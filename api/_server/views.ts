/**
 * Read-endpoint assembly. `GET /overview` and `GET /branches/:name` return
 * counts and per-branch divergence the client cannot cheaply derive;
 * `GET /merge-requests/:id` returns raw engine output (`report`, `migration`)
 * plus queue framing (ADR 0004 §7). Every function takes `db` and runs its own
 * reads so the routes stay thin.
 */

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { diffSnapshots } from "../../engine/diff.js";
import { threeWayMerge } from "../../engine/merge.js";
import { emitMigration, type Migration } from "../../engine/emit.js";
import type { SchemaDocument, ColumnType } from "../../engine/schema.js";
import type { MergeReport, Resolution } from "../../engine/merge-types.js";
import type { MergeMarker } from "../../src/domain/operations.js";
import type { Db, DbOrTx } from "./db/client.js";
import { branches, deletedBranches, mergeRequests, mergeRequestResolutions, operations, users } from "./db/schema.js";
import type {
  Database,
  BranchDetail,
  BranchSummary,
  DeletedBranchSummary,
  MergeKickback,
  MergeRequestResponse,
  MergeSummary,
  Overview,
} from "./types.js";

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const sameDoc = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

type MrRow = typeof mergeRequests.$inferSelect;

/**
 * A terminal merge request — one that will never merge, so it is out of the
 * queue, does not block its source branch, and is never re-freshened on read.
 */
export const isTerminal = (status: MrRow["status"]): boolean =>
  status === "merged" || status === "closed";

export type ResolvedMerge = {
  merged: SchemaDocument | null;
  report: MergeReport;
  migration: Migration | null;
  appliedResolutions: MergeRequestResponse["appliedResolutions"];
  droppedResolutions: MergeRequestResponse["droppedResolutions"];
};

/**
 * Run the three-way merge for `mr` with its stored resolutions folded in
 * (ADR 0004 §6). A stored row is dropped — and reported in `droppedResolutions`
 * — when its conflict is gone from the current bare report (`absent`) or its
 * `conflict_snapshot` no longer matches (`changed`). The surviving rows are fed
 * to `threeWayMerge` and echoed back as `appliedResolutions` so the client can
 * render the resolved conflict cards (a resolved conflict drops out of
 * `report.conflicts`).
 */
export async function resolveMerge(
  db: DbOrTx,
  mr: MrRow,
  triple: { base: SchemaDocument; ours: SchemaDocument; theirs: SchemaDocument } = mr,
): Promise<ResolvedMerge> {
  const { base, ours, theirs } = triple;
  const stored = await db
    .select()
    .from(mergeRequestResolutions)
    .where(eq(mergeRequestResolutions.mrId, mr.id));

  const { report: bare } = threeWayMerge(base, ours, theirs, []);
  const currentById = new Map(bare.conflicts.map((c) => [c.id, c]));

  const valid: Resolution[] = [];
  const appliedResolutions: ResolvedMerge["appliedResolutions"] = [];
  const droppedResolutions: ResolvedMerge["droppedResolutions"] = [];

  for (const row of stored) {
    const current = currentById.get(row.conflictId);
    if (!current) {
      droppedResolutions.push({ conflictId: row.conflictId, why: "absent" });
      continue;
    }
    const snapshot = { base: current.base, ours: current.ours, theirs: current.theirs };
    if (JSON.stringify(row.conflictSnapshot) !== JSON.stringify(snapshot)) {
      droppedResolutions.push({ conflictId: row.conflictId, why: "changed" });
      continue;
    }
    valid.push(
      row.choice === "type"
        ? { conflictId: row.conflictId, choice: "type", type: row.payload as ColumnType }
        : row.choice === "ours"
          ? { conflictId: row.conflictId, choice: "ours" }
          : { conflictId: row.conflictId, choice: "theirs" },
    );
    appliedResolutions.push({
      conflictId: row.conflictId,
      choice: row.choice,
      type: row.payload ?? null,
      snapshot,
    });
  }

  const { merged, report } = threeWayMerge(base, ours, theirs, valid);
  const migration = merged ? emitMigration(theirs, merged) : null;
  return { merged, report, migration, appliedResolutions, droppedResolutions };
}

function countObjects(doc: SchemaDocument): Pick<Database, "tables" | "columns" | "indexes" | "constraints"> {
  let columns = 0;
  let indexes = 0;
  let constraints = 0;
  for (const t of doc.tables) {
    columns += t.columns.length;
    indexes += t.indexes.length;
    constraints += (t.primaryKey ? 1 : 0) + t.uniques.length + t.foreignKeys.length;
  }
  return { tables: doc.tables.length, columns, indexes, constraints };
}

async function nameMap(db: DbOrTx): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, displayName: users.displayName }).from(users);
  return new Map(rows.map((u) => [u.id, u.displayName]));
}

// ── merge queue (ADR 0004 §3–§6) ────────────────────────────────────────────

/**
 * Lazily re-freeze a live merge request's triple on read (ADR 0004 §5, ADR 0012 §1).
 *
 * `ours` **always** follows the source branch's current `head` — for a `queued`
 * request as much as for the active one. That is the D-12 fix: before it, an
 * author who kept editing their branch after opening the request saw a merge
 * screen frozen at creation, with no way to tell it was showing yesterday's
 * work. `base` never moves (it is the branch cut point).
 *
 * `theirs` still only follows live `main` for the **active** request
 * (`open`/`held`), which is ADR 0004 §5's promotion refresh unchanged. A
 * `queued` request keeps the `main` it was previewed against, so `stale` stays
 * the honest signal that the trunk moved while it waited — refreshing `theirs`
 * too would silently erase that.
 *
 * A terminal request is a record, not a live view: it is returned exactly as
 * stored so a later `GET` recomputes the identical report.
 *
 * Plain `UPDATE`, no `FOR UPDATE`: the merge transaction is the real
 * serialization point, and a read that races a merge simply self-corrects on
 * the next read (`stale` briefly shows the drift).
 */
export async function refreshTriple(db: DbOrTx, mr: MrRow): Promise<MrRow> {
  if (isTerminal(mr.status)) return mr;
  const [main] = await db.select().from(branches).where(eq(branches.name, mr.targetBranch));
  const [source] = await db.select().from(branches).where(eq(branches.name, mr.sourceBranch));
  if (!main || !source) return mr;

  const active = mr.status === "open" || mr.status === "held";
  const theirs = active ? main.head : mr.theirs;
  const previewedMainVersion = active ? main.headVersion : mr.previewedMainVersion;
  if (
    mr.previewedMainVersion === previewedMainVersion &&
    sameDoc(mr.ours, source.head) &&
    sameDoc(mr.theirs, theirs)
  ) {
    return mr;
  }
  const [updated] = await db
    .update(mergeRequests)
    .set({ ours: source.head, theirs, previewedMainVersion })
    .where(eq(mergeRequests.id, mr.id))
    .returning();
  return updated ?? mr;
}

/** Queue framing for one MR — `position` (1 = front / active), `ahead`, `behind`. */
export async function queueFraming(
  db: DbOrTx,
  mr: MrRow,
): Promise<MergeRequestResponse["queue"]> {
  if (isTerminal(mr.status)) {
    return { status: mr.status, position: 0, ahead: 0, behind: 0 };
  }
  const rows = await db
    .select({ id: mergeRequests.id })
    .from(mergeRequests)
    .where(
      and(
        eq(mergeRequests.targetBranch, mr.targetBranch),
        notInArray(mergeRequests.status, ["merged", "closed"]),
      ),
    )
    .orderBy(asc(mergeRequests.createdAt));
  const idx = rows.findIndex((r) => r.id === mr.id);
  const position = idx < 0 ? rows.length + 1 : idx + 1;
  return { status: mr.status, position, ahead: position - 1, behind: Math.max(0, rows.length - position) };
}

const joinAnd = (xs: string[]): string =>
  xs.length <= 1 ? xs[0] ?? "" : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}`;

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numberWord = (n: number): string => WORDS[n] ?? String(n);
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The `409` kick-back body for a non-clean merge re-run (ADR 0004 §4,
 * `docs/backend-contract.md` §6). `landed` is the merge markers appended to the
 * target's op log since this MR's `previewed_main_version` — the most recent
 * `(main.headVersion - previewedMainVersion)` of them.
 */
export async function revalidationKickback(
  db: DbOrTx,
  mr: MrRow,
  report: MergeReport,
  droppedResolutions: ResolvedMerge["droppedResolutions"],
): Promise<MergeKickback> {
  const [main] = await db.select().from(branches).where(eq(branches.name, mr.targetBranch));
  const behind = Math.max(0, (main?.headVersion ?? 0) - mr.previewedMainVersion);

  let landed: MergeKickback["landed"] = [];
  if (behind > 0) {
    const markerRows = await db
      .select()
      .from(operations)
      .where(eq(operations.branchName, mr.targetBranch))
      .orderBy(asc(operations.seq));
    landed = markerRows
      .filter((r) => r.op.type === "merge")
      .slice(-behind)
      .map((r) => ({ branch: (r.op as { sourceBranch: string }).sourceBranch, mergedAt: r.at.toISOString() }));
  }

  const n = report.conflicts.length;
  // `landed` is only populated in the window between promotion and the first
  // read of the MR — once a `GET` refreshes `previewed_main_version` to the
  // current head (ADR 0004 §5), "merges since previewed" is empty and the
  // conflict is stated without naming what jumped ahead.
  const lead = landed.length
    ? `${mr.targetBranch} moved on while this was open: ${joinAnd(landed.map((l) => l.branch))} merged ahead of you. `
    : `this branch now diverges from ${mr.targetBranch}. `;
  const tail =
    report.verdict === "unclassified-divergence"
      ? "Applying your changes and what landed in different orders now disagree."
      : `${cap(numberWord(n))} of your changes now conflict${n === 1 ? "s" : ""} with what landed.`;

  return {
    error: "revalidation-failed",
    reason: report.verdict as MergeKickback["reason"],
    landed,
    conflicts: report.conflicts,
    droppedResolutions,
    summary: cap(lead) + tail,
  };
}

/** Non-terminal merge request whose source is `branchName`, if any. */
export async function openMergeNumberFor(db: Db, branchName: string): Promise<number | undefined> {
  const rows = await db
    .select({ number: mergeRequests.number, status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.sourceBranch, branchName));
  return rows.find((r) => !isTerminal(r.status))?.number;
}

export async function listBranchSummaries(db: Db): Promise<BranchSummary[]> {
  const [branchRows, mrRows, names] = await Promise.all([
    db.select().from(branches),
    db.select({ source: mergeRequests.sourceBranch, status: mergeRequests.status, number: mergeRequests.number }).from(mergeRequests),
    nameMap(db),
  ]);
  const openMr = new Map<string, number>();
  for (const mr of mrRows) if (!isTerminal(mr.status)) openMr.set(mr.source, mr.number);

  const out = branchRows.map((b) => {
    const s: BranchSummary = {
      name: b.name,
      author: b.name === "main" ? "" : names.get(b.authorId) ?? b.authorId,
      cutOn: isoDate(b.createdAt),
      divergence: b.name === "main" ? 0 : diffSnapshots(b.baseSnapshot, b.head).length,
    };
    if (b.name === "main") s.trunk = true;
    const mnum = openMr.get(b.name);
    if (mnum !== undefined) s.openMergeNumber = mnum;
    return s;
  });
  out.sort((a, b) => (a.trunk ? -1 : b.trunk ? 1 : a.name.localeCompare(b.name)));
  return out;
}

/**
 * The `deleted_branches` archive, most-recently dropped first (ADR 0013). Each
 * row is a whole branch moved off `branches` at delete time; `author` is the
 * branch's author resolved to a display name, `divergence` the frozen
 * `base` → `head` delta count.
 */
export async function listDeletedBranches(db: Db): Promise<DeletedBranchSummary[]> {
  const [rows, names] = await Promise.all([db.select().from(deletedBranches), nameMap(db)]);
  return rows
    .map((r) => ({
      name: r.name,
      author: names.get(r.authorId) ?? r.authorId,
      deletedAt: r.deletedAt.toISOString(),
      divergence: diffSnapshots(r.baseSnapshot, r.head).length,
    }))
    .sort((a, b) => (a.deletedAt === b.deletedAt ? a.name.localeCompare(b.name) : a.deletedAt < b.deletedAt ? 1 : -1));
}

/** The open-merge queue (non-terminal only — the shape has no "merged" state). */
export async function listOpenMergeSummaries(db: Db): Promise<MergeSummary[]> {
  const [mrRows, names, ops] = await Promise.all([
    db.select().from(mergeRequests),
    nameMap(db),
    db.select({ branchName: operations.branchName }).from(operations),
  ]);
  const opCount = (branch: string) => ops.filter((o) => o.branchName === branch).length;

  const nonTerminal = mrRows
    .filter((mr) => !isTerminal(mr.status))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return Promise.all(
    nonTerminal.map(async (row, idx) => {
      // every live MR's `ours` follows its source branch; only the active one's
      // `theirs` follows live `main` (ADR 0004 §5, ADR 0012 §1).
      const mr = await refreshTriple(db, row);
      const { report, appliedResolutions } = await resolveMerge(db, mr);
      // `report.conflicts` is the engine's full detected set — it does not drop
      // an entry once resolved (the engine `Conflict` carries no `resolvedWith`;
      // only `verdict` reflects resolution). Count the ones still open.
      const resolvedIds = new Set(appliedResolutions.map((r) => r.conflictId));
      const openConflicts = report.conflicts.filter((c) => !resolvedIds.has(c.id)).length;
      return {
        number: mr.number,
        source: mr.sourceBranch,
        target: mr.targetBranch,
        author: names.get(mr.authorId) ?? mr.authorId,
        openedOn: isoDate(mr.createdAt),
        operations: opCount(mr.sourceBranch),
        position: idx + 1,
        // a queued MR's frozen triple can still be clean; the list must not
        // call that mergeable. Front-of-queue rows keep clean/held from the
        // live three-way.
        status:
          row.status === "queued"
            ? ("queued" as const)
            : report.verdict === "clean"
              ? ("clean" as const)
              : ("held" as const),
        conflicts: openConflicts,
      };
    }),
  );
}

/**
 * The Closed list — every terminal request, `closed` and `merged` alike, most
 * recently finished first. Like GitHub's closed filter, it carries both; the
 * per-row `status` tells them apart (ADR 0012 §3, ADR 0013 §6). Deliberately
 * *not* a three-way re-run: a terminal request is a record, its triple is never
 * re-frozen, and a conflict count for something that will never merge again
 * would be noise. `position` and `conflicts` are 0. `operations` reads 0 for a
 * `merged` row — its source branch and op log were removed by the merge
 * (ADR 0013 §6); the Merges surface does not render the count anyway.
 */
export async function listTerminalMergeSummaries(db: Db): Promise<MergeSummary[]> {
  const [rows, names, ops] = await Promise.all([
    db
      .select()
      .from(mergeRequests)
      .where(inArray(mergeRequests.status, ["closed", "merged"])),
    nameMap(db),
    db.select({ branchName: operations.branchName }).from(operations),
  ]);

  const finishedAt = (mr: MrRow): number =>
    (mr.status === "merged" ? mr.mergedAt : mr.closedAt)?.getTime() ?? 0;

  return rows
    .sort((a, b) => finishedAt(b) - finishedAt(a))
    .map((mr) => ({
      number: mr.number,
      source: mr.sourceBranch,
      target: mr.targetBranch,
      author: names.get(mr.authorId) ?? mr.authorId,
      openedOn: isoDate(mr.createdAt),
      operations: ops.filter((o) => o.branchName === mr.sourceBranch).length,
      position: 0,
      status: mr.status as "closed" | "merged",
      conflicts: 0,
      ...(mr.status === "merged" && mr.mergedAt ? { mergedOn: isoDate(mr.mergedAt) } : {}),
      ...(mr.status === "closed" && mr.closedAt ? { closedOn: isoDate(mr.closedAt) } : {}),
    }));
}

/**
 * `main`'s revision history — one entry per merge that has landed on trunk,
 * newest first, capped at ten (`docs/backend-contract.md` §3–§4). The source is
 * `main`'s `operations` rows whose `op` is a `MergeMarker`: ADR 0010 §5's merge
 * transaction appends exactly one per successful merge. `n` is the real revision
 * number — the 1-based position of the merge in `main`'s full marker sequence —
 * so the newest entry's `n` equals `database.trunkRevision` even when older
 * entries are trimmed. The marker carries only `sourceBranch`; `summary` states
 * the one fact it adds beyond `sourceBranch`/`at` — who ran the merge, resolved
 * to a display name.
 */
function trunkRevisions(
  mainOps: (typeof operations.$inferSelect)[],
  names: Map<string, string>,
): Overview["revisions"] {
  const markers = mainOps
    .filter((o): o is typeof o & { op: MergeMarker } => o.op.type === "merge")
    .sort((a, b) => a.seq - b.seq);
  return markers
    .map((o, i) => ({
      n: i + 1,
      sourceBranch: o.op.sourceBranch,
      at: isoDate(o.at),
      summary: names.has(o.authorId) ? `merged by ${names.get(o.authorId)!}` : "merged",
    }))
    .reverse()
    .slice(0, 10);
}

export async function assembleOverview(db: Db): Promise<Overview> {
  const branchRows = await db.select().from(branches);
  const main = branchRows.find((b) => b.name === "main");
  if (!main) throw new Error("no main branch — reset the workspace");

  const mainOps = await db.select().from(operations).where(eq(operations.branchName, "main"));
  const lastChange = mainOps.reduce<Date>((acc, o) => (o.at > acc ? o.at : acc), main.createdAt);

  // The trunk revision is the number of merges that have landed on `main` — the
  // count of merge markers in its op log. `main.headVersion` happens to match
  // today (the merge transaction bumps it and `main` cannot be edited directly),
  // but `head_version` is a per-edit counter on working branches; deriving from
  // the markers keeps the counter and the list below consistent by construction.
  const names = await nameMap(db);
  const revisions = trunkRevisions(mainOps, names);
  const trunkRevision = mainOps.filter((o) => o.op.type === "merge").length;

  const database: Database = {
    name: main.head.database,
    connection: "postgres",
    ...countObjects(main.head),
    trunk: "main",
    trunkRevision,
    trunkChangedOn: isoDate(lastChange),
  };

  const [branchList, merges] = await Promise.all([listBranchSummaries(db), listOpenMergeSummaries(db)]);
  return { database, branches: branchList, merges, revisions };
}

export async function assembleBranchDetail(db: Db, name: string): Promise<BranchDetail | null> {
  const [b] = await db.select().from(branches).where(eq(branches.name, name));
  if (!b) return null;
  const names = await nameMap(db);
  return {
    name: b.name,
    author: b.name === "main" ? "" : names.get(b.authorId) ?? b.authorId,
    cutOn: isoDate(b.createdAt),
    head: b.head,
    base: b.baseSnapshot,
    divergence: b.name === "main" ? 0 : diffSnapshots(b.baseSnapshot, b.head).length,
    openMergeRequestNumber: (await openMergeNumberFor(db, b.name)) ?? null,
  };
}

/**
 * Recompute `report` + `migration` (with stored resolutions) for a merge-request
 * row, plus real queue framing (ADR 0004 §3–§5). The frozen triple is refreshed
 * first: `ours` to the source branch's live head either way, `theirs` to live
 * `main` only for the active MR — so a `queued` request still shows `stale` if
 * `main` moved since it was previewed (ADR 0012 §1).
 *
 * `droppedResolutions` is how that refresh reports itself: if moving `ours`
 * invalidated a stored choice, the row is named here rather than discarded in
 * silence (ADR 0004 §6, ADR 0012 §2).
 */
export async function assembleMergeResponse(db: DbOrTx, row: MrRow): Promise<MergeRequestResponse> {
  const names = await nameMap(db);
  const mr = await refreshTriple(db, row);
  const { report, migration, appliedResolutions, droppedResolutions } = await resolveMerge(db, mr);
  const [main] = await db.select().from(branches).where(eq(branches.name, mr.targetBranch));

  return {
    number: mr.number,
    source: mr.sourceBranch,
    target: mr.targetBranch,
    author: names.get(mr.authorId) ?? mr.authorId,
    openedAt: mr.createdAt.toISOString(),
    base: mr.base,
    ours: mr.ours,
    theirs: mr.theirs,
    report,
    migration,
    queue: await queueFraming(db, mr),
    stale: main ? mr.previewedMainVersion !== main.headVersion : false,
    appliedResolutions,
    droppedResolutions,
  };
}

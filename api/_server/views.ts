/**
 * Read-endpoint assembly. `GET /overview` and `GET /branches/:name` return
 * counts and per-branch divergence the client cannot cheaply derive;
 * `GET /merge-requests/:id` returns raw engine output (`report`, `migration`)
 * plus queue framing (ADR 0004 §7). Every function takes `db` and runs its own
 * reads so the routes stay thin.
 */

import { eq } from "drizzle-orm";
import { diffSnapshots } from "../../engine/diff.js";
import { threeWayMerge } from "../../engine/merge.js";
import { emitMigration, type Migration } from "../../engine/emit.js";
import type { SchemaDocument, ColumnType } from "../../engine/schema.js";
import type { MergeReport, Resolution } from "../../engine/merge-types.js";
import type { Db } from "./db/client.js";
import { branches, mergeRequests, mergeRequestResolutions, operations, users } from "./db/schema.js";
import type {
  Database,
  BranchDetail,
  BranchSummary,
  MergeRequestResponse,
  MergeSummary,
  Overview,
} from "./types.js";

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

type MrRow = typeof mergeRequests.$inferSelect;

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
  db: Db,
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

async function nameMap(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ id: users.id, displayName: users.displayName }).from(users);
  return new Map(rows.map((u) => [u.id, u.displayName]));
}

/** Non-terminal merge request whose source is `branchName`, if any. */
export async function openMergeIdFor(db: Db, branchName: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: mergeRequests.id, status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.sourceBranch, branchName));
  return rows.find((r) => r.status !== "merged")?.id;
}

export async function listBranchSummaries(db: Db): Promise<BranchSummary[]> {
  const [branchRows, mrRows, names] = await Promise.all([
    db.select().from(branches),
    db.select({ source: mergeRequests.sourceBranch, status: mergeRequests.status, id: mergeRequests.id }).from(mergeRequests),
    nameMap(db),
  ]);
  const openMr = new Map<string, string>();
  for (const mr of mrRows) if (mr.status !== "merged") openMr.set(mr.source, mr.id);

  const out = branchRows.map((b) => {
    const s: BranchSummary = {
      name: b.name,
      author: b.name === "main" ? "" : names.get(b.authorId) ?? b.authorId,
      cutOn: isoDate(b.createdAt),
      divergence: b.name === "main" ? 0 : diffSnapshots(b.baseSnapshot, b.head).length,
    };
    if (b.name === "main") s.trunk = true;
    const mid = openMr.get(b.name);
    if (mid) s.openMergeId = mid;
    return s;
  });
  out.sort((a, b) => (a.trunk ? -1 : b.trunk ? 1 : a.name.localeCompare(b.name)));
  return out;
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
    .filter((mr) => mr.status !== "merged")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return Promise.all(
    nonTerminal.map(async (mr) => {
      const { report, appliedResolutions } = await resolveMerge(db, mr);
      // `report.conflicts` is the engine's full detected set — it does not drop
      // an entry once resolved (the engine `Conflict` carries no `resolvedWith`;
      // only `verdict` reflects resolution). Count the ones still open.
      const resolvedIds = new Set(appliedResolutions.map((r) => r.conflictId));
      const openConflicts = report.conflicts.filter((c) => !resolvedIds.has(c.id)).length;
      return {
        id: mr.id,
        source: mr.sourceBranch,
        target: mr.targetBranch,
        author: names.get(mr.authorId) ?? mr.authorId,
        openedOn: isoDate(mr.createdAt),
        operations: opCount(mr.sourceBranch),
        status: report.verdict === "clean" ? ("clean" as const) : ("held" as const),
        conflicts: openConflicts,
      };
    }),
  );
}

export async function assembleOverview(db: Db): Promise<Overview> {
  const branchRows = await db.select().from(branches);
  const main = branchRows.find((b) => b.name === "main");
  if (!main) throw new Error("no main branch — reset the workspace");

  const mainOps = await db.select().from(operations).where(eq(operations.branchName, "main"));
  const lastChange = mainOps.reduce<Date>((acc, o) => (o.at > acc ? o.at : acc), main.createdAt);

  const database: Database = {
    name: main.head.database,
    connection: "postgres",
    ...countObjects(main.head),
    trunk: "main",
    trunkRevision: main.headVersion,
    trunkChangedOn: isoDate(lastChange),
  };

  const [branchList, merges] = await Promise.all([listBranchSummaries(db), listOpenMergeSummaries(db)]);
  return { database, branches: branchList, merges };
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
    openMergeRequestId: (await openMergeIdFor(db, b.name)) ?? null,
  };
}

/** Recompute `report` + `migration` (with stored resolutions) for a merge-request row; attach the V0 queue framing. */
export async function assembleMergeResponse(db: Db, mr: MrRow): Promise<MergeRequestResponse> {
  const names = await nameMap(db);
  const { report, migration, appliedResolutions, droppedResolutions } = await resolveMerge(db, mr);

  return {
    id: mr.id,
    source: mr.sourceBranch,
    target: mr.targetBranch,
    author: names.get(mr.authorId) ?? mr.authorId,
    openedAt: mr.createdAt.toISOString(),
    base: mr.base,
    ours: mr.ours,
    theirs: mr.theirs,
    report,
    migration,
    queue: { status: mr.status, position: 1, ahead: 0, behind: 0 },
    stale: false,
    appliedResolutions,
    droppedResolutions,
  };
}

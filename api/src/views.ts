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
import { emitMigration } from "../../engine/emit.js";
import type { SchemaDocument } from "../../engine/schema.js";
import type { Db } from "./db/client.js";
import { branches, mergeRequests, operations, users } from "./db/schema.js";
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

  return mrRows
    .filter((mr) => mr.status !== "merged")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((mr) => {
      const { report } = threeWayMerge(mr.base, mr.ours, mr.theirs, []);
      return {
        id: mr.id,
        source: mr.sourceBranch,
        target: mr.targetBranch,
        author: names.get(mr.authorId) ?? mr.authorId,
        openedOn: isoDate(mr.createdAt),
        operations: opCount(mr.sourceBranch),
        status: report.verdict === "clean" ? ("clean" as const) : ("held" as const),
        conflicts: report.conflicts.length,
      };
    });
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

/** Recompute `report` + `migration` for a merge-request row; attach the V0 queue framing. */
export async function assembleMergeResponse(db: Db, mr: MrRow): Promise<MergeRequestResponse> {
  const names = await nameMap(db);
  const { merged, report } = threeWayMerge(mr.base, mr.ours, mr.theirs, []);
  const migration = merged ? emitMigration(mr.theirs, merged) : null;

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
    droppedResolutions: [],
  };
}

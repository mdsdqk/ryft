/**
 * Domain aggregates for the read endpoints. `GET /overview` and
 * `GET /branches/:name` return counts and per-branch divergence the client
 * cannot cheaply derive; everything else is raw engine output (ADR 0004 §7).
 *
 * Every function takes `db` and runs its own reads — the routes stay thin.
 */

import { eq } from "drizzle-orm";
import { diffSnapshots } from "../../engine/diff.js";
import { threeWayMerge } from "../../engine/merge.js";
import type { SchemaDocument } from "../../engine/schema.js";
import type { Db } from "./db/client.js";
import { branches, mergeRequests, operations, users } from "./db/schema.js";
import type { Database, BranchSummary, MergeSummary, Overview } from "./types.js";

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

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

/** Non-terminal merge request whose source is `branchName`, if any. */
async function openMergeIdFor(db: Db, branchName: string): Promise<string | undefined> {
  const rows = await db
    .select({ id: mergeRequests.id, status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.sourceBranch, branchName));
  return rows.find((r) => r.status !== "merged")?.id;
}

export async function assembleOverview(db: Db): Promise<Overview> {
  const [branchRows, mrRows, userRows] = await Promise.all([
    db.select().from(branches),
    db.select().from(mergeRequests),
    db.select().from(users),
  ]);
  const nameOf = new Map(userRows.map((u) => [u.id, u.displayName]));

  const main = branchRows.find((b) => b.name === "main");
  if (!main) throw new Error("no main branch — reset the workspace");

  const mainOps = await db.select().from(operations).where(eq(operations.branchName, "main"));
  const lastMainChange = mainOps.reduce<Date>((acc, o) => (o.at > acc ? o.at : acc), main.createdAt);

  const database: Database = {
    name: main.head.database,
    connection: "postgres",
    ...countObjects(main.head),
    trunk: "main",
    trunkRevision: main.headVersion,
    trunkChangedOn: isoDate(lastMainChange),
  };

  const openMr = new Map<string, string>();
  for (const mr of mrRows) if (mr.status !== "merged") openMr.set(mr.sourceBranch, mr.id);

  const opCounts = await db.select().from(operations);
  const countFor = (branchName: string) => opCounts.filter((o) => o.branchName === branchName).length;

  const branchSummaries: BranchSummary[] = branchRows.map((b) => {
    const base: BranchSummary = {
      name: b.name,
      author: b.name === "main" ? "" : nameOf.get(b.authorId) ?? b.authorId,
      cutOn: isoDate(b.createdAt),
      divergence: b.name === "main" ? 0 : diffSnapshots(b.baseSnapshot, b.head).length,
    };
    if (b.name === "main") base.trunk = true;
    const mid = openMr.get(b.name);
    if (mid) base.openMergeId = mid;
    return base;
  });
  branchSummaries.sort((a, b) => (a.trunk ? -1 : b.trunk ? 1 : a.name.localeCompare(b.name)));

  const merges: MergeSummary[] = mrRows
    .filter((mr) => mr.status !== "merged")
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((mr) => {
      const { report } = threeWayMerge(mr.base, mr.ours, mr.theirs, []);
      return {
        id: mr.id,
        source: mr.sourceBranch,
        target: mr.targetBranch,
        author: nameOf.get(mr.authorId) ?? mr.authorId,
        openedOn: isoDate(mr.createdAt),
        operations: countFor(mr.sourceBranch),
        status: report.verdict === "clean" ? "clean" : "held",
        conflicts: report.conflicts.length,
      };
    });

  return { database, branches: branchSummaries, merges };
}

export { openMergeIdFor };

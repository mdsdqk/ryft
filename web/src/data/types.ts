/**
 * Resource shapes the UI reads. These are the contract between the surfaces and
 * whatever backs the data — a fixture today (`./fixture.ts`), the Hono API later.
 * See docs/design/app-flow-work-breakdown.md, decision 5.
 *
 * Dates are ISO-8601 date strings (`2026-02-08`). Ids are opaque strings.
 */

export type Database = {
  /** the Postgres namespace under version control; there is only one */
  name: string;
  connection: string;
  tables: number;
  columns: number;
  indexes: number;
  constraints: number;
  /** the trunk branch — always `main` in V0/V1 */
  trunk: string;
  trunkRevision: number;
  trunkChangedOn: string;
};

export type BranchSummary = {
  name: string;
  author: string;
  cutOn: string;
  /** count of operations that have diverged this branch from its base */
  divergence: number;
};

export type MergeSummary = {
  id: string;
  source: string;
  target: string;
  author: string;
  openedOn: string;
  operations: number;
  status: "clean" | "held";
  /** unresolved conflicts; 0 unless status is "held" */
  conflicts: number;
};

/** The landing aggregate — everything the rail and the dashboard need in one read. */
export type Overview = {
  database: Database;
  branches: BranchSummary[];
  merges: MergeSummary[];
};

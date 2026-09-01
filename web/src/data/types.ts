/**
 * Resource shapes the UI reads. These are the contract between the surfaces and
 * whatever backs the data — a fixture today (`./fixture.ts`), the Hono API later.
 * See docs/design/app-flow-work-breakdown.md, decision 5.
 *
 * Dates are ISO-8601 date strings (`2026-02-08`). Ids are opaque strings.
 */

import type { SchemaDocument } from "@engine/schema.js";
import type { Operation } from "@engine/operations.js";

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
  /** the trunk (`main`) — listed on `/branches`, never deleted, never △N */
  trunk?: boolean;
  /** id of an open merge request whose source is this branch; blocks delete */
  openMergeId?: string;
};

export type MergeSummary = {
  id: string;
  source: string;
  target: string;
  author: string;
  openedOn: string;
  operations: number;
  /**
   * `clean` — mergeable; `held` — blocked on conflicts; `stale` — `main`
   * moved after this request opened. The list never conveys these by colour.
   */
  status: "clean" | "held" | "stale";
  /** unresolved conflicts; 0 unless status is "held" */
  conflicts: number;
};

/** The landing aggregate — everything the rail and the dashboard need in one read. */
export type Overview = {
  database: Database;
  branches: BranchSummary[];
  merges: MergeSummary[];
};

/**
 * One branch's working state — the branch workspace's read (`/branch/:name`).
 * `head` is the branch's current schema; `base` is `main`'s schema frozen at
 * cut time. The Schema sub-sheet renders `head`; the Divergence sub-sheet is
 * `diffSnapshots(base, head)`, computed client-side. Mirrors the API's
 * `BranchDetail` (docs/backend-contract.md §3), projected: `author` is already
 * resolved to a display name, `openMergeId` is flattened from the nullable API
 * field.
 */
export type BranchDetail = {
  name: string;
  author: string;
  /** ISO-8601 date the branch was cut from `main` */
  cutOn: string;
  head: SchemaDocument;
  base: SchemaDocument;
  /** count of derived deltas `base` → `head` */
  divergence: number;
  /** id of an open merge request whose source is this branch, if any */
  openMergeId?: string;
};

/**
 * One entry in a branch's operation log — the "what changed on this branch"
 * stream, ascending `seq`. The engine never reads this (ADR 0001 §2); it drives
 * the operation list and per-row `△N` on the Schema sub-sheet, and LIFO undo.
 * Projected from the API's `LogEntry`: `authorId` is resolved to `author`.
 */
export type BranchOperationEntry = {
  /** per-branch monotonic counter from 1; the `△N` shown on the surface */
  seq: number;
  /** ISO-8601 timestamp, display only — ordering is `seq` */
  at: string;
  /** resolved display name of who made the edit */
  author: string;
  op: Operation;
};

/**
 * Result of a structured-editor write — `POST /branches/:name/operations`
 * (docs/backend-contract.md §3). One transaction: `head` is the branch's new
 * schema, `appliedSeqs` the log positions the batch took. Non-blocking
 * warnings are surfaced client-side from `validateOperation`, not carried here.
 */
export type ApplyOpsResult = {
  head: SchemaDocument;
  appliedSeqs: number[];
  headVersion: number;
};

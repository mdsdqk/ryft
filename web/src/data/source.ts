/**
 * The data seam. Every surface reads through a `DataSource`; nothing imports a
 * concrete implementation except `./index.ts`, which picks one.
 *
 * V0 ships `getOverview` (rail + dashboard), the branches resource (WU-A),
 * the merges resource (WU-B), and the branch-workspace reads (WU-E · E1).
 * E2–E4 add `applyOperations`, `undoAfter`, and the open-merge-request call.
 */

import type { Operation } from "@engine/operations.js";
import type { SchemaDocument } from "@engine/schema.js";

import type {
  ApplyOpsResult,
  BranchDetail,
  BranchOperationEntry,
  BranchSummary,
  MergeSummary,
  Overview,
} from "./types.ts";

export type CreateBranchArgs = {
  name: string;
  author: string;
  /** ISO-8601 date (`2026-02-12`) — the client stamps the cut day */
  cutOn: string;
};

export interface DataSource {
  /** database stats + the branches and open merges, in one read */
  getOverview(): Promise<Overview>;
  /** trunk first, then working branches — the `/branches` list */
  listBranches(): Promise<BranchSummary[]>;
  /** open merge requests, oldest first — the `/merges` queue */
  listMerges(): Promise<MergeSummary[]>;
  /** cut a working branch from `main`; throws on a bad or taken name */
  createBranch(args: CreateBranchArgs): Promise<BranchSummary>;
  /** drop a working branch; throws if it is the trunk or held by an open MR */
  deleteBranch(name: string): Promise<void>;

  /** one branch's `head` + `base` documents; throws `BranchNotFoundError` on a miss */
  getBranchDetail(name: string): Promise<BranchDetail>;
  /** the branch's operation log, ascending `seq` */
  listBranchOperations(name: string): Promise<BranchOperationEntry[]>;
  /**
   * Apply a batch of structured edits in one transaction. Throws
   * `OperationBlockedError` (from `@engine/apply-operation`) if any op fails its
   * precondition — nothing is written.
   */
  applyOperations(name: string, ops: Operation[]): Promise<ApplyOpsResult>;
  /** Undo every operation after `seq` (LIFO), returning the rebuilt head. */
  undoAfter(
    name: string,
    seq: number,
  ): Promise<{ head: SchemaDocument; headVersion: number }>;
  /**
   * Open `source → main` (WU-E · E4). Idempotent — if one is already open for
   * `source` its id comes back, so the caller never has to handle a `409`.
   */
  createMergeRequest(
    source: string,
  ): Promise<{ id: string; status: "open" | "queued" | "held" | "merged" }>;
}

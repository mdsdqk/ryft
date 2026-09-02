/**
 * The data seam. Every surface reads through a `DataSource`; nothing imports a
 * concrete implementation except `./index.ts`, which picks one.
 *
 * V0 ships `getOverview` (rail + dashboard), the branches resource (WU-A),
 * the merges resource (WU-B), and the branch-workspace reads (WU-E · E1).
 * E2–E4 add `applyOperations`, `undoAfter`, and the open-merge-request call.
 * Merge-review wiring adds `getMergeReview` / resolution mutations / `mergeMergeRequest`.
 */

import type { Operation } from "@engine/operations.js";
import type { ColumnType, SchemaDocument } from "@engine/schema.js";

import type { MergeReview } from "../merge-review/model.ts";
import type {
  ApplyOpsResult,
  BranchDetail,
  BranchOperationEntry,
  BranchSummary,
  DeletedBranchSummary,
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
  /**
   * The `/merges` list. `state` defaults to `"open"` — the live queue, oldest
   * first. `"closed"` is the record of requests withdrawn without merging, most
   * recently closed first (ADR 0012 §3).
   */
  listMerges(state?: "open" | "closed"): Promise<MergeSummary[]>;
  /** cut a working branch from `main`; throws on a bad or taken name */
  createBranch(args: CreateBranchArgs): Promise<BranchSummary>;
  /** drop a working branch; throws if it is the trunk or held by an open MR */
  deleteBranch(name: string): Promise<void>;
  /** archived (deleted) branches, most-recently dropped first — `/branches/deleted` */
  listDeletedBranches(): Promise<DeletedBranchSummary[]>;

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

  /** One merge request's review model; throws `MergeRequestNotFoundError` on a miss. */
  getMergeReview(id: string): Promise<MergeReview>;
  /**
   * Record a conflict choice (`docs/backend-contract.md` §3). `type` is
   * required iff `choice === "type"`. Returns the review recomputed with the
   * resolution applied.
   */
  postResolution(
    id: string,
    conflictId: string,
    choice: "ours" | "theirs" | "type",
    type?: ColumnType,
  ): Promise<MergeReview>;
  /** Drop a recorded choice, reopening the conflict. */
  deleteResolution(id: string, conflictId: string): Promise<MergeReview>;
  /**
   * Sign off a cleared merge request (`POST /merge-requests/:id/merge`).
   * Throws `MergeRevalidationError` if live `main` no longer merges clean.
   */
  mergeMergeRequest(id: string): Promise<{ status: "merged" }>;
  /**
   * Close a merge request without merging it (`POST /merge-requests/:id/close`).
   * The request keeps its row and moves to the closed list; the next queued
   * request is promoted if this one held the front. Throws if it already
   * merged — a merged request is a record of something that happened.
   */
  closeMergeRequest(id: string): Promise<void>;
}

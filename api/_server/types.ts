/**
 * API response shapes. These mirror `web/src/data/types.ts` and
 * `docs/backend-contract.md` §4 — the contract the frontend data seam will bind
 * to in the follow-up iteration (ADR 0010 §7). The API returns raw domain and
 * engine data plus framing the client cannot derive (queue position,
 * staleness); it does not pre-render display strings (ADR 0004 §7).
 *
 * `SchemaDocument`, `MergeReport`, `Migration` are re-exported from the engine
 * at the call sites that need them.
 */

import type { SchemaDocument, ColumnType } from "../../engine/schema.js";
import type { MergeReport } from "../../engine/merge-types.js";
import type { Migration } from "../../engine/emit.js";
import type { StructuralError } from "../../engine/validate.js";
import type { LogEntry } from "../../src/domain/operations.js";
import type { User, Organization } from "../../src/domain/users.js";

export type Database = {
  name: string;
  connection: string;
  tables: number;
  columns: number;
  indexes: number;
  constraints: number;
  trunk: string;
  trunkRevision: number;
  trunkChangedOn: string;
};

export type BranchSummary = {
  name: string;
  author: string;
  cutOn: string;
  divergence: number;
  trunk?: boolean;
  openMergeId?: string;
};

export type MergeSummary = {
  id: string;
  source: string;
  target: string;
  author: string;
  openedOn: string;
  operations: number;
  /** 1-based place in the open queue (oldest first); 0 for a closed request. */
  position: number;
  status: "clean" | "held" | "stale" | "queued" | "closed";
  conflicts: number;
  /** ISO-8601 date the request was closed; set iff `status` is `closed`. */
  closedOn?: string;
};

export type Overview = {
  database: Database;
  branches: BranchSummary[];
  merges: MergeSummary[];
};

/**
 * One row of the `deleted_branches` archive — `GET /branches/deleted` (ADR 0013).
 * `divergence` is the `base` → `head` delta count frozen at deletion, the same
 * cheap `diffSnapshots` the live list runs.
 */
export type DeletedBranchSummary = {
  name: string;
  author: string;
  /** ISO-8601 timestamp the branch was dropped */
  deletedAt: string;
  divergence: number;
};

export type SessionResponse = { user: User; organization: Organization };

export type BranchDetail = {
  name: string;
  author: string;
  cutOn: string;
  head: SchemaDocument;
  base: SchemaDocument;
  divergence: number;
  openMergeRequestId: string | null;
};

export type MergeRequestResponse = {
  id: string;
  source: string;
  target: string;
  author: string;
  openedAt: string;
  base: SchemaDocument;
  ours: SchemaDocument;
  theirs: SchemaDocument;
  report: MergeReport;
  /** `emitMigration(theirs, merged)` — `null` when the merge is not clean (no merged doc to render). */
  migration: Migration | null;
  queue: {
    status: "queued" | "open" | "held" | "merged" | "closed";
    /** 0 for a terminal request — it holds no place in the queue. */
    position: number;
    ahead: number;
    behind: number;
  };
  stale: boolean;
  /**
   * The stored resolutions that are currently in force (ADR 0004 §6). A resolved
   * conflict is absent from `report.conflicts`, so the client rebuilds its card
   * from this — `conflictId` is `${class}:${sortedObjectIds}`; `snapshot` is the
   * conflict's frozen `base`/`ours`/`theirs` payloads.
   */
  appliedResolutions: Array<{
    conflictId: string;
    choice: "ours" | "theirs" | "type";
    type: ColumnType | null;
    snapshot: { base: unknown; ours: unknown; theirs: unknown };
  }>;
  droppedResolutions: Array<{ conflictId: string; why: "changed" | "absent" }>;
};

/**
 * `POST /merge-requests/:id/merge` — the `409` body when the re-run against live
 * `main` is not clean (ADR 0004 §4, `docs/backend-contract.md` §6). Names what
 * landed ahead and what now conflicts; never says the author's state is invalid.
 * The MR moves to `held` and keeps its place at the front of the queue.
 */
export type MergeKickback = {
  error: "revalidation-failed";
  reason: MergeReport["verdict"]; // "conflicts" | "unclassified-divergence"
  landed: Array<{ branch: string; mergedAt: string }>; // merges into the target since previewed_main_version
  conflicts: MergeReport["conflicts"]; // fresh from the re-run
  droppedResolutions: MergeRequestResponse["droppedResolutions"];
  summary: string;
};

/**
 * `POST /merge-requests/:id/merge` — the `409` body when the re-run against live
 * `main` is `clean` but the merged candidate fails whole-document structural
 * validation (ADR 0008 §5). Two individually-valid branches composed into an
 * invalid document — a dangling reference, a duplicate name, an orphaned foreign
 * key. Nothing is written; the MR keeps its status and its place at the front,
 * and the author fixes the source branch and retries.
 */
export type MergeStructuralKickback = {
  error: "structural-validation-failed";
  errors: StructuralError[];
};

export type OperationsResponse = {
  head: SchemaDocument;
  appliedSeqs: number[];
  headVersion: number;
  warnings: Array<{ reason: string; message: string; objectId: string }>;
};

/**
 * `POST /branches/:name/operations` — the `422` body when the batch applies
 * op-by-op cleanly but the resulting branch head fails whole-document structural
 * validation (ADR 0008 §5, `docs/robustness.md` §5). A backstop: `validateOperation`
 * should already have blocked any single-op route to an invalid whole, so this
 * fires only on a gap in the per-op rules or a batch that composed to an
 * incoherent document. Nothing is persisted. Distinct from the op-level `422`
 * (`{ error, failedAt, op, ... }`) — there is no single failing op here.
 */
export type OperationsStructuralError = {
  error: "structural-validation-failed";
  errors: StructuralError[];
};

/** `DELETE /branches/:name/operations?after=<seq>` — the rebuilt head after an undo. */
export type UndoResponse = {
  head: SchemaDocument;
  headVersion: number;
};

export type { LogEntry };
export type { StructuralError, StructuralErrorReason } from "../../engine/validate.js";

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
  status: "clean" | "held" | "stale";
  conflicts: number;
};

export type Overview = {
  database: Database;
  branches: BranchSummary[];
  merges: MergeSummary[];
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
  queue: { status: "queued" | "open" | "held" | "merged"; position: number; ahead: number; behind: number };
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

export type OperationsResponse = {
  head: SchemaDocument;
  appliedSeqs: number[];
  headVersion: number;
  warnings: Array<{ reason: string; message: string; objectId: string }>;
};

/** `DELETE /branches/:name/operations?after=<seq>` — the rebuilt head after an undo. */
export type UndoResponse = {
  head: SchemaDocument;
  headVersion: number;
};

export type { LogEntry };

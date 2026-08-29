/**
 * Branch operation log.
 *
 * The ordered list of schema edits made on a branch, captured at edit time. It
 * is a UI and audit convenience — "what changed on this branch", and undo — and
 * it is NOT load-bearing for merge correctness. Object identity is carried by
 * stable ids in the schema snapshots (see `engine/schema.ts`); the three-way
 * merge matches objects by id and never consults a recorded operation log. See
 * ADR 0001 §2 and ADR 0002.
 *
 * The edit vocabulary itself — `Operation` — lives in `engine/operations.ts` and
 * is shared with the merge engine, which builds a *derived* `Operation[]` from
 * snapshot state. There is only one vocabulary. This module adds the `LogEntry`
 * envelope (who / when / sequence) and the audit-only `merge` marker on top.
 */

import type { Operation } from "../../engine/operations.js";

export type { Operation };

/**
 * The audit breadcrumb written onto `main`'s log when a merge request lands.
 * Carries no schema delta — the delta is already in `main`'s new head — so it is
 * a domain concept, not part of the engine's edit vocabulary. `LogEntry.authorId`
 * records who ran the merge.
 */
export interface MergeMarker {
  type: "merge";
  mergeRequestId: string;
  sourceBranch: string;
}

/** What a log entry can carry: any schema edit, or the merge marker. */
export type LogOp = Operation | MergeMarker;

export interface LogEntry {
  /**
   * Per-branch monotonic counter, from 1. Orders the history view and drives
   * "undo the last N". Carries no identity weight and is referenced by nothing.
   */
  seq: number;
  /** ISO 8601. Display only — ordering is `seq`, because wall-clock is unreliable. */
  at: string;
  /** `User.id` (a UUID). The engine never reads this; the app resolves it to a name. */
  authorId: string;
  op: LogOp;
}

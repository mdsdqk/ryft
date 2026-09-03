/**
 * Merge-review view model.
 *
 * The shape the merge-review screen renders. It is derivable from what the
 * semantic merge engine (ticket 0002) produces — base / ours / theirs snapshots,
 * a derived `Operation[]` per side, the classified conflict set, the merged
 * document, and the rendered DDL — but it is deliberately a *view* model: every
 * string the screen shows is pre-rendered here so the components stay dumb and
 * the engine stays free to change its internals.
 *
 * `RevisionRef.op` carries the real engine `Operation` so the fixture cannot
 * drift from the engine's vocabulary; everything else is display data.
 */

import type { Operation } from "@engine/operations.js";

export type Side = "ours" | "theirs";

/**
 * PlanetScale's vocabulary, adopted (CONTEXT.md § Diff and merge), plus the
 * engine's named catch-all (`engine/merge-types.ts` `divergent-definition` —
 * a divergence classify recognises but that isn't one of the six named
 * classes, e.g. two branches setting a table's primary key differently).
 */
export type ConflictClass =
  | "divergent-retype"
  | "add-vs-add"
  | "rename-vs-rename"
  | "divergent-index"
  | "drop-vs-modify"
  | "dependency"
  | "divergent-definition";

export type Severity = "clear" | "subtle";

export interface Party {
  /** `User.id` (a UUID). */
  userId: string;
  /** Resolved display name — `User.displayName`. */
  name: string;
}

export interface RevisionRef {
  /** The △ number shown throughout the screen. Stable within one review. */
  n: number;
  side: Side;
  author: Party;
  /** ISO 8601, display only. */
  at: string;
  /** The real derived edit. */
  op: Operation;
  /** Name of the table this edit is on — the section it belongs to (Zone A) and
   *  the label the operation log carries when a merge spans several tables. */
  table: string;
  /** Pre-rendered one-line summary, e.g. "rename col_s2 → status_v2". */
  summary: string;
}

export type ChangeKind =
  | "rename"
  | "retype"
  | "add-column"
  | "drop-column"
  | "set-nullable"
  | "set-default"
  | "add-index"
  | "change-index"
  | "drop-index"
  | "add-unique"
  | "change-unique"
  | "drop-unique"
  | "add-fk"
  | "change-fk"
  | "drop-fk"
  | "add-pk"
  | "change-pk"
  | "drop-pk"
  | "create-table"
  | "rename-table"
  | "drop-table";

export interface SideChange {
  kind: ChangeKind;
  /** Links to `RevisionRef.n`. */
  revision: number;
  /** Pre-rendered, e.g. "varchar(20) → varchar(32)". */
  detail: string;
  /** For renames: the struck-through prior name and the new one. */
  wasName?: string;
  newName?: string;
}

export type RowResolution =
  | { state: "clean" }
  | { state: "auto-merged"; note: string }
  | { state: "conflict"; conflictId: string }
  | { state: "gated"; byConflictId: string; note: string };

export type ObjectGroup = "columns" | "indexes" | "constraints";

/**
 * A pre-rendered destructive / risk advisory for a row (ADR 0008 §6). `kind` is
 * "destructive" for an irreversible drop, "risk" for a legal-but-lossy edit;
 * `message` is the verbatim `OpWarning.message` the engine composed. Never
 * blocks — row data is out of scope, so every one of these is advisory.
 */
export interface RowWarning {
  kind: "destructive" | "risk";
  message: string;
}

export interface ComparisonRow {
  /** Stable id(s). Composite (add-vs-add) shows both. */
  objectId: string;
  /** e.g. "orders.status". */
  objectLabel: string;
  /** Owning table name — groups the row into its per-table section (Zone A). */
  table: string;
  group: ObjectGroup;
  ours: SideChange | null;
  theirs: SideChange | null;
  resolution: RowResolution;
  /** Leader-line note under a cell — a rebase explanation, most often. */
  leader?: { text: string; tone: "ok" | "muted" };
  /** Destructive / risk advisories from either side's delta. */
  warnings?: RowWarning[];
}

export interface ConflictOption {
  id: string;
  label: string;
  /** Keyboard hint shown on the button, e.g. "1". */
  hint?: string;
  kind: "ours" | "theirs" | "custom";
}

export interface Conflict {
  id: string;
  cls: ConflictClass;
  severity: Severity;
  /** Table the conflicted object lives in — disambiguates `objectLabel` in the
   *  conflict queue (Zone B) when a merge touches more than one table. */
  table: string;
  objectLabel: string;
  objectId: string;
  /** One-line statement of the divergence. */
  title: string;
  ours: { author: Party; detail: string };
  theirs: { author: Party; detail: string };
  options: ConflictOption[];
  /** `ConflictOption.id` once chosen, else null. */
  resolvedWith: string | null;
  /** Object labels this conflict blocks downstream until it resolves. */
  gates: string[];
}

/**
 * The merge-request lifecycle, by its internal keys — the screen shows
 * Queued / Under review / Reviewed / Merged (ADR 0011). `closed` is the fifth
 * and it is off the line rather than at the end of it: a request withdrawn
 * without merging (ADR 0012 §3). Terminal, like `released`.
 */
export type RevisionStatus = "received" | "in-check" | "cleared" | "released" | "closed";

export interface DdlStatement {
  sql: string;
  /** △ tag, or null for engine-inserted glue. */
  revision: number | null;
  side: Side | null;
  rebased?: boolean;
  /** The engine's `DdlStatement.destructive` — a drop that tears down data
   *  (`dropColumn` / `dropTable`). Marks the line in the fabrication order. */
  destructive?: boolean;
}

export interface DdlBlocked {
  /** e.g. "conflict 2 (rename vs rename) — also gates uq_orders_tracking, fk targets". */
  reason: string;
  conflictId: string;
}

export interface FabricationOrder {
  statements: DdlStatement[];
  blocked: DdlBlocked[];
  /** Always true — Postgres has transactional DDL (CONTEXT.md § Output). */
  transactional: true;
}

/**
 * A table-level change — create / drop / rename — on one side. Rendered as a
 * single banner line at the head of that table's comparison section (Zone A),
 * not as an object row: a created table's columns are not separate ops, and a
 * dropped table has no rows left to compare. It still appears in the operation
 * log and the fabrication order like any other revision.
 */
export interface TableChange {
  /** Table name — the section this banner sits above. For a rename, the *new* name. */
  table: string;
  /** Links to `RevisionRef.n`. */
  revision: number;
  side: Side;
  kind: "create-table" | "drop-table" | "rename-table";
  /** Pre-rendered: "orders → orders_v2" for a rename, "" for create / drop. */
  detail: string;
}

export interface MergeReview {
  /** GitHub-style public identifier — the `#N` shown in the rail and title strip. */
  number: number;
  source: string;
  target: string;
  /** e.g. "main@3a91f4". */
  base: string;
  /**
   * Every table this merge request touches, busiest first. A merge request is
   * whole-schema (source head vs target head), so the screen shows one
   * comparison section per entry (Zone A); the operation log and fabrication
   * order span all of them. A single-table merge has one entry and reads
   * exactly as it did before.
   */
  tables: string[];
  openedBy: Party;
  openedAt: string;
  status: RevisionStatus;
  /**
   * Queue placement (ADR 0004 §3). `ahead` is how many requests must merge
   * before this one; a request at the front has `ahead: 0`. Absent on fixtures
   * that predate the queue — treat as "at the front".
   */
  queue?: { position: number; ahead: number; behind: number };
  /**
   * The server re-freezes `ours` from the source branch's live head on every
   * read (ADR 0012 §1), so a branch edit made after the request opened lands
   * here. When that refresh invalidated conflict choices already recorded, this
   * names them — one pre-rendered line each — so the screen can say what was
   * un-chosen instead of dropping it in silence (ADR 0012 §2). Absent when
   * nothing dropped; never blocks the merge.
   */
  refreshNote?: { droppedResolutions: string[] };
  rows: ComparisonRow[];
  conflicts: Conflict[];
  revisions: RevisionRef[];
  /** Table-level create / drop / rename — one entry per side that made one.
   *  Empty on the common case where every side only altered existing tables. */
  tableChanges: TableChange[];
  autoMergedCount: number;
  /** Rows carrying an irreversible `drop-destructive` — the "destructive
   *  changes" roll-up (ADR 0008 §6). */
  destructiveCount: number;
  fabricationOrder: FabricationOrder;
  commutativity: "pending" | "passed" | "failed";
}

// ── derived selectors ───────────────────────────────────────────────────────

export function openConflicts(review: MergeReview): Conflict[] {
  return review.conflicts.filter((c) => c.resolvedWith === null);
}

export function isMergeable(review: MergeReview): boolean {
  return openConflicts(review).length === 0 && review.commutativity === "passed";
}

/**
 * `cleared` is derived, not stored — a request is Reviewed the moment nothing is
 * outstanding. The two terminal states short-circuit that: a merged or closed
 * request is what it is, however its conflicts happen to read now.
 */
export function effectiveStatus(review: MergeReview): RevisionStatus {
  if (review.status === "released" || review.status === "closed") return review.status;
  return isMergeable(review) ? "cleared" : review.status;
}

/** Terminal — the request is finished either way, so the screen is read-only. */
export function isTerminal(status: RevisionStatus): boolean {
  return status === "released" || status === "closed";
}

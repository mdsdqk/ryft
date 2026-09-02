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

export type RevisionStatus = "received" | "in-check" | "cleared" | "released";

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

export interface MergeReview {
  source: string;
  target: string;
  /** e.g. "main@3a91f4". */
  base: string;
  /** Primary table under review — V0 is single-namespace, one table per review screen. */
  table: string;
  openedBy: Party;
  openedAt: string;
  status: RevisionStatus;
  rows: ComparisonRow[];
  conflicts: Conflict[];
  revisions: RevisionRef[];
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

export function effectiveStatus(review: MergeReview): RevisionStatus {
  if (review.status === "released") return "released";
  return isMergeable(review) ? "cleared" : review.status;
}

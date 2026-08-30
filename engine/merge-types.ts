/**
 * Public types for the semantic three-way merge — the conflict report and the
 * resolution input. Zero runtime code. See `docs/merge-engine.md` §5, §9, §10.
 *
 * The report is data, never an interactive prompt: the same object serves the
 * merge-review screen, a CI check, and an agent.
 */

import type { ColumnType } from "./schema.js";
import type { Operation } from "./operations.js";

/** Which kind of schema object a conflict or note is about. */
export type ObjectKind = "table" | "column" | "primaryKey" | "index" | "unique" | "foreignKey";

/** The seven conflict classes (`docs/merge-engine.md` §5). */
export type ConflictClass =
  | "divergent-retype" // 1
  | "add-vs-add" // 2
  | "rename-vs-rename" // 3
  | "divergent-index-definition" // 4
  | "drop-vs-modify" // 5
  | "dependency-conflict" // 6
  | "divergent-definition"; // 7 — named catch-all

/** PlanetScale's severity vocabulary. Six classes are clear; dependency conflict is subtle. */
export type Severity = "clear" | "subtle";

export type MergeVerdict = "clean" | "conflicts" | "unclassified-divergence";

/** A recorded choice that settles one conflict. Stored in the domain, re-fed to `threeWayMerge`. */
export type Resolution =
  | { conflictId: string; choice: "ours" }
  | { conflictId: string; choice: "theirs" }
  | { conflictId: string; choice: "type"; type: ColumnType }; // divergent retype only

/** One entry in the conflict queue. */
export interface Conflict {
  /** Stable within a report and across re-runs of an unchanged conflict; a `Resolution` key. */
  id: string;
  class: ConflictClass;
  severity: Severity;
  object: { kind: ObjectKind; id: string; table?: string };
  /** Payload shape depends on the class; `null` where a side did not touch the object. */
  base: unknown | null;
  ours: unknown | null;
  theirs: unknown | null;
  /** The `choice` values this conflict accepts. */
  resolutionModes: Array<Resolution["choice"]>;
}

/** A dependent change that stayed resolved across a rename on the other side — the success wash. */
export interface RebasedChange {
  op: Operation;
  followedRename: { objectId: string; kind: ObjectKind; from: string; to: string };
}

/** Both sides made the identical change; applied once. */
export interface OverlapNote {
  slot: string;
  kind: ObjectKind;
  objectId: string;
}

/** A degenerate-overlap id rewrite (two branches added a structurally identical column). */
export interface IdRemap {
  kind: ObjectKind;
  from: string;
  to: string;
}

/** Set when `verdict === "unclassified-divergence"`. */
export interface UnclassifiedDivergence {
  kind: "unclassified-divergence";
  /** Why the oracle failed: the two application orders disagreed, or a delta would not replay. */
  reason: "non-commutative" | "apply-error";
  detail: string;
  /** Objects whose state differs between the two application orders — for the held-merge banner. */
  divergingObjects: Array<{ kind: ObjectKind; id: string; table?: string }>;
}

export interface MergeReport {
  verdict: MergeVerdict;
  conflicts: Conflict[];
  rebased: RebasedChange[];
  overlaps: OverlapNote[];
  remaps: IdRemap[];
  divergence?: UnclassifiedDivergence;
}

/**
 * Destructive-warning derivation for a *diff*, shared by the branch Divergence
 * sub-sheet and the merge-review screen (ADR 0008 §6 / `docs/robustness.md` §6).
 *
 * The structured editor gets its `OpWarning`s straight from `validateOperation`
 * as each edit lands. The diff and merge views have no live edit — they hold a
 * base/head pair — so this re-runs `validateOperation` over the *derived* delta
 * (`diffSnapshots(base, head)`), against `base`, and keeps the warnings. A
 * derived delta is legal by construction, so any `OpError` it produces is a
 * resolution artefact (an op whose target was created later in the same delta)
 * and is dropped.
 *
 * The one ADR 0008 §2 carve-out is applied here: `not-null-no-default` is silent
 * when the same delta also gives that column a non-null default.
 */

import type { SchemaDocument } from "@engine/schema.js";
import type { Operation } from "@engine/operations.js";
import { isOpError, validateOperation, type OpWarning } from "@engine/validate.js";

export type DeltaWarnings = Map<string, OpWarning[]>;

/** Warnings for `ops` (a `diffSnapshots(base, head)` delta), keyed by the stable
 *  id of the schema object each warning is about — the same id `changedObjectId`
 *  returns for the op, so callers can look up per row. */
export function deltaWarnings(base: SchemaDocument, ops: readonly Operation[]): DeltaWarnings {
  const givenDefault = new Set<string>();
  for (const op of ops) {
    if (op.type === "setDefault" && op.to !== null) givenDefault.add(op.columnId);
    if (op.type === "addColumn" && op.column.default !== null) givenDefault.add(op.column.id);
  }

  const byObjectId: DeltaWarnings = new Map();
  for (const op of ops) {
    for (const d of validateOperation(base, op)) {
      if (isOpError(d)) continue;
      if (d.reason === "not-null-no-default" && givenDefault.has(d.objectId)) continue;
      const list = byObjectId.get(d.objectId);
      if (list) list.push(d);
      else byObjectId.set(d.objectId, [d]);
    }
  }
  return byObjectId;
}

/** Whether `warnings` carries a `drop-destructive` — used for the "destructive
 *  changes" roll-up counts on both surfaces. */
export function hasDestructive(warnings: readonly OpWarning[] | undefined): boolean {
  return !!warnings?.some((w) => w.reason === "drop-destructive");
}

/** The category word that leads a rendered warning line. `drop-destructive` is
 *  the only one that is irreversible; the rest are "legal but risky". */
export function warningKindLabel(reason: OpWarning["reason"]): "destructive" | "risk" {
  return reason === "drop-destructive" ? "destructive" : "risk";
}

/** `"destructive — dropping column \"email\" is irreversible"` — the label plus
 *  the verbatim `OpWarning.message`, the one string both surfaces show. */
export function warningLine(w: OpWarning): string {
  return `${warningKindLabel(w.reason)} — ${w.message}`;
}

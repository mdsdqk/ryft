/**
 * The editor's apply contract. A control builds one `Operation` and hands it to
 * `ApplyFn`; the surface validates it against the current head, sends it as a
 * one-op batch when clean, and reports back. Errors block and stay on the
 * control; warnings are advisory and shown after the edit lands (grill Q1/Q15).
 */

import type { Operation } from "@engine/operations.js";
import type { OpError, OpWarning } from "@engine/validate.js";

export type ApplyOutcome =
  | { ok: true; warnings: OpWarning[] }
  | { ok: false; errors: OpError[] };

export type ApplyFn = (op: Operation) => Promise<ApplyOutcome>;

/** First error message, or a fallback. */
export function firstMessage(errors: OpError[], fallback: string): string {
  return errors[0]?.message ?? fallback;
}

/** `foreignKey` → `foreign key` for the dependents list. */
export function prettyKind(kind: string): string {
  return kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

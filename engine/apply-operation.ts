/**
 * applyOperation — apply one validated schema edit to a document.
 *
 * Ticket 0008 / ADR 0004 §8. The server's single-operation entry point: the
 * structured-editor route (`POST /branches/:name/operations`) runs each incoming
 * `Operation` through this, and the structured editor itself shares the same
 * `validateOperation` for inline feedback so the two can never disagree about
 * what is legal.
 *
 *   applyOperation(doc, op)
 *     ├─ validateOperation(doc, op)                    (engine/validate.ts)
 *     ├─ any OpError            → throw OperationBlockedError (nothing applied)
 *     └─ else                   → structuredClone(doc), applyOne, return
 *                                 { head, warnings }
 *
 * Pure and framework-free, like the rest of `engine/`. It never mutates `doc`.
 *
 * Batch use (`docs/robustness.md` §5): the caller folds a list by threading
 * `head` — op *n* is validated against the document with ops *1 … n−1* already
 * applied — stops at the first `OperationBlockedError`, and concatenates the
 * `warnings` from each step. That loop is the caller's; this function is one op.
 */

import { applyOne } from "./apply.js";
import { isOpError, validateOperation } from "./validate.js";
import type { OpError, OpWarning } from "./validate.js";
import type { Operation } from "./operations.js";
import type { SchemaDocument } from "./schema.js";

/** Thrown when `validateOperation` returns an `OpError`. Carries the first one and the op. */
export class OperationBlockedError extends Error {
  constructor(
    /** The first blocking error. For `drop-blocked` it carries `dependents`. */
    readonly error: OpError,
    /** The operation that was refused. */
    readonly op: Operation,
  ) {
    super(error.message);
    this.name = "OperationBlockedError";
  }
}

export interface ApplyOperationResult {
  /** The new document. A fresh object — `doc` is untouched. */
  head: SchemaDocument;
  /** Non-blocking advisories for this op (drops, lossy retypes, NOT-NULL-no-default). */
  warnings: OpWarning[];
}

export function applyOperation(doc: SchemaDocument, op: Operation): ApplyOperationResult {
  const diagnostics = validateOperation(doc, op);
  const firstError = diagnostics.find(isOpError);
  if (firstError) throw new OperationBlockedError(firstError, op);

  const warnings = diagnostics.filter((d): d is OpWarning => !isOpError(d));
  const head = structuredClone(doc);
  applyOne(head, op);
  return { head, warnings };
}

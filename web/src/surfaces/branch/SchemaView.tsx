/**
 * The Schema sub-sheet — every table on the branch as an editable card, with the
 * branch's operation log alongside. `△N` on a row is the highest `seq` of the
 * operations that touched that object (grill Q10), read from the log. The
 * two-column body (cards · operations) is the Detail pattern; the per-control
 * apply loop is the Form pattern.
 *
 * `apply` is the editor's whole contract: validate the op against the current
 * head, send it as a one-op batch when clean, reload, and hand back errors
 * (block) or warnings (advisory). Undo is LIFO — it walks `seq` backward
 * (grill Q6).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SchemaDocument } from "@engine/schema.js";
import { OperationBlockedError } from "@engine/apply-operation.js";
import { isOpError, validateOperation, type OpWarning } from "@engine/validate.js";

import { source, type BranchOperationEntry } from "../../data/index.ts";
import { NewTableCard } from "./NewTableCard.tsx";
import { OperationList } from "./OperationList.tsx";
import { TableCard } from "./TableCard.tsx";
import type { ApplyFn, ApplyOutcome } from "./edit.ts";
import { changedObjectId, summarizeOp, type NameOf } from "./format.ts";

function buildNameOf(head: SchemaDocument): NameOf {
  const names = new Map<string, string>();
  for (const t of head.tables) {
    names.set(t.id, t.name);
    for (const c of t.columns) names.set(c.id, c.name);
    if (t.primaryKey) names.set(t.primaryKey.id, t.primaryKey.name);
    for (const ix of t.indexes) names.set(ix.id, ix.name);
    for (const u of t.uniques) names.set(u.id, u.name);
    for (const fk of t.foreignKeys) names.set(fk.id, fk.name);
  }
  return (id) => names.get(id) ?? id;
}

function buildMarks(entries: BranchOperationEntry[]): Map<string, number> {
  const marks = new Map<string, number>();
  for (const e of entries) {
    const id = changedObjectId(e.op);
    marks.set(id, Math.max(marks.get(id) ?? 0, e.seq));
  }
  return marks;
}

export function SchemaView({
  name,
  head,
  operations,
  reload,
}: {
  name: string;
  head: SchemaDocument;
  operations: BranchOperationEntry[];
  reload: () => void;
}) {
  const editable = name !== "main";
  const nameOf = useMemo(() => buildNameOf(head), [head]);
  const marks = useMemo(() => buildMarks(operations), [operations]);
  const markOf = (id: string) => marks.get(id);
  const [undoing, setUndoing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [landedSeq, setLandedSeq] = useState<number | null>(null);
  const prevMaxSeq = useRef<number | null>(null);

  useEffect(() => {
    prevMaxSeq.current = null;
    setLandedSeq(null);
  }, [name]);

  useEffect(() => {
    const maxSeq = operations.reduce((m, e) => Math.max(m, e.seq), 0);
    const prev = prevMaxSeq.current;
    if (prev === null) {
      prevMaxSeq.current = maxSeq;
      return;
    }
    if (maxSeq > prev) setLandedSeq(maxSeq);
    prevMaxSeq.current = maxSeq;
  }, [operations]);

  const apply = useCallback<ApplyFn>(
    async (op) => {
      const diags = validateOperation(head, op);
      const errors = diags.filter(isOpError);
      if (errors.length) return { ok: false, errors } satisfies ApplyOutcome;
      try {
        await source.applyOperations(name, [op]);
        reload();
        return {
          ok: true,
          warnings: diags.filter((d): d is OpWarning => !isOpError(d)),
        } satisfies ApplyOutcome;
      } catch (e) {
        if (e instanceof OperationBlockedError) {
          return { ok: false, errors: [e.error] } satisfies ApplyOutcome;
        }
        return {
          ok: false,
          errors: [
            {
              reason: "target-not-found",
              message: e instanceof Error ? e.message : "The edit failed.",
            },
          ],
        } satisfies ApplyOutcome;
      }
    },
    [head, name, reload],
  );

  const last = operations[operations.length - 1];
  const undoLast = async () => {
    if (!last) return;
    setUndoing(true);
    try {
      await source.undoAfter(name, last.seq - 1);
      reload();
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="bw-grid">
      <div className="bw-main">
        <h2 className="bw-main__k">
          Schema
          <span className="bw-main__ct">
            {head.tables.length} table{head.tables.length === 1 ? "" : "s"}
          </span>
          {editable && (
            <button className="bw-mini bw-mini--create" type="button" onClick={() => setCreating(true)}>
              + create table
            </button>
          )}
        </h2>
        <div className="bw-cards">
          {creating && <NewTableCard apply={apply} onClose={() => setCreating(false)} />}
          {head.tables.map((t) => (
            <TableCard
              key={t.id}
              table={t}
              tables={head.tables}
              nameOf={nameOf}
              markOf={markOf}
              landedSeq={landedSeq}
              apply={apply}
              editable={editable}
            />
          ))}
        </div>
      </div>
      <aside className="bw-rail">
        <OperationList entries={operations} nameOf={nameOf} landedSeq={landedSeq} />
        {editable && last && (
          <button className="bw-undo" type="button" disabled={undoing} onClick={() => void undoLast()}>
            {undoing ? "Undoing…" : `Undo △${last.seq} — ${summarizeOp(last.op, nameOf)}`}
          </button>
        )}
      </aside>
    </div>
  );
}

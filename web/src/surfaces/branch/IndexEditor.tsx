/**
 * In-place editor for one index row. The previous V0 path was drop-only;
 * changeIndex is a real control now — member columns (click order) and the
 * unique flag each commit their own operation, same as a column's type select.
 */

import { useEffect, useState } from "react";

import type { Index } from "@engine/schema.js";
import type { OpWarning } from "@engine/validate.js";

import type { ApplyFn } from "./edit.ts";
import { firstMessage } from "./edit.ts";
import { ColumnPicker, DropConfirm, sameIdList } from "./fields.tsx";

type Mode = "fields" | "confirm-drop";

export function IndexEditor({
  tableId,
  index,
  columns,
  apply,
  onClose,
}: {
  tableId: string;
  index: Index;
  columns: { id: string; name: string }[];
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(index.columnIds);
  const [unique, setUnique] = useState(index.unique);
  const [mode, setMode] = useState<Mode>("fields");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<OpWarning[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPicked(index.columnIds), [index.columnIds]);
  useEffect(() => setUnique(index.unique), [index.unique]);

  const run = async (op: Parameters<ApplyFn>[0], after?: () => void) => {
    setBusy(true);
    setError(null);
    const outcome = await apply(op);
    setBusy(false);
    if (outcome.ok) {
      setWarnings(outcome.warnings);
      after?.();
    } else {
      setError(firstMessage(outcome.errors, "The edit was refused."));
    }
    return outcome.ok;
  };

  const commit = (nextCols: string[], nextUnique: boolean) => {
    if (!nextCols.length) return;
    if (sameIdList(nextCols, index.columnIds) && nextUnique === index.unique) return;
    void run({
      type: "changeIndex",
      tableId,
      indexId: index.id,
      from: { name: index.name, columnIds: index.columnIds, unique: index.unique },
      to: { name: index.name, columnIds: nextCols, unique: nextUnique },
    }).then((ok) => {
      if (!ok) {
        setPicked(index.columnIds);
        setUnique(index.unique);
      }
    });
  };

  if (mode === "confirm-drop") {
    return (
      <DropConfirm
        what={`index ${index.name}`}
        confirmLabel="Drop index"
        busy={busy}
        onCancel={() => setMode("fields")}
        onConfirm={() => void run({ type: "dropIndex", tableId, index }, onClose)}
      />
    );
  }

  return (
    <div className="bw-ed" role="group" aria-label={`Edit index ${index.name}`}>
      <ColumnPicker
        columns={columns}
        picked={picked}
        disabled={busy}
        onChange={(ids) => {
          setPicked(ids);
          commit(ids, unique);
        }}
      />
      <label className="bw-check bw-check--inline">
        <input
          type="checkbox"
          checked={unique}
          disabled={busy}
          onChange={(e) => {
            const next = e.target.checked;
            setUnique(next);
            commit(picked, next);
          }}
        />
        unique
      </label>
      {error && (
        <p className="bw-ed__err" role="alert">
          {error}
        </p>
      )}
      {warnings.map((w) => (
        <p key={w.reason} className="bw-ed__note">
          {w.message}
        </p>
      ))}
      <div className="bw-ed__foot">
        <button className="mr-btn mr-btn--ghost" type="button" onClick={() => setMode("confirm-drop")}>
          Drop
        </button>
        <button className="mr-btn" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

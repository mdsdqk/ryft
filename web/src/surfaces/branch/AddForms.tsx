/**
 * Inline blank editors for the card-level add actions (grill Q14) — the same
 * expand-in-place language as editing a row, appended to the group. Ids are
 * minted client-side with the engine's `freshId`; the server re-validates.
 */

import { useEffect, useRef, useState } from "react";

import { freshId } from "@engine/id.js";

import type { ApplyFn } from "./edit.ts";
import { firstMessage } from "./edit.ts";
import { typeForValue, TYPE_PRESETS } from "./format.ts";

function useApply(apply: ApplyFn, onClose: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (op: Parameters<ApplyFn>[0]) => {
    setBusy(true);
    setError(null);
    const outcome = await apply(op);
    setBusy(false);
    if (outcome.ok) onClose();
    else setError(firstMessage(outcome.errors, "The edit was refused."));
  };
  return { busy, error, submit };
}

export function AddColumnForm({
  tableId,
  tableName,
  apply,
  onClose,
}: {
  tableId: string;
  tableName: string;
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState("text");
  const [nullable, setNullable] = useState(true);
  const { busy, error, submit } = useApply(apply, onClose);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const add = () => {
    const nm = name.trim();
    if (!nm) return;
    void submit({
      type: "addColumn",
      tableId,
      column: {
        id: freshId("col", `${tableName}_${nm}`),
        name: nm,
        type: typeForValue(type),
        nullable,
        default: null,
      },
    });
  };

  return (
    <div className="bw-ed bw-ed--add" role="group" aria-label={`Add a column to ${tableName}`}>
      <div className="bw-ed__grid">
        <label className="bw-fld">
          <span>name</span>
          <input
            ref={ref}
            className="bw-in"
            value={name}
            spellCheck={false}
            autoComplete="off"
            placeholder="column_name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </label>
        <label className="bw-fld">
          <span>type</span>
          <select className="bw-in" value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_PRESETS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="bw-fld">
          <span>nullable</span>
          <select
            className="bw-in"
            value={nullable ? "null" : "not null"}
            onChange={(e) => setNullable(e.target.value === "null")}
          >
            <option value="not null">not null</option>
            <option value="null">null</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="bw-ed__err" role="alert">
          {error}
        </p>
      )}
      <div className="bw-ed__row">
        <button className="mr-btn mr-btn--ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button className="mr-btn mr-btn--primary" type="button" disabled={busy || !name.trim()} onClick={add}>
          {busy ? "Adding…" : "Add column"}
        </button>
      </div>
    </div>
  );
}

export function AddIndexForm({
  tableId,
  tableName,
  columns,
  apply,
  onClose,
}: {
  tableId: string;
  tableName: string;
  columns: { id: string; name: string }[];
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [unique, setUnique] = useState(false);
  const [name, setName] = useState("");
  const { busy, error, submit } = useApply(apply, onClose);

  const chosenNames = columns.filter((c) => picked.includes(c.id)).map((c) => c.name);
  const suggested = chosenNames.length
    ? `${tableName}_${chosenNames.join("_")}_${unique ? "key" : "idx"}`
    : "";
  const effectiveName = name.trim() || suggested;

  const toggle = (id: string) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const add = () => {
    if (!picked.length || !effectiveName) return;
    void submit({
      type: "addIndex",
      tableId,
      index: {
        id: freshId("idx", `${tableName}_${chosenNames.join("_")}`),
        name: effectiveName,
        columnIds: picked,
        unique,
      },
    });
  };

  return (
    <div className="bw-ed bw-ed--add" role="group" aria-label={`Add an index to ${tableName}`}>
      <fieldset className="bw-ed__cols">
        <legend>columns</legend>
        {columns.map((c) => (
          <label key={c.id} className="bw-check">
            <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
            {c.name}
          </label>
        ))}
      </fieldset>
      <div className="bw-ed__grid">
        <label className="bw-fld bw-fld--wide">
          <span>name</span>
          <input
            className="bw-in"
            value={name}
            spellCheck={false}
            autoComplete="off"
            placeholder={suggested || "index_name"}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="bw-check bw-check--inline">
          <input type="checkbox" checked={unique} onChange={(e) => setUnique(e.target.checked)} />
          unique
        </label>
      </div>
      {error && (
        <p className="bw-ed__err" role="alert">
          {error}
        </p>
      )}
      <div className="bw-ed__row">
        <button className="mr-btn mr-btn--ghost" type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          className="mr-btn mr-btn--primary"
          type="button"
          disabled={busy || !picked.length || !effectiveName}
          onClick={add}
        >
          {busy ? "Adding…" : "Add index"}
        </button>
      </div>
    </div>
  );
}

/** A single blank column sub-form for the new-table card. Controlled by parent. */
export function NewColumnFields({
  value,
  onChange,
}: {
  value: { name: string; type: string; nullable: boolean };
  onChange: (v: { name: string; type: string; nullable: boolean }) => void;
}) {
  return (
    <div className="bw-ed__grid">
      <label className="bw-fld">
        <span>column</span>
        <input
          className="bw-in"
          value={value.name}
          spellCheck={false}
          autoComplete="off"
          placeholder="id"
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </label>
      <label className="bw-fld">
        <span>type</span>
        <select className="bw-in" value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })}>
          {TYPE_PRESETS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="bw-fld">
        <span>nullable</span>
        <select
          className="bw-in"
          value={value.nullable ? "null" : "not null"}
          onChange={(e) => onChange({ ...value, nullable: e.target.value === "null" })}
        >
          <option value="not null">not null</option>
          <option value="null">null</option>
        </select>
      </label>
    </div>
  );
}

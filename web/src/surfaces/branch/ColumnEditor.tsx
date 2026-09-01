/**
 * The in-place editor for one column row (grill Q2/Q15). Read-only spec at rest
 * (TableCard); this panel replaces it when the row is opened. Each control
 * commits its own operation on confirm — the name field on Enter or blur, the
 * selects on change — as an awaited one-op batch. `drop` asks first (Q5) and, if
 * the engine refuses it, lists the dependents to clear.
 */

import { useEffect, useRef, useState } from "react";

import type { Column } from "@engine/schema.js";
import type { OpWarning } from "@engine/validate.js";

import type { ApplyFn } from "./edit.ts";
import { firstMessage, prettyKind } from "./edit.ts";
import { optionsForColumn, sqlType, typeForValue } from "./format.ts";

type Mode = "fields" | "confirm-drop" | "blocked";

export function ColumnEditor({
  tableId,
  column,
  apply,
  onClose,
}: {
  tableId: string;
  column: Column;
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [name, setName] = useState(column.name);
  const [mode, setMode] = useState<Mode>("fields");
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<OpWarning[]>([]);
  const [blockers, setBlockers] = useState<{ name: string; kind: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  // keep the field in sync when a successful apply reloads a fresh `column`
  useEffect(() => setName(column.name), [column.name]);

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
      const deps = outcome.errors.find((e) => e.reason === "drop-blocked")?.dependents;
      if (deps) {
        setBlockers(deps.map((d) => ({ name: d.name, kind: d.kind })));
        setMode("blocked");
      }
    }
  };

  const commitName = () => {
    const to = name.trim();
    if (to === column.name || !to) {
      setName(column.name);
      return;
    }
    void run({ type: "renameColumn", tableId, columnId: column.id, from: column.name, to });
  };

  if (mode === "confirm-drop") {
    return (
      <div className="bw-ed bw-ed--warn" role="group" aria-label={`Drop column ${column.name}`}>
        <p className="bw-ed__msg">
          Drop <b>{column.name}</b>? This cannot be undone.
        </p>
        <div className="bw-ed__row">
          <button className="mr-btn mr-btn--ghost" type="button" disabled={busy} onClick={() => setMode("fields")}>
            Keep
          </button>
          <button
            className="mr-btn"
            type="button"
            disabled={busy}
            onClick={() =>
              void run({ type: "dropColumn", tableId, column }, onClose)
            }
          >
            {busy ? "Dropping…" : "Drop column"}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "blocked") {
    return (
      <div className="bw-ed bw-ed--warn" role="group" aria-label={`Cannot drop ${column.name}`}>
        <p className="bw-ed__msg">
          <b>{column.name}</b> is in use. Remove these first:
        </p>
        <ul className="bw-ed__deps">
          {blockers.map((b) => (
            <li key={b.name}>
              {b.name} <span className="bw-ed__kind">{prettyKind(b.kind)}</span>
            </li>
          ))}
        </ul>
        <div className="bw-ed__row">
          <button className="mr-btn" type="button" onClick={() => setMode("fields")}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bw-ed" role="group" aria-label={`Edit column ${column.name}`}>
      <div className="bw-ed__grid">
        <label className="bw-fld">
          <span>name</span>
          <input
            ref={nameRef}
            className="bw-in"
            value={name}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitName();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            onBlur={commitName}
          />
        </label>

        <label className="bw-fld">
          <span>type</span>
          <select
            className="bw-in"
            value={sqlType(column.type)}
            disabled={busy}
            onChange={(e) =>
              void run({
                type: "retypeColumn",
                tableId,
                columnId: column.id,
                from: column.type,
                to: typeForValue(e.target.value),
              })
            }
          >
            {optionsForColumn(column.type).map((o) => (
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
            value={column.nullable ? "null" : "not null"}
            disabled={busy}
            onChange={(e) =>
              void run({
                type: "setNullable",
                tableId,
                columnId: column.id,
                from: column.nullable,
                to: e.target.value === "null",
              })
            }
          >
            <option value="not null">not null</option>
            <option value="null">null</option>
          </select>
        </label>

        <button className="mr-btn mr-btn--ghost bw-ed__drop" type="button" onClick={() => setMode("confirm-drop")}>
          Drop
        </button>
      </div>

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
        <button className="mr-btn" type="button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

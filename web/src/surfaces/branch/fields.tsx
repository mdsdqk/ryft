/**
 * Shared in-card editor pieces — a column picker, a drop-confirm strip, and
 * the add-form apply loop. Kept out of any one editor so index / unique / FK
 * forms don't each grow a copy.
 */

import { useState, type ReactNode } from "react";

import type { ApplyFn } from "./edit.ts";
import { firstMessage } from "./edit.ts";

export function sameIdList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a);
  return b.every((id) => set.has(id));
}

export function useApply(apply: ApplyFn, onClose: () => void) {
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

export function ColumnPicker({
  columns,
  picked,
  onChange,
  disabled,
  legend = "columns",
}: {
  columns: { id: string; name: string; hint?: string; locked?: boolean }[];
  picked: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  legend?: string;
}) {
  const toggle = (id: string) => {
    if (picked.includes(id)) onChange(picked.filter((x) => x !== id));
    else onChange([...picked, id]);
  };
  return (
    <fieldset className="bw-ed__cols">
      <legend>{legend}</legend>
      {columns.map((c) => (
        <label key={c.id} className="bw-check">
          <input
            type="checkbox"
            checked={picked.includes(c.id)}
            disabled={disabled || c.locked}
            onChange={() => toggle(c.id)}
          />
          {c.name}
          {c.hint ? <span className="bw-ed__kind">{c.hint}</span> : null}
        </label>
      ))}
    </fieldset>
  );
}

export function DropConfirm({
  what,
  confirmLabel,
  busy,
  error,
  onCancel,
  onConfirm,
  children,
}: {
  what: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="bw-ed bw-ed--warn" role="group" aria-label={`Drop ${what}`}>
      {error ? (
        <p className="bw-ed__msg">{error}</p>
      ) : (
        <p className="bw-ed__msg">
          Drop <b>{what}</b>? This cannot be undone.
        </p>
      )}
      {children}
      <div className="bw-ed__row">
        <button className="mr-btn mr-btn--ghost" type="button" disabled={busy} onClick={onCancel}>
          {error ? "Back" : "Keep"}
        </button>
        {!error && (
          <button className="mr-btn" type="button" disabled={busy} onClick={onConfirm}>
            {busy ? "Dropping…" : confirmLabel}
          </button>
        )}
      </div>
    </div>
  );
}

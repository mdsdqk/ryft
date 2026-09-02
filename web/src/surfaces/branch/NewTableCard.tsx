/**
 * The blank card shown while the sheet's "+ create table" action is active
 * (grill Q14). Minimum to commit: a table name and one named column. Extra
 * columns (and their defaults) ride on the same `createTable` so the first-run
 * tour can author `attachments` in one operation.
 */

import { useEffect, useRef, useState } from "react";

import { freshId } from "@engine/id.js";

import { NewColumnFields, type ColumnDraft } from "./AddForms.tsx";
import type { ApplyFn } from "./edit.ts";
import { firstMessage } from "./edit.ts";
import { typeForValue } from "./format.ts";

const blankCol = (): ColumnDraft => ({ name: "", type: "text", nullable: true, default: "" });

export function NewTableCard({
  apply,
  onClose,
}: {
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [cols, setCols] = useState<ColumnDraft[]>([
    { name: "id", type: "uuid", nullable: false, default: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const named = cols.filter((c) => c.name.trim());

  const create = async () => {
    const tn = name.trim();
    if (!tn || !named.length) return;
    setBusy(true);
    setError(null);
    const outcome = await apply({
      type: "createTable",
      table: {
        id: freshId("tbl", tn),
        name: tn,
        columns: named.map((c) => ({
          id: freshId("col", `${tn}_${c.name.trim()}`),
          name: c.name.trim(),
          type: typeForValue(c.type),
          nullable: c.nullable,
          default: c.default.trim() || null,
        })),
        primaryKey: null,
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    });
    setBusy(false);
    if (outcome.ok) onClose();
    else setError(firstMessage(outcome.errors, "The table could not be created."));
  };

  return (
    <article className="bw-card bw-card--new" aria-label="New table">
      <header className="bw-card__strip">
        <label className="bw-fld bw-fld--strip">
          <span>table</span>
          <input
            ref={ref}
            className="bw-in"
            value={name}
            spellCheck={false}
            autoComplete="off"
            placeholder="table_name"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </label>
      </header>
      <div className="bw-group">
        <p className="bw-group__k">Columns</p>
        {cols.map((col, i) => (
          <div key={i} className="bw-ed bw-ed--add">
            <NewColumnFields
              value={col}
              onChange={(next) => setCols((all) => all.map((c, j) => (j === i ? next : c)))}
            />
          </div>
        ))}
        {error && (
          <p className="bw-ed__err bw-ed__err--pad" role="alert">
            {error}
          </p>
        )}
        <div className="bw-ed__row bw-ed__row--pad">
          <button className="bw-mini" type="button" onClick={() => setCols((c) => [...c, blankCol()])}>
            + column
          </button>
          <span className="bw-ed__spacer" />
          <button className="mr-btn mr-btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            className="mr-btn mr-btn--primary"
            type="button"
            disabled={busy || !name.trim() || !named.length}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "Create table"}
          </button>
        </div>
      </div>
    </article>
  );
}

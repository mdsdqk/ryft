/**
 * The blank card shown while the sheet's "+ create table" action is active
 * (grill Q14). Minimum to commit: a table name and one column — no primary key
 * in V0. Same drafting-card frame as a real table.
 */

import { useEffect, useRef, useState } from "react";

import { freshId } from "@engine/id.js";

import { NewColumnFields } from "./AddForms.tsx";
import type { ApplyFn } from "./edit.ts";
import { firstMessage } from "./edit.ts";
import { typeForValue } from "./format.ts";

export function NewTableCard({
  apply,
  onClose,
}: {
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [col, setCol] = useState({ name: "id", type: "uuid", nullable: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  const create = async () => {
    const tn = name.trim();
    const cn = col.name.trim();
    if (!tn || !cn) return;
    setBusy(true);
    setError(null);
    const outcome = await apply({
      type: "createTable",
      table: {
        id: freshId("tbl", tn),
        name: tn,
        columns: [
          {
            id: freshId("col", `${tn}_${cn}`),
            name: cn,
            type: typeForValue(col.type),
            nullable: col.nullable,
            default: null,
          },
        ],
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
        <p className="bw-group__k">First column</p>
        <div className="bw-ed bw-ed--add">
          <NewColumnFields value={col} onChange={setCol} />
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
              disabled={busy || !name.trim() || !col.name.trim()}
              onClick={() => void create()}
            >
              {busy ? "Creating…" : "Create table"}
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

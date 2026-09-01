/**
 * One table, drawn as a drafting card — a `1.5px --ink` frame, a title strip
 * with the table name and its stable id, then the three object groups (columns,
 * indexes, constraints) as hairline rows. A row an operation touched carries a
 * `△N` in the `--ours` role and a ring.
 *
 * E1 was read-only; E2 makes it editable (grill Q2/Q8/Q14/Q15): a column or
 * index row reveals an `edit` affordance on hover/focus and opens its editor in
 * place on click or Enter — one row at a time. The card strip carries
 * `+ column` / `+ index` / `drop table`. Primary keys, foreign keys, uniques,
 * and column defaults stay read-only in V0.
 */

import { useState } from "react";

import type { Table } from "@engine/schema.js";

import { EmptyState } from "../kit/index.ts";
import { AddColumnForm, AddIndexForm } from "./AddForms.tsx";
import { ColumnEditor } from "./ColumnEditor.tsx";
import { RevTriangle } from "./RevTriangle.tsx";
import type { ApplyFn } from "./edit.ts";
import { firstMessage } from "./edit.ts";
import {
  columnSpec,
  foreignKeySpec,
  indexSpec,
  primaryKeySpec,
  uniqueSpec,
  type NameOf,
} from "./format.ts";

/** `seq` if an operation touched this object id, else `undefined`. */
type MarkOf = (objectId: string) => number | undefined;

type RowSpec = { id: string; name: string; spec: string; pk?: boolean };

/** Inline confirm for a drop that cannot be blocked (an index — no FK depends
 *  on one). Column and table drops have their own dependent-aware flows. */
function DropConfirm({
  what,
  onCancel,
  onConfirm,
}: {
  what: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="bw-ed bw-ed--warn" role="group" aria-label={`Drop ${what}`}>
      <p className="bw-ed__msg">
        Drop <b>{what}</b>? This cannot be undone.
      </p>
      <div className="bw-ed__row">
        <button className="mr-btn mr-btn--ghost" type="button" disabled={busy} onClick={onCancel}>
          Keep
        </button>
        <button
          className="mr-btn"
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Dropping…" : "Drop index"}
        </button>
      </div>
    </div>
  );
}

function ReadRow({ r, seq }: { r: RowSpec; seq?: number }) {
  return (
    <div className={`bw-row${seq !== undefined ? " bw-row--changed" : ""}`}>
      <span className="bw-row__name">
        {r.name}
        {r.pk && <span className="bw-row__pk">pk</span>}
      </span>
      <span className="bw-row__spec">{r.spec}</span>
      <span className="bw-row__edit" aria-hidden="true" />
      <span className="bw-row__mark">{seq !== undefined && <RevTriangle n={seq} />}</span>
    </div>
  );
}

function OpenRow({
  r,
  seq,
  onOpen,
}: {
  r: RowSpec;
  seq?: number;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      className={`bw-row bw-row--btn${seq !== undefined ? " bw-row--changed" : ""}`}
      onClick={onOpen}
    >
      <span className="bw-row__name">
        {r.name}
        {r.pk && <span className="bw-row__pk">pk</span>}
      </span>
      <span className="bw-row__spec">{r.spec}</span>
      <span className="bw-row__edit" aria-hidden="true">
        edit
      </span>
      <span className="bw-row__mark">{seq !== undefined && <RevTriangle n={seq} />}</span>
    </button>
  );
}

export function TableCard({
  table,
  nameOf,
  markOf,
  apply,
  editable,
}: {
  table: Table;
  nameOf: NameOf;
  markOf: MarkOf;
  apply: ApplyFn;
  editable: boolean;
}) {
  const [open, setOpen] = useState<
    | { kind: "column"; id: string }
    | { kind: "index"; id: string }
    | { kind: "add-column" }
    | { kind: "add-index" }
    | { kind: "drop-table" }
    | null
  >(null);
  const [dropErr, setDropErr] = useState<string | null>(null);

  const pkMembers = new Set(table.primaryKey?.columnIds ?? []);

  const columnRows: RowSpec[] = table.columns.map((c) => ({
    id: c.id,
    name: c.name,
    spec: columnSpec(c),
    pk: pkMembers.has(c.id),
  }));
  const indexRows: RowSpec[] = table.indexes.map((ix) => ({
    id: ix.id,
    name: ix.name,
    spec: indexSpec(ix, nameOf),
  }));
  const constraintRows: RowSpec[] = [
    ...(table.primaryKey
      ? [{ id: table.primaryKey.id, name: table.primaryKey.name, spec: primaryKeySpec(table.primaryKey, nameOf) }]
      : []),
    ...table.uniques.map((u) => ({ id: u.id, name: u.name, spec: uniqueSpec(u, nameOf) })),
    ...table.foreignKeys.map((fk) => ({ id: fk.id, name: fk.name, spec: foreignKeySpec(fk, nameOf) })),
  ];

  const dropTable = async () => {
    const outcome = await apply({ type: "dropTable", table });
    if (!outcome.ok) {
      const deps = outcome.errors.find((e) => e.reason === "drop-blocked")?.dependents;
      setDropErr(
        deps
          ? `In use by ${deps.map((d) => d.name).join(", ")}. Remove those first.`
          : firstMessage(outcome.errors, "The table could not be dropped."),
      );
    }
  };

  return (
    <article className="bw-card" aria-labelledby={`card-${table.id}`}>
      <header className="bw-card__strip">
        <span className="bw-card__name" id={`card-${table.id}`}>
          {table.name}
        </span>
        <span className="bw-card__right">
          <span className="bw-card__id">{table.id}</span>
          {editable && (
            <span className="bw-card__acts">
              <button className="bw-mini" type="button" onClick={() => setOpen({ kind: "add-column" })}>
                + column
              </button>
              <button className="bw-mini" type="button" onClick={() => setOpen({ kind: "add-index" })}>
                + index
              </button>
              <button
                className="bw-mini bw-mini--danger"
                type="button"
                onClick={() => {
                  setDropErr(null);
                  setOpen({ kind: "drop-table" });
                }}
              >
                drop table
              </button>
            </span>
          )}
        </span>
      </header>

      {open?.kind === "drop-table" && (
        <div className="bw-ed bw-ed--warn bw-ed--strip" role="group" aria-label={`Drop table ${table.name}`}>
          {dropErr ? (
            <p className="bw-ed__msg">{dropErr}</p>
          ) : (
            <p className="bw-ed__msg">
              Drop table <b>{table.name}</b> and its {table.columns.length} columns? This cannot be undone.
            </p>
          )}
          <div className="bw-ed__row">
            <button className="mr-btn mr-btn--ghost" type="button" onClick={() => setOpen(null)}>
              {dropErr ? "Back" : "Keep"}
            </button>
            {!dropErr && (
              <button className="mr-btn" type="button" onClick={() => void dropTable()}>
                Drop table
              </button>
            )}
          </div>
        </div>
      )}

      <div className="bw-group">
        <p className="bw-group__k">Columns</p>
        {table.columns.map((c) => {
          const seq = markOf(c.id);
          const isOpen = open?.kind === "column" && open.id === c.id;
          if (isOpen) {
            return (
              <ColumnEditor
                key={c.id}
                tableId={table.id}
                column={c}
                apply={apply}
                onClose={() => setOpen(null)}
              />
            );
          }
          const r = columnRows.find((x) => x.id === c.id)!;
          return editable ? (
            <OpenRow key={c.id} r={r} seq={seq} onOpen={() => setOpen({ kind: "column", id: c.id })} />
          ) : (
            <ReadRow key={c.id} r={r} seq={seq} />
          );
        })}
        {open?.kind === "add-column" && (
          <AddColumnForm
            tableId={table.id}
            tableName={table.name}
            apply={apply}
            onClose={() => setOpen(null)}
          />
        )}
      </div>

      <div className="bw-group">
        <p className="bw-group__k">Indexes</p>
        {indexRows.length === 0 && open?.kind !== "add-index" && (
          <EmptyState layout="inline" title="No indexes on this table.">
            {editable ? "Add one with + index on this card." : null}
          </EmptyState>
        )}
        {table.indexes.map((ix) => {
          const seq = markOf(ix.id);
          const isOpen = open?.kind === "index" && open.id === ix.id;
          if (isOpen) {
            return (
              <DropConfirm
                key={ix.id}
                what={`index ${ix.name}`}
                onCancel={() => setOpen(null)}
                onConfirm={async () => {
                  const outcome = await apply({ type: "dropIndex", tableId: table.id, index: ix });
                  if (outcome.ok) setOpen(null);
                }}
              />
            );
          }
          const r = indexRows.find((x) => x.id === ix.id)!;
          return editable ? (
            <OpenRow key={ix.id} r={r} seq={seq} onOpen={() => setOpen({ kind: "index", id: ix.id })} />
          ) : (
            <ReadRow key={ix.id} r={r} seq={seq} />
          );
        })}
        {open?.kind === "add-index" && (
          <AddIndexForm
            tableId={table.id}
            tableName={table.name}
            columns={table.columns.map((c) => ({ id: c.id, name: c.name }))}
            apply={apply}
            onClose={() => setOpen(null)}
          />
        )}
      </div>

      <div className="bw-group">
        <p className="bw-group__k">Constraints</p>
        {constraintRows.length === 0 ? (
          <EmptyState layout="inline" title="No constraints on this table.">
            Primary key, unique, and foreign-key constraints appear here.
          </EmptyState>
        ) : (
          constraintRows.map((r) => <ReadRow key={r.id} r={r} seq={markOf(r.id)} />)
        )}
      </div>
    </article>
  );
}

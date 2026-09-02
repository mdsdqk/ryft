/**
 * One table, drawn as a drafting card — a `1.5px --ink` frame, a title strip
 * with the table name and its stable id, then the three object groups (columns,
 * indexes, constraints) as hairline rows. A row an operation touched carries a
 * `△N` in the `--ours` role and a ring.
 *
 * Every operation class is editable from the card: columns (including default),
 * indexes (including redefine), constraints (PK / unique / FK), table rename
 * and drop. One row's editor is open at a time.
 */

import { useEffect, useState, type ReactNode } from "react";

import type { Table } from "@engine/schema.js";

import { Chevron, EmptyState } from "../kit/index.ts";
import { TableDdl } from "./TableDdl.tsx";
import { AddColumnForm, AddIndexForm } from "./AddForms.tsx";
import { ColumnEditor } from "./ColumnEditor.tsx";
import {
  AddForeignKeyForm,
  AddPrimaryKeyForm,
  AddUniqueForm,
  ForeignKeyEditor,
  PrimaryKeyEditor,
  UniqueEditor,
} from "./ConstraintEditors.tsx";
import { IndexEditor } from "./IndexEditor.tsx";
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

export type CardGroup = "columns" | "indexes" | "constraints";

type RowSpec = { id: string; name: string; spec: string; pk?: boolean };

type Open =
  | { kind: "column"; id: string }
  | { kind: "index"; id: string }
  | { kind: "pk" }
  | { kind: "unique"; id: string }
  | { kind: "fk"; id: string }
  | { kind: "add-column" }
  | { kind: "add-index" }
  | { kind: "add-unique" }
  | { kind: "add-fk" }
  | { kind: "add-pk" }
  | { kind: "drop-table" }
  | null;

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

function TableName({
  table,
  apply,
  editable,
}: {
  table: Table;
  apply: ApplyFn;
  editable: boolean;
}) {
  const [name, setName] = useState(table.name);
  useEffect(() => setName(table.name), [table.name]);

  const commit = () => {
    const to = name.trim();
    if (to === table.name || !to) {
      setName(table.name);
      return;
    }
    void apply({ type: "renameTable", tableId: table.id, from: table.name, to }).then((outcome) => {
      if (!outcome.ok) setName(table.name);
    });
  };

  if (!editable) {
    return (
      <span className="bw-card__name" id={`card-${table.id}`}>
        {table.name}
      </span>
    );
  }

  return (
    <label className="bw-fld bw-fld--strip">
      <span>table</span>
      <input
        className="bw-in bw-in--title"
        id={`card-${table.id}`}
        value={name}
        spellCheck={false}
        autoComplete="off"
        aria-label="table name"
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            setName(table.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}

export function TableCard({
  table,
  tables,
  nameOf,
  markOf,
  apply,
  editable,
  cardCollapsed = false,
  onToggleCard,
  groupCollapsed = () => false,
  onToggleGroup = () => {},
}: {
  table: Table;
  tables: Table[];
  nameOf: NameOf;
  markOf: MarkOf;
  apply: ApplyFn;
  editable: boolean;
  cardCollapsed?: boolean;
  onToggleCard?: () => void;
  groupCollapsed?: (g: CardGroup) => boolean;
  onToggleGroup?: (g: CardGroup) => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  const [dropErr, setDropErr] = useState<string | null>(null);
  const [showDdl, setShowDdl] = useState(false);

  const GroupHead = ({ g, children }: { g: CardGroup; children: ReactNode }) => (
    <button
      type="button"
      className="bw-group__k bw-group__k--btn"
      aria-expanded={!groupCollapsed(g)}
      onClick={() => onToggleGroup(g)}
    >
      <Chevron open={!groupCollapsed(g)} />
      <span>{children}</span>
    </button>
  );

  const pkMembers = new Set(table.primaryKey?.columnIds ?? []);
  const cols = table.columns.map((c) => ({ id: c.id, name: c.name, nullable: c.nullable }));

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

  const close = () => setOpen(null);
  const noConstraints =
    !table.primaryKey && table.uniques.length === 0 && table.foreignKeys.length === 0;
  const addingConstraint = open?.kind === "add-pk" || open?.kind === "add-unique" || open?.kind === "add-fk";

  const counts = `${table.columns.length} col${table.columns.length === 1 ? "" : "s"} · ${
    table.indexes.length
  } index${table.indexes.length === 1 ? "" : "es"}`;

  return (
    <article
      className={`bw-card${cardCollapsed ? " bw-card--collapsed" : ""}`}
      aria-labelledby={`card-${table.id}`}
    >
      <header className="bw-card__strip">
        {onToggleCard && (
          <button
            type="button"
            className="bw-card__toggle"
            aria-expanded={!cardCollapsed}
            aria-label={`${cardCollapsed ? "Expand" : "Collapse"} table ${table.name}`}
            onClick={onToggleCard}
          >
            <Chevron open={!cardCollapsed} />
          </button>
        )}
        <TableName table={table} apply={apply} editable={editable} />
        <span className="bw-card__right">
          {cardCollapsed && <span className="bw-card__counts">{counts}</span>}
          <span className="bw-card__id">{table.id}</span>
          <span className="bw-card__acts">
            <button
              className="bw-mini"
              type="button"
              aria-pressed={showDdl}
              onClick={() => setShowDdl((v) => !v)}
            >
              {showDdl ? "table view" : "view SQL"}
            </button>
          </span>
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

      {cardCollapsed ? null : showDdl ? (
        <TableDdl table={table} />
      ) : (
      <>
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
            <button className="mr-btn mr-btn--ghost" type="button" onClick={close}>
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
        <GroupHead g="columns">Columns</GroupHead>
        {!groupCollapsed("columns") && (
        <>
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
                onClose={close}
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
            onClose={close}
          />
        )}
        </>
        )}
      </div>

      <div className="bw-group">
        <GroupHead g="indexes">Indexes</GroupHead>
        {!groupCollapsed("indexes") && (
        <>
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
              <IndexEditor
                key={ix.id}
                tableId={table.id}
                index={ix}
                columns={cols}
                apply={apply}
                onClose={close}
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
            columns={cols}
            apply={apply}
            onClose={close}
          />
        )}
        </>
        )}
      </div>

      <div className="bw-group">
        <div className="bw-group__head">
          <GroupHead g="constraints">Constraints</GroupHead>
          {editable && (
            <span className="bw-card__acts">
              {!table.primaryKey && (
                <button className="bw-mini" type="button" onClick={() => setOpen({ kind: "add-pk" })}>
                  + primary key
                </button>
              )}
              <button className="bw-mini" type="button" onClick={() => setOpen({ kind: "add-unique" })}>
                + unique
              </button>
              <button className="bw-mini" type="button" onClick={() => setOpen({ kind: "add-fk" })}>
                + foreign key
              </button>
            </span>
          )}
        </div>
        {!groupCollapsed("constraints") && (
        <>
        {noConstraints && !addingConstraint && (
          <EmptyState layout="inline" title="No constraints on this table.">
            {editable
              ? "Add a primary key, unique, or foreign key from this group."
              : "Primary key, unique, and foreign-key constraints appear here."}
          </EmptyState>
        )}
        {table.primaryKey &&
          (open?.kind === "pk" ? (
            <PrimaryKeyEditor
              tableId={table.id}
              primaryKey={table.primaryKey}
              columns={cols}
              apply={apply}
              onClose={close}
            />
          ) : editable ? (
            <OpenRow
              r={{
                id: table.primaryKey.id,
                name: table.primaryKey.name,
                spec: primaryKeySpec(table.primaryKey, nameOf),
              }}
              seq={markOf(table.primaryKey.id)}
              onOpen={() => setOpen({ kind: "pk" })}
            />
          ) : (
            <ReadRow
              r={{
                id: table.primaryKey.id,
                name: table.primaryKey.name,
                spec: primaryKeySpec(table.primaryKey, nameOf),
              }}
              seq={markOf(table.primaryKey.id)}
            />
          ))}
        {open?.kind === "add-pk" && <AddPrimaryKeyForm table={table} apply={apply} onClose={close} />}
        {table.uniques.map((u) => {
          const seq = markOf(u.id);
          const r = { id: u.id, name: u.name, spec: uniqueSpec(u, nameOf) };
          if (open?.kind === "unique" && open.id === u.id) {
            return (
              <UniqueEditor
                key={u.id}
                tableId={table.id}
                unique={u}
                columns={cols}
                apply={apply}
                onClose={close}
              />
            );
          }
          return editable ? (
            <OpenRow key={u.id} r={r} seq={seq} onOpen={() => setOpen({ kind: "unique", id: u.id })} />
          ) : (
            <ReadRow key={u.id} r={r} seq={seq} />
          );
        })}
        {open?.kind === "add-unique" && (
          <AddUniqueForm
            tableId={table.id}
            tableName={table.name}
            columns={cols}
            apply={apply}
            onClose={close}
          />
        )}
        {table.foreignKeys.map((fk) => {
          const seq = markOf(fk.id);
          const r = { id: fk.id, name: fk.name, spec: foreignKeySpec(fk, nameOf) };
          if (open?.kind === "fk" && open.id === fk.id) {
            return (
              <ForeignKeyEditor
                key={fk.id}
                table={table}
                tables={tables}
                fk={fk}
                apply={apply}
                onClose={close}
              />
            );
          }
          return editable ? (
            <OpenRow key={fk.id} r={r} seq={seq} onOpen={() => setOpen({ kind: "fk", id: fk.id })} />
          ) : (
            <ReadRow key={fk.id} r={r} seq={seq} />
          );
        })}
        {open?.kind === "add-fk" && (
          <AddForeignKeyForm table={table} tables={tables} apply={apply} onClose={close} />
        )}
        </>
        )}
      </div>
      </>
      )}
    </article>
  );
}

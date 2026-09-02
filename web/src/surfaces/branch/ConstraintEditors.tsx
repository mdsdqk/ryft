/**
 * In-place editors and add forms for the Constraints group: primary key,
 * unique, and foreign key. Each follows the column/index grammar — add is a
 * blank form with one submit; an existing row expands to per-control commits
 * plus a confirm-first drop.
 */

import { useEffect, useState } from "react";

import { freshId } from "@engine/id.js";
import type { ForeignKey, OnDeleteAction, PrimaryKey, Table, Unique } from "@engine/schema.js";
import type { OpWarning } from "@engine/validate.js";

import type { ApplyFn } from "./edit.ts";
import { firstMessage, prettyKind } from "./edit.ts";
import { ColumnPicker, DropConfirm, sameIdList, sameIdSet, useApply } from "./fields.tsx";
import { ON_DELETE_ACTIONS } from "./format.ts";

type Col = { id: string; name: string; nullable?: boolean };

function useRowApply(apply: ApplyFn) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<OpWarning[]>([]);
  const [blockers, setBlockers] = useState<{ name: string; kind: string }[]>([]);
  const run = async (op: Parameters<ApplyFn>[0], after?: () => void) => {
    setBusy(true);
    setError(null);
    const outcome = await apply(op);
    setBusy(false);
    if (outcome.ok) {
      setWarnings(outcome.warnings);
      after?.();
      return { ok: true as const, blockers: [] as { name: string; kind: string }[] };
    }
    setError(firstMessage(outcome.errors, "The edit was refused."));
    const deps = outcome.errors.find((e) => e.reason === "drop-blocked")?.dependents;
    const next = deps?.map((d) => ({ name: d.name, kind: d.kind })) ?? [];
    setBlockers(next);
    return { ok: false as const, blockers: next };
  };
  return { busy, error, warnings, blockers, run };
}

function Blocked({
  name,
  blockers,
  onBack,
}: {
  name: string;
  blockers: { name: string; kind: string }[];
  onBack: () => void;
}) {
  return (
    <div className="bw-ed bw-ed--warn" role="group" aria-label={`Cannot drop ${name}`}>
      <p className="bw-ed__msg">
        <b>{name}</b> is in use. Remove these first:
      </p>
      <ul className="bw-ed__deps">
        {blockers.map((b) => (
          <li key={b.name}>
            {b.name} <span className="bw-ed__kind">{prettyKind(b.kind)}</span>
          </li>
        ))}
      </ul>
      <div className="bw-ed__row">
        <button className="mr-btn" type="button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}

function targetOptions(table: Table): { value: string; label: string; columnIds: string[] }[] {
  const out: { value: string; label: string; columnIds: string[] }[] = [];
  if (table.primaryKey) {
    out.push({
      value: `pk:${table.primaryKey.id}`,
      label: `primary key (${table.primaryKey.name})`,
      columnIds: table.primaryKey.columnIds,
    });
  }
  for (const u of table.uniques) {
    out.push({
      value: `uq:${u.id}`,
      label: `unique ${u.name}`,
      columnIds: u.columnIds,
    });
  }
  return out;
}

function matchingTarget(table: Table, refColumnIds: string[]): string {
  const hit = targetOptions(table).find((o) => sameIdList(o.columnIds, refColumnIds));
  return hit?.value ?? "";
}

// ── primary key ───────────────────────────────────────────────────────────

export function AddPrimaryKeyForm({
  table,
  apply,
  onClose,
}: {
  table: Table;
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const { busy, error, submit } = useApply(apply, onClose);
  const suggested = `${table.name}_pkey`;
  const effectiveName = name.trim() || suggested;

  const add = () => {
    if (!picked.length || !effectiveName) return;
    void submit({
      type: "addPrimaryKey",
      tableId: table.id,
      primaryKey: {
        id: freshId("pk", table.name),
        name: effectiveName,
        columnIds: picked,
      },
    });
  };

  return (
    <div className="bw-ed bw-ed--add" role="group" aria-label={`Add a primary key to ${table.name}`}>
      <ColumnPicker
        columns={table.columns.map((c) => ({
          id: c.id,
          name: c.name,
          hint: c.nullable ? "nullable" : undefined,
          locked: c.nullable,
        }))}
        picked={picked}
        onChange={setPicked}
        legend="columns (not null)"
      />
      <label className="bw-fld bw-fld--wide">
        <span>name</span>
        <input
          className="bw-in"
          value={name}
          spellCheck={false}
          autoComplete="off"
          placeholder={suggested}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
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
          {busy ? "Adding…" : "Add primary key"}
        </button>
      </div>
    </div>
  );
}

export function PrimaryKeyEditor({
  tableId,
  primaryKey,
  columns,
  apply,
  onClose,
}: {
  tableId: string;
  primaryKey: PrimaryKey;
  columns: Col[];
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(primaryKey.columnIds);
  const [mode, setMode] = useState<"fields" | "confirm-drop" | "blocked">("fields");
  const { busy, error, warnings, blockers, run } = useRowApply(apply);

  useEffect(() => setPicked(primaryKey.columnIds), [primaryKey.columnIds]);

  const commit = (next: string[]) => {
    if (!next.length || sameIdList(next, primaryKey.columnIds)) return;
    void run({
      type: "changePrimaryKey",
      tableId,
      primaryKeyId: primaryKey.id,
      from: primaryKey.columnIds,
      to: next,
    }).then((r) => {
      if (!r.ok) setPicked(primaryKey.columnIds);
    });
  };

  if (mode === "blocked") {
    return <Blocked name={primaryKey.name} blockers={blockers} onBack={() => setMode("fields")} />;
  }
  if (mode === "confirm-drop") {
    return (
      <DropConfirm
        what={`primary key ${primaryKey.name}`}
        confirmLabel="Drop primary key"
        busy={busy}
        error={error}
        onCancel={() => setMode("fields")}
        onConfirm={() =>
          void run({ type: "dropPrimaryKey", tableId, primaryKey }, onClose).then((r) => {
            if (!r.ok && r.blockers.length) setMode("blocked");
          })
        }
      />
    );
  }

  return (
    <div className="bw-ed" role="group" aria-label={`Edit primary key ${primaryKey.name}`}>
      <ColumnPicker
        columns={columns.map((c) => ({
          id: c.id,
          name: c.name,
          hint: c.nullable ? "nullable" : undefined,
          locked: c.nullable,
        }))}
        picked={picked}
        disabled={busy}
        legend="columns (not null)"
        onChange={(ids) => {
          setPicked(ids);
          commit(ids);
        }}
      />
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

// ── unique ────────────────────────────────────────────────────────────────

export function AddUniqueForm({
  tableId,
  tableName,
  columns,
  apply,
  onClose,
}: {
  tableId: string;
  tableName: string;
  columns: Col[];
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const { busy, error, submit } = useApply(apply, onClose);
  const chosen = columns.filter((c) => picked.includes(c.id)).map((c) => c.name);
  const suggested = chosen.length ? `${tableName}_${chosen.join("_")}_key` : "";
  const effectiveName = name.trim() || suggested;

  const add = () => {
    if (!picked.length || !effectiveName) return;
    void submit({
      type: "addUnique",
      tableId,
      unique: {
        id: freshId("uq", `${tableName}_${chosen.join("_")}`),
        name: effectiveName,
        columnIds: picked,
      },
    });
  };

  return (
    <div className="bw-ed bw-ed--add" role="group" aria-label={`Add a unique constraint to ${tableName}`}>
      <ColumnPicker columns={columns} picked={picked} onChange={setPicked} />
      <label className="bw-fld bw-fld--wide">
        <span>name</span>
        <input
          className="bw-in"
          value={name}
          spellCheck={false}
          autoComplete="off"
          placeholder={suggested || "constraint_name"}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
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
          {busy ? "Adding…" : "Add unique"}
        </button>
      </div>
    </div>
  );
}

export function UniqueEditor({
  tableId,
  unique,
  columns,
  apply,
  onClose,
}: {
  tableId: string;
  unique: Unique;
  columns: Col[];
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(unique.columnIds);
  const [mode, setMode] = useState<"fields" | "confirm-drop" | "blocked">("fields");
  const { busy, error, warnings, blockers, run } = useRowApply(apply);

  useEffect(() => setPicked(unique.columnIds), [unique.columnIds]);

  const commit = (next: string[]) => {
    if (!next.length || sameIdSet(next, unique.columnIds)) return;
    void run({
      type: "changeUnique",
      tableId,
      uniqueId: unique.id,
      from: { name: unique.name, columnIds: unique.columnIds },
      to: { name: unique.name, columnIds: next },
    }).then((r) => {
      if (!r.ok) setPicked(unique.columnIds);
    });
  };

  if (mode === "blocked") {
    return <Blocked name={unique.name} blockers={blockers} onBack={() => setMode("fields")} />;
  }
  if (mode === "confirm-drop") {
    return (
      <DropConfirm
        what={`unique ${unique.name}`}
        confirmLabel="Drop unique"
        busy={busy}
        error={error}
        onCancel={() => setMode("fields")}
        onConfirm={() =>
          void run({ type: "dropUnique", tableId, unique }, onClose).then((r) => {
            if (!r.ok && r.blockers.length) setMode("blocked");
          })
        }
      />
    );
  }

  return (
    <div className="bw-ed" role="group" aria-label={`Edit unique ${unique.name}`}>
      <ColumnPicker
        columns={columns}
        picked={picked}
        disabled={busy}
        onChange={(ids) => {
          setPicked(ids);
          commit(ids);
        }}
      />
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

// ── foreign key ───────────────────────────────────────────────────────────

function fkDef(fk: ForeignKey) {
  return {
    name: fk.name,
    columnIds: fk.columnIds,
    refTableId: fk.refTableId,
    refColumnIds: fk.refColumnIds,
    onDelete: fk.onDelete,
  };
}

export function AddForeignKeyForm({
  table,
  tables,
  apply,
  onClose,
}: {
  table: Table;
  tables: Table[];
  apply: ApplyFn;
  onClose: () => void;
}) {
  const others = tables.filter((t) => t.id !== table.id);
  const [picked, setPicked] = useState<string[]>([]);
  const [refId, setRefId] = useState(others[0]?.id ?? "");
  const refTable = tables.find((t) => t.id === refId);
  const targets = refTable ? targetOptions(refTable) : [];
  const [target, setTarget] = useState(targets[0]?.value ?? "");
  const [onDelete, setOnDelete] = useState<OnDeleteAction>("cascade");
  const [name, setName] = useState("");
  const { busy, error, submit } = useApply(apply, onClose);

  const chosen = table.columns.filter((c) => picked.includes(c.id)).map((c) => c.name);
  const suggested = chosen.length ? `${table.name}_${chosen.join("_")}_fkey` : "";
  const effectiveName = name.trim() || suggested;
  const refColumnIds = targets.find((t) => t.value === target)?.columnIds ?? [];

  const add = () => {
    if (!picked.length || !refTable || !refColumnIds.length || !effectiveName) return;
    void submit({
      type: "addForeignKey",
      tableId: table.id,
      fk: {
        id: freshId("fk", `${table.name}_${chosen.join("_")}`),
        name: effectiveName,
        columnIds: picked,
        refTableId: refTable.id,
        refColumnIds,
        onDelete,
      },
    });
  };

  return (
    <div className="bw-ed bw-ed--add" role="group" aria-label={`Add a foreign key to ${table.name}`}>
      <ColumnPicker columns={table.columns} picked={picked} onChange={setPicked} legend="local columns" />
      <div className="bw-ed__grid">
        <label className="bw-fld">
          <span>references</span>
          <select
            className="bw-in"
            value={refId}
            onChange={(e) => {
              const next = e.target.value;
              setRefId(next);
              const t = tables.find((x) => x.id === next);
              setTarget(t ? (targetOptions(t)[0]?.value ?? "") : "");
            }}
          >
            {others.length === 0 && <option value="">no other tables</option>}
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="bw-fld">
          <span>on</span>
          <select className="bw-in" value={target} onChange={(e) => setTarget(e.target.value)} disabled={!targets.length}>
            {targets.length === 0 && <option value="">no key on that table</option>}
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="bw-fld">
          <span>on delete</span>
          <select className="bw-in" value={onDelete} onChange={(e) => setOnDelete(e.target.value as OnDeleteAction)}>
            {ON_DELETE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="bw-fld bw-fld--wide">
          <span>name</span>
          <input
            className="bw-in"
            value={name}
            spellCheck={false}
            autoComplete="off"
            placeholder={suggested || "constraint_name"}
            onChange={(e) => setName(e.target.value)}
          />
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
          disabled={busy || !picked.length || !refColumnIds.length || !effectiveName}
          onClick={add}
        >
          {busy ? "Adding…" : "Add foreign key"}
        </button>
      </div>
    </div>
  );
}

export function ForeignKeyEditor({
  table,
  tables,
  fk,
  apply,
  onClose,
}: {
  table: Table;
  tables: Table[];
  fk: ForeignKey;
  apply: ApplyFn;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(fk.columnIds);
  const [refId, setRefId] = useState(fk.refTableId);
  const refTable = tables.find((t) => t.id === refId);
  const targets = refTable ? targetOptions(refTable) : [];
  const [target, setTarget] = useState(() => (refTable ? matchingTarget(refTable, fk.refColumnIds) : ""));
  const [mode, setMode] = useState<"fields" | "confirm-drop">("fields");
  const { busy, error, warnings, run } = useRowApply(apply);

  useEffect(() => {
    setPicked(fk.columnIds);
    setRefId(fk.refTableId);
    const t = tables.find((x) => x.id === fk.refTableId);
    setTarget(t ? matchingTarget(t, fk.refColumnIds) : "");
  }, [fk, tables]);

  const emit = (patch: {
    columnIds?: string[];
    refTableId?: string;
    refColumnIds?: string[];
    onDelete?: OnDeleteAction;
  }) => {
    const to = {
      ...fkDef(fk),
      ...patch,
    };
    if (
      sameIdList(to.columnIds, fk.columnIds) &&
      to.refTableId === fk.refTableId &&
      sameIdList(to.refColumnIds, fk.refColumnIds) &&
      to.onDelete === fk.onDelete
    ) {
      return;
    }
    if (!to.columnIds.length || !to.refColumnIds.length) return;
    void run({
      type: "changeForeignKey",
      tableId: table.id,
      fkId: fk.id,
      from: fkDef(fk),
      to,
    }).then((r) => {
      if (!r.ok) {
        setPicked(fk.columnIds);
        setRefId(fk.refTableId);
        const t = tables.find((x) => x.id === fk.refTableId);
        setTarget(t ? matchingTarget(t, fk.refColumnIds) : "");
      }
    });
  };

  if (mode === "confirm-drop") {
    return (
      <DropConfirm
        what={`foreign key ${fk.name}`}
        confirmLabel="Drop foreign key"
        busy={busy}
        onCancel={() => setMode("fields")}
        onConfirm={() => void run({ type: "dropForeignKey", tableId: table.id, fk }, onClose)}
      />
    );
  }

  return (
    <div className="bw-ed" role="group" aria-label={`Edit foreign key ${fk.name}`}>
      <ColumnPicker
        columns={table.columns}
        picked={picked}
        disabled={busy}
        legend="local columns"
        onChange={(ids) => {
          setPicked(ids);
          emit({ columnIds: ids });
        }}
      />
      <div className="bw-ed__grid">
        <label className="bw-fld">
          <span>references</span>
          <select
            className="bw-in"
            value={refId}
            disabled={busy}
            onChange={(e) => {
              const next = e.target.value;
              const t = tables.find((x) => x.id === next);
              const first = t ? targetOptions(t)[0] : undefined;
              setRefId(next);
              setTarget(first?.value ?? "");
              emit({
                refTableId: next,
                refColumnIds: first?.columnIds ?? fk.refColumnIds,
              });
            }}
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="bw-fld">
          <span>on</span>
          <select
            className="bw-in"
            value={target}
            disabled={busy || !targets.length}
            onChange={(e) => {
              const next = e.target.value;
              setTarget(next);
              const hit = targets.find((t) => t.value === next);
              if (hit) emit({ refColumnIds: hit.columnIds });
            }}
          >
            {targets.length === 0 && <option value="">no key on that table</option>}
            {target === "" && <option value="">current columns</option>}
            {targets.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="bw-fld">
          <span>on delete</span>
          <select
            className="bw-in"
            value={fk.onDelete}
            disabled={busy}
            onChange={(e) => emit({ onDelete: e.target.value as OnDeleteAction })}
          >
            {ON_DELETE_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
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

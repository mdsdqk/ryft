/**
 * diffSnapshots — structural diff of two schema snapshots into a derived delta.
 *
 * `diffSnapshots(base, head)` returns an ordered `Operation[]` that, applied to
 * `base` by `applyDelta`, reproduces `head`. Objects are matched BY ID at every
 * level (table, column, primary key, index, unique, foreign key); a rename is
 * therefore "same id, new name", never drop + add, and a redefinition of an
 * index / unique / foreign key is one id-preserving `change*` op.
 *
 * This is the merge engine's only source of edit history. It never reads a
 * branch's recorded `LogEntry[]` (ADR 0001 §2) — it reconstructs the stream from
 * state alone, which is what makes a true three-way merge tractable.
 *
 * Emission order is fixed and deterministic (see `diffSnapshots`) so that
 * classification and spike output are stable. It is NOT dependency-ordered;
 * `applyDelta` owns the topological sort.
 */

import type { Operation } from "./operations.js";
import type {
  ColumnType,
  ForeignKey,
  Index,
  PrimaryKey,
  SchemaDocument,
  Table,
} from "./schema.js";

// ── equality helpers ────────────────────────────────────────────────────────

/** Structural equality of two column types, parameters included. */
export function sameColumnType(a: ColumnType, b: ColumnType): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "varchar" && b.kind === "varchar") return a.n === b.n;
  if (a.kind === "numeric" && b.kind === "numeric") {
    return a.precision === b.precision && a.scale === b.scale;
  }
  return true; // parameter-free kinds: kind match is enough
}

/** Ordered equality of two id lists. Order is significant (index / PK / FK columns). */
export function eqSeq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Unordered (multiset) equality of two id lists. Used where column order is not significant. */
export function eqSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const counts = new Map<string, number>();
  for (const x of a) counts.set(x, (counts.get(x) ?? 0) + 1);
  for (const x of b) {
    const n = counts.get(x);
    if (!n) return false;
    counts.set(x, n - 1);
  }
  return true;
}

// `name` is deliberately not compared here or in `sameForeignKeyDef`: it is a
// stored label, immutable in V0 (no `renameConstraint` op), so it never differs
// between `base` and `head`. It rides along in the `change*` payloads below only
// so the DDL renderer has it.
function sameIndexDef(a: Index, b: Index): boolean {
  return a.unique === b.unique && eqSeq(a.columnIds, b.columnIds);
}

export function sameForeignKeyDef(a: ForeignKey, b: ForeignKey): boolean {
  return (
    a.refTableId === b.refTableId &&
    a.onDelete === b.onDelete &&
    eqSeq(a.columnIds, b.columnIds) &&
    eqSeq(a.refColumnIds, b.refColumnIds)
  );
}

// ── id maps ────────────────────────────────────────────────────────────────

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((it) => [it.id, it]));
}

// ── per-level diff ─────────────────────────────────────────────────────────

function diffColumns(tableId: string, base: Table, head: Table): Operation[] {
  const ops: Operation[] = [];
  const baseCols = byId(base.columns);
  const headCols = byId(head.columns);

  for (const col of head.columns) {
    const prev = baseCols.get(col.id);
    if (!prev) {
      ops.push({ type: "addColumn", tableId, column: col });
      continue;
    }
    if (prev.name !== col.name) {
      ops.push({ type: "renameColumn", tableId, columnId: col.id, from: prev.name, to: col.name });
    }
    if (!sameColumnType(prev.type, col.type)) {
      ops.push({ type: "retypeColumn", tableId, columnId: col.id, from: prev.type, to: col.type });
    }
    if (prev.nullable !== col.nullable) {
      ops.push({ type: "setNullable", tableId, columnId: col.id, from: prev.nullable, to: col.nullable });
    }
    if (prev.default !== col.default) {
      ops.push({ type: "setDefault", tableId, columnId: col.id, from: prev.default, to: col.default });
    }
  }
  for (const col of base.columns) {
    if (!headCols.has(col.id)) ops.push({ type: "dropColumn", tableId, column: col });
  }
  return ops;
}

function diffPrimaryKey(tableId: string, base: PrimaryKey | null, head: PrimaryKey | null): Operation[] {
  if (!base && !head) return [];
  if (!base && head) return [{ type: "addPrimaryKey", tableId, primaryKey: head }];
  if (base && !head) return [{ type: "dropPrimaryKey", tableId, primaryKey: base }];
  // both present
  const b = base as PrimaryKey;
  const h = head as PrimaryKey;
  if (b.id === h.id) {
    return eqSeq(b.columnIds, h.columnIds)
      ? []
      : [{ type: "changePrimaryKey", tableId, primaryKeyId: b.id, from: b.columnIds, to: h.columnIds }];
  }
  // genuinely replaced: a different constraint object occupies the slot
  return [
    { type: "dropPrimaryKey", tableId, primaryKey: b },
    { type: "addPrimaryKey", tableId, primaryKey: h },
  ];
}

function diffIndexes(tableId: string, base: Table, head: Table): Operation[] {
  const ops: Operation[] = [];
  const baseIdx = byId(base.indexes);
  const headIdx = byId(head.indexes);
  for (const idx of head.indexes) {
    const prev = baseIdx.get(idx.id);
    if (!prev) ops.push({ type: "addIndex", tableId, index: idx });
    else if (!sameIndexDef(prev, idx)) {
      ops.push({
        type: "changeIndex",
        tableId,
        indexId: idx.id,
        from: { name: prev.name, columnIds: prev.columnIds, unique: prev.unique },
        to: { name: idx.name, columnIds: idx.columnIds, unique: idx.unique },
      });
    }
  }
  for (const idx of base.indexes) {
    if (!headIdx.has(idx.id)) ops.push({ type: "dropIndex", tableId, index: idx });
  }
  return ops;
}

function diffUniques(tableId: string, base: Table, head: Table): Operation[] {
  const ops: Operation[] = [];
  const baseUq = byId(base.uniques);
  const headUq = byId(head.uniques);
  for (const uq of head.uniques) {
    const prev = baseUq.get(uq.id);
    if (!prev) ops.push({ type: "addUnique", tableId, unique: uq });
    else if (!eqSet(prev.columnIds, uq.columnIds)) {
      ops.push({
        type: "changeUnique",
        tableId,
        uniqueId: uq.id,
        from: { name: prev.name, columnIds: prev.columnIds },
        to: { name: uq.name, columnIds: uq.columnIds },
      });
    }
  }
  for (const uq of base.uniques) {
    if (!headUq.has(uq.id)) ops.push({ type: "dropUnique", tableId, unique: uq });
  }
  return ops;
}

function diffForeignKeys(tableId: string, base: Table, head: Table): Operation[] {
  const ops: Operation[] = [];
  const baseFk = byId(base.foreignKeys);
  const headFk = byId(head.foreignKeys);
  for (const fk of head.foreignKeys) {
    const prev = baseFk.get(fk.id);
    if (!prev) ops.push({ type: "addForeignKey", tableId, fk });
    else if (!sameForeignKeyDef(prev, fk)) {
      ops.push({
        type: "changeForeignKey",
        tableId,
        fkId: fk.id,
        from: {
          name: prev.name,
          columnIds: prev.columnIds,
          refTableId: prev.refTableId,
          refColumnIds: prev.refColumnIds,
          onDelete: prev.onDelete,
        },
        to: {
          name: fk.name,
          columnIds: fk.columnIds,
          refTableId: fk.refTableId,
          refColumnIds: fk.refColumnIds,
          onDelete: fk.onDelete,
        },
      });
    }
  }
  for (const fk of base.foreignKeys) {
    if (!headFk.has(fk.id)) ops.push({ type: "dropForeignKey", tableId, fk });
  }
  return ops;
}

function diffTableInternals(base: Table, head: Table): Operation[] {
  return [
    ...diffColumns(head.id, base, head),
    ...diffPrimaryKey(head.id, base.primaryKey, head.primaryKey),
    ...diffIndexes(head.id, base, head),
    ...diffUniques(head.id, base, head),
    ...diffForeignKeys(head.id, base, head),
  ];
}

// ── entry point ────────────────────────────────────────────────────────────

/**
 * The derived delta from `base` to `head`. Deterministic emission order:
 *
 *   1. for each table in `head` order:
 *        a. `createTable` if new, else `renameTable` if the name changed
 *        b. the table's internal ops (columns, PK, indexes, uniques, FKs)
 *   2. `dropTable` for each table in `base` not in `head`, in `base` order
 *
 * Not dependency-ordered — `applyDelta` topologically sorts before replay.
 */
export function diffSnapshots(base: SchemaDocument, head: SchemaDocument): Operation[] {
  const ops: Operation[] = [];
  const baseTables = byId(base.tables);
  const headTables = byId(head.tables);

  for (const table of head.tables) {
    const prev = baseTables.get(table.id);
    if (!prev) {
      ops.push({ type: "createTable", table });
      continue;
    }
    if (prev.name !== table.name) {
      ops.push({ type: "renameTable", tableId: table.id, from: prev.name, to: table.name });
    }
    ops.push(...diffTableInternals(prev, table));
  }
  for (const table of base.tables) {
    if (!headTables.has(table.id)) ops.push({ type: "dropTable", table });
  }
  return ops;
}

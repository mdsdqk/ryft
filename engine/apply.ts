/**
 * applyDelta — replay a derived delta onto a schema document.
 *
 * `applyDelta(delta, doc)` returns a NEW document with every op in `delta`
 * applied. It never mutates `doc` (the commutativity oracle applies the same
 * `base` repeatedly), so it deep-clones the input up front and works on the copy.
 *
 * ── Replay order: fixed phases, not a general topological sort ───────────────
 *
 * The dependency graph is shallow — `table -> column -> {index, PK, unique, FK}`,
 * cross-table only through a foreign key — so a fixed phase order covers every
 * case the engine can produce:
 *
 *   A.  createTable (FKs stripped off and deferred), renameTable
 *   A2. dropPrimaryKey — before B, so a one-side PK replacement
 *       (dropPrimaryKey + addPrimaryKey in one delta) does not trip
 *       "table already has a primary key". Safe for a plain PK drop too.
 *   B.  all intra-table edits: column add/rename/retype/nullable/default,
 *       primary key add/change, index add/change, unique add/change
 *   C.  addForeignKey / changeForeignKey, plus the FKs deferred from phase A
 *   D.  drops, in reverse dependency order: dropForeignKey, then
 *       dropIndex / dropUnique, then dropColumn, then dropTable
 *
 * The one trick is stripping FKs off `createTable` in A and replaying them in C:
 * it dissolves "new table A's FK references new table B" without sorting the
 * creates. Within a phase, ops are order-independent by construction — a
 * `renameColumn` and a dependent `addIndex` commute because the index holds the
 * column's id, not its name.
 *
 * ── Failure ────────────────────────────────────────────────────────────────
 *
 * A malformed delta (addColumn to an absent table, changeIndex on an unknown id,
 * ...) throws `DeltaApplyError`. The merge never lets a raw throw escape: it runs
 * `applyDelta` inside the commutativity post-condition and reports a failure as
 * an unclassified divergence that blocks the merge.
 */

import type { Delta, Operation } from "./operations.js";
import type { ForeignKey, Index, SchemaDocument, Table, Unique } from "./schema.js";

export class DeltaApplyError extends Error {
  constructor(
    message: string,
    /** The op that could not be applied. */
    readonly op: Operation,
  ) {
    super(message);
    this.name = "DeltaApplyError";
  }
}

// ── lookup helpers (throwing) ──────────────────────────────────────────────

function mustTable(doc: SchemaDocument, id: string, op: Operation): Table {
  const t = doc.tables.find((t) => t.id === id);
  if (!t) throw new DeltaApplyError(`no table ${id}`, op);
  return t;
}

function mustColumn(table: Table, id: string, op: Operation) {
  const c = table.columns.find((c) => c.id === id);
  if (!c) throw new DeltaApplyError(`no column ${id} on table ${table.id}`, op);
  return c;
}

function mustIndex(table: Table, id: string, op: Operation): Index {
  const i = table.indexes.find((i) => i.id === id);
  if (!i) throw new DeltaApplyError(`no index ${id} on table ${table.id}`, op);
  return i;
}

function mustUnique(table: Table, id: string, op: Operation): Unique {
  const u = table.uniques.find((u) => u.id === id);
  if (!u) throw new DeltaApplyError(`no unique ${id} on table ${table.id}`, op);
  return u;
}

function mustForeignKey(table: Table, id: string, op: Operation): ForeignKey {
  const f = table.foreignKeys.find((f) => f.id === id);
  if (!f) throw new DeltaApplyError(`no foreign key ${id} on table ${table.id}`, op);
  return f;
}

// ── phase bucketing ───────────────────────────────────────────────────────

interface Phases {
  a: Operation[];
  b: Operation[];
  c: Operation[];
  /**
   * `dropPrimaryKey` replayed before phase B, not in teardown: a one-side PK
   * replacement is `dropPrimaryKey` + `addPrimaryKey` in one delta (`diffSnapshots`
   * emits it when the PK id changes), and `addPrimaryKey` throws if the old PK is
   * still present. Running it first is safe for a plain PK drop too — a PK has no
   * dependents to tear down after.
   */
  pkDrop: Operation[];
  /** Drop ops, split so they replay dependents-before-targets. */
  dFk: Operation[];
  dConstraint: Operation[];
  dColumn: Operation[];
  dTable: Operation[];
}

function bucket(delta: Delta): Phases {
  const p: Phases = {
    a: [], b: [], c: [], pkDrop: [], dFk: [], dConstraint: [], dColumn: [], dTable: [],
  };
  for (const op of delta) {
    switch (op.type) {
      case "createTable":
      case "renameTable":
        p.a.push(op);
        break;
      case "addColumn":
      case "renameColumn":
      case "retypeColumn":
      case "setNullable":
      case "setDefault":
      case "addPrimaryKey":
      case "changePrimaryKey":
      case "addIndex":
      case "changeIndex":
      case "addUnique":
      case "changeUnique":
        p.b.push(op);
        break;
      case "addForeignKey":
      case "changeForeignKey":
        p.c.push(op);
        break;
      case "dropForeignKey":
        p.dFk.push(op);
        break;
      case "dropPrimaryKey":
        p.pkDrop.push(op);
        break;
      case "dropIndex":
      case "dropUnique":
        p.dConstraint.push(op);
        break;
      case "dropColumn":
        p.dColumn.push(op);
        break;
      case "dropTable":
        p.dTable.push(op);
        break;
    }
  }
  return p;
}

// ── op appliers ───────────────────────────────────────────────────────────

function applyStructural(doc: SchemaDocument, op: Operation, deferredFks: Operation[]): void {
  switch (op.type) {
    case "createTable": {
      if (doc.tables.some((t) => t.id === op.table.id)) {
        throw new DeltaApplyError(`table ${op.table.id} already exists`, op);
      }
      const table = structuredClone(op.table);
      // FKs are replayed in phase C once every referand table/column exists.
      for (const fk of table.foreignKeys) {
        deferredFks.push({ type: "addForeignKey", tableId: table.id, fk });
      }
      table.foreignKeys = [];
      doc.tables.push(table);
      return;
    }
    case "renameTable":
      mustTable(doc, op.tableId, op).name = op.to;
      return;
    default:
      return;
  }
}

function applyIntraTable(doc: SchemaDocument, op: Operation): void {
  switch (op.type) {
    case "addColumn": {
      const table = mustTable(doc, op.tableId, op);
      if (table.columns.some((c) => c.id === op.column.id)) {
        throw new DeltaApplyError(`column ${op.column.id} already exists`, op);
      }
      table.columns.push(structuredClone(op.column));
      return;
    }
    case "renameColumn":
      mustColumn(mustTable(doc, op.tableId, op), op.columnId, op).name = op.to;
      return;
    case "retypeColumn":
      mustColumn(mustTable(doc, op.tableId, op), op.columnId, op).type = structuredClone(op.to);
      return;
    case "setNullable":
      mustColumn(mustTable(doc, op.tableId, op), op.columnId, op).nullable = op.to;
      return;
    case "setDefault":
      mustColumn(mustTable(doc, op.tableId, op), op.columnId, op).default = op.to;
      return;
    case "addPrimaryKey": {
      const table = mustTable(doc, op.tableId, op);
      if (table.primaryKey) throw new DeltaApplyError(`table ${table.id} already has a primary key`, op);
      table.primaryKey = structuredClone(op.primaryKey);
      return;
    }
    case "changePrimaryKey": {
      const table = mustTable(doc, op.tableId, op);
      if (!table.primaryKey || table.primaryKey.id !== op.primaryKeyId) {
        throw new DeltaApplyError(`no primary key ${op.primaryKeyId} on table ${table.id}`, op);
      }
      table.primaryKey.columnIds = [...op.to];
      return;
    }
    case "addIndex": {
      const table = mustTable(doc, op.tableId, op);
      if (table.indexes.some((i) => i.id === op.index.id)) {
        throw new DeltaApplyError(`index ${op.index.id} already exists`, op);
      }
      table.indexes.push(structuredClone(op.index));
      return;
    }
    case "changeIndex": {
      const idx = mustIndex(mustTable(doc, op.tableId, op), op.indexId, op);
      idx.columnIds = [...op.to.columnIds];
      idx.unique = op.to.unique;
      return;
    }
    case "addUnique": {
      const table = mustTable(doc, op.tableId, op);
      if (table.uniques.some((u) => u.id === op.unique.id)) {
        throw new DeltaApplyError(`unique ${op.unique.id} already exists`, op);
      }
      table.uniques.push(structuredClone(op.unique));
      return;
    }
    case "changeUnique":
      mustUnique(mustTable(doc, op.tableId, op), op.uniqueId, op).columnIds = [...op.to.columnIds];
      return;
    default:
      return;
  }
}

function applyForeignKey(doc: SchemaDocument, op: Operation): void {
  switch (op.type) {
    case "addForeignKey": {
      const table = mustTable(doc, op.tableId, op);
      if (table.foreignKeys.some((f) => f.id === op.fk.id)) {
        throw new DeltaApplyError(`foreign key ${op.fk.id} already exists`, op);
      }
      table.foreignKeys.push(structuredClone(op.fk));
      return;
    }
    case "changeForeignKey": {
      const fk = mustForeignKey(mustTable(doc, op.tableId, op), op.fkId, op);
      fk.columnIds = [...op.to.columnIds];
      fk.refTableId = op.to.refTableId;
      fk.refColumnIds = [...op.to.refColumnIds];
      fk.onDelete = op.to.onDelete;
      return;
    }
    default:
      return;
  }
}

function applyDrop(doc: SchemaDocument, op: Operation): void {
  switch (op.type) {
    case "dropForeignKey": {
      const table = mustTable(doc, op.tableId, op);
      table.foreignKeys = table.foreignKeys.filter((f) => f.id !== op.fk.id);
      return;
    }
    case "dropIndex": {
      const table = mustTable(doc, op.tableId, op);
      table.indexes = table.indexes.filter((i) => i.id !== op.index.id);
      return;
    }
    case "dropUnique": {
      const table = mustTable(doc, op.tableId, op);
      table.uniques = table.uniques.filter((u) => u.id !== op.unique.id);
      return;
    }
    case "dropPrimaryKey": {
      const table = mustTable(doc, op.tableId, op);
      table.primaryKey = null;
      return;
    }
    case "dropColumn": {
      const table = mustTable(doc, op.tableId, op);
      table.columns = table.columns.filter((c) => c.id !== op.column.id);
      return;
    }
    case "dropTable":
      doc.tables = doc.tables.filter((t) => t.id !== op.table.id);
      return;
    default:
      return;
  }
}

// ── entry point ───────────────────────────────────────────────────────────

export function applyDelta(delta: Delta, doc: SchemaDocument): SchemaDocument {
  const next = structuredClone(doc);
  const p = bucket(delta);
  const deferredFks: Operation[] = [];

  for (const op of p.a) applyStructural(next, op, deferredFks);
  for (const op of p.pkDrop) applyDrop(next, op);
  for (const op of p.b) applyIntraTable(next, op);
  for (const op of [...p.c, ...deferredFks]) applyForeignKey(next, op);
  for (const op of [...p.dFk, ...p.dConstraint, ...p.dColumn, ...p.dTable]) applyDrop(next, op);

  return next;
}

/**
 * replay — the intermediate-state validity check for a generated migration.
 * Ticket 0003.
 *
 * The ordering rules in `emit.ts` are the implementation; this is the verifier.
 * It replays the `DdlStatement[]` one statement at a time against a lightweight
 * in-memory schema model and asserts, after EVERY statement, that the schema is
 * still structurally sound — every prefix of the migration, not just the final
 * state. This runs at generation time (ADR 0003 §4), so a bad ordering is caught
 * before any SQL is handed over, on top of the transaction that would roll it
 * back at apply time.
 *
 * PlanetScale's `schemadiff` does the same: it "validat[es] that the overall
 * schema remains structurally sound at every intermediate state".
 *
 * ── Relationship to `applyDelta` ──────────────────────────────────────────
 * `applyDelta` (engine/apply.ts) replays `Operation[]` (id-referenced) as one
 * batch in four phases. This replays `DdlStatement[]` (name-referenced, already
 * ordered) one at a time and checks between each. Different granularity, so it
 * is a separate small replayer over the same `SchemaDocument` shape rather than
 * a reuse of `applyDelta`.
 */

import type { DdlStatement } from "./emit.js";
import type { Column, OnDeleteAction, SchemaDocument, Table } from "./schema.js";

export class IntermediateStateError extends Error {
  constructor(
    message: string,
    /** 0-based index of the statement whose prefix first became invalid. */
    readonly stepIndex: number,
    readonly statement: DdlStatement,
  ) {
    super(message);
    this.name = "IntermediateStateError";
  }
}

/**
 * Structural-validity predicate, run after every replayed statement
 * (`verifyPrefixes`). Returns `null` if sound, else the FIRST failure as a
 * human-readable string.
 *
 * SCOPE: reference resolution only —
 *   - table names unique; column names unique within a table
 *   - every primary-key / index / unique member column exists in its table
 *   - every foreign key's local columns exist; its referenced table exists and
 *     its referenced columns exist in that table
 *
 * This is the SEAM to ticket 0008 (ADR 0003 §4). 0008 owns the rest of
 * structural validity — a nullable column in a primary key, a default literal
 * that cannot be rendered, NOT NULL added with no default — and will extend this
 * predicate (its checks added here, or composed alongside it). The
 * migration-ordering check only needs reference resolution: a wrong statement
 * order shows up as an object referenced before it exists, which is exactly what
 * this catches.
 *
 * Operates on a `SchemaDocument` — the same type the merge engine uses — whose
 * objects reference columns and tables by id. `replayStatement` keeps the model
 * in that shape as it applies each (name-referenced) statement.
 */
export function checkReferences(doc: SchemaDocument): string | null {
  const tablesById = new Map(doc.tables.map((t) => [t.id, t]));
  const seenTableNames = new Set<string>();

  for (const t of doc.tables) {
    if (seenTableNames.has(t.name)) return `duplicate table name "${t.name}"`;
    seenTableNames.add(t.name);

    const colIds = new Set(t.columns.map((c) => c.id));
    const seenColNames = new Set<string>();
    for (const c of t.columns) {
      if (seenColNames.has(c.name)) return `duplicate column name "${c.name}" on table "${t.name}"`;
      seenColNames.add(c.name);
    }

    /** First missing member, or `null`. */
    const missingMember = (columnIds: string[], what: string): string | null => {
      for (const cid of columnIds) {
        if (!colIds.has(cid)) return `${what} on table "${t.name}" references missing column ${cid}`;
      }
      return null;
    };

    if (t.primaryKey) {
      const e = missingMember(t.primaryKey.columnIds, `primary key "${t.primaryKey.name}"`);
      if (e) return e;
    }
    for (const idx of t.indexes) {
      const e = missingMember(idx.columnIds, `index "${idx.name}"`);
      if (e) return e;
    }
    for (const uq of t.uniques) {
      const e = missingMember(uq.columnIds, `unique "${uq.name}"`);
      if (e) return e;
    }
    for (const fk of t.foreignKeys) {
      const localMissing = missingMember(fk.columnIds, `foreign key "${fk.name}"`);
      if (localMissing) return localMissing;

      const refTable = tablesById.get(fk.refTableId);
      if (!refTable) {
        return `foreign key "${fk.name}" on table "${t.name}" references missing table ${fk.refTableId}`;
      }
      const refColIds = new Set(refTable.columns.map((c) => c.id));
      for (const cid of fk.refColumnIds) {
        if (!refColIds.has(cid)) {
          return `foreign key "${fk.name}" on table "${t.name}" references missing column ${cid} on "${refTable.name}"`;
        }
      }
    }
  }

  return null;
}

// ── the tiny replayer ────────────────────────────────────────────────────
//
// The working model IS a `SchemaDocument` (chunk 6 decision — one model type in
// the codebase, shared with the merge engine and with `checkReferences`). It is
// mutated in place; `verifyPrefixes` clones `source` once up front.
//
// Statements reference tables and columns BY NAME; the model references them by
// id. So `replayStatement` resolves each name to the live object and mutates it,
// keeping ids stable — e.g. `RENAME COLUMN` finds the column by its old name and
// sets `.name`, so every index/FK holding that column's id still resolves.

function mustTable(model: SchemaDocument, name: string, ctx: string): Table {
  const t = model.tables.find((x) => x.name === name);
  if (!t) throw new Error(`${ctx}: no table "${name}"`);
  return t;
}

function mustColumn(table: Table, name: string, ctx: string): Column {
  const c = table.columns.find((x) => x.name === name);
  if (!c) throw new Error(`${ctx}: no column "${name}" on table "${table.name}"`);
  return c;
}

/** Resolve statement column names to live model column ids, in order. */
function colIds(table: Table, names: string[], ctx: string): string[] {
  return names.map((n) => mustColumn(table, n, ctx).id);
}

/**
 * Apply one `DdlStatement` to the running model in place.
 *
 * Statements are name-referenced; the model is id-referenced. Each case resolves
 * names to live objects and mutates them, keeping ids stable — so a `RENAME
 * COLUMN` only touches `.name` and every index / FK holding that column's id
 * still resolves afterwards.
 *
 * New objects get a synthetic `replay:*` id minted from their names. Nothing
 * dereferences those ids (indexes and constraints are dropped by name), and the
 * `replay:` prefix cannot collide with a real id from `source`. An impossible
 * mutation throws a plain `Error`; `verifyPrefixes` converts it.
 */
function replayStatement(model: SchemaDocument, stmt: DdlStatement): void {
  const mint = (...parts: string[]): string => `replay:${parts.join(":")}`;

  switch (stmt.kind) {
    case "createTable": {
      if (model.tables.some((t) => t.name === stmt.table)) {
        throw new Error(`createTable: "${stmt.table}" already exists`);
      }
      const columns: Column[] = stmt.columns.map((c) => ({
        id: mint("col", stmt.table, c.name),
        name: c.name,
        type: c.type,
        nullable: c.nullable,
        default: c.default,
      }));
      const table: Table = {
        id: mint("tbl", stmt.table),
        name: stmt.table,
        columns,
        primaryKey: null,
        foreignKeys: [],
        uniques: [],
        indexes: [],
      };
      if (stmt.primaryKey) {
        const idByName = new Map(columns.map((c) => [c.name, c.id]));
        table.primaryKey = {
          id: mint("pk", stmt.table, stmt.primaryKey.name),
          name: stmt.primaryKey.name,
          columnIds: stmt.primaryKey.columns.map((n) => {
            const id = idByName.get(n);
            if (!id) throw new Error(`createTable "${stmt.table}": primary key references unknown column "${n}"`);
            return id;
          }),
        };
      }
      model.tables.push(table);
      return;
    }

    case "renameTable": {
      if (model.tables.some((t) => t.name === stmt.to)) throw new Error(`renameTable: "${stmt.to}" already exists`);
      mustTable(model, stmt.from, "renameTable").name = stmt.to;
      return;
    }

    case "renameColumn": {
      const t = mustTable(model, stmt.table, "renameColumn");
      if (t.columns.some((c) => c.name === stmt.to)) {
        throw new Error(`renameColumn: "${stmt.to}" already exists on "${t.name}"`);
      }
      mustColumn(t, stmt.from, "renameColumn").name = stmt.to;
      return;
    }

    case "addColumn": {
      const t = mustTable(model, stmt.table, "addColumn");
      if (t.columns.some((c) => c.name === stmt.column.name)) {
        throw new Error(`addColumn: "${stmt.column.name}" already exists on "${t.name}"`);
      }
      t.columns.push({ id: mint("col", stmt.table, stmt.column.name), ...stmt.column });
      return;
    }

    case "alterColumnType":
      mustColumn(mustTable(model, stmt.table, "alterColumnType"), stmt.column, "alterColumnType").type = stmt.to;
      return;

    case "setNotNull":
      mustColumn(mustTable(model, stmt.table, "setNotNull"), stmt.column, "setNotNull").nullable = false;
      return;

    case "dropNotNull":
      mustColumn(mustTable(model, stmt.table, "dropNotNull"), stmt.column, "dropNotNull").nullable = true;
      return;

    case "setDefault":
      mustColumn(mustTable(model, stmt.table, "setDefault"), stmt.column, "setDefault").default = stmt.expr;
      return;

    case "dropDefault":
      mustColumn(mustTable(model, stmt.table, "dropDefault"), stmt.column, "dropDefault").default = null;
      return;

    case "addPrimaryKey": {
      const t = mustTable(model, stmt.table, "addPrimaryKey");
      if (t.primaryKey) throw new Error(`addPrimaryKey: "${t.name}" already has a primary key`);
      t.primaryKey = {
        id: mint("pk", stmt.table, stmt.name),
        name: stmt.name,
        columnIds: colIds(t, stmt.columns, "addPrimaryKey"),
      };
      return;
    }

    case "addUnique": {
      const t = mustTable(model, stmt.table, "addUnique");
      t.uniques.push({
        id: mint("uq", stmt.table, stmt.name),
        name: stmt.name,
        columnIds: colIds(t, stmt.columns, "addUnique"),
      });
      return;
    }

    case "createIndex": {
      const t = mustTable(model, stmt.table, "createIndex");
      if (model.tables.some((x) => x.indexes.some((i) => i.name === stmt.name))) {
        throw new Error(`createIndex: "${stmt.name}" already exists`);
      }
      t.indexes.push({
        id: mint("idx", stmt.table, stmt.name),
        name: stmt.name,
        columnIds: colIds(t, stmt.columns, "createIndex"),
        unique: stmt.unique,
      });
      return;
    }

    case "addForeignKey": {
      const t = mustTable(model, stmt.table, "addForeignKey");
      const refT = mustTable(model, stmt.refTable, "addForeignKey");
      t.foreignKeys.push({
        id: mint("fk", stmt.table, stmt.name),
        name: stmt.name,
        columnIds: colIds(t, stmt.columns, "addForeignKey"),
        refTableId: refT.id,
        refColumnIds: colIds(refT, stmt.refColumns, "addForeignKey"),
        onDelete: stmt.onDelete as OnDeleteAction,
      });
      return;
    }

    case "dropConstraint": {
      const t = mustTable(model, stmt.table, "dropConstraint");
      if (t.primaryKey?.name === stmt.name) {
        t.primaryKey = null;
        return;
      }
      const uniquesBefore = t.uniques.length;
      t.uniques = t.uniques.filter((u) => u.name !== stmt.name);
      if (t.uniques.length !== uniquesBefore) return;
      const fksBefore = t.foreignKeys.length;
      t.foreignKeys = t.foreignKeys.filter((f) => f.name !== stmt.name);
      if (t.foreignKeys.length !== fksBefore) return;
      throw new Error(`dropConstraint: no constraint "${stmt.name}" on table "${t.name}"`);
    }

    case "dropIndex": {
      const owner = model.tables.find((t) => t.indexes.some((i) => i.name === stmt.name));
      if (!owner) throw new Error(`dropIndex: no index "${stmt.name}"`);
      owner.indexes = owner.indexes.filter((i) => i.name !== stmt.name);
      return;
    }

    case "dropColumn": {
      const t = mustTable(model, stmt.table, "dropColumn");
      mustColumn(t, stmt.column, "dropColumn"); // existence check
      t.columns = t.columns.filter((c) => c.name !== stmt.column);
      return;
    }

    case "dropTable": {
      mustTable(model, stmt.table, "dropTable"); // existence check
      model.tables = model.tables.filter((t) => t.name !== stmt.table);
      return;
    }
  }
}

/**
 * Replay every statement against a clone of `source`, running `checkReferences`
 * after each. Throws `IntermediateStateError` (carrying the 0-based step index
 * and the offending statement) at the first bad prefix — whether the statement
 * was impossible to apply or the schema it produced fails the predicate. Returns
 * the final model on success, so a caller can compare it to `target`.
 */
export function verifyPrefixes(source: SchemaDocument, statements: DdlStatement[]): SchemaDocument {
  const model = structuredClone(source);
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      replayStatement(model, stmt);
    } catch (e) {
      throw new IntermediateStateError((e as Error).message, i, stmt);
    }
    const bad = checkReferences(model);
    if (bad) throw new IntermediateStateError(bad, i, stmt);
  }
  return model;
}

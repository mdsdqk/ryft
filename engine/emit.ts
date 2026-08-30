/**
 * emitMigration — render the delta between two schema documents as a runnable,
 * dependency-ordered, forward-only Postgres DDL migration. Ticket 0003.
 *
 * Pipeline (see `docs/migration-generation.md`):
 *
 *   emitMigration(source, target)
 *     ├─ diffSnapshots(source, target)            → Delta (Operation[], id-referenced)
 *     ├─ expand each Operation into DdlStatement[] (names resolved via NameResolver)
 *     ├─ bucket statements into the four fixed phases (§3)
 *     ├─ verifyPrefixes(...)                        → intermediate-state replay check (engine/replay.ts)
 *     └─ serialize: header + BEGIN; … COMMIT;
 *
 * `source` is the document the migration starts from (`theirs` for a merge,
 * `base` for a branch head); `target` is where it ends (the merged document, or
 * the branch head). We take the two documents and derive the delta internally —
 * same stance as `threeWayMerge`, which takes documents and derives its deltas
 * rather than being handed them (ADR 0003 §1).
 *
 * The engine still has zero runtime dependencies and zero framework imports.
 */

import { diffSnapshots, sameForeignKeyDef } from "./diff.js";
import { verifyPrefixes } from "./replay.js";
import type { Delta, Operation } from "./operations.js";
import type { ColumnType, ForeignKey, SchemaDocument } from "./schema.js";

// ── the DDL statement IR (ADR 0003 §2) ─────────────────────────────────────
//
// A typed statement list that mirrors Postgres DDL 1:1 and carries RESOLVED
// NAMES, never ids. Two consumers: `serialize` below (→ SQL text) and
// `engine/replay.ts` (→ intermediate-state check). The merge-review screen can
// render it directly. `destructive` tags the statements ticket 0008's warning
// pass cares about; the flag is set here, the warning copy is 0008's.

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  nullable: boolean;
  /** Raw default literal exactly as authored, or `null` for no default clause. */
  default: string | null;
}

export type DdlStatement =
  // ── phase 1: creates + renames ──────────────────────────────────────────
  | { kind: "createTable"; table: string; columns: ColumnSpec[]; primaryKey: { name: string; columns: string[] } | null }
  | { kind: "renameTable"; from: string; to: string }
  | { kind: "renameColumn"; table: string; from: string; to: string }
  // ── phase 2: intra-table alters ─────────────────────────────────────────
  | { kind: "addColumn"; table: string; column: ColumnSpec }
  | { kind: "alterColumnType"; table: string; column: string; to: ColumnType }
  | { kind: "setNotNull"; table: string; column: string }
  | { kind: "dropNotNull"; table: string; column: string }
  | { kind: "setDefault"; table: string; column: string; expr: string }
  | { kind: "dropDefault"; table: string; column: string }
  | { kind: "addPrimaryKey"; table: string; name: string; columns: string[] }
  | { kind: "addUnique"; table: string; name: string; columns: string[] }
  | { kind: "createIndex"; table: string; name: string; columns: string[]; unique: boolean }
  // ── phase 3: foreign keys (after every referand table + column exists) ───
  | { kind: "addForeignKey"; table: string; name: string; columns: string[]; refTable: string; refColumns: string[]; onDelete: string }
  // ── phase 4: drops, reverse dependency order ────────────────────────────
  | { kind: "dropConstraint"; table: string; name: string; destructive: boolean }
  | { kind: "dropIndex"; name: string; destructive: boolean }
  | { kind: "dropColumn"; table: string; column: string; destructive: boolean }
  | { kind: "dropTable"; table: string; destructive: boolean };

export interface Migration {
  /** The ordered IR. The reusable artifact — SQL text is one serialization of it. */
  statements: DdlStatement[];
  /** `-- header` + `BEGIN;` + one statement per line + `COMMIT;`. */
  sql: string;
}

// ── identifier quoting — seam to ticket 0008 (ADR 0003 §5) ─────────────────
//
// 0008 owns the real rules (reserved words, mixed case, round-tripping). Until
// then: always double-quote and escape embedded quotes. Safe, if noisy.
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Render a `ColumnType` as its Postgres type name. Mechanical; no widening lattice. */
export function renderType(t: ColumnType): string {
  switch (t.kind) {
    case "int":
      return "integer";
    case "bigint":
      return "bigint";
    case "text":
      return "text";
    case "boolean":
      return "boolean";
    case "timestamptz":
      return "timestamptz";
    case "uuid":
      return "uuid";
    case "jsonb":
      return "jsonb";
    case "varchar":
      return `varchar(${t.n})`;
    case "numeric":
      return `numeric(${t.precision}, ${t.scale})`;
  }
}

// ── name resolution across renames (§2) ───────────────────────────────────
//
// Tables and columns HAVE a name in the model. Resolve it from `target`. Every
// `renameTable` / `renameColumn` is emitted in phase 1, before any statement
// that resolves a name, so a resolver keyed on `target` is correct for phases
// 2–4; phase-1 rename statements render from the delta's own `from` / `to`.
//
// Primary keys, uniques, foreign keys, and indexes ALSO carry a stored `name`
// (`engine/schema.ts`) — their DDL identifier is that name, verbatim. A `DROP`
// must name the exact string the `CREATE` used; because the name is stored on
// the object (not synthesised from column names) it survives a column rename and
// create-time / drop-time always agree. `constraintIdent` / `indexIdent` read it
// from `target` for adds and changes (the object is still there); a PURE drop
// reads it straight off the drop op's payload (`op.index.name`, …) since the
// object is gone from `target` — see `expand`.
export class NameResolver {
  constructor(private readonly target: SchemaDocument) {}

  private mustTable(id: string): SchemaDocument["tables"][number] {
    const t = this.target.tables.find((x) => x.id === id);
    if (!t) throw new Error(`emit: no table ${id} in target`);
    return t;
  }

  table(id: string): string {
    return this.mustTable(id).name;
  }

  column(tableId: string, id: string): string {
    const c = this.mustTable(tableId).columns.find((x) => x.id === id);
    if (!c) throw new Error(`emit: no column ${id} on table ${tableId} in target`);
    return c.name;
  }

  /** DDL identifier of a PK / unique / FK constraint that exists in `target`. */
  constraintIdent(tableId: string, constraintId: string): string {
    const t = this.mustTable(tableId);
    if (t.primaryKey?.id === constraintId) return t.primaryKey.name;
    const u = t.uniques.find((x) => x.id === constraintId);
    if (u) return u.name;
    const f = t.foreignKeys.find((x) => x.id === constraintId);
    if (f) return f.name;
    throw new Error(`emit: no constraint ${constraintId} on table ${tableId} in target`);
  }

  /** DDL identifier of an index that exists in `target`. */
  indexIdent(tableId: string, indexId: string): string {
    const i = this.mustTable(tableId).indexes.find((x) => x.id === indexId);
    if (!i) throw new Error(`emit: no index ${indexId} on table ${tableId} in target`);
    return i.name;
  }
}

// ── Operation → statement groups ─────────────────────────────────────────
//
// `expand` returns a list of GROUPS (`DdlStatement[][]`). A group is one or more
// statements that must stay contiguous and are placed together at their EARLIEST
// member phase (see `order`). Almost every op is a single-statement group. The
// exception is an id-preserving redefinition — `changeIndex` / `changeUnique` /
// `changePrimaryKey` — which becomes a two-statement group: a `drop` immediately
// followed by its re-add. Grouping is what keeps that pair adjacent and in
// phase 2 instead of the drop being sorted away into the phase-4 teardown (ADR
// 0003 §3, the emit-side mirror of `apply.ts`'s `pkDrop`-before-B handling).
//
// A PURE drop — the object is gone from `target` — is a normal single-statement
// group and lands in phase 4. Its name is read straight off the drop op's
// payload (`op.index.name`, …), since it is no longer in `target` to resolve.
//
// Chunk 2 covers tables/columns (done), primary keys, indexes, and uniques.
// Foreign keys still `throw` — chunk 3.

const one = (s: DdlStatement): DdlStatement[][] => [[s]];

function expand(op: Operation, r: NameResolver): DdlStatement[][] {
  switch (op.type) {
    case "createTable": {
      // A fresh table is self-contained: its PK name and its own column names
      // are all in `op.table` — no resolver lookup needed. FKs are intentionally
      // NOT emitted here; `expandForeignKeys` (chunk 3) adds every FK in a later
      // phase, so a new-table ⇄ new-table FK cycle never blocks a create.
      const t = op.table;
      const colName = (id: string): string => {
        const c = t.columns.find((x) => x.id === id);
        if (!c) throw new Error(`emit: createTable ${t.id} references unknown column ${id}`);
        return c.name;
      };
      const groups: DdlStatement[][] = [
        [
          {
            kind: "createTable",
            table: t.name,
            columns: t.columns.map(toColumnSpec),
            primaryKey: t.primaryKey
              ? { name: t.primaryKey.name, columns: t.primaryKey.columnIds.map(colName) }
              : null,
          },
        ],
      ];
      // Uniques and indexes on the fresh table become their own phase-2 groups —
      // separate ADD CONSTRAINT / CREATE INDEX statements after the table exists.
      for (const u of t.uniques) {
        groups.push([{ kind: "addUnique", table: t.name, name: u.name, columns: u.columnIds.map(colName) }]);
      }
      for (const idx of t.indexes) {
        groups.push([
          { kind: "createIndex", table: t.name, name: idx.name, columns: idx.columnIds.map(colName), unique: idx.unique },
        ]);
      }
      return groups;
    }

    case "renameTable":
      return one({ kind: "renameTable", from: op.from, to: op.to });

    case "renameColumn":
      return one({ kind: "renameColumn", table: r.table(op.tableId), from: op.from, to: op.to });

    case "addColumn":
      return one({ kind: "addColumn", table: r.table(op.tableId), column: toColumnSpec(op.column) });

    case "retypeColumn":
      return one({ kind: "alterColumnType", table: r.table(op.tableId), column: r.column(op.tableId, op.columnId), to: op.to });

    case "setNullable":
      return one(
        op.to
          ? { kind: "dropNotNull", table: r.table(op.tableId), column: r.column(op.tableId, op.columnId) }
          : { kind: "setNotNull", table: r.table(op.tableId), column: r.column(op.tableId, op.columnId) },
      );

    case "setDefault":
      return one(
        op.to === null
          ? { kind: "dropDefault", table: r.table(op.tableId), column: r.column(op.tableId, op.columnId) }
          : { kind: "setDefault", table: r.table(op.tableId), column: r.column(op.tableId, op.columnId), expr: op.to },
      );

    // ── primary key ───────────────────────────────────────────────────────
    case "addPrimaryKey":
      return one({
        kind: "addPrimaryKey",
        table: r.table(op.tableId),
        name: op.primaryKey.name,
        columns: op.primaryKey.columnIds.map((c) => r.column(op.tableId, c)),
      });

    case "dropPrimaryKey":
      // Pure drop: name from the payload (gone from `target`). A dropped PK has
      // no dependents to tear down, so it is not marked destructive.
      return one({ kind: "dropConstraint", table: r.table(op.tableId), name: op.primaryKey.name, destructive: false });

    case "changePrimaryKey": {
      // Redefinition: DROP then re-ADD, same name (names are immutable — chunk 1).
      // The PK still exists in `target` (same id), so resolve its name there.
      const table = r.table(op.tableId);
      const name = r.constraintIdent(op.tableId, op.primaryKeyId);
      return [
        [
          { kind: "dropConstraint", table, name, destructive: false },
          { kind: "addPrimaryKey", table, name, columns: op.to.map((c) => r.column(op.tableId, c)) },
        ],
      ];
    }

    // ── indexes ───────────────────────────────────────────────────────────
    case "addIndex":
      return one({
        kind: "createIndex",
        table: r.table(op.tableId),
        name: op.index.name,
        columns: op.index.columnIds.map((c) => r.column(op.tableId, c)),
        unique: op.index.unique,
      });

    case "dropIndex":
      // Pure drop. `DROP INDEX <name>` — index names are schema-scoped, no table.
      return one({ kind: "dropIndex", name: op.index.name, destructive: false });

    case "changeIndex": {
      const table = r.table(op.tableId);
      return [
        [
          { kind: "dropIndex", name: op.from.name, destructive: false },
          {
            kind: "createIndex",
            table,
            name: op.to.name,
            columns: op.to.columnIds.map((c) => r.column(op.tableId, c)),
            unique: op.to.unique,
          },
        ],
      ];
    }

    // ── uniques (constraint form: ADD/DROP CONSTRAINT) ─────────────────────
    case "addUnique":
      return one({
        kind: "addUnique",
        table: r.table(op.tableId),
        name: op.unique.name,
        columns: op.unique.columnIds.map((c) => r.column(op.tableId, c)),
      });

    case "dropUnique":
      return one({ kind: "dropConstraint", table: r.table(op.tableId), name: op.unique.name, destructive: false });

    case "changeUnique": {
      const table = r.table(op.tableId);
      return [
        [
          { kind: "dropConstraint", table, name: op.from.name, destructive: false },
          { kind: "addUnique", table, name: op.to.name, columns: op.to.columnIds.map((c) => r.column(op.tableId, c)) },
        ],
      ];
    }

    // Foreign keys are owned entirely by `expandForeignKeys`, which re-derives
    // every FK add / change / drop by comparing `source` and `target` directly.
    // Going through the documents (not these delta ops) is what lets a new
    // table's FKs — which live only inside its `createTable` payload, never as
    // separate `addForeignKey` ops — be emitted in phase 3 without any
    // "remember what I stripped off the create" bookkeeping (ADR 0003 §4).
    case "addForeignKey":
    case "dropForeignKey":
    case "changeForeignKey":
      return [];

    case "dropColumn":
      return one({ kind: "dropColumn", table: r.table(op.tableId), column: op.column.name, destructive: true });

    case "dropTable":
      return one({ kind: "dropTable", table: op.table.name, destructive: true });
  }
}

function toColumnSpec(c: { name: string; type: ColumnType; nullable: boolean; default: string | null }): ColumnSpec {
  return { name: c.name, type: c.type, nullable: c.nullable, default: c.default };
}

// ── phase bucketing (§3) ──────────────────────────────────────────────────
//
// The dependency graph is shallow and STATIC — `table → column → {index, pk,
// unique, fk}`, cross-table only via FK — so the phase order below IS a
// precomputed topological order of that graph. No runtime graph sort (ADR
// 0003 §3, mirrors `apply.ts`).
//
// The doc's four phases map to these sort keys. Two phases are split so `order()`
// gets a sub-ordering "for free" from a plain numeric sort:
//
//   1  createTable (FK-free), renameTable, renameColumn
//   2  alterColumnType                              ── D4: hoisted ahead of every
//                                                      index / PK / unique add, so
//                                                      Postgres never builds an
//                                                      object then rebuilds it on
//                                                      the type change. A retype
//                                                      only ever targets a
//                                                      pre-existing column, so it
//                                                      cannot collide with an
//                                                      addColumn in key 3.
//   3  addColumn, set/dropNotNull, set/dropDefault, addPrimaryKey, addUnique,
//      createIndex
//   4  addForeignKey
//   5  dropConstraint (FK / PK / unique), dropIndex   — nothing depends on these
//   6  dropColumn                                     — after its constraints/indexes
//   7  dropTable                                      — last; takes any remaining FK with it
//
// Keys 5–7 are the doc's "phase 4" teardown in reverse dependency order (mirrors
// `apply.ts` phase D: FK → index/unique → column → table).

const PHASE: Record<DdlStatement["kind"], number> = {
  createTable: 1,
  renameTable: 1,
  renameColumn: 1,
  alterColumnType: 2,
  addColumn: 3,
  setNotNull: 3,
  dropNotNull: 3,
  setDefault: 3,
  dropDefault: 3,
  addPrimaryKey: 3,
  addUnique: 3,
  createIndex: 3,
  addForeignKey: 4,
  dropConstraint: 5,
  dropIndex: 5,
  dropColumn: 6,
  dropTable: 7,
};

/**
 * Flatten statement groups into a single phase-ordered list.
 *
 * Each group is placed at the MINIMUM `PHASE` key of its members and its members
 * stay contiguous and in emission order — so a `change*` group `[drop, re-add]`
 * lands whole at the re-add's key, the drop never sorted away into the teardown.
 * The sort is stable on `(key, original group index)`, so `expand`'s emission
 * order is preserved wherever keys tie.
 *
 * All ordering rules live in `PHASE` (including D4 — `alterColumnType` hoisted
 * ahead of index/PK/unique adds — and the reverse-dependency teardown), so this
 * function stays a plain stable sort.
 */
function order(groups: DdlStatement[][]): DdlStatement[] {
  return groups
    .filter((g) => g.length > 0)
    .map((g, i) => ({ g, i, phase: Math.min(...g.map((s) => PHASE[s.kind])) }))
    .sort((a, b) => a.phase - b.phase || a.i - b.i)
    .flatMap(({ g }) => g);
}

// ── foreign-key pass (§4) ─────────────────────────────────────────────────
//
// The single owner of every FK statement. Re-derives the FK delta by comparing
// `source` and `target` FKs by id across all tables — NOT from the delta ops —
// so a brand-new table's FKs (which exist only inside its `createTable` payload)
// need no special handling: they are simply "in `target`, not in `source`".
//
// Every FK add lands in phase 3, by which point every endpoint table and column
// exists. That is the whole of the foreign-key ordering knot: two new tables
// that reference each other become two independent phase-3 `ADD CONSTRAINT`
// statements, in either order (ADR 0003 §4).
//
//   new FK        → [ addForeignKey ]                       (phase 3)
//   changed FK    → [ dropConstraint(old), addForeignKey ]  (group min phase 3)
//   removed FK    → [ dropConstraint ]                      (phase 4) — unless the
//                   owning table is also dropped, in which case DROP TABLE takes
//                   the FK with it and we emit nothing.

function addForeignKeyStatement(tableId: string, fk: ForeignKey, r: NameResolver): DdlStatement {
  return {
    kind: "addForeignKey",
    table: r.table(tableId),
    name: fk.name,
    columns: fk.columnIds.map((c) => r.column(tableId, c)),
    refTable: r.table(fk.refTableId),
    refColumns: fk.refColumnIds.map((c) => r.column(fk.refTableId, c)),
    onDelete: fk.onDelete,
  };
}

function expandForeignKeys(source: SchemaDocument, target: SchemaDocument, r: NameResolver): DdlStatement[][] {
  const groups: DdlStatement[][] = [];
  const targetTableIds = new Set(target.tables.map((t) => t.id));

  // Every source FK by id, with the id of the table that owns it.
  const sourceFks = new Map<string, { tableId: string; fk: ForeignKey }>();
  for (const t of source.tables) {
    for (const fk of t.foreignKeys) sourceFks.set(fk.id, { tableId: t.id, fk });
  }

  for (const t of target.tables) {
    for (const fk of t.foreignKeys) {
      const prev = sourceFks.get(fk.id);
      sourceFks.delete(fk.id); // consumed — whatever is left was removed
      if (prev && sameForeignKeyDef(prev.fk, fk)) continue; // unchanged

      const add = addForeignKeyStatement(t.id, fk, r);
      groups.push(
        prev
          ? [{ kind: "dropConstraint", table: r.table(t.id), name: prev.fk.name, destructive: false }, add]
          : [add],
      );
    }
  }

  for (const { tableId, fk } of sourceFks.values()) {
    if (!targetTableIds.has(tableId)) continue; // owning table dropped — DROP TABLE covers it
    groups.push([{ kind: "dropConstraint", table: r.table(tableId), name: fk.name, destructive: false }]);
  }

  return groups;
}

// ── serialization ────────────────────────────────────────────────────────

const HEADER = [
  "-- Generated migration. Forward-only: no down-migration is produced.",
  "-- Renames render as ALTER … RENAME, never drop-and-add.",
  "-- The whole migration is one transaction — it fully applies or does nothing.",
].join("\n");

/**
 * One `DdlStatement` → one SQL statement string (no trailing newline, no
 * `BEGIN`/`COMMIT`). All identifiers go through `quoteIdent`; a column default
 * and `ON DELETE` action are expressions/keywords, emitted verbatim (default
 * literals are 0008's to validate). The switch is exhaustive over the IR.
 */
export function serialize(stmt: DdlStatement): string {
  const q = quoteIdent;
  const cols = (names: string[]): string => names.map(q).join(", ");
  switch (stmt.kind) {
    // ── phase 1 ─────────────────────────────────────────────────────────
    case "createTable": {
      const lines = stmt.columns.map((c) => `  ${columnClause(c)}`);
      if (stmt.primaryKey) {
        lines.push(`  CONSTRAINT ${q(stmt.primaryKey.name)} PRIMARY KEY (${cols(stmt.primaryKey.columns)})`);
      }
      return `CREATE TABLE ${q(stmt.table)} (\n${lines.join(",\n")}\n);`;
    }
    case "renameTable":
      return `ALTER TABLE ${q(stmt.from)} RENAME TO ${q(stmt.to)};`;
    case "renameColumn":
      return `ALTER TABLE ${q(stmt.table)} RENAME COLUMN ${q(stmt.from)} TO ${q(stmt.to)};`;

    // ── phase 2–3: column + constraint + index alters ───────────────────
    case "addColumn":
      return `ALTER TABLE ${q(stmt.table)} ADD COLUMN ${columnClause(stmt.column)};`;
    case "alterColumnType":
      return `ALTER TABLE ${q(stmt.table)} ALTER COLUMN ${q(stmt.column)} TYPE ${renderType(stmt.to)};`;
    case "setNotNull":
      return `ALTER TABLE ${q(stmt.table)} ALTER COLUMN ${q(stmt.column)} SET NOT NULL;`;
    case "dropNotNull":
      return `ALTER TABLE ${q(stmt.table)} ALTER COLUMN ${q(stmt.column)} DROP NOT NULL;`;
    case "setDefault":
      return `ALTER TABLE ${q(stmt.table)} ALTER COLUMN ${q(stmt.column)} SET DEFAULT ${stmt.expr};`;
    case "dropDefault":
      return `ALTER TABLE ${q(stmt.table)} ALTER COLUMN ${q(stmt.column)} DROP DEFAULT;`;
    case "addPrimaryKey":
      return `ALTER TABLE ${q(stmt.table)} ADD CONSTRAINT ${q(stmt.name)} PRIMARY KEY (${cols(stmt.columns)});`;
    case "addUnique":
      return `ALTER TABLE ${q(stmt.table)} ADD CONSTRAINT ${q(stmt.name)} UNIQUE (${cols(stmt.columns)});`;
    case "createIndex":
      return `CREATE ${stmt.unique ? "UNIQUE " : ""}INDEX ${q(stmt.name)} ON ${q(stmt.table)} (${cols(stmt.columns)});`;
    case "addForeignKey":
      return (
        `ALTER TABLE ${q(stmt.table)} ADD CONSTRAINT ${q(stmt.name)} ` +
        `FOREIGN KEY (${cols(stmt.columns)}) ` +
        `REFERENCES ${q(stmt.refTable)} (${cols(stmt.refColumns)}) ` +
        `ON DELETE ${stmt.onDelete.toUpperCase()};`
      );

    // ── teardown ───────────────────────────────────────────────────────
    case "dropConstraint":
      return `ALTER TABLE ${q(stmt.table)} DROP CONSTRAINT ${q(stmt.name)};`;
    case "dropIndex":
      return `DROP INDEX ${q(stmt.name)};`;
    case "dropColumn":
      return `ALTER TABLE ${q(stmt.table)} DROP COLUMN ${q(stmt.column)};`;
    case "dropTable":
      return `DROP TABLE ${q(stmt.table)};`;
  }
}

function columnClause(c: ColumnSpec): string {
  const parts = [quoteIdent(c.name), renderType(c.type)];
  if (!c.nullable) parts.push("NOT NULL");
  if (c.default !== null) parts.push(`DEFAULT ${c.default}`);
  return parts.join(" ");
}

// ── entry point ──────────────────────────────────────────────────────────

export function emitMigration(source: SchemaDocument, target: SchemaDocument): Migration {
  const delta: Delta = diffSnapshots(source, target);
  const r = new NameResolver(target);

  const groups: DdlStatement[][] = [];
  for (const op of delta) groups.push(...expand(op, r));
  groups.push(...expandForeignKeys(source, target, r));

  const statements = order(groups);

  // Every prefix of this migration must leave the schema structurally sound. If
  // the ordering rules produced a bad sequence, `verifyPrefixes` throws an
  // `IntermediateStateError` here rather than letting us hand back SQL we already
  // know is wrong (ADR 0003 §4). The BEGIN/COMMIT wrapper would roll such a
  // migration back at apply time; this catches it at generation time.
  verifyPrefixes(source, statements);

  const body = statements.map(serialize).join("\n");
  const sql = `${HEADER}\n\nBEGIN;\n\n${body}\n\nCOMMIT;\n`;
  return { statements, sql };
}

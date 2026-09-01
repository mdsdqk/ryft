/**
 * Schema-rendering helpers for the branch workspace — a `ColumnType` to its
 * Postgres spelling, an object to its one-line spec, and an `Operation` to a
 * compact log line. Pure; no React. Kept local to the surface for E1; the
 * comparison-grid extraction (E3) is where any of this that merge-review also
 * needs moves to the kit.
 */

import type {
  Column,
  ColumnType,
  ForeignKey,
  Index,
  PrimaryKey,
  Unique,
} from "@engine/schema.js";
import type { Operation } from "@engine/operations.js";

/** id → current name, resolved across every object in the branch head. */
export type NameOf = (id: string) => string;

export function sqlType(t: ColumnType): string {
  switch (t.kind) {
    case "varchar":
      return `varchar(${t.n})`;
    case "numeric":
      return `numeric(${t.precision}, ${t.scale})`;
    default:
      return t.kind;
  }
}

/**
 * The type choices the editor offers (grill Q2 — a preset set, no free
 * parameter field in V0). `optionsForColumn` prepends the column's current type
 * when it is not already one of the presets (e.g. `varchar(50)`), so a retype
 * select always shows where it starts.
 */
export type TypeOption = { value: string; label: string; type: ColumnType };

export const TYPE_PRESETS: TypeOption[] = (
  [
    { kind: "text" },
    { kind: "varchar", n: 255 },
    { kind: "varchar", n: 120 },
    { kind: "varchar", n: 64 },
    { kind: "int" },
    { kind: "bigint" },
    { kind: "boolean" },
    { kind: "timestamptz" },
    { kind: "uuid" },
    { kind: "jsonb" },
    { kind: "numeric", precision: 10, scale: 2 },
  ] as ColumnType[]
).map((type) => ({ value: sqlType(type), label: sqlType(type), type }));

export function optionsForColumn(current: ColumnType): TypeOption[] {
  const here = sqlType(current);
  return TYPE_PRESETS.some((o) => o.value === here)
    ? TYPE_PRESETS
    : [{ value: here, label: `${here} (current)`, type: current }, ...TYPE_PRESETS];
}

export function typeForValue(value: string): ColumnType {
  const hit = TYPE_PRESETS.find((o) => o.value === value);
  if (hit) return hit.type;
  const v = value.match(/^varchar\((\d+)\)$/);
  if (v) return { kind: "varchar", n: Number(v[1]) };
  const n = value.match(/^numeric\((\d+),\s*(\d+)\)$/);
  if (n) return { kind: "numeric", precision: Number(n[1]), scale: Number(n[2]) };
  return { kind: "text" };
}

/** `varchar(255) · not null` — the type, nullability, and any default. */
export function columnSpec(c: Column): string {
  const parts = [sqlType(c.type), c.nullable ? "null" : "not null"];
  if (c.default !== null) parts.push(`default ${c.default}`);
  return parts.join(" · ");
}

const cols = (ids: readonly string[], nameOf: NameOf): string =>
  ids.map(nameOf).join(", ");

export function indexSpec(ix: Index, nameOf: NameOf): string {
  return `${ix.unique ? "unique " : ""}(${cols(ix.columnIds, nameOf)})`;
}

export function primaryKeySpec(pk: PrimaryKey, nameOf: NameOf): string {
  return `primary key (${cols(pk.columnIds, nameOf)})`;
}

export function uniqueSpec(u: Unique, nameOf: NameOf): string {
  return `unique (${cols(u.columnIds, nameOf)})`;
}

export function foreignKeySpec(fk: ForeignKey, nameOf: NameOf): string {
  const local = cols(fk.columnIds, nameOf);
  const ref = cols(fk.refColumnIds, nameOf);
  return `foreign key (${local}) → ${nameOf(fk.refTableId)} (${ref}) on delete ${fk.onDelete}`;
}

/**
 * The id of the schema object an operation concerns — the key the Schema view
 * uses to mark a row `changed` and hang its `△N`.
 */
export function changedObjectId(op: Operation): string {
  switch (op.type) {
    case "createTable":
    case "dropTable":
      return op.table.id;
    case "renameTable":
      return op.tableId;
    case "addColumn":
    case "dropColumn":
      return op.column.id;
    case "renameColumn":
    case "retypeColumn":
    case "setNullable":
    case "setDefault":
      return op.columnId;
    case "addPrimaryKey":
    case "dropPrimaryKey":
      return op.primaryKey.id;
    case "changePrimaryKey":
      return op.primaryKeyId;
    case "addIndex":
    case "dropIndex":
      return op.index.id;
    case "changeIndex":
      return op.indexId;
    case "addUnique":
    case "dropUnique":
      return op.unique.id;
    case "changeUnique":
      return op.uniqueId;
    case "addForeignKey":
    case "dropForeignKey":
      return op.fk.id;
    case "changeForeignKey":
      return op.fkId;
  }
}

/** A compact past-tense line for the operation list. */
export function summarizeOp(op: Operation, nameOf: NameOf): string {
  switch (op.type) {
    case "createTable":
      return `create table ${op.table.name}`;
    case "dropTable":
      return `drop table ${op.table.name}`;
    case "renameTable":
      return `rename table ${op.from} → ${op.to}`;
    case "addColumn":
      return `add ${nameOf(op.tableId)}.${op.column.name} ${sqlType(op.column.type)}`;
    case "dropColumn":
      return `drop ${nameOf(op.tableId)}.${op.column.name}`;
    case "renameColumn":
      return `rename ${nameOf(op.tableId)}.${op.from} → ${op.to}`;
    case "retypeColumn":
      return `retype ${nameOf(op.tableId)}.${nameOf(op.columnId)} ${sqlType(op.from)} → ${sqlType(op.to)}`;
    case "setNullable":
      return `${nameOf(op.tableId)}.${nameOf(op.columnId)} → ${op.to ? "null" : "not null"}`;
    case "setDefault":
      return `${nameOf(op.tableId)}.${nameOf(op.columnId)} default → ${op.to ?? "none"}`;
    case "addPrimaryKey":
      return `add primary key on ${nameOf(op.tableId)}`;
    case "dropPrimaryKey":
      return `drop primary key on ${nameOf(op.tableId)}`;
    case "changePrimaryKey":
      return `change primary key on ${nameOf(op.tableId)}`;
    case "addIndex":
      return `add index ${op.index.name}`;
    case "dropIndex":
      return `drop index ${op.index.name}`;
    case "changeIndex":
      return `change index ${nameOf(op.indexId)}`;
    case "addUnique":
      return `add unique ${op.unique.name}`;
    case "dropUnique":
      return `drop unique ${op.unique.name}`;
    case "changeUnique":
      return `change unique ${nameOf(op.uniqueId)}`;
    case "addForeignKey":
      return `add foreign key ${op.fk.name}`;
    case "dropForeignKey":
      return `drop foreign key ${op.fk.name}`;
    case "changeForeignKey":
      return `change foreign key ${nameOf(op.fkId)}`;
  }
}

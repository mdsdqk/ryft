/**
 * Schema document — the canonical in-memory representation of ONE schema state.
 *
 * This module is the vocabulary the merge engine speaks. It is pure type
 * definitions: zero imports, zero runtime code, zero framework awareness. The
 * three-way diff, the semantic merge, and the DDL renderer all build on these
 * types and nothing else.
 *
 * Invariants that live in prose because the type system cannot express them
 * (validation enforces them):
 *
 *  - Every object (table, column, primary key, unique, index, foreign key)
 *    carries a stable synthetic `id`, assigned at creation and preserved across
 *    rename and across merge. Identity lives in the id, never the name.
 *  - Foreign keys and indexes reference columns and tables BY ID. Names are
 *    resolved only when DDL is rendered.
 *  - `id` format is a Postgres-style prefixed string: `tbl_`, `col_`, `pk_`,
 *    `fk_`, `uq_`, `idx_` + `<table>_<name>` context + a random suffix. The
 *    human-readable part is frozen at creation and may go stale after a rename;
 *    the id string itself is immutable.
 *  - Primary-key columns must have `nullable: false`.
 *  - Column order within a table is insertion order and is NOT semantically
 *    significant (Postgres appends; there is no reorder).
 *  - Column order within a `PrimaryKey` or `Index` IS significant: (a, b) != (b, a).
 *  - Column order within a `Unique` is stored but not semantically significant.
 *
 * Snapshots (see `BaseSnapshot`) are `SchemaDocument`s that are treated as
 * frozen by convention and produced via `structuredClone`. The types are left
 * mutable because the structured editor mutates a branch's head document in
 * place (e.g. renaming a column sets `name` while keeping `id`).
 */

/** The fixed set of column type kinds. No widening/safety lattice — see CONTEXT.md. */
export type ColumnTypeKind = ColumnType["kind"];

/**
 * A column's type. Equivalence is structural deep-equality including parameters:
 * `varchar(255)` != `varchar(256)`, `numeric(10, 2)` != `numeric(10, 3)`.
 */
export type ColumnType =
  | { kind: "int" }
  | { kind: "bigint" }
  | { kind: "text" }
  | { kind: "boolean" }
  | { kind: "timestamptz" }
  | { kind: "uuid" }
  | { kind: "jsonb" }
  | { kind: "varchar"; n: number }
  | { kind: "numeric"; precision: number; scale: number };

/** Referential action taken on the referencing rows when a referenced row is deleted. */
export type OnDeleteAction =
  | "cascade"
  | "restrict"
  | "set null"
  | "set default"
  | "no action";

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  nullable: boolean;
  /**
   * The raw SQL default literal exactly as authored (`"0"`, `"false"`, `"now()"`,
   * `"'pending'"`). `null` means no default clause. Equality is string equality;
   * normalization is deferred to the DDL renderer (ticket 0008).
   */
  default: string | null;
}

export interface PrimaryKey {
  id: string;
  /** Member columns by id, ordered. Order is significant. */
  columnIds: string[];
}

export interface Unique {
  id: string;
  /** Member columns by id. Stored ordered; order is not semantically significant. */
  columnIds: string[];
}

export interface Index {
  id: string;
  /** Indexed columns by id, ordered. Order is significant. */
  columnIds: string[];
  unique: boolean;
}

export interface ForeignKey {
  id: string;
  /** Local (referencing) columns by id, ordered. */
  columnIds: string[];
  /** Referenced table by id. */
  refTableId: string;
  /**
   * Referenced columns by id, ordered. Same length as `columnIds`;
   * `columnIds[i]` references `refColumnIds[i]`.
   */
  refColumnIds: string[];
  onDelete: OnDeleteAction;
}

export interface Table {
  id: string;
  name: string;
  columns: Column[];
  primaryKey: PrimaryKey | null;
  foreignKeys: ForeignKey[];
  uniques: Unique[];
  indexes: Index[];
}

export interface SchemaDocument {
  /** Display label only. Never used for identity or lookup. */
  database: string;
  tables: Table[];
}

/**
 * A schema document captured and frozen at a moment (branch creation, merge-request
 * creation). Structurally identical to `SchemaDocument`; the alias names the intent
 * at call sites. Produced by `structuredClone`, which is id-preserving by construction.
 */
export type BaseSnapshot = SchemaDocument;

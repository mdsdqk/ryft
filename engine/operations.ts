/**
 * Operation — the vocabulary of a single schema edit.
 *
 * ONE type, owned by the engine, imported by two callers:
 *
 *  - the semantic merge engine, which derives an ordered `Operation[]` (a
 *    "delta") from a structural diff of two snapshots — `diffSnapshots(base,
 *    head)` — and replays non-conflicting ops onto `theirs`;
 *  - `src/domain/operations.ts`, which wraps each `Operation` in a `LogEntry`
 *    (`seq`, `at`, `authorId`) to form a branch's operation log.
 *
 * There is deliberately no second copy. Two parallel vocabularies for "a schema
 * edit" — one for the editor, one for the merge — would drift into divergent
 * logic. This module has zero imports beyond `engine/schema.ts` and zero runtime
 * code, so `src/domain` importing it does not pull anything framework-shaped into
 * the engine.
 *
 * ADR 0001 §2 ("the operation log is never merge input") is unaffected: it means
 * the merge never reads a branch's *recorded* `LogEntry[]`. The merge reads a
 * *derived* `Operation[]` computed from snapshot state. Same vocabulary,
 * different stream.
 *
 * ── Payload conventions ────────────────────────────────────────────────────
 *
 *  - Objects are referenced BY ID (`tableId`, `columnId`, `indexId`, ...), never
 *    by name. A child op also carries its parent `tableId` as an anchor so the
 *    op is self-describing and O(1) to locate.
 *  - Mutation ops carry the prior value (`from`) and drop ops carry the WHOLE
 *    removed object. The op log needs this for replay-free undo and history
 *    rendering. `diffSnapshots` populates it from `base` at no extra cost, so a
 *    derived delta is equally undo-capable.
 *  - Index / unique / foreign-key redefinition is a single id-preserving
 *    `change*` op carrying the full old and new definition (minus the id) —
 *    "replace all". `(a, b)` -> `(b, a)` and a `unique` flip are one atomic
 *    change to "the definition", not independent axes. This is also the only way
 *    "divergent index definition" is detectable: an `Index` has no `name`, so
 *    the conflict can only be seen as *same id, different definition*, which
 *    requires the editor to keep the id stable across a redefine.
 *  - Column attributes (`name`, `type`, `nullable`, `default`) ARE independent
 *    axes and get one op each (`renameColumn`, `retypeColumn`, `setNullable`,
 *    `setDefault`). Two sides touching different attributes of one column merge
 *    cleanly.
 *  - `createTable` carries the full `Table` (columns, PK, FKs, indexes nested).
 *    A new table on one side is one op, not a `createTable` + N `addColumn`
 *    stream.
 *
 * ── Preconditions (checked by the structured editor before it appends a log
 *    entry; the merge's replay assumes a well-formed delta and re-validates via
 *    the commutativity post-condition) ───────────────────────────────────────
 *
 *  - createTable      — `table.id` fresh; `table.name` unique in the database;
 *                       nested object ids fresh; internal references resolve.
 *  - dropTable        — table exists; no foreign key from another table
 *                       references it. Payload carries the full `Table`.
 *  - renameTable      — table exists; `to` unique in the database.
 *  - addColumn        — table exists; `column.id` fresh; `column.name` unique in
 *                       the table.
 *  - dropColumn       — column exists; not referenced by this table's primary
 *                       key, any index, any unique, or any foreign key on this
 *                       branch. Payload carries the full `Column`.
 *  - renameColumn     — column exists; `to` unique in the table.
 *  - retypeColumn     — column exists.
 *  - setNullable      — column exists; when setting `true`, the column is not
 *                       part of the primary key.
 *  - setDefault       — column exists.
 *  - addPrimaryKey    — table has no primary key; `primaryKey.id` fresh; every
 *                       member column resolves in this table and is `nullable:
 *                       false`.
 *  - dropPrimaryKey   — table has a primary key. Payload carries the full
 *                       `PrimaryKey`.
 *  - changePrimaryKey — table has a primary key with this id; every `to` member
 *                       column resolves in this table and is `nullable: false`.
 *  - addIndex         — table exists; `index.id` fresh; every member column
 *                       resolves in this table.
 *  - dropIndex        — index exists. Payload carries the full `Index`.
 *  - changeIndex      — index with this id exists on this table; every `to`
 *                       member column resolves in this table.
 *  - addUnique        — table exists; `unique.id` fresh; members resolve.
 *  - dropUnique       — unique exists. Payload carries the full `Unique`.
 *  - changeUnique     — unique with this id exists; `to` members resolve.
 *  - addForeignKey    — table exists; `fk.id` fresh; local columns resolve;
 *                       `refTableId` resolves; `refColumnIds` resolve in the
 *                       referenced table and are exactly its primary key or a
 *                       unique constraint's columns.
 *  - dropForeignKey   — foreign key exists. Payload carries the full `ForeignKey`.
 *  - changeForeignKey — foreign key with this id exists on this table; `to`
 *                       endpoints resolve under the same rules as addForeignKey.
 *
 * The `merge` audit marker is NOT here — it carries no schema delta and is a
 * domain/audit concept. `src/domain/operations.ts` adds it as `LogOp`.
 */

import type {
  Column,
  ColumnType,
  ForeignKey,
  Index,
  PrimaryKey,
  Table,
  Unique,
} from "./schema.js";

/** The new definition of an index, minus its (stable) id. Carried by `changeIndex`. */
export type IndexDef = Omit<Index, "id">;
/** The new definition of a unique constraint, minus its id. Carried by `changeUnique`. */
export type UniqueDef = Omit<Unique, "id">;
/** The new definition of a foreign key, minus its id. Carried by `changeForeignKey`. */
export type ForeignKeyDef = Omit<ForeignKey, "id">;

export type Operation =
  // ── tables ──────────────────────────────────────────────────────────────
  | { type: "createTable"; table: Table }
  | { type: "dropTable"; table: Table }
  | { type: "renameTable"; tableId: string; from: string; to: string }
  // ── columns (attribute-granular) ────────────────────────────────────────
  | { type: "addColumn"; tableId: string; column: Column }
  | { type: "dropColumn"; tableId: string; column: Column }
  | { type: "renameColumn"; tableId: string; columnId: string; from: string; to: string }
  | { type: "retypeColumn"; tableId: string; columnId: string; from: ColumnType; to: ColumnType }
  | { type: "setNullable"; tableId: string; columnId: string; from: boolean; to: boolean }
  | { type: "setDefault"; tableId: string; columnId: string; from: string | null; to: string | null }
  // ── primary key (0..1 per table, id-preserving change) ──────────────────
  | { type: "addPrimaryKey"; tableId: string; primaryKey: PrimaryKey }
  | { type: "dropPrimaryKey"; tableId: string; primaryKey: PrimaryKey }
  | { type: "changePrimaryKey"; tableId: string; primaryKeyId: string; from: string[]; to: string[] }
  // ── indexes / uniques / foreign keys (add + drop + replace-all change) ──
  | { type: "addIndex"; tableId: string; index: Index }
  | { type: "dropIndex"; tableId: string; index: Index }
  | { type: "changeIndex"; tableId: string; indexId: string; from: IndexDef; to: IndexDef }
  | { type: "addUnique"; tableId: string; unique: Unique }
  | { type: "dropUnique"; tableId: string; unique: Unique }
  | { type: "changeUnique"; tableId: string; uniqueId: string; from: UniqueDef; to: UniqueDef }
  | { type: "addForeignKey"; tableId: string; fk: ForeignKey }
  | { type: "dropForeignKey"; tableId: string; fk: ForeignKey }
  | { type: "changeForeignKey"; tableId: string; fkId: string; from: ForeignKeyDef; to: ForeignKeyDef };

/** Discriminator union tag for `Operation`. */
export type OperationType = Operation["type"];

/**
 * An ordered, derived stream of edits that transforms one snapshot into another.
 * Produced by `diffSnapshots(base, head)`; consumed by `applyDelta(delta, doc)`.
 * A readability alias — it is exactly `Operation[]`.
 */
export type Delta = Operation[];

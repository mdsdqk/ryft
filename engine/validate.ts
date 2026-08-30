/**
 * validateOperation — the precondition check for a single schema edit.
 *
 * Ticket 0008 (ADR 0008 §1–§4, `docs/robustness.md` §1–§4). Pure, zero imports
 * beyond the engine's own type modules, no I/O. It is the single owner of "is
 * this edit legal", shared by two callers so they can never disagree:
 *
 *  - `applyOperation` (engine/apply-operation.ts) calls it and refuses the op if
 *    any `OpError` comes back;
 *  - the structured editor (WU-E) imports it for inline feedback as the user
 *    types.
 *
 * ── What it returns ────────────────────────────────────────────────────────
 *
 * One flat list of `OpDiagnostic` = `OpError | OpWarning`, errors and warnings
 * together (ADR 0008 §1). The caller separates them with `isOpError`; the two
 * `reason` unions are disjoint, so the discriminator is just the reason string.
 * An empty list means the op is legal with nothing to flag.
 *
 *  - `OpError`   — block. The resulting document would not be a valid Postgres
 *                  schema, or the op has no target. Nothing is written.
 *  - `OpWarning` — the op applies; a risky-but-legal edit is surfaced (a drop, a
 *                  lossy retype, NOT NULL with no default). Never blocks.
 *
 * ── Scope ─────────────────────────────────────────────────────────────────
 *
 * Every rule here is a property of the current `SchemaDocument` plus the one
 * proposed `Operation`. It cannot see the operation log or the database, which
 * is correct — `docs/robustness.md` §2 is exactly that table. Whole-document
 * structural validity (`validateDocument`) is ADR 0008 §5 and is V1; it is not
 * in this module.
 *
 * Batch semantics (ADR 0008 §5): a caller applying `ops[]` validates op *n*
 * against the document with ops *1 … n−1* already applied, stops at the first
 * `OpError`, and accumulates every `OpWarning`. That loop lives in the caller
 * (`applyOperation` / the API route), not here.
 */

import { sameColumnType } from "./diff.js";
import type {
  Column,
  ColumnType,
  ColumnTypeKind,
  SchemaDocument,
  Table,
} from "./schema.js";
import type { Operation } from "./operations.js";

// ── typed diagnostics (`docs/robustness.md` §1) ────────────────────────────

export type OpErrorReason =
  | "target-not-found" // the object an edit names does not resolve
  | "name-taken" // a new name collides in its namespace
  | "invalid-identifier" // fails ^[a-z_][a-z0-9_]*$ or > 63 bytes
  | "invalid-type" // not one of the 9 ColumnType kinds, or bad params
  | "unresolved-reference" // an index / PK / unique member or FK endpoint id is absent
  | "fk-shape" // FK arity mismatch, per-column type mismatch, or target not PK/unique
  | "primary-key-exists" // addPrimaryKey on a table that already has one
  | "nullable-primary-key-member" // a nullable column placed in a primary key
  | "drop-blocked" // a drop with a live dependent (ADR 0001 §3, ADR 0004 §8)
  | "unsafe-default"; // a default outside the §4 allowlist

export type OpWarningReason =
  | "drop-destructive" // dropColumn / dropTable
  | "narrowing-retype" // a retype that looks lossy (heuristic, not a safety lattice)
  | "not-null-no-default" // addColumn / setNullable(false) with no default
  | "fk-action-loosened"; // changeForeignKey relaxing onDelete toward cascade

/** A dependent that blocks a drop. Mirrors ADR 0004 §8's 422 body. */
export interface Dependent {
  kind: "index" | "unique" | "primaryKey" | "foreignKey";
  id: string;
  name: string;
  /** owning table id */
  table: string;
}

export interface OpError {
  reason: OpErrorReason;
  /** Human-readable, names the offending object. */
  message: string;
  /** Present only for `drop-blocked`. */
  dependents?: Dependent[];
}

export interface OpWarning {
  reason: OpWarningReason;
  message: string;
  /** The schema object the warning is about. */
  objectId: string;
}

export type OpDiagnostic = OpError | OpWarning;

const ERROR_REASONS: ReadonlySet<string> = new Set<OpErrorReason>([
  "target-not-found",
  "name-taken",
  "invalid-identifier",
  "invalid-type",
  "unresolved-reference",
  "fk-shape",
  "primary-key-exists",
  "nullable-primary-key-member",
  "drop-blocked",
  "unsafe-default",
]);

/** Discriminator for `OpDiagnostic`. The two reason unions are disjoint. */
export function isOpError(d: OpDiagnostic): d is OpError {
  return ERROR_REASONS.has(d.reason);
}

// ── identifiers (`docs/robustness.md` §3 rule 2) ───────────────────────────

const IDENT = /^[a-z_][a-z0-9_]*$/;
const utf8 = new TextEncoder();

/** `null` if the identifier is legal, else the reason it is not. */
function identProblem(name: string): string | null {
  if (!IDENT.test(name)) {
    return `must match ^[a-z_][a-z0-9_]*$ (lowercase letters, digits, underscore; not starting with a digit)`;
  }
  if (utf8.encode(name).length > 63) {
    return `is longer than 63 bytes (Postgres truncates longer identifiers, which can collide)`;
  }
  return null;
}

// ── column types (`docs/robustness.md` §2, "type valid") ───────────────────

const TYPE_KINDS: ReadonlySet<string> = new Set<ColumnTypeKind>([
  "int",
  "bigint",
  "text",
  "boolean",
  "timestamptz",
  "uuid",
  "jsonb",
  "varchar",
  "numeric",
]);

/** `null` if the type is one of the nine kinds with valid params, else why not. */
function typeProblem(t: ColumnType): string | null {
  if (!t || typeof t !== "object" || !TYPE_KINDS.has((t as ColumnType).kind)) {
    return `is not one of int, bigint, text, boolean, timestamptz, uuid, jsonb, varchar(n), numeric(p,s)`;
  }
  if (t.kind === "varchar" && !(Number.isInteger(t.n) && t.n >= 1)) {
    return `varchar length must be an integer >= 1`;
  }
  if (
    t.kind === "numeric" &&
    !(Number.isInteger(t.precision) && Number.isInteger(t.scale) && t.precision >= t.scale && t.scale >= 0)
  ) {
    return `numeric requires precision >= scale >= 0`;
  }
  return null;
}

// ── column defaults (`docs/robustness.md` §4 allowlist) ────────────────────

const DEFAULT_FUNCTIONS: ReadonlySet<string> = new Set([
  "now()",
  "current_timestamp",
  "gen_random_uuid()",
]);
const INT_OR_DECIMAL = /^-?\d+(\.\d+)?$/;
const STRING_LITERAL = /^'([^']|'')*'$/;

/** `true` if a non-null default literal is a renderable form. `null` default is handled by the caller. */
function isRenderableDefault(raw: string): boolean {
  const s = raw.trim();
  if (INT_OR_DECIMAL.test(s)) return true;
  const lower = s.toLowerCase();
  if (lower === "true" || lower === "false" || lower === "null") return true;
  if (STRING_LITERAL.test(s)) return true;
  return DEFAULT_FUNCTIONS.has(lower);
}

const DEFAULT_FORMS =
  "an integer/decimal literal, true/false, null, a single-quoted string, or now() / current_timestamp / gen_random_uuid()";

// ── document lookups ──────────────────────────────────────────────────────

const table = (doc: SchemaDocument, id: string): Table | undefined =>
  doc.tables.find((t) => t.id === id);

const column = (t: Table, id: string): Column | undefined =>
  t.columns.find((c) => c.id === id);

/** Every column id referenced by a constraint or index on `t`, that resolves. */
function membersResolve(t: Table, columnIds: readonly string[]): boolean {
  const ids = new Set(t.columns.map((c) => c.id));
  return columnIds.every((id) => ids.has(id));
}

/** Is `columnIds` (as a set) covered by `t`'s primary key or one of its uniques, other than `exceptId`? */
function coveredByKeyOrUnique(t: Table, columnIds: readonly string[], exceptId: string): boolean {
  const want = [...columnIds].sort().join(",");
  if (t.primaryKey && t.primaryKey.id !== exceptId && [...t.primaryKey.columnIds].sort().join(",") === want) {
    return true;
  }
  return t.uniques.some((u) => u.id !== exceptId && [...u.columnIds].sort().join(",") === want);
}

/**
 * Foreign keys anywhere in `doc` that point at `tableId` and whose referenced
 * columns are exactly `columnIds` (order-insensitive) — the FKs that a
 * `dropPrimaryKey` / `dropUnique` / `changeUnique` / `changePrimaryKey` on that
 * column set would strand.
 */
function fkDependentsOnColumnSet(doc: SchemaDocument, tableId: string, columnIds: readonly string[]): Dependent[] {
  const want = [...columnIds].sort().join(",");
  const out: Dependent[] = [];
  for (const t of doc.tables) {
    for (const fk of t.foreignKeys) {
      if (fk.refTableId === tableId && [...fk.refColumnIds].sort().join(",") === want) {
        out.push({ kind: "foreignKey", id: fk.id, name: fk.name, table: t.id });
      }
    }
  }
  return out;
}

// ── the rule table (`docs/robustness.md` §2) ──────────────────────────────

/**
 * Every `OpError` and `OpWarning` for one operation against `doc`. Order within
 * the list is check order; the first `OpError` is the one a caller reports.
 */
export function validateOperation(doc: SchemaDocument, op: Operation): OpDiagnostic[] {
  const out: OpDiagnostic[] = [];
  const err = (reason: OpErrorReason, message: string, dependents?: Dependent[]) =>
    out.push(dependents ? { reason, message, dependents } : { reason, message });
  const warn = (reason: OpWarningReason, message: string, objectId: string) =>
    out.push({ reason, message, objectId });

  /** A new/changed identifier check that short-circuits nothing — collects the error. */
  const checkIdent = (name: string, what: string) => {
    const p = identProblem(name);
    if (p) err("invalid-identifier", `${what} "${name}" ${p}`);
  };
  const checkType = (t: ColumnType, what: string) => {
    const p = typeProblem(t);
    if (p) err("invalid-type", `${what} ${p}`);
  };
  const checkDefault = (d: string | null, what: string) => {
    if (d !== null && !isRenderableDefault(d)) {
      err("unsafe-default", `${what} default \`${d}\` is not renderable — allowed: ${DEFAULT_FORMS}`);
    }
  };

  switch (op.type) {
    // ── tables ────────────────────────────────────────────────────────────
    case "createTable": {
      const t = op.table;
      checkIdent(t.name, "table name");
      if (doc.tables.some((x) => x.name === t.name)) err("name-taken", `a table named "${t.name}" already exists`);
      if (doc.tables.some((x) => x.id === t.id)) err("name-taken", `table id ${t.id} is already in use`);
      const seenCol = new Set<string>();
      for (const c of t.columns) {
        checkIdent(c.name, "column name");
        if (seenCol.has(c.name)) err("name-taken", `column "${c.name}" is defined twice on "${t.name}"`);
        seenCol.add(c.name);
        checkType(c.type, `column "${c.name}" type`);
        checkDefault(c.default, `column "${c.name}"`);
      }
      if (t.primaryKey) {
        if (!membersResolve(t, t.primaryKey.columnIds)) {
          err("unresolved-reference", `primary key "${t.primaryKey.name}" names a column not on "${t.name}"`);
        } else {
          for (const cid of t.primaryKey.columnIds) {
            const c = column(t, cid)!;
            if (c.nullable) err("nullable-primary-key-member", `primary-key column "${c.name}" must be NOT NULL`);
          }
        }
      }
      return out;
    }

    case "dropTable": {
      const t = table(doc, op.table.id);
      if (!t) return [{ reason: "target-not-found", message: `no table ${op.table.id}` }];
      const dependents: Dependent[] = [];
      for (const other of doc.tables) {
        if (other.id === t.id) continue;
        for (const fk of other.foreignKeys) {
          if (fk.refTableId === t.id) {
            dependents.push({ kind: "foreignKey", id: fk.id, name: fk.name, table: other.id });
          }
        }
      }
      if (dependents.length) err("drop-blocked", `"${t.name}" is referenced by a foreign key`, dependents);
      warn("drop-destructive", `dropping table "${t.name}" is irreversible`, t.id);
      return out;
    }

    case "renameTable": {
      const t = table(doc, op.tableId);
      if (!t) return [{ reason: "target-not-found", message: `no table ${op.tableId}` }];
      checkIdent(op.to, "table name");
      if (doc.tables.some((x) => x.id !== t.id && x.name === op.to)) {
        err("name-taken", `a table named "${op.to}" already exists`);
      }
      return out;
    }

    // ── columns ───────────────────────────────────────────────────────────
    case "addColumn": {
      const t = table(doc, op.tableId);
      if (!t) return [{ reason: "target-not-found", message: `no table ${op.tableId}` }];
      checkIdent(op.column.name, "column name");
      if (t.columns.some((c) => c.name === op.column.name)) {
        err("name-taken", `"${t.name}" already has a column named "${op.column.name}"`);
      }
      if (t.columns.some((c) => c.id === op.column.id)) {
        err("name-taken", `column id ${op.column.id} is already in use on "${t.name}"`);
      }
      checkType(op.column.type, `column "${op.column.name}" type`);
      checkDefault(op.column.default, `column "${op.column.name}"`);
      if (!op.column.nullable && op.column.default === null) {
        warn("not-null-no-default", `"${op.column.name}" is NOT NULL with no default`, op.column.id);
      }
      return out;
    }

    case "dropColumn": {
      const t = table(doc, op.tableId);
      const c = t && column(t, op.column.id);
      if (!t || !c) return [{ reason: "target-not-found", message: `no column ${op.column.id}` }];
      const dependents: Dependent[] = [];
      if (t.primaryKey?.columnIds.includes(c.id)) {
        dependents.push({ kind: "primaryKey", id: t.primaryKey.id, name: t.primaryKey.name, table: t.id });
      }
      for (const idx of t.indexes) {
        if (idx.columnIds.includes(c.id)) dependents.push({ kind: "index", id: idx.id, name: idx.name, table: t.id });
      }
      for (const uq of t.uniques) {
        if (uq.columnIds.includes(c.id)) dependents.push({ kind: "unique", id: uq.id, name: uq.name, table: t.id });
      }
      for (const owner of doc.tables) {
        for (const fk of owner.foreignKeys) {
          const local = owner.id === t.id && fk.columnIds.includes(c.id);
          const remote = fk.refTableId === t.id && fk.refColumnIds.includes(c.id);
          if (local || remote) dependents.push({ kind: "foreignKey", id: fk.id, name: fk.name, table: owner.id });
        }
      }
      if (dependents.length) err("drop-blocked", `"${c.name}" is referenced by ${dependents.length} object(s)`, dependents);
      warn("drop-destructive", `dropping column "${c.name}" is irreversible`, c.id);
      return out;
    }

    case "renameColumn": {
      const t = table(doc, op.tableId);
      const c = t && column(t, op.columnId);
      if (!t || !c) return [{ reason: "target-not-found", message: `no column ${op.columnId}` }];
      checkIdent(op.to, "column name");
      if (t.columns.some((x) => x.id !== c.id && x.name === op.to)) {
        err("name-taken", `"${t.name}" already has a column named "${op.to}"`);
      }
      return out;
    }

    case "retypeColumn": {
      const t = table(doc, op.tableId);
      const c = t && column(t, op.columnId);
      if (!t || !c) return [{ reason: "target-not-found", message: `no column ${op.columnId}` }];
      checkType(op.to, `target type`);
      if (typeProblem(op.to) === null && looksLossy(c.type, op.to)) {
        warn("narrowing-retype", `retyping "${c.name}" ${describe(c.type)} → ${describe(op.to)} may lose data`, c.id);
      }
      return out;
    }

    case "setNullable": {
      const t = table(doc, op.tableId);
      const c = t && column(t, op.columnId);
      if (!t || !c) return [{ reason: "target-not-found", message: `no column ${op.columnId}` }];
      if (op.to === true && t.primaryKey?.columnIds.includes(c.id)) {
        err("nullable-primary-key-member", `"${c.name}" is in primary key "${t.primaryKey.name}" and cannot be nullable`);
      }
      if (op.to === false && c.default === null) {
        warn("not-null-no-default", `"${c.name}" set NOT NULL with no default`, c.id);
      }
      return out;
    }

    case "setDefault": {
      const t = table(doc, op.tableId);
      const c = t && column(t, op.columnId);
      if (!t || !c) return [{ reason: "target-not-found", message: `no column ${op.columnId}` }];
      checkDefault(op.to, `column "${c.name}"`);
      return out;
    }

    // ── primary keys ──────────────────────────────────────────────────────
    case "addPrimaryKey": {
      const t = table(doc, op.tableId);
      if (!t) return [{ reason: "target-not-found", message: `no table ${op.tableId}` }];
      if (t.primaryKey) err("primary-key-exists", `"${t.name}" already has primary key "${t.primaryKey.name}"`);
      checkIdent(op.primaryKey.name, "constraint name");
      if (nameTakenOnTable(t, op.primaryKey.name, op.primaryKey.id)) {
        err("name-taken", `"${t.name}" already has a constraint named "${op.primaryKey.name}"`);
      }
      if (!membersResolve(t, op.primaryKey.columnIds)) {
        err("unresolved-reference", `primary key names a column not on "${t.name}"`);
      } else {
        for (const cid of op.primaryKey.columnIds) {
          const c = column(t, cid)!;
          if (c.nullable) err("nullable-primary-key-member", `primary-key column "${c.name}" must be NOT NULL`);
        }
      }
      return out;
    }

    case "dropPrimaryKey": {
      const t = table(doc, op.tableId);
      if (!t || !t.primaryKey || t.primaryKey.id !== op.primaryKey.id) {
        return [{ reason: "target-not-found", message: `no primary key ${op.primaryKey.id} on ${op.tableId}` }];
      }
      const stranded = fkDependentsOnColumnSet(doc, t.id, t.primaryKey.columnIds).filter(
        () => !coveredByKeyOrUnique(t, t.primaryKey!.columnIds, t.primaryKey!.id),
      );
      if (stranded.length) err("drop-blocked", `primary key "${t.primaryKey.name}" backs a foreign key`, stranded);
      return out;
    }

    case "changePrimaryKey": {
      const t = table(doc, op.tableId);
      if (!t || !t.primaryKey || t.primaryKey.id !== op.primaryKeyId) {
        return [{ reason: "target-not-found", message: `no primary key ${op.primaryKeyId} on ${op.tableId}` }];
      }
      if (!membersResolve(t, op.to)) {
        err("unresolved-reference", `new primary key names a column not on "${t.name}"`);
      } else {
        for (const cid of op.to) {
          const c = column(t, cid)!;
          if (c.nullable) err("nullable-primary-key-member", `primary-key column "${c.name}" must be NOT NULL`);
        }
      }
      const removed = t.primaryKey.columnIds.filter((id) => !op.to.includes(id));
      if (removed.length) {
        const stranded = fkDependentsOnColumnSet(doc, t.id, t.primaryKey.columnIds).filter(
          () => !coveredByKeyOrUnique(t, t.primaryKey!.columnIds, t.primaryKey!.id),
        );
        if (stranded.length) err("drop-blocked", `the current primary key backs a foreign key`, stranded);
      }
      return out;
    }

    // ── indexes & uniques ─────────────────────────────────────────────────
    case "addIndex":
    case "addUnique": {
      const t = table(doc, op.tableId);
      if (!t) return [{ reason: "target-not-found", message: `no table ${op.tableId}` }];
      const obj = op.type === "addIndex" ? op.index : op.unique;
      checkIdent(obj.name, op.type === "addIndex" ? "index name" : "constraint name");
      if (op.type === "addIndex" && indexNameTaken(doc, obj.name, obj.id)) {
        err("name-taken", `an index named "${obj.name}" already exists`);
      }
      if (op.type === "addUnique" && nameTakenOnTable(t, obj.name, obj.id)) {
        err("name-taken", `"${t.name}" already has a constraint named "${obj.name}"`);
      }
      if (!membersResolve(t, obj.columnIds)) {
        err("unresolved-reference", `${op.type === "addIndex" ? "index" : "unique"} names a column not on "${t.name}"`);
      }
      return out;
    }

    case "dropIndex": {
      const t = table(doc, op.tableId);
      if (!t || !t.indexes.some((i) => i.id === op.index.id)) {
        return [{ reason: "target-not-found", message: `no index ${op.index.id} on ${op.tableId}` }];
      }
      return out;
    }

    case "dropUnique": {
      const t = table(doc, op.tableId);
      const uq = t?.uniques.find((u) => u.id === op.unique.id);
      if (!t || !uq) return [{ reason: "target-not-found", message: `no unique ${op.unique.id} on ${op.tableId}` }];
      const stranded = fkDependentsOnColumnSet(doc, t.id, uq.columnIds).filter(
        () => !coveredByKeyOrUnique(t, uq.columnIds, uq.id),
      );
      if (stranded.length) err("drop-blocked", `unique "${uq.name}" backs a foreign key`, stranded);
      return out;
    }

    case "changeIndex": {
      const t = table(doc, op.tableId);
      if (!t || !t.indexes.some((i) => i.id === op.indexId)) {
        return [{ reason: "target-not-found", message: `no index ${op.indexId} on ${op.tableId}` }];
      }
      if (!membersResolve(t, op.to.columnIds)) {
        err("unresolved-reference", `the new index definition names a column not on "${t.name}"`);
      }
      return out;
    }

    case "changeUnique": {
      const t = table(doc, op.tableId);
      const uq = t?.uniques.find((u) => u.id === op.uniqueId);
      if (!t || !uq) return [{ reason: "target-not-found", message: `no unique ${op.uniqueId} on ${op.tableId}` }];
      if (!membersResolve(t, op.to.columnIds)) {
        err("unresolved-reference", `the new unique definition names a column not on "${t.name}"`);
      }
      const removed = uq.columnIds.filter((id) => !op.to.columnIds.includes(id));
      if (removed.length) {
        const stranded = fkDependentsOnColumnSet(doc, t.id, uq.columnIds).filter(
          () => !coveredByKeyOrUnique(t, uq.columnIds, uq.id),
        );
        if (stranded.length) err("drop-blocked", `unique "${uq.name}" backs a foreign key`, stranded);
      }
      return out;
    }

    // ── foreign keys ──────────────────────────────────────────────────────
    case "addForeignKey": {
      const t = table(doc, op.tableId);
      if (!t) return [{ reason: "target-not-found", message: `no table ${op.tableId}` }];
      checkIdent(op.fk.name, "constraint name");
      if (nameTakenOnTable(t, op.fk.name, op.fk.id)) {
        err("name-taken", `"${t.name}" already has a constraint named "${op.fk.name}"`);
      }
      fkShapeErrors(doc, t, op.fk.columnIds, op.fk.refTableId, op.fk.refColumnIds, err);
      return out;
    }

    case "dropForeignKey": {
      const t = table(doc, op.tableId);
      if (!t || !t.foreignKeys.some((f) => f.id === op.fk.id)) {
        return [{ reason: "target-not-found", message: `no foreign key ${op.fk.id} on ${op.tableId}` }];
      }
      return out;
    }

    case "changeForeignKey": {
      const t = table(doc, op.tableId);
      const fk = t?.foreignKeys.find((f) => f.id === op.fkId);
      if (!t || !fk) return [{ reason: "target-not-found", message: `no foreign key ${op.fkId} on ${op.tableId}` }];
      fkShapeErrors(doc, t, op.to.columnIds, op.to.refTableId, op.to.refColumnIds, err);
      const strict = new Set(["restrict", "no action"]);
      if (strict.has(fk.onDelete) && !strict.has(op.to.onDelete)) {
        warn("fk-action-loosened", `"${fk.name}" ON DELETE ${fk.onDelete} → ${op.to.onDelete}`, fk.id);
      }
      return out;
    }
  }
}

// ── helpers used by more than one case ─────────────────────────────────────

function nameTakenOnTable(t: Table, name: string, selfId: string): boolean {
  if (t.primaryKey && t.primaryKey.id !== selfId && t.primaryKey.name === name) return true;
  if (t.uniques.some((u) => u.id !== selfId && u.name === name)) return true;
  return t.foreignKeys.some((f) => f.id !== selfId && f.name === name);
}

function indexNameTaken(doc: SchemaDocument, name: string, selfId: string): boolean {
  return doc.tables.some((t) => t.indexes.some((i) => i.id !== selfId && i.name === name));
}

/** Push `fk-shape` / `unresolved-reference` errors for a proposed FK endpoint set. */
function fkShapeErrors(
  doc: SchemaDocument,
  local: Table,
  columnIds: readonly string[],
  refTableId: string,
  refColumnIds: readonly string[],
  err: (reason: OpErrorReason, message: string) => void,
): void {
  if (!membersResolve(local, columnIds)) {
    err("unresolved-reference", `foreign key names a local column not on "${local.name}"`);
    return;
  }
  const ref = table(doc, refTableId);
  if (!ref) {
    err("unresolved-reference", `foreign key references missing table ${refTableId}`);
    return;
  }
  if (!membersResolve(ref, refColumnIds)) {
    err("unresolved-reference", `foreign key references a column not on "${ref.name}"`);
    return;
  }
  if (columnIds.length !== refColumnIds.length) {
    err("fk-shape", `foreign key has ${columnIds.length} local column(s) but ${refColumnIds.length} referenced`);
    return;
  }
  for (let i = 0; i < columnIds.length; i++) {
    const lc = column(local, columnIds[i]!)!;
    const rc = column(ref, refColumnIds[i]!)!;
    if (!sameColumnType(lc.type, rc.type)) {
      err("fk-shape", `"${lc.name}" (${describe(lc.type)}) and "${rc.name}" (${describe(rc.type)}) types differ`);
      return;
    }
  }
  if (!coveredByKeyOrUnique(ref, refColumnIds, "")) {
    err("fk-shape", `referenced columns on "${ref.name}" are not a primary key or unique constraint`);
  }
}

// ── retype "looks lossy" heuristic (`docs/robustness.md` §2 note) ──────────
//
// A warning heuristic, not a safety lattice: warn on any cross-kind change, or a
// same-kind change that shrinks a parameter. Never warn on an equal or widening
// parameter change. The engine does not claim to know which cross-kind retypes
// are safe — it warns on all of them.

function looksLossy(from: ColumnType, to: ColumnType): boolean {
  if (from.kind !== to.kind) return true;
  if (from.kind === "varchar" && to.kind === "varchar") return to.n < from.n;
  if (from.kind === "numeric" && to.kind === "numeric") {
    return to.precision < from.precision || to.scale < from.scale;
  }
  return false;
}

function describe(t: ColumnType): string {
  if (t.kind === "varchar") return `varchar(${t.n})`;
  if (t.kind === "numeric") return `numeric(${t.precision},${t.scale})`;
  return t.kind;
}

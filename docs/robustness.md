# Robustness — validation rules, quoting, defaults, destructive warnings

Ticket 0008. The companion reference to `docs/adr/0008-robustness-validation-and-warnings.md`
(rationale, one section per call). `decisions.md` carries the narrative.

Owns: the per-operation validation rule table, the typed error / warning shapes, the
identifier-quoting rule, the default allowlist, and the destructive-warning list with where
each renders. Consumes ADR 0004 §8's atomicity contract rather than restating it.

No code ships with this ticket. `validateOperation`, `validateDocument`, `OpError`,
`OpWarning`, and `StructuralError` are new dependency-free surface in `engine/`, owned by the
build track.

---

## 1. Typed shapes

```ts
// engine/ — pure, no framework imports

type OpErrorReason =
  | "target-not-found"            // the object an edit names does not resolve
  | "name-taken"                  // a new name collides in its namespace
  | "invalid-identifier"          // fails ^[a-z_][a-z0-9_]*$ or > 63 bytes
  | "invalid-type"                // not one of the 9 ColumnType kinds, or bad params
  | "unresolved-reference"        // an index / PK / unique member or FK endpoint id is absent
  | "fk-shape"                    // FK arity mismatch, per-column type mismatch, or target not PK/unique
  | "primary-key-exists"          // addPrimaryKey on a table that already has one
  | "nullable-primary-key-member" // a nullable column placed in a primary key
  | "drop-blocked"                // a drop with a live dependent (ADR 0001 §3, ADR 0004 §8)
  | "unsafe-default";             // a default outside the §4 allowlist

interface OpError {
  reason: OpErrorReason;
  /** Human-readable, names the offending object. */
  message: string;
  /** Present only for `drop-blocked` — mirrors ADR 0004 §8's 422 body. */
  dependents?: Array<{
    kind: "index" | "unique" | "primaryKey" | "foreignKey";
    id: string;
    name: string;
    table: string;
  }>;
}

type OpWarningReason =
  | "drop-destructive"     // dropColumn / dropTable
  | "narrowing-retype"     // a retype that looks lossy (heuristic — see §3)
  | "not-null-no-default"  // addColumn / setNullable(false) with no default
  | "fk-action-loosened";  // changeForeignKey relaxing onDelete toward cascade

interface OpWarning {
  reason: OpWarningReason;
  message: string;
  /** The schema object the warning is about. */
  objectId: string;
}

function validateOperation(doc: SchemaDocument, op: Operation): OpError[];

// whole-document structural validity (ADR 0008 §5)

type StructuralErrorReason =
  | "duplicate-name"
  | "dangling-reference"
  | "nullable-primary-key-member"
  | "unsafe-default"
  | "orphaned-foreign-key"; // an FK whose target columns no longer carry a PK / unique

interface StructuralError {
  reason: StructuralErrorReason;
  message: string;
  objectId: string;
}

function validateDocument(doc: SchemaDocument): StructuralError[];
```

`validateOperation` returns every `OpError` and `OpWarning` it finds for one op (errors and
warnings are returned together; the caller separates them). `applyOperation` refuses the op
if there is any `OpError`; warnings never block.

---

## 2. Per-operation validation rule table

`B` = block (`OpError`), `W` = warn (`OpWarning`), `—` = allowed silently. Every row is
checked against the document as it stands when the op is applied (in a batch, that means
with the earlier ops already applied — §5).

### Tables

| Operation | Check | Outcome · reason |
|---|---|---|
| `createTable` | name matches `^[a-z_][a-z0-9_]*$`, ≤ 63 bytes | B · `invalid-identifier` |
| | name not already a table | B · `name-taken` |
| | each column name valid and unique within the table | B · `invalid-identifier` / `name-taken` |
| | each column type in the nine kinds, params valid (`varchar` n ≥ 1; `numeric` precision ≥ scale ≥ 0) | B · `invalid-type` |
| | each column default in the §4 allowlist | B · `unsafe-default` |
| | if a primary key is included: members resolve to this table's columns and are all `nullable: false` | B · `unresolved-reference` / `nullable-primary-key-member` |
| `dropTable` | table resolves | B · `target-not-found` |
| | no other table's foreign key targets it | B · `drop-blocked` (+ `dependents`) |
| | — | W · `drop-destructive` |
| `renameTable` | table resolves | B · `target-not-found` |
| | new name valid; not already a table | B · `invalid-identifier` / `name-taken` |

### Columns

| Operation | Check | Outcome · reason |
|---|---|---|
| `addColumn` | table resolves | B · `target-not-found` |
| | name valid; free on the table | B · `invalid-identifier` / `name-taken` |
| | type valid | B · `invalid-type` |
| | default in the §4 allowlist | B · `unsafe-default` |
| | `nullable: false` with no default | W · `not-null-no-default` |
| `dropColumn` | column resolves | B · `target-not-found` |
| | no index / unique / PK / FK on this column; no FK from another table onto it | B · `drop-blocked` (+ `dependents`) |
| | — | W · `drop-destructive` |
| `renameColumn` | column resolves | B · `target-not-found` |
| | new name valid; free on the table | B · `invalid-identifier` / `name-taken` |
| `retypeColumn` | column resolves | B · `target-not-found` |
| | target type valid | B · `invalid-type` |
| | target looks lossy vs. current (see below) | W · `narrowing-retype` |
| `setNullable` | column resolves | B · `target-not-found` |
| | `to === true` and the column is in the table's primary key | B · `nullable-primary-key-member` |
| | `to === false` and the column has no default | W · `not-null-no-default` |
| `setDefault` | column resolves | B · `target-not-found` |
| | new default (if non-null) in the §4 allowlist | B · `unsafe-default` |

**"Looks lossy" (warning heuristic only, not a safety lattice).** Warn when `from.kind !==
to.kind`, or same kind with a smaller parameter (`varchar` `n` decreases; `numeric`
`precision` or `scale` decreases). Do not warn on an equal or widening parameter change. The
engine does not claim to know which cross-kind retypes are safe — it warns on all of them.

### Primary keys

| Operation | Check | Outcome · reason |
|---|---|---|
| `addPrimaryKey` | table resolves | B · `target-not-found` |
| | table has no primary key | B · `primary-key-exists` |
| | constraint name valid; free | B · `invalid-identifier` / `name-taken` |
| | members resolve to this table's columns | B · `unresolved-reference` |
| | every member is `nullable: false` | B · `nullable-primary-key-member` |
| `dropPrimaryKey` | table and this primary key resolve | B · `target-not-found` |
| | no foreign key targets exactly these columns without another unique covering them | B · `drop-blocked` (+ `dependents`) |
| `changePrimaryKey` | table and primary key resolve | B · `target-not-found` |
| | new members resolve to this table's columns and are all `nullable: false` | B · `unresolved-reference` / `nullable-primary-key-member` |
| | no foreign key depends on the old column set (as `dropPrimaryKey`) | B · `drop-blocked` (+ `dependents`) |
| | removing columns from the key | — |

### Indexes and uniques

| Operation | Check | Outcome · reason |
|---|---|---|
| `addIndex` / `addUnique` | table resolves | B · `target-not-found` |
| | name valid; free | B · `invalid-identifier` / `name-taken` |
| | members resolve to this table's columns | B · `unresolved-reference` |
| `dropIndex` | index resolves | B · `target-not-found` |
| `dropUnique` | unique resolves | B · `target-not-found` |
| | no foreign key targets exactly these columns without another unique / PK covering them | B · `drop-blocked` (+ `dependents`) |
| `changeIndex` / `changeUnique` | object resolves | B · `target-not-found` |
| | new members resolve to this table's columns | B · `unresolved-reference` |
| `changeUnique` | no foreign key depends on the old column set | B · `drop-blocked` (+ `dependents`) |

### Foreign keys

| Operation | Check | Outcome · reason |
|---|---|---|
| `addForeignKey` | table resolves | B · `target-not-found` |
| | name valid; free | B · `invalid-identifier` / `name-taken` |
| | local columns resolve on this table | B · `unresolved-reference` |
| | referenced table resolves; referenced columns resolve on it | B · `unresolved-reference` |
| | local column count === referenced column count; per-column types equal (exact-match, `CONTEXT.md`); referenced columns are covered by a PK or unique | B · `fk-shape` |
| `dropForeignKey` | foreign key resolves | B · `target-not-found` |
| `changeForeignKey` | foreign key resolves | B · `target-not-found` |
| | new endpoints resolve; shape valid (as `addForeignKey`) | B · `unresolved-reference` / `fk-shape` |
| | `onDelete` moves from `restrict` / `no action` to `cascade` / `set null` / `set default` | W · `fk-action-loosened` |

---

## 3. Identifier quoting (the contract ticket 0003 consumes)

**Rule 1 — always quote.** `quoteIdent` is permanently:

```ts
const quoteIdent = (s: string) => '"' + s.replace(/"/g, '""') + '"';
```

Every table, column, constraint, index, and schema name in generated DDL is emitted through
it. No reserved-word list, no quote-only-when-needed path. This satisfies the ticket's "always
quotes identifiers" literally and makes reserved words (`"select"` as a column name) and any
mixed-case name round-trip correctly for free.

**Not quoted:** type names (`text`, `varchar(255)`), referential actions (`cascade`), and
SQL keywords the emitter writes itself (`not null`, `default`, `add column`). These are
emitter-authored, never user input.

**Rule 2 — restrict new names at the source.** `validateOperation` blocks
(`invalid-identifier`) any new or changed object name that fails `^[a-z_][a-z0-9_]*$` or
exceeds 63 bytes (Postgres truncates longer identifiers, which can silently collide two
objects). Reserved words pass Rule 2 — they are handled by Rule 1, not forbidden.

The raw-SQL import path (stretch) meets names that break Rule 2 (`"MyTable"`,
Postgres-assigned constraint names); it normalises or escapes them at the single import
chokepoint ADR 0003 §6 reserves, and does not relax Rule 2 for editor-authored schemas.

---

## 4. Column-default allowlist

`Column.default` stays a raw string or `null` (ADR 0001). Trimmed, a non-null default is
accepted only if it matches one form:

| Form | Rule | Examples |
|---|---|---|
| Integer / decimal literal | `^-?\d+(\.\d+)?$` | `0`, `-1`, `3.14` |
| Boolean | `true` / `false`, case-insensitive | `false` |
| Null keyword | `null`, case-insensitive (distinct from "no default") | `null` |
| String literal | `^'([^']|'')*'$` — single-quoted, internal quotes doubled | `'pending'`, `'O''Brien'` |
| Allowlisted function | exact match, case-insensitive | **V0:** `now()`, `current_timestamp`, `gen_random_uuid()` |

Anything else → `OpError { reason: "unsafe-default" }` naming the allowed forms. Never
silently dropped, never re-quoted or guessed at.

**V1** widens the function set: `current_date`, `current_time`, `clock_timestamp()`,
`uuid_generate_v4()`. `nextval('...')` stays out — its string argument needs its own parser
to validate.

The allowlist is one named constant in `engine/`. `setDefault` and `addColumn` both route
their default through it; `validateDocument` re-checks it as the backstop for the import path.

---

## 5. Atomicity and batch semantics

The transaction contract is ADR 0004 §8, not restated here. What 0008 adds is how
`validateOperation` runs over a batch:

- The batch is validated **progressively**: op *n* is checked against the document with ops
  *1 … n − 1* already applied. So an earlier op that frees a name (a `renameColumn` away, a
  `dropColumn`) lets a later op in the same batch reuse it.
- The **first** `OpError` stops validation and rejects the whole batch —
  `422 { failedAt: n, op, reason, dependents? }` (ADR 0004 §8 shape). Nothing is written.
- `OpWarning`s from every op in the batch are accumulated and returned with the success
  response; they never stop anything.
- `validateDocument` runs once on the resulting branch head after a successful batch (a
  backstop — a single-op route to an invalid whole should already have been blocked), and
  once on the merged candidate after `threeWayMerge` returns `clean` (ADR 0008 §5). A
  `StructuralError` on the merge path → `409` with the `StructuralError[]`.

---

## 6. Destructive-warning surfaces

The `OpWarning`s and the `destructive: true` flag on the DDL IR (ADR 0003 §5) drive advisory
notices in three places. Row data is out of scope, so all of these are advisory — visible,
never blocking.

| Warning | Structured editor (at edit time) | Branch Divergence sub-sheet | Merge-review screen |
|---|---|---|---|
| `drop-destructive` | inline on the card, on apply | on the affected row | on the affected `ComparisonRow`; rolled into a "destructive changes" summary line |
| `narrowing-retype` | inline on the column control | on the affected row | on the affected row |
| `not-null-no-default` | inline on the column control | on the affected row | on the affected row |
| `fk-action-loosened` | inline on the constraint control | on the affected row | on the affected row |

The merge-review screen reads `DdlStatement.destructive` to mark the generated-DDL lines as
well; the warning *text* is the `OpWarning.message` composed by `validateOperation`, never a
regex over emitted SQL.

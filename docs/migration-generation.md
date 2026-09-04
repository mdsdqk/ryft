# SQL migration generation and dependency ordering — algorithm

Ticket 0003. Given the delta between two schema documents (`theirs` → merged, or `base` →
branch head), produce a correctly ordered, **forward-only** Postgres DDL rendering of the
change, shown on the merge-review screen. Nothing executes it — `main`'s schema document is
the schema of record and a merge updates it directly (ticket 0009; `decisions.md` § "The
generated DDL is a rendering of the merge, not a deliverable").

This is the algorithm write-up. `docs/adr/0003-sql-generation-and-ordering.md` is the
structured companion (one section per load-bearing call). `decisions.log.md` carries the
running narrative (`decisions.md` is the curated record).

Built on 0001 (`schema.ts`, `operations.ts`), 0002 (`diff.ts`'s `diffSnapshots`,
`apply.ts`'s phase model). Implemented in `engine/`: `emit.ts` (`emitMigration`, the
`DdlStatement` IR, `expand`, `expandForeignKeys`, `order`, `serialize`), `replay.ts`
(`checkReferences`, `replayStatement`, `verifyPrefixes`), worked examples in
`engine/__fixtures__/migration-scenarios.ts` run by `engine/emit.spike.ts`.

Owned elsewhere and only *consumed* here: identifier quoting and destructive-change warnings
(ticket 0008 — §8), the merge itself (0002).

---

## 0. Signature and pipeline

```ts
emitMigration(
  source: SchemaDocument,   // where the migration starts: `theirs` for a merge, `base` for a branch head
  target: SchemaDocument,   // where it ends: the merged document, or the branch head
): { statements: DdlStatement[]; sql: string }
```

We take the two documents and derive the delta internally via `diffSnapshots(source,
target)` — the same stance as `threeWayMerge`, which is handed documents and derives its
deltas rather than being passed them (ADR 0003 §1). The delta stays an internal artifact;
`DdlStatement[]` is the reusable output (§1).

```
   diffSnapshots(source, target) ─▶ Delta (Operation[], id-referenced, not ordered)
                                      │
       expand each Operation ─▶ DdlStatement[][]   (statement groups, names resolved, §2)
       + expandForeignKeys(source, target)         (the FK pass — sole FK owner, §4)
                                      │
                    order(groups) ─▶ DdlStatement[]   (phase-ordered, §3)
                                      │
              verifyPrefixes(source, statements)   (§5 — throws if any prefix is unsound)
                                      │
        serialize: header + BEGIN;  <one statement per line>  COMMIT;   (§7)
```

`emitMigration` is **pure**. No I/O, no database. If `verifyPrefixes` finds a bad prefix it
throws `IntermediateStateError` and `emitMigration` produces nothing — it never returns SQL
it knows is misordered. The pre-merge dry run against a real ephemeral Postgres is a
separate thing (ticket 0009).

---

## 1. The `DdlStatement` IR

`expand` does not build SQL text. It builds a typed statement list — `DdlStatement` in
`engine/emit.ts` — that mirrors Postgres DDL one-to-one and carries **resolved names, never
ids**. `serialize` turns one `DdlStatement` into one SQL string; `verifyPrefixes` replays
the same list against an in-memory model. SQL text is one serialization of the IR, not the
primary artifact — the merge-review screen renders the IR directly ("what this migration
will do").

Statement kinds, grouped by the phase they land in:

| Phase | kinds |
|---|---|
| 1 — creates + renames | `createTable` (FK-free), `renameTable`, `renameColumn` |
| 2 — intra-table alters | `alterColumnType`, `addColumn`, `setNotNull`, `dropNotNull`, `setDefault`, `dropDefault`, `addPrimaryKey`, `addUnique`, `createIndex` |
| 3 — foreign keys | `addForeignKey` |
| 4 — teardown | `dropConstraint`, `dropIndex`, `dropColumn`, `dropTable` |

These four phases are the *conceptual* order. `emit.ts` encodes them as a per-kind sort key
`PHASE` with two phases split for sub-ordering (`alterColumnType` hoisted ahead of the rest
of phase 2 — §6; teardown as FK/index → column → table — §3). Every constraint/index
carries its DDL identifier as a stored `name` on the IR (§2). Every destructive statement
carries `destructive: true` — the hook ticket 0008's warning pass reads (§8); the warning
copy and the "narrowing a type" / "NOT NULL without default" cases are 0008's.

`expand` returns a list of **groups** (`DdlStatement[][]`). A group is one or more
statements that must stay contiguous and sort together at their earliest phase — almost
always a single statement, the exception being an id-preserving redefinition, which is a
`[drop, re-add]` pair (§3).

### Renames render as `ALTER … RENAME`, never drop-and-add

This falls out for free and must not be broken. `diffSnapshots` matches objects by id, so a
rename is already a single `renameColumn` / `renameTable` op — never a `dropColumn` +
`addColumn` pair. `expand` maps it straight to `{ kind: "renameColumn", from, to }`. There
is no code path that would turn a rename into a drop-and-add; the id model removed it
upstream.

---

## 2. Name resolution

`NameResolver` in `engine/emit.ts`. The delta references objects by id; a `DdlStatement`
needs the concrete name the object has *at the point the statement runs*.

**Tables and columns** have a `name` in the model. `NameResolver` resolves it from
`target`. Because every `renameTable` / `renameColumn` is emitted in phase 1 — before any
statement that resolves a name — a resolver keyed on `target` is correct for phases 2–4;
the phase-1 rename statements themselves render from the delta op's own `from` / `to`, not
the resolver.

**Constraints and indexes** also carry a stored `name` (ADR 0003 §6 — a `name` field was
added to `PrimaryKey` / `Unique` / `Index` / `ForeignKey` in `schema.ts`). Their DDL
identifier *is* that name, verbatim. `NameResolver.constraintIdent` / `.indexIdent` read it
from `target` for adds and changes; a **pure drop** reads it straight off the drop op's
payload (`op.index.name`), since the object is no longer in `target` to resolve.

Why stored rather than synthesised from the table + member column names at emit time: a
`DROP` must name the exact string the `CREATE` used, and Postgres does not rename a
constraint or index when a column it covers is renamed — so any name derived from current
column names is wrong for an object that outlived a rename, and that error lands on the
un-recoverable drop path. A stored name is set once and travels with the object. See ADR
0003 §6 for the full trade-off (including the rejected "identifier = the stable id"
option).

Because the name is immutable in V0 (no `renameConstraint` op), it never differs between
`base` and `head`; `diffSnapshots` carries it in the `change*` payloads for the renderer but
does not compare it.

---

## 3. Ordering: four fixed phases, not a runtime topological sort

The dependency graph is shallow and **static**: `table → column → {index, primary key,
unique, foreign key}`, cross-table only through a foreign key. There is no view→table edge,
no trigger, no partition (all cut — see `decisions.md`). A graph this shape has one
topological order up to independent-sibling permutation, and that order is known at compile
time. So the emitter uses the **same fixed phases as `apply.ts`** (ADR 0002 §4) rather than
building and sorting a graph at runtime:

1. `createTable` (foreign keys stripped off), `renameTable`, `renameColumn`
2. `alterColumnType`; then `addColumn`, `setNotNull` / `dropNotNull`, `setDefault` /
   `dropDefault`, `addPrimaryKey`, `addUnique`, `createIndex`
3. `addForeignKey` — every FK, new or changed, added once both endpoint tables and their
   columns exist (§4)
4. teardown in **reverse** dependency order: `dropConstraint` (incl. FK) + `dropIndex`,
   then `dropColumn`, then `dropTable`

"Describe the topological-sort rule" (ticket wording) is answered by: *the phase list is a
precomputed topological order of the static graph.* `emit.ts` encodes it as a per-kind sort
key `PHASE` (values 1–7 — phases 2 and 4 are split for the sub-rules below). `order()` is a
stable sort of `expand`'s statement **groups**: each group is placed at its earliest
member's key, its members stay contiguous, and `expand`'s emission order breaks ties. No
procedural ordering logic — every rule lives in the `PHASE` table.

### `change*` ops expand to an adjacent `[drop, re-add]` group

A `changeIndex` / `changeUnique` / `changePrimaryKey` (and a changed foreign key, via
`expandForeignKeys`) expands to a two-statement group. `order()` places the group at the
re-add's key — 2 for index / PK / unique, 3 for FK — so the `drop` rides with it into the
alter phase. If the `drop` were routed by its own kind it would land in the teardown, and
the re-add would run first and be undone. Only a **pure** drop — the object is absent in
`target` — is a lone group in the teardown. This is the emit-side mirror of `apply.ts`
running `pkDrop` before phase B.

### The teardown sub-order

`dropConstraint` and `dropIndex` share a key (nothing depends on a constraint or index),
then `dropColumn` (after its constraints/indexes are gone), then `dropTable` (last — it
carries any remaining FK with it). This mirrors `apply.ts` phase D (FK → index/unique →
column → table) and is three extra keys in `PHASE`, not a separate mechanism.

### Retype before a dependent index/constraint add on the same column

See §6.

### The foreign-key knot

See §4.

---

## 4. The foreign-key ordering knot

Two new tables that reference each other — `teams.org_id` → `organizations.id` and
`organizations.primary_team_id` → `teams.id` — have **no** valid "create in dependency
order" sequence: each `CREATE TABLE` names a table the other creates. `schemadiff` spends
real machinery on this; on Postgres it dissolves.

The rule: **`createTable` never carries its foreign keys.** `expand` strips them
(`table.foreignKeys` is dropped from the `createTable` statement), and a separate pass —
`expandForeignKeys(source, target)` — emits one `addForeignKey` for every FK in `target`
that is new or changed relative to `source`, all in phase 3. By then every table and column
exists, so a cycle among FKs is just two independent `ALTER TABLE … ADD CONSTRAINT`
statements in either order.

`expandForeignKeys` is the **sole owner** of every FK statement — the `addForeignKey` /
`dropForeignKey` / `changeForeignKey` delta ops are ignored by `expand` (they `return []`).
It runs off the two **documents**: it walks `target`'s FKs by id, emitting an
`addForeignKey` for each one new or changed relative to `source` (a changed FK as a
`[dropConstraint, addForeignKey]` group), then emits a lone `dropConstraint` for any
`source` FK absent from `target` whose owning table still exists (if the table is also
dropped, `DROP TABLE` carries the FK). Because it reads the documents, a brand-new table's
FKs — which live only inside its `createTable` payload, never as separate ops — need no
"remember what I stripped" bookkeeping; they are simply "in `target`, not in `source`".

This is worked example 3 in `migration-scenarios.ts` (§9).

---

## 5. The intermediate-state replay check

`engine/replay.ts` — `verifyPrefixes`, `replayStatement`, `checkReferences`. `emitMigration`
calls `verifyPrefixes(source, statements)` after `order()` and before `serialize`; a failure
throws and `emitMigration` produces nothing.

**Why every prefix, not just the final state.** The ordering rules in §3 are the
implementation; this is the verifier. A migration whose *last* statement leaves a sound
schema can still pass through an unsound intermediate state — and an unsound prefix is
exactly the signature of a wrong statement order (an object referenced before it exists).
Catching it here means it is caught at generation time, on top of the `BEGIN/COMMIT` that
would roll a bad order back at apply time. PlanetScale's `schemadiff` checks the same
property.

**`verifyPrefixes(source, statements)`** clones `source` into a working `SchemaDocument`,
then for each statement: `replayStatement(model, stmt)`, then `checkReferences(model)`. The
first failure — a statement that cannot apply, or a model that fails the predicate — throws
`IntermediateStateError` carrying the 0-based step index and the offending statement. On
success it returns the final model, so a caller can diff it against `target`.

**`replayStatement(model, stmt)`** applies one statement in place. Statements are
name-referenced, the model is id-referenced, so each case resolves names to live objects and
mutates them, keeping ids stable — a `RENAME COLUMN` only touches `.name`, so every index /
FK holding that column's id still resolves. New objects get a synthetic `replay:*` id minted
deterministically from their names; nothing dereferences those ids (indexes and constraints
are dropped by name), and the `replay:` prefix cannot collide with a real id from `source`.
An impossible mutation throws a plain `Error` that `verifyPrefixes` converts.

**`checkReferences(doc)`** returns `null` if sound, else the first failure as a string. Its
scope is **reference resolution only**: table names unique, column names unique within a
table, every primary-key / index / unique member column present, every foreign key's local
columns present and its referenced table + columns present. That is all the ordering check
needs. It is the **seam to ticket 0008** (ADR 0003 §4): 0008 owns the rest of structural
validity — a nullable column in a primary key, a default literal that cannot be rendered,
NOT NULL added with no default — and extends this predicate with those checks.

**Not a reuse of `applyDelta`.** `applyDelta` replays id-referenced `Operation[]` as one
four-phase batch; this replays already-ordered, name-resolved `DdlStatement[]` one statement
at a time with a check between each — different granularity. Mapping `DdlStatement` back to
`Operation` to reuse `applyDelta` would add a second translation surface that can drift from
`expand` and would throw away the resolved names that make a failure legible.

The working model is a `SchemaDocument` (rather than a stripped name-keyed map) so there is
one model type across the engine — the merge, `checkReferences`, and this replayer all speak
it.

---

## 6. Retype ordered against dependent indexes and constraints

Postgres `ALTER TABLE … ALTER COLUMN … TYPE` **automatically rebuilds** every index,
primary key, and unique constraint that covers the column, and revalidates foreign keys. So
the emitter never produces an explicit `DROP INDEX` / `CREATE INDEX` (or drop/re-add
constraint) around a retype — Postgres does the rebuild.

The one obligation is a sub-ordering: an `alterColumnType` must be serialized **before** any
`addPrimaryKey` / `addUnique` / `createIndex` in the same migration, so we do not build an
object and then immediately have Postgres rebuild it. Index/constraint *drops* are already
in the teardown (after), so the drop direction needs nothing.

This is enforced by giving `alterColumnType` its **own `PHASE` key** ahead of the rest of
phase 2 — not a per-column comparator. Unconditional hoisting is safe because a retype only
ever targets a *pre-existing* column (it needs a prior type to diff against) while
`addColumn` only adds new ones, so the two keys touch disjoint columns and a retype can
never be reordered ahead of the `ADD COLUMN` that creates its target. `SET NOT NULL` /
`SET DEFAULT` after a retype on the same column is order-independent. It also reads well —
every `ALTER COLUMN … TYPE` grouped right after the renames.

Worked example 2 in §9 confirms it: `posts.view_count` retyped and a new index added on the
same column, emitted retype-first with no explicit `DROP INDEX` / `CREATE INDEX` around it.

---

## 7. Transaction wrapping and forward-only

The whole migration is wrapped in a single `BEGIN; … COMMIT;`. Postgres has transactional
DDL, so `CREATE`, `ALTER`, and `DROP` all commit together or all roll back — a bad ordering
becomes "nothing happened" rather than a half-migrated schema. This is a capability MySQL
lacks, and a large part of PlanetScale's equivalence-class machinery exists only to work
around its absence. We emit no `CREATE INDEX CONCURRENTLY` (it cannot run inside a
transaction), so nothing forces us out.

Two safety nets, both kept:

- the **transaction** turns a bad ordering into a rolled-back no-op at apply time;
- the **intermediate-state check** (§5) turns it into an error at generation time, before
  any SQL is handed over.

**No down-migrations.** Forward-only is a confirmed cut (`decisions.md` § "The generated DDL
is a rendering of the merge, not a deliverable"; full history in `decisions.log.md`). The generated file states this in its header comment. Down-paths are rarely
tested and a schema rollback loses data anyway; PlanetScale's real answer to this is a
data-plane feature (reverse replication) that is out of scope by definition. `emitMigration`
has no `direction` parameter and never will in V0/V1.

The header, verbatim:

```sql
-- Generated migration. Forward-only: no down-migration is produced.
-- Renames render as ALTER … RENAME, never drop-and-add.
-- The whole migration is one transaction — it fully applies or does nothing.
```

---

## 8. What ticket 0008 owns, consumed here

- **Identifier quoting.** `quoteIdent` in `emit.ts` is a placeholder — always double-quote,
  escape embedded quotes. 0008 owns reserved-word handling, mixed-case round-tripping, and
  the real rule set. Every identifier in `serialize` already routes through `quoteIdent`, so
  0008's work is a single-function change.
- **Destructive-change warnings.** Every destructive `DdlStatement` carries
  `destructive: true`. 0008's warning pass reads that flag and adds the type-narrowing and
  NOT-NULL-without-default cases. This ticket does not classify or word warnings.
- **Unsupported defaults.** `setDefault` emits the raw default literal as-is. 0008 decides
  which literals cannot be rendered safely and raises an explicit error instead of
  mis-quoting.
- **The extended validity predicate.** `checkReferences` (§5) — 0008 adds the non-reference
  structural checks.

---

## 9. Worked examples

In `engine/__fixtures__/migration-scenarios.ts`, run by `engine/emit.spike.ts`. Each
asserts the ordered statement `kinds`, `before` ordering pairs, verbatim SQL fragments
(`contains`), and that `verifyPrefixes` passes.

### 1. Rename + dependent index

`seed` → the `contact-fields` branch: `users.email` renamed to `email_address` (same id),
`users.phone` added, and a unique index added whose member column id is the *renamed*
column's original id.

```sql
-- Generated migration. Forward-only: no down-migration is produced.
-- Renames render as ALTER … RENAME, never drop-and-add.
-- The whole migration is one transaction — it fully applies or does nothing.

BEGIN;

ALTER TABLE "users" RENAME COLUMN "email" TO "email_address";
ALTER TABLE "users" ADD COLUMN "phone" varchar(30);
CREATE UNIQUE INDEX "users_email_address_key" ON "users" ("email_address");

COMMIT;
```

The rename is `ALTER … RENAME COLUMN`, never drop-and-add (§1); it is phase-ordered before
the `CREATE INDEX`; and the index's column id resolves to the **new** name `email_address`
(§2).

### 2. Retype ordered before a new index on the same column

`seed` → `posts.view_count` retyped `bigint → int`, plus a new index on `view_count`.

```sql
BEGIN;

ALTER TABLE "posts" ALTER COLUMN "view_count" TYPE integer;
CREATE INDEX "posts_view_count_idx" ON "posts" ("view_count");

COMMIT;
```

`alterColumnType` first (§6); no explicit `DROP INDEX` / `CREATE INDEX` around it — Postgres
rebuilds a dependent index on the type change itself.

### 3. The foreign-key ordering knot

`seed` → two new tables that reference each other: `organizations.primary_team_id → teams.id`
and `teams.org_id → organizations.id`. No "create tables in dependency order" exists.

```sql
BEGIN;

CREATE TABLE "organizations" (
  "id" uuid NOT NULL,
  "primary_team_id" uuid,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "teams" (
  "id" uuid NOT NULL,
  "org_id" uuid NOT NULL,
  CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_primary_team_id_fkey" FOREIGN KEY ("primary_team_id") REFERENCES "teams" ("id") ON DELETE SET NULL;
ALTER TABLE "teams" ADD CONSTRAINT "teams_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE;

COMMIT;
```

Both `CREATE TABLE`s carry no foreign keys; both `ADD CONSTRAINT … FOREIGN KEY` come after,
once every table exists (§4). Every prefix passes `checkReferences` — including the one
after the first `CREATE TABLE`, where `organizations` exists with no dangling reference
because its FK has not been emitted yet.

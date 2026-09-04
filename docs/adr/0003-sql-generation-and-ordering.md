# ADR 0003 — SQL migration generation and dependency ordering

Status: accepted. `engine/emit.ts` (`emitMigration`, the `DdlStatement` IR, `expand`,
`expandForeignKeys`, `order`, `serialize`) and `engine/replay.ts` (`checkReferences`,
`replayStatement`, `verifyPrefixes`) are implemented, with worked examples in
`engine/__fixtures__/migration-scenarios.ts` run by `engine/emit.spike.ts`.

The load-bearing calls made while designing migration generation — the step that renders a
merged (or branch-head) schema document as ordered Postgres DDL. One section per call.
`docs/migration-generation.md` is the full algorithm write-up; `decisions.log.md` carries the
running narrative (`decisions.md` is the curated record). Builds on ADR 0001 (stable ids; references held by id, resolved to names only at
render time) and ADR 0002 (the derived-delta model; `apply.ts`'s four-phase replay).

**Framing note (ticket 0009).** This ADR originally described the output as "runnable Postgres
DDL" for the user to deploy. That framing was wrong: `main`'s schema document is the schema of
record, a merge updates it directly, and there is no downstream database — nothing executes the
DDL. The mechanism in the six sections below is unchanged and correct; the DDL is a *rendering*
of the change, shown on the merge-review screen. See `decisions.md` § "The generated DDL is a
rendering of the merge, not a deliverable".

## 1. `emitMigration` takes the two documents and derives the delta itself

`emitMigration(source, target)` computes `diffSnapshots(source, target)` internally rather
than accepting a `Delta`. `source` is where the migration starts (`theirs` for a merge,
`base` for a branch head); `target` is where it ends.

**Why.** It matches `threeWayMerge`, which is handed documents and derives its two deltas
(ADR 0002 §1). The caller — the merge-request view, or a branch-diff view — already holds
both documents; asking it to also produce and pass a delta duplicates `diffSnapshots` at
every call site. Name resolution needs the `target` document anyway (§3), so the emitter has
to hold it regardless. The delta stays an internal artifact; the reusable output is
`DdlStatement[]`.

**Considered and rejected.** `emitMigration(delta, target)`: the ticket phrases the input as
"a delta between two schema documents", which reads like the signature. Rejected because the
delta alone is not sufficient — `expand` needs `target` to resolve ids to names, and the FK
pass (§4) reads both documents — so passing the delta as well is redundant surface that can
disagree with `diffSnapshots(source, target)`.

**Consequences.** `emitMigration` re-runs `diffSnapshots`, which the merge already ran. It is
pure and cheap and this keeps one code path. If a future caller genuinely has only a delta,
an internal `emitFromDelta(delta, source, target)` can be factored out then.

## 2. A typed `DdlStatement` IR, not string assembly

`expand` produces `DdlStatement` groups — a discriminated union that mirrors Postgres DDL
one-to-one and holds **resolved names, never ids**. `serialize` renders one statement to one
SQL string; `verifyPrefixes` replays the same list. SQL text is one serialization, not the
primary artifact. (`expand` returns a list of *groups* — `DdlStatement[][]` — so an
id-preserving redefinition can be kept as an adjacent `[drop, re-add]` pair; see §3.)

**Why.** Two consumers need the ordered statement list before it is text: the
intermediate-state check replays it against a schema model (§4), and the merge-review screen
renders "what this migration will do" without re-parsing SQL. The same reasoning as ADR 0002
§1's derived delta — the thing that is verified is the thing that is rendered, so they
cannot drift. `destructive: true` on the IR gives ticket 0008's warning pass a structured
hook instead of a regex over generated SQL.

**Considered and rejected.** Emitting SQL strings directly from `expand`: then the
intermediate-state checker has to parse SQL back into a model — writing the parser this
project spent ADR 0001 avoiding — or maintain a second parallel representation. Either way
the check and the output can disagree.

**Consequences.** Every DDL form the engine supports is enumerated twice — once as a
`DdlStatement` kind, once as a `serialize` case. For the fixed, small Postgres subset in
scope (`CONTEXT.md` out-of-scope list) that enumeration is short and stable.

## 3. Statement ordering is `apply.ts`'s four fixed phases, not a runtime topological sort

The migration's dependency graph is the same shallow static graph `apply.ts` reasons about
(`table → column → {index, PK, unique, FK}`, cross-table only via FK). So `emit.ts` reuses
the four-phase order — creates+renames, intra-table alters, foreign keys, then drops in
reverse — as a **precomputed topological order**. `order()` is a stable sort of statement
*groups* on a per-kind key (`PHASE` in `emit.ts`), placing each group at its earliest
member's key and keeping members contiguous. The ticket's "describe the topological-sort
rule" is answered by "the phases are the topological order of a graph known at compile
time".

Two sub-rules are encoded directly in the `PHASE` key table rather than in procedural code:

- **`change*` = adjacent `[drop, re-add]` group.** A `changeIndex` / `changeUnique` /
  `changePrimaryKey` (and a changed FK, via `expandForeignKeys`) expands to a two-statement
  group. `order()` places the group at the re-add's key, so the drop rides with it into the
  alter phase instead of being sorted into the teardown, where the re-add would then run
  first. This is the emit-side mirror of `apply.ts` running `pkDrop` before phase B.
- **Retype hoisted (D4).** `alterColumnType` gets its own key ahead of every
  index/PK/unique add, so Postgres never builds an object then rebuilds it on the type
  change. Unconditional, not per-column: a retype only ever targets a pre-existing column,
  so it cannot be reordered ahead of the `addColumn` that creates its target.

**Considered and rejected.** A general per-migration topological sort — build a dependency
graph from the statement list, sort it. Correct, but more machinery than a three-level graph
with one cross-table edge needs, and the same call `apply.ts` already made and rejected for
the merge replay (ADR 0002 §4). A fixed key table is easier to read, to test, and to keep
in step with `apply.ts`.

**Consequences.** Emit's ordering is coupled to the same shallow-graph assumption as
`apply.ts`. A later scope expansion that deepens the graph — views on tables, check
constraints — forces both `apply.ts`'s phases and `emit.ts`'s `PHASE` table to be revisited
together. The teardown sub-order (FK/PK/unique/index drops → column drops → table drops) is
just three more keys in the same table, not a second mechanism.

## 4. The intermediate-state check is a separate statement-granularity replayer

`engine/replay.ts` clones `source`, applies one `DdlStatement` at a time via
`replayStatement`, and runs `checkReferences` after each — the first bad prefix throws
`IntermediateStateError` carrying the step index and the offending statement.
`emitMigration` calls `verifyPrefixes` before serializing and lets that error propagate, so
it refuses to hand back a migration it knows is misordered.

**Why.** The ordering rules in §3 are the implementation; this is the verifier that proves
they held for a given migration, at generation time, on top of the `BEGIN/COMMIT` that would
roll a bad ordering back at apply time. PlanetScale's `schemadiff` validates the same "sound
at every intermediate state" property.

**Considered and rejected.** Reusing `applyDelta` op-by-op — map each `DdlStatement` back to
an `Operation`, apply it, check. Rejected on two counts: the `DdlStatement → Operation`
mapping is a second translation surface that can drift from `expand`, and it throws away the
resolved names that make a replay failure legible. `applyDelta` also replays a whole delta
in four phases, not one statement with a check between each — the wrong granularity for a
prefix check.

**Consequences.** The replay model is a `SchemaDocument` (chosen over a stripped
name-keyed map so there is one model type across the engine — merge, `checkReferences`, and
this replayer all speak it). `replayStatement` therefore resolves each statement's names to
live objects and mints a synthetic `replay:` id for every object it creates; nothing
dereferences those ids, so the minting can stay a deterministic string. `checkReferences` is
the **seam to ticket 0008**: it covers reference resolution only (names unique; every
PK/index/unique/FK member and every FK endpoint resolves), and 0008 extends the same
predicate with the structural checks it owns (nullable PK member, unrenderable default,
NOT NULL added with no default).

## 5. Quoting and destructive warnings are consumed from ticket 0008, not defined here

`quoteIdent` is a placeholder (always double-quote); every identifier in `serialize` routes
through it, so 0008's real rules are a one-function change. Destructive statements carry
`destructive: true` for 0008's warning pass. `setDefault` emits the raw literal; 0008 owns
which literals are unsafe.

**Why.** 0008 is the single owner of the cross-cutting robustness concern (its ticket). Two
tickets writing quoting rules would produce two rule sets. This ticket's job is to leave
clean seams, which it does: one function, one boolean flag on the IR.

**Consequences.** Until 0008 lands, generated SQL over-quotes (noisy but correct) and
carries no warnings. The spike and worked examples are written to not depend on either.

## 6. Constraint and index names are stored on the model, not synthesised at emit time

`PrimaryKey`, `Unique`, `Index`, and `ForeignKey` gained a required `name: string` field in
`engine/schema.ts` (a change to ADR 0001's model). The structured editor assigns a
Postgres-style name at creation (`users_pkey`, `posts_author_id_fkey`); the user may
override it. Identity stays the `id` — the merge matches on `id`, never `name` — so `name`
is a label, in the same class as `SchemaDocument.database`, and it is not independently
editable in V0 (no `renameConstraint` operation), so it never diverges between branches.

**Why.** A `DROP CONSTRAINT` / `DROP INDEX` must name the exact string the `CREATE` used.
The only alternative that needs no model change is to *synthesise* a Postgres-convention
name from the table and member column names at emit time — but Postgres does not propagate a
column rename into the names of constraints/indexes that reference it, so any name derived
from current column names is wrong for an object that has outlived a rename, and the failure
lands on the un-recoverable drop path. A stored name is set once, travels in the `drop*` op
payload, and cannot desynchronise.

**Considered and rejected.** Synthesising the name at emit time (no model change, idiomatic
output, but incorrect on the drop path per above). Using the stable `id` verbatim as the DDL
identifier (correct, no model change, but `ADD CONSTRAINT "fk_posts_users_4c88"` reads
poorly in a headline artifact, and the model stays asymmetric — tables and columns have
names, constraints do not).

**Consequences.** The seed (ticket 0005) and every fixture carry constraint/index names.
`diffSnapshots` puts `name` in the `change*` payloads for the renderer but does not compare
it (immutable in V0). `NameResolver.constraintIdent` / `.indexIdent` read the stored name
from `target` for adds and changes; a pure drop reads it from the op payload. The raw-SQL
import path (stretch) will need a fallback for objects that arrive without a name or with a
Postgres-assigned one — a single chokepoint is kept for that.

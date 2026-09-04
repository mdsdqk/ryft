# Decisions

The choices that shaped ryft, in rough order of impact. This is the short version for
someone evaluating the build; the working record, including reversals and implementation
detail, is in `decisions.log.md` and the ADRs under `docs/adr/`.

The thesis: schema version control should work on schema semantics, not SQL text. Most of the
architecture follows from that.

## Brief

### Problem

Version control for a Postgres schema: branch it, change it, see what diverged, merge it back.

The user is one engineer on a team that shares a database and changes its schema concurrently.
The team already version-controls its application code. For the schema it has migration files,
a change log rather than a schema, so reconciliation happens as a Git text conflict on a file
nobody wants to hand-edit, or in one person's head. ryft versions the schema itself and
reconciles the schema, not the files that describe it.

Row data is out of scope.

### Hard part

Two problems.

1. Merging two diverged schemas. A text merge over a schema dump is wrong both ways: it flags
   a conflict when two people add unrelated columns to one table, because the lines are
   adjacent, and it merges cleanly when one person drops a column the other indexed, because
   the lines are far apart.

2. Telling a rename from a drop-and-add. Given only two states, "`email` became
   `email_address`" and "`email` was dropped and `email_address` added" are identical. This is
   undecidable from state alone, and the existing tools say so.

### Slice

One path, deployed: seed `main`, cut a branch, edit it through a structured editor that
records renames as renames, open a merge request, see a three-way diff with every conflict
typed, resolve conflicts, see the rendered Postgres DDL, merge.

## Core decisions

### 1. State-based versioning

A branch is its current schema document plus a snapshot of its parent from when the branch was
cut. No commit graph.

The schema is small enough to store whole, and history answers questions nobody asks. A
reviewer wants to know what differs now and what a merge would do; the three snapshots (base,
ours, theirs) give both, and the merge never replays a log. Each state is stored as one JSONB
document, with no table of columns and indexes, because the engine only ever consumes whole
documents. Identity lives in the snapshots, not in the operation log, which exists only for
undo and per-branch history.

This follows PlanetScale, which diffs schema states.

Cut: history, blame, revert, point-in-time views.

### 2. Stable object identity

Every table, column, constraint, and index gets a synthetic id at creation. The id survives
renames and merges. References (foreign keys, indexes) hold ids, not names; names resolve only
when DDL is rendered.

Name-matching is the alternative, and it breaks on the first rename: the diff reports a drop
and an add, and the merge destroys a column or invents a conflict. With ids, rename-rebase is
almost free, because a reference to a renamed column still resolves, and a class of ordering
problems disappears, because "rename X" and "add index on X" commute when the reference is an
id.

The cost: ids exist because the editor mints them. Pasted SQL or an introspected database has
none, and for that input ryft is where everyone else is.

### 3. Structured schema IR

There is no SQL parser. The editor produces a typed schema document and the engine diffs two
of them. A column type is a discriminated union, not a string, because `varchar(255)` cannot
carry its parameter without a parser.

Next to PlanetScale's `schemadiff`, which parses SQL and then normalizes it into a
syntax-free model, this looks like a shortcut. It is not: that normalized model is a schema
document, and a structured editor produces one directly. What is skipped is ingestion, not the
diff. The diff still knows this is a column, it has a type, an index depends on it.

Cut: SQL parsing, and with it the ability to ingest arbitrary DDL. That is the real gap, and
the first thing I would close with more time.

### 4. Explicit rename intent

The editor records a rename as a rename: same id, new name. No similarity matching, no prompt.

Surveyed tools prompt a human, take a hand-written directive (`renamed_from`), or emit a
destructive drop and add. The only automatic heuristic anyone trusts is exact structural
equality. ryft does not guess, because a wrong guess renames the wrong column or drops one
meant to stay.

### 5. Semantic diff and typed conflicts

Conflicts are typed, not textual. An identical change on both sides is an overlap, not a
conflict: it applies once. A dependency failure, one branch drops a column the other indexes,
is its own class, separate from a property conflict, both sides retype the same column
differently. The full set is seven classes, six clear and one subtle.

The merge returns a typed report, never an interactive prompt, because a prompt fails silently
when a CI job or an agent is on the other end. The vocabulary started from PlanetScale's
clear, subtle, and overlap split.

Cut: positional column-order conflicts. Postgres always appends and cannot reorder, so two
branches cannot hold competing intentions about a column's position. Order inside a composite
index still matters and stays a conflict.

### 6. Three-way merge and the commutativity check

Before reporting a clean merge, the engine applies both branches' changes to the common
ancestor in both orders and checks the results match each other and the merge output. If not,
the merge is blocked.

This is the important one. The typed conflict classes are a fixed list, so they are only as
complete as the cases I thought of. The commutativity check is not a list, so it catches
ordering bugs the taxonomy misses. It proves only that order does not matter, not that the
result is valid: two branches that each add a table named `audit` commute and still collide.
Duplicate names are caught during classification; other structural breakage is caught by a
separate check on the merged schema.

Saved resolutions are guarded too. A resolution carries its conflict id and the base, ours,
and theirs snapshots it was chosen against. It is re-applied only when both still match; a
resolved conflict that changed while the merge request was stale must be chosen again. The
tempting alternative was to reuse a resolution by object id alone. That would make a stale
choice look convenient while applying it to a materially different conflict.

### 7. Dependency-aware validation

One pure engine function, `validateOperation`, decides what is legal. The server refuses on
any error; the editor shows the same errors inline as you type, from the same function.

The line: if a real Postgres would accept the DDL, ryft does not block it. Losing a NOT NULL
guarantee or narrowing a type warns; an incoherent result blocks, such as an unknown target, a
name collision, an unresolved reference, or a drop with live dependents. A drop is blocked
while anything still references the object, so each dependent is removed as its own deliberate
operation rather than swept up by a cascade. A whole-document check runs after a batch of
edits and after a merge, catching a duplicate name or dangling reference that two individually
valid changes can still produce.

Native foreign keys are kept, unlike PlanetScale, which drops them for data-plane reasons ryft
does not have. They are the most interesting dependency to track.

### 8. Branching and concurrency

Every branch is cut from `main` and merges back into `main`. No branch-of-branch. This keeps
the model tractable and matches PlanetScale, where `main` is the common ancestor by
construction. A merge consumes its source branch: on success the branch is archived and
removed, rather than given rebase semantics so it can keep going.

Merges serialize at `main`. Two merge requests can each be clean on their own and then
conflict because `main` moved between them; serializing means the second one is re-checked
against the `main` it will actually land on, and comes back with the new conflicts if there
are any. That re-check is an implicit rebase, so rebase is not a user-facing operation.

Cut: branching from a non-`main` branch; rebase as an explicit action.

### 9. Generated DDL as a rendered artifact

The merged schema document is the source of truth. A merge updates that document directly. The
Postgres DDL is a rendering of the change, not the thing being stored, and nothing executes
it.

The engine builds a typed, ordered list of statements before rendering any string, because a
replayer checks that list and the review screen displays it; a bare string would have to be
parsed back. Ordering is four fixed phases: creates and renames, intra-table alters, foreign
keys, then drops in reverse. That is sufficient for the deliberately shallow dependency graph.
The replayer walks the list one statement at a time and fails if any prefix leaves a reference
unresolved.

Generated SQL always quotes identifiers, and defaults are restricted to a small validated set
rather than interpolating arbitrary SQL: numeric and boolean literals, `null`, quoted strings,
and a tiny allowlist of functions such as `now()`. A denylist or raw interpolation would make
the generated migration accept arbitrary user text. Safe generation wins over dialect
completeness.

Cut: down-migrations, rollback generation, executing the migration for the user.

## Product and UX decisions

### 10. Review is the primary surface

The prompt can be met with a schema editor, but the real need is understanding and reviewing a
change. The UI makes the merge request the center: schema state, semantic diff, conflict
explanations, resolution, and the generated migration are one review surface.

### 11. Conflicts explain themselves

A conflict is not rendered as "cannot merge." The screen shows the common ancestor, both
branches' changes, the object in conflict, and why the engine classified it that way. It
mirrors the typed conflict model instead of an opaque boolean.

### 12. Progressive disclosure

The default view is the semantic change. Dependency chains and the generated DDL are one click
away, not on screen by default. The common path stays readable without hiding what someone
reviewing a risky change needs.

## Scope

### Deliberately cut

Views, enums, check constraints, triggers, functions, partitions, row-level security. This
keeps the dependency graph shallow, tables and columns and indexes and foreign keys, and
shallower than `schemadiff`'s, where a view depends on a table.

Multiple schemas and namespaces. More than one target branch per merge request.

Authentication and authorization. A minimal user identity exists only so merge authorship
shows in the product: a username, no password, no session.

A widening or safety order over types, so `int` to `bigint` is not known to be safer than
`int` to `text`. Equality is an exact structural match; `varchar(255)` differs from
`varchar(256)`.

### Stretch

Ranking retypes by risk, once a widening order exists.

A per-branch SQL console, the one feature that would close the ingestion gap: a rename typed
as `ALTER TABLE ... RENAME COLUMN` carries its own intent, so the console keeps the identity
signal a raw state comparison loses.

## Testing and known limitations

The engine has a scenario-based vitest suite: merge cases, emit cases, invariants. The API
suite runs the whole app in-process against `pglite`, real Postgres in WebAssembly, so
`pnpm test` needs no database.

One gap is pinned, not hidden: `diffSnapshots` on a primary key whose id changed emits
`addPrimaryKey` without the matching `dropPrimaryKey`. An `it.fails` test records it until it
is fixed.

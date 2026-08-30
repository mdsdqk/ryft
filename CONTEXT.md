# Context — Version Control for Database Schemas

Glossary for the project. Terms only, no implementation detail.

## Core artifact

- **Schema** — the object under version control: the set of tables, columns, primary keys,
  foreign keys, unique constraints, and indexes in a single Postgres namespace. Row and table
  *data* is explicitly not part of the schema and is out of scope.
- **Schema document** — the canonical serialized representation of one schema *state*, as a
  structured document (JSON). Two schema documents can be compared field by field.
- **Snapshot** — a schema document captured and frozen at a particular moment (branch creation,
  merge-request creation).
- **Type equivalence** — two column types are the same iff their normalized forms are identical,
  parameters included: `varchar(255)` ≠ `varchar(256)`, `numeric(10,2)` ≠ `numeric(10,3)`. There
  is no widening lattice — the engine does not know that `int` → `bigint` is safer than
  `int` → `text`. Ranking retypes by safety is a stretch item.

## Branching model

The model is **declarative / state-based**, following PlanetScale's `schemadiff`: there is no
commit graph and no history. A branch is defined by its current state plus a lightweight record
of the edits that produced it. (Neon is a reference for branching *UX* only — it has no merge
and only a textual diff, so it is not a model for anything below.)

- **Branch** — a named line of schema evolution.
- **Trunk** — `main`. It is the single shared ancestor: every branch is cut from `main` and
  merges back into `main`. Branching from a non-`main` branch is **not supported** in V0/V1.
  This matches PlanetScale, where `main` *is* the common ancestor by construction. `main` is
  seeded once and thereafter only changes when a branch merges into it.
- **Base snapshot** — the schema document of a branch's parent, copied at the moment the branch
  was created. It is the common ancestor used in a three-way merge.
- **Head** — a branch's current, mutable schema document.
- **Stable id** — a synthetic identifier carried by every schema object (table, column,
  constraint, index), assigned at creation and preserved across rename and across merge. Object
  identity lives in the id, not the name, so the three-way merge follows an object across a
  rename by matching ids, and foreign keys and indexes reference their columns by id (resolved
  to names only when DDL is rendered). A base snapshot is an id-preserving copy.
- **Operation** — a single recorded schema edit (add column, rename column, retype column, add
  index, create table, …), captured at edit time.
- **Operation log** — the ordered list of operations applied to a branch. It is a UI and audit
  convenience — undo, and showing "what changed on this branch". It is **not** load-bearing for
  merge correctness, because identity is carried by stable ids in the snapshots; there is no
  commit and no revision history.

## Diff and merge

- **Merge request** — a request to merge a source branch into a target branch. On creation it
  freezes three snapshots: **base** (the source branch's base snapshot), **ours** (the source
  branch's head), **theirs** (the target branch's head at that moment).
- **Three-way diff** — the comparison of base, ours, and theirs that identifies what each side
  changed relative to the common ancestor.
- **Semantic three-way merge** — computing the merged schema document from base / ours / theirs
  by matching schema objects on their stable ids, resolving object identity across renames,
  rebasing dependent changes across renames, and classifying conflicts. Operating at the level
  of schema objects, not text. No operation logs are consulted.
- **Rename-rebase** — when one side renames a column and the other side adds a dependent object
  (index, NOT NULL, foreign key) against the old name, the dependent change is re-pointed at the
  new name instead of erroring or being dropped. The project's headline edge case.
- **Conflict** — a change on `ours` and a change on `theirs`, relative to `base`, that cannot
  both be applied. Seven classes are recognised, each mapped to PlanetScale's severity vocabulary:

  | Class | Severity | Detection rule |
  |---|---|---|
  | Divergent retype | clear | both sides retype the same column id to different types |
  | Add-vs-add | clear | both sides add an object of the same name in one namespace whose definitions differ (identical definitions are an overlap) |
  | Rename-vs-rename | clear | both sides rename the same column id to different names |
  | Divergent index definition | clear | both sides change the same index id incompatibly |
  | Drop-vs-modify | clear | one side drops an object id the other side modifies |
  | Dependency conflict | subtle | a change whose target object was dropped or renamed incompatibly on the other side, so it cannot be rebased |
  | Divergent definition | clear | catch-all: both sides change the same object and aspect to different values and no class above matched (divergent default, primary key, unique, or foreign key) |

- **Overlap** — both sides make the *identical* change to the same object. **Not** a conflict:
  the change is applied once and the merge proceeds silently. PlanetScale's term, adopted.
- **Order-dependence.** PlanetScale's "subtle conflict" bundles two separate things and only one
  of them survives here. *Positional* order — a column's ordinal position in its table — does not
  exist in this model: Postgres has no `ADD COLUMN … AFTER` and no way to reorder a table, so two
  branches cannot hold competing intents about it. That half dissolves, and there is no standalone
  ordering conflict class. *Dependency* order — a change that presupposes an object the other side
  removed or renamed — is real and survives as the **dependency conflict** class above. Column
  order **within** a composite index or primary key is a third, different thing and is fully
  significant: `(a, b)` ≠ `(b, a)`, and a divergence there is a divergent index definition.
- **Commutativity post-condition** — before declaring a clean merge, the engine verifies that
  applying each side's delta to `base` in either order yields the same document, and that it
  equals the merged document. A failure is reported as an **unclassified divergence** and blocks
  the merge. This is the completeness check on the seven rule-based classes: the classes are only
  as complete as their enumeration, so the engine never claims a clean merge it cannot prove. It
  detects order-dependence only; an order-independent invalid result (a duplicate name, a
  dangling reference) is caught by structural validation, not this check.
- **False conflict** — independent changes to the same table (or unrelated objects) that a
  text-level merge would collide on but the semantic merge applies cleanly.
- **Resolution** — a recorded choice that settles one conflict (take ours, take theirs, or, for
  a divergent retype, an explicit target type). Resolutions are stored on the merge request; the
  merge cannot complete while any conflict is unresolved.

## Output

- **Migration** — the dependency-ordered Postgres DDL that `emit` renders for a change
  (`theirs` → merged for a merge, `base` → head for a branch diff). Forward-only; renames
  render as `ALTER … RENAME`, never drop-and-add; statements are dependency-ordered and wrapped
  `BEGIN … COMMIT`. It is shown on the merge-review screen as what the change amounts to in
  SQL. `main`'s schema document is the schema of record and a merge updates that document
  directly — nothing executes the DDL, and there is no downstream database.
- **Intermediate-state validity** — every prefix of the DDL must leave the schema structurally
  sound (all references resolve), not just the final statement. The dependency-ordering rules
  are the implementation; a step-by-step in-memory replay is the verifier that proves they
  held. PlanetScale does the same (`schemadiff` validates every intermediate state).
- **DDL verification** *(stretch)* — the rendered DDL is applied to an ephemeral Neon Postgres
  branch to confirm a real Postgres accepts it. Advisory; the merge never depends on it. In
  V0/V1 the correctness of `emit`'s output is covered by tests; the Neon-backed check is
  stretch (ADR 0009).

## Delivery bands

- **V0** — the walking skeleton: seed, branch, edit, open merge request, semantic three-way
  diff, fast-forward (no-conflict) merge, deployed.
- **V1** — conflict detection and classification for all seven classes, plus a resolution UI for
  divergent retype and rename-rebase.
- **Stretch** — raw-SQL import with heuristic rename detection; drop-vs-modify resolution UI;
  DDL verification against a real Postgres (ADR 0009).

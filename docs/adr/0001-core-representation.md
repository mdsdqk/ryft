# ADR 0001 — Core representation: schema document and operation log

Status: accepted

The load-bearing modelling calls made while defining the two data structures the schema-VCS
engine is built on: the schema document and the branch operation log. One section per call.
`decisions.md` is the fine-grained running log. This is the structured companion a reviewer
reads for context, alternatives, and consequences.

## 1. Object identity is a stable synthetic id, not a name

Every table, column, primary key, unique constraint, index, and foreign key carries an `id`
assigned at creation and preserved across rename and across merge. Foreign keys and indexes
reference their columns and tables by id. Names are resolved only when DDL is rendered. A base
snapshot is an id-preserving copy, produced with `structuredClone`.

**Why.** Matching objects by name is what every state-based tool surveyed does: Atlas, Skeema,
PlanetScale's `schemadiff`, Prisma, Alembic. None of them can follow an object across a
rename. The rename reads as drop-and-add, and the three-way merge then either destroys a
column and its data or reports a conflict that is not real. With ids, a rename is the same id
with a new name. The merge matches on id, so rename-vs-dependent resolves on its own: one
branch renames `email`, the other adds an index on it, and the index holds the column's id,
which still exists.

**Considered and rejected.** Name matching is simpler and needs no id allocation, but it loses
renames, which is the project's headline case. Heuristic rename inference from state is
something no surveyed tool trusts, because a wrong guess silently drops a column.

**Consequences.** Ids exist only because the structured editor mints them. A schema arriving
from outside has no ids, whether pasted as SQL or introspected from a database, and for that
input the model falls back to name matching like everyone else. Raw-SQL import is therefore
stretch-only. "The editor preserves an object's id across every rename" is a load-bearing
invariant and is tested as one.

## 2. The operation log is an audit and undo convenience, never merge input

Each branch keeps an ordered log of the edits made on it. A `LogEntry` is `seq`, a timestamp,
an `authorId`, and an `Operation`. The semantic three-way merge never reads it. Identity is
carried by the stable ids in the schema snapshots. The merge matches base, ours, and theirs by
id and computes the result from state alone.

**Why.** An operation log that drives merge is Django's and Alembic's model, and neither can
merge two diverged branches. A log records the order edits happened on one branch, not how to
reconcile two orders. Moving the identity signal out of the log and into the state, as an id
that survives a rename, is what makes a real three-way merge tractable. It also frees the log
to be a thin UI feature: what changed on this branch, and undo.

**Consequences.** The log needs no immutable revisions, no content addressing, no range
slicing to identify a branch's changes. Drop operations carry the full removed object so undo
is a faithful, id-preserving re-insert. The `merge` marker on `main`'s log records no schema
delta, because the delta is already in `main`'s new head. The entry's `authorId` records who
ran the merge.

## 3. Drops are blocked on dependents, not cascaded

`dropColumn` and `dropTable` are rejected at edit time when a dependent exists: an index,
unique, primary key, or foreign key on the column, or a foreign key from another table into
the table. The user removes the dependents first, as explicit operations.

**Why.** One operation should represent one intent. A cascading drop records a single
`dropColumn` that silently also removed two indexes and a foreign key, which makes the history
misleading and undo ambiguous. It also multiplies what the merge engine has to reconcile: a
cascaded drop on one branch interacts with every dependent the other branch might have
touched. Blocking keeps preconditions simple and every operation independently meaningful.

**Considered and rejected.** Auto-cascade and record the cascaded drops as extra log entries.
More convenient in the editor, but the cost of the wider conflict set lands in the merge
engine.

**Consequences.** The editor has to surface why a drop is blocked and what to remove. Drop
payloads carrying the full object are enough for undo precisely because a blocked drop has no
dependents that also need restoring.

## 4. Identity is a username with no authentication

V0 has a landing screen that takes a username and nothing else. An unknown username creates a
new user in the single seeded organisation. A known one resumes as that user. There is no
password, no session token, no permission check. The current user id is held client-side and
trusted by the server.

**Why.** The target customer is a team, and the three-way merge story is only legible with
named people on each side of a merge request. Grace renamed the column, Ada added the index.
Modelling `User` and `Organization` and stamping `authorId` on every operation is what makes
the tool read as a team product rather than a library demo, which is the deliberate
above-and-beyond signal for this submission. Full authentication is out of proportion to a
20-hour take-home and adds nothing to the hard problem.

**Considered and rejected.** No users at all: merge requests have no author and the demo
narrative collapses. Real authentication with passwords or OAuth: the cost is far more than
the value here.

**Consequences.** Impersonation is trivial, and it is a documented non-goal rather than a bug.
Usernames are stored unauthenticated and the table can be spammed. An optional cap is a
stretch nicety. `engine/` never imports the user types, so the merge engine has no concept of
a user. The `users` and `organizations` tables and the create-or-resume endpoint are owned by
ticket 0004. Seeding one organisation and three users is owned by ticket 0005.

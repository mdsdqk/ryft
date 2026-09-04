# ADR 0002 — The semantic three-way merge engine

Status: accepted as a design freeze. `engine/diff.ts` and `engine/apply.ts` are implemented;
`classify` and `threeWayMerge` are specified here and in `docs/merge-engine.md` but not yet
written. This ADR records the design, not a shipped implementation.

The load-bearing modelling calls made while designing the semantic three-way merge — the
headline artifact of the submission. One section per call. `docs/merge-engine.md` is the
full algorithm write-up; `decisions.log.md` is the fine-grained running log (`decisions.md` is
the curated record). This is the structured companion a reviewer reads for context,
alternatives, and consequences. It
builds directly on ADR 0001 (stable ids; the operation log is audit + undo only).

## 1. The merge builds `merged` by replaying a derived delta, not by a field-walk

`threeWayMerge(base, ours, theirs)` computes two derived deltas —
`Δ_ours = diffSnapshots(base, ours)` and `Δ_theirs = diffSnapshots(base, theirs)` — classifies
them (§5), then, if nothing conflicts, produces the result as
`merged = applyDelta(Δ_merge, theirs)`, where `Δ_merge` is the non-conflicting subset of
`Δ_ours`. The very same `applyDelta` runs inside the commutativity post-condition. If any
conflict is unresolved the call returns `merged: null` — the engine never hands back a
document it will not stand behind.

**Why.** The commutativity check is defined in terms of `apply(Δ, doc)` in both orders, so an
`applyDelta` and a delta representation have to exist no matter how `merged` is built. Given
that, letting `applyDelta` also *produce* `merged` means one code path instead of two: the
thing that computes the result is the thing the oracle verifies, so they cannot silently
drift. Rename-rebase and dependency ordering each get solved in exactly one place. The
derived delta is also a reusable artifact — it is what the merge-review screen renders as
"what this merge will do".

**Considered and rejected.** A direct three-way field merge: walk the union of object ids,
merge each field of each object in place, assemble `merged` from the per-field decisions.
It reads clearly, but it still needs `applyDelta` for the oracle, so it is *more* code, not
less, and it splits the result down two paths that must agree. Dependency ordering also has
to be bolted on separately because a field-walk only sees one object at a time.

**Consequences.** `diffSnapshots` has to be solid — it is the single source of edit history
for the merge. Stable ids make it a state comparison rather than a rename-guessing exercise
(ADR 0001 §1), which is what makes this option viable at all. The merge never reads a
branch's recorded `LogEntry[]`; it reconstructs an `Operation[]` from snapshots. ADR 0001 §2
is intact — that decision is about the recorded log, not the vocabulary.

## 2. One `Operation` vocabulary, owned by the engine

The vocabulary of a single schema edit — `Operation` — lives in `engine/operations.ts`,
which imports only `engine/schema.ts`. Both callers import it from there: the merge engine
(as a derived `Operation[]`) and `src/domain/operations.ts` (wrapped in a `LogEntry`
envelope with `seq` / `at` / `authorId`, plus a domain-only `merge` audit marker).

**Why.** The alternative that ADR 0001 left implied — the engine keeps its own delta type,
the domain keeps its own operation type — is two shapes for the same concept. They would
drift, and the drift would land as divergent logic between "what the editor recorded" and
"what the merge replays". Sharing one type from the engine keeps the dependency direction
correct (`src/domain` → `engine`, never the reverse) and adds nothing framework-shaped to
the engine, which still has zero runtime dependencies.

**Considered and rejected.** Reusing the domain's `Operation` from the engine: inverts the
dependency direction. Maintaining two vocabularies with a mapping layer between them: the
mapping is exactly the drift surface we are trying to remove.

**Consequences.** ADR 0001's shipped `src/domain/operations.ts` was rewritten to re-export
from the engine. The move also closed two gaps in 0001's vocabulary that the merge exposed:
there was no primary-key operation at all, and index / unique / foreign-key edits were
modelled as drop + add, which destroys the id a redefinition needs to keep. Both are fixed
in the shared type (§3).

## 3. Redefinitions are replace-all and id-preserving; column attributes are granular

An index, unique, or foreign-key edit is one `changeIndex` / `changeUnique` /
`changeForeignKey` op carrying the whole old and new definition minus the id. A column edit
is one op per attribute: `renameColumn`, `retypeColumn`, `setNullable`, `setDefault`.

**Why.** A column's attributes are genuinely independent — a DBA changes `nullable` and
`default` for unrelated reasons at different times — so two sides touching different
attributes of one column should merge cleanly, which granular ops give for free. An index's
`columnIds` and `unique` flag are not independent: they *are* "the definition", `(a, b)` and
`(b, a)` are different indexes, and an index is cheap to drop and recreate so there is no
data-loss pressure to auto-merge a composite of two sides' partial edits. Treating the whole
definition as one atomic unit also gives a one-line conflict rule. Decisively: an `Index`
has no `name`, so "divergent index definition" is only ever detectable as *same id,
different definition* — which requires the id to survive a redefine, i.e. requires a
`change*` op rather than drop + add.

**Considered and rejected.** Field-granular index ops (`retargetIndex` + `setIndexUnique`):
buys a clean auto-merge for the near-nonexistent case of two people editing different knobs
of the same index against the same base, at the cost of silently emitting an index
definition neither author wrote or reviewed.

**Consequences.** `diffSnapshots` compares index / FK definitions structurally and emits a
single `change*` on any difference. A both-sides `change*` on one id is always either an
overlap (identical) or a divergent-definition conflict (class 4 for an index, class 7
otherwise) — never a partial merge.

## 4. Replay is four fixed phases, not a topological sort

`applyDelta` replays a delta in four phases: (A) `createTable` with FKs stripped off and
deferred, plus `renameTable`; (B) all intra-table edits; (C) `addForeignKey` /
`changeForeignKey` plus the deferred FKs; (D) drops in reverse dependency order
(`dropForeignKey` → constraint drops → `dropColumn` → `dropTable`).

**Why.** The dependency graph in scope is shallow — `table → column → {index, PK, unique,
FK}`, with the only cross-table edge being a foreign key (`CONTEXT.md` out-of-scope list
removes views, the one construct that would deepen it). A fixed phase order covers every
delta the engine can produce. The one hard case — a new table's FK pointing at another new
table — is dissolved by stripping FKs off `createTable` in phase A and replaying them in
phase C once every table and column exists. Within a phase, ops are order-independent
because references are held by id: a `renameColumn` and a dependent `addIndex` commute by
construction.

**Considered and rejected.** A general topological sort over a dependency graph built per
delta: correct, but more machinery than a three-level graph with one cross-table edge
needs, and the phase structure is easier to reason about and test.

**Consequences.** This replay order is for the merge and the oracle. The DDL *statement*
ordering (ticket 0003) is a separate consumer of the same dependency principle and is not
bound to these phases. If a later scope expansion adds views or check constraints, the phase
model has to be revisited.

## 5. The classifier is keyed pairing plus a cross-reference pass

`classify` runs two passes. **Pass 1** keys every op onto a slot `(key, aspect)` — an
identity slot (`(colId, "type")`, `(idxId, "definition")`, `(tableId, "presence")`, …) and,
for any op that sets a name, a name slot `(namespace, name)` — and pairs the two sides slot
by slot. This yields divergent retype, add-vs-add, rename-vs-rename, divergent index
definition, the catch-all, and overlap. **Pass 2** reconciles across slots: for every `drop*`
on one side it scans the other side for any op targeting that id (→ drop-vs-modify), and for
every op that survived pass 1 it resolves the ids that op *references* against the other
side's drops and un-followable renames (→ dependency conflict).

**Why.** Drop-vs-modify pairs a `presence` slot against a `name` (or `type`, …) slot on the
same id; dependency conflict relates an op on one object to a `drop*` on a different object.
Neither is a same-slot pairing. A single-pass per-slot classifier silently misses both — the
broken op would instead reach `applyDelta`, throw, and surface as an unclassified divergence,
turning two nameable, resolvable conflicts into a scary dead end. The name slot, keyed by
`(namespace, name)` rather than id, is what makes add-vs-add and rename-vs-rename detectable
when the two sides used different ids — two branches each creating a table called `audit`
never meet on an identity slot.

**Considered and rejected.** A full object-graph three-way merge (diff every object against
its two versions, walk a dependency DAG): more general than a three-level graph with one
cross-table edge needs, and it re-derives what the slot keys give directly. Relying on
`applyDelta` throwing to detect classes 5 and 6: loses the class, the severity, and the
resolution UX, and conflates a real conflict with an engine bug.

**Consequences.** The classifier is two ordered passes over the two deltas, not a fold. Slot
keys are strings built from ids and names, so classification is `O(ops)` with map lookups.
Every op type must declare which slots it occupies; a new op type that forgets its name slot
would reintroduce the duplicate-name hole, so the slot table in `docs/merge-engine.md` §2 is
part of the spec, not an illustration.

## 6. Seven conflict classes: six clear, one subtle, one of them a named catch-all

Divergent retype, add-vs-add, rename-vs-rename, divergent index definition, drop-vs-modify,
and dependency conflict came from `CONTEXT.md`. This ticket added the seventh,
**divergent definition**: a clear-severity catch-all for a both-sides change to the same
object and aspect that no specific rule matched (divergent `setDefault`, divergent primary
key, divergent `changeUnique`, divergent `changeForeignKey`). Six are clear; dependency
conflict is the one subtle class.

**Why.** Ticket 0002's own instruction: anything that maps to no class is a missing class.
Divergent default / PK / unique / FK edits are real and were unclassified. A named, queued
class carries a resolution UX (a branch picker) and an honest count in the conflict queue.
Leaving them to the commutativity oracle instead would surface them as "unclassified
divergence" — a vaguer, scarier verdict with no per-conflict resolution — and would blur the
one signal that verdict is meant to carry: *the enumeration itself has a hole*.

**Considered and rejected.** Stopping at six and letting commutativity catch the rest: makes
"unclassified divergence" a routine outcome for ordinary divergent-default edits, which
trains users to ignore it.

**Consequences.** The classifier has an explicit fall-through arm. "Unclassified divergence"
now means only what it should: the rule-based classes and the catch-all together still could
not explain a non-commutative merge. Two related calls sit under this class set:

- **Degenerate overlap.** Both sides `addColumn` with the same name *and a structurally
  identical definition* (type, nullability, default all equal) but different fresh ids is not
  add-vs-add — class 2 fires only when an attribute differs. It is auto-merged as an overlap:
  keep one id, drop the other side's `addColumn`, remap the loser's id in that side's later
  ops. Flagging it would force a choice with no user-visible difference. The cost — a silent
  id remap — is recorded in the report.
- **Rename-rebase's semantic boundary.** A dependent change that follows a rename by id can
  still be semantically broken — e.g. `ours` adds a foreign key onto a column `theirs`
  retyped to an incompatible type. The id resolves and DDL renders, but Postgres would
  reject it. The structural merge cannot see this. It is a documented boundary — *id
  resolution is not semantic validity* — and type-compatibility enforcement is deferred to
  ticket 0008 (validation and warnings). The merge engine does not block on it.

## 7. Commutativity is a runtime post-condition, not only a test invariant

Before returning `verdict: "clean"`, the engine verifies
`applyDelta(Δ_ours', applyDelta(Δ_theirs, base)) == applyDelta(Δ_theirs', applyDelta(Δ_ours, base)) == merged`
under an order-insensitive deep-equal (canonicalise object arrays by id; preserve column
order within an index or primary key). A failure sets `verdict: "unclassified-divergence"`
and blocks the merge, with a report carrying both diverging documents and an object-level
diff of them.

**Why.** The rule-based classes (§6) are only as complete as their enumeration.
Commutativity is the oracle that catches what the enumeration missed — it is a property, not
a pattern, so it holds regardless of which class was forgotten. Running it in the product
and not only in the test suite means the engine never *ships* a "clean" verdict it cannot
prove, which is the credibility claim the whole submission rests on. The stable-id model
actively shrinks the surface this has to police: with references held by id, "rename X" and
"add a dependent on X" commute by construction.

**What it does not do.** Commutativity tests *order-dependence*, not *order-independent
illegality*. Two concurrently created tables sharing a name, or a reference left dangling by
the merge, produce the same invalid document in either application order — all three
documents are equal and the check passes. Structural validity — every name unique in its
namespace, every reference resolving — is a separate pass, and it is ticket 0008's, run
against the candidate `merged`. The name slots in §5 catch the *concurrent* duplicate-name
case up front; 0008 is the backstop for the rest. This ADR should not be read as claiming the
oracle is a total correctness guarantee.

**Considered and rejected.** Commutativity as a test-only invariant: a forgotten class then
produces a silently wrong `merged` in production, and the test suite only catches the
scenarios someone thought to write.

**Consequences.** The merge does real work twice on every clean path (both application
orders, plus the direct composition). At the schema sizes in scope (`CONTEXT.md`: tens of
tables) this is negligible. `held-on-commutativity-failure` is a first-class material state
in the UI (shape brief §5): the status dial stops at `In check`, and the banner names the
diverging objects and says the merge is held because order-independence could not be proven
— it is an escalation, not a task the user can clear by picking a branch.

## 8. Resolutions are re-fed into a stateless merge, not accumulated inside it

`threeWayMerge(base, ours, theirs, resolutions?)` is pure. It holds no conflict state between
calls. The domain layer owns the loop: it persists each `Resolution` on the merge request
and calls `threeWayMerge` again from scratch with the full set, until the verdict comes back
`clean` and `merged` is non-null.

**Why.** The merge is meant to be run from an API handler, a CI check, or an agent, not only
from the review screen. A stateful engine that remembers "conflict 3 is resolved" needs a
session, an instance lifecycle, and a story for concurrent callers — all of which leak into
every consumer. A pure function that takes the resolutions as an argument has none of that:
the same call is reproducible, cacheable, and testable, and the merge queue re-running it
against a moved `main` (`decisions.log.md`) is just another call with the same resolutions.
Re-running the whole classification each time also means a resolution that changed shape
because `theirs` moved is detected — the conflict it referenced is simply no longer in the
report, and the domain layer drops the stale resolution with a notice.

**Considered and rejected.** A `Merge` object that accumulates resolutions and exposes
`resolve(conflictId, choice)` / `isComplete()` / `result()`: friendlier for one interactive
screen, hostile to every other caller, and it forces the engine to own persistence concerns
that belong to the merge request.

**Consequences.** Re-classifying from scratch on every resolution is `O(ops)` and trivial at
the sizes in scope. `Resolution` is a plain serialisable value keyed by `conflictId`, and
`conflictId` must be stable across re-runs for an unchanged conflict — the classifier derives
it from the conflict's class and the ids of the objects involved, not from iteration order.

# The semantic three-way merge — algorithm

Ticket 0002. The headline artifact of the submission: given three schema documents, compute
the merged document and a typed, machine-actionable conflict report — never an interactive
prompt, so the engine is usable from an API, an agent, or CI.

This is the algorithm write-up. `docs/adr/0002-semantic-merge-engine.md` is the structured
companion (one section per load-bearing call, with alternatives and consequences).
`decisions.log.md` carries the running narrative (`decisions.md` is the curated record).

Implemented so far in `engine/`: `diff.ts` (`diffSnapshots`) and `apply.ts` (`applyDelta`),
on top of 0001's `schema.ts` and `operations.ts`. Still to build: `classify.ts`, `merge.ts`
(`threeWayMerge`), and fixtures under `engine/__fixtures__/`. This document is the spec they
are written against.

---

## 0. Signature and pipeline

```ts
threeWayMerge(
  base:   SchemaDocument,   // common ancestor: the source branch's base snapshot
  ours:   SchemaDocument,   // the source branch's head
  theirs: SchemaDocument,   // the target branch's head at merge-request creation
  resolutions?: Resolution[],
): { merged: SchemaDocument | null; report: MergeReport }
```

`merged` is non-null **iff** `report.verdict === "clean"` — which includes the case where the
call was made with `resolutions` that settle every conflict and the re-run comes back clean.
A `conflicts` or `unclassified-divergence` verdict returns `merged: null`; the engine never
hands back a document it will not stand behind (§3, §10).

`threeWayMerge` is **pure and stateless**. It holds no conflict state between calls. The
resolution loop lives in the domain layer: it stores each `Resolution` on the merge request
and calls `threeWayMerge` again from scratch with the full set. This is what keeps the engine
usable from an API, an agent, or CI unchanged (ADR 0002 §7).

No operation logs are consulted (ADR 0001 §2). Object identity is carried by the stable ids
in the snapshots. The pipeline:

```
        diffSnapshots(base, ours)   ─▶  Δ_ours
        diffSnapshots(base, theirs) ─▶  Δ_theirs
                                          │
                    classify(Δ_ours, Δ_theirs, resolutions)
                                          │
              ┌───────────────┬───────────┴────────────┬───────────────┐
           conflicts       rebased                  overlaps     Δ_merge (ops to
        (Zone B queue)  (success wash)          (informational)   replay onto theirs)
                  │                                       │
      any conflict unresolved?                     none unresolved
                  │                                       │
      verdict = "conflicts"                  merged = applyDelta(Δ_merge, theirs)
      merged  = null                                      │
      (return here)                          commutativity post-condition
                                                          │
                              verdict ∈ { clean, unclassified-divergence }
```

---

## 1. Deriving deltas — `diffSnapshots(base, head)`

Implemented in `engine/diff.ts`. Matches objects **by id** at every level (table, column,
primary key, index, unique, foreign key):

| Level | head-only | base-only | in both, differs |
|---|---|---|---|
| Table | `createTable` (full object) | `dropTable` (full object) | name → `renameTable`; recurse |
| Column | `addColumn` | `dropColumn` | one op per differing attribute: `renameColumn` / `retypeColumn` / `setNullable` / `setDefault` |
| Primary key | `addPrimaryKey` | `dropPrimaryKey` | same id, cols differ → `changePrimaryKey`; different id → `dropPrimaryKey` + `addPrimaryKey` (a **replacement** — see §2 and §3) |
| Index | `addIndex` | `dropIndex` | `columnIds` (ordered) or `unique` differ → `changeIndex` (replace-all) |
| Unique | `addUnique` | `dropUnique` | `columnIds` as a **set** differ → `changeUnique` |
| Foreign key | `addForeignKey` | `dropForeignKey` | any of `columnIds` / `refTableId` / `refColumnIds` / `onDelete` differ → `changeForeignKey` (replace-all) |

The delta vocabulary is `Operation` from `engine/operations.ts` — the *same* vocabulary the
structured editor's log uses, owned by the engine and imported by `src/domain`. The merge
consumes a **derived** `Operation[]`, never a branch's recorded `LogEntry[]`.

Emission order is fixed and deterministic (head table order; per table: rename, columns, PK,
indexes, uniques, FKs; table drops last). It is **not** dependency-ordered — `applyDelta`
owns the topological concern.

Column attributes get one op each because they are independent axes: two sides touching
different attributes of one column merge cleanly. Index / unique / FK redefinition is a
single id-preserving `change*` op carrying the whole new definition ("replace-all"), because
`(a, b) → (b, a)` and a `unique` flip are one atomic change to "the definition", and because
an `Index` has no `name` — the only way "divergent index definition" is ever detectable is
*same id, different definition*.

---

## 2. Classification — keyed pairing, then a cross-reference pass

`classify` runs in **two passes**. Pass 1 pairs ops that touch the same slot. Pass 2
reconciles across slots — it is what catches drop-vs-modify and dependency conflict, neither
of which is a same-slot pairing. A purely per-slot classifier would miss classes 5 and 6.

### Slots

A **slot** is `(key, aspect)`. An op occupies one or two:

| Op | Identity slot | Name slot |
|---|---|---|
| `createTable` | `(tableId, "presence")` | `(name, "table-name")` |
| `dropTable` | `(tableId, "presence")` | — |
| `renameTable` | `(tableId, "name")` | `(to, "table-name")` |
| `addColumn` | `(colId, "presence")` | `(tableId + "::" + name, "column-name")` |
| `dropColumn` | `(colId, "presence")` | — |
| `renameColumn` | `(colId, "name")` | `(tableId + "::" + to, "column-name")` |
| `retypeColumn` | `(colId, "type")` | — |
| `setNullable` | `(colId, "nullable")` | — |
| `setDefault` | `(colId, "default")` | — |
| `addPrimaryKey` | `(tableId, "primaryKey-presence")` | — |
| `dropPrimaryKey` | `(tableId, "primaryKey-presence")` | — |
| `changePrimaryKey` | `(tableId, "primaryKey-definition")` | — |
| `addIndex` / `dropIndex` | `(idxId, "presence")` | — |
| `changeIndex` | `(idxId, "definition")` | — |
| `addUnique` / `dropUnique` | `(uqId, "presence")` | — |
| `changeUnique` | `(uqId, "definition")` | — |
| `addForeignKey` / `dropForeignKey` | `(fkId, "presence")` | — |
| `changeForeignKey` | `(fkId, "definition")` | — |

Every op declares exactly which slots it occupies; add/drop take the `"presence"` slot,
`change*` takes the `"definition"` slot. The document is a single namespace, so table names
key on the bare name — `SchemaDocument.database` is a display label and never an identity key
(`engine/schema.ts`). Column names key on `tableId + "::" + name` because the table is their
namespace.

The **name slot** is keyed by `(namespace, name)`, separate from identity. It is what makes
add-vs-add and rename-vs-rename detectable across *different ids* — two branches each creating
a table called `audit`, or each renaming a column to `slug`, collide on the name slot even
though their identity slots never meet.

**A one-side PK replacement** (`dropPrimaryKey` + `addPrimaryKey` from `diffSnapshots` when
the PK id differs, §1) puts two ops from one side on `(tableId, "primaryKey-presence")`. Pass 1
treats a same-side `{drop, add}` pair on that slot as a single unit whose payload is the new
`PrimaryKey`. One side only → it flows into `Δ_merge` as both ops (`applyDelta` runs the drop
before the add, §3). Both sides replace the PK with different definitions → **class 7** on
`(tableId, "primaryKey-presence")`.

### Pass 1 — keyed pairing

For every slot, look at which sides populate it:

- **one side only** → the op is non-conflicting; if it is an `ours` op it is a candidate for
  `Δ_merge` (pass 2 may still reject it)
- **both sides, payloads structurally equal** (the `to` value, or the added object minus its
  id) → **overlap** (§6): already in `theirs`, dropped from `Δ_merge`, recorded
- **both sides, payloads differ** → **conflict**, class from the aspect:
  - `(colId, "type")` → class 1
  - `(colId, "name")` → class 3; `(tableId, "name")` → class 3
  - `(idxId, "definition")` → class 4
  - `(uqId, "definition")`, `(fkId, "definition")`, `(tableId, "primaryKey-definition")`,
    `(tableId, "primaryKey-presence")` replacement, `(colId, "default")` → class 7
  - a **name-slot** collision → class 2 when both sides *create/add* the object
    (`createTable` vs `createTable`, `addColumn` vs `addColumn`); class 3 when at least one
    side *renames* into the name (`renameColumn` vs `renameColumn`, `renameTable` vs
    `renameTable`, or a rename vs an add landing on the same name)

Per-id status is read off the identity slots: **unchanged** (neither side), **changed-on-ours**
/ **changed-on-theirs** (one), **changed-on-both** (both), **dropped-on-one-side**
(`"presence"` with a `drop*` on one side), **added-on-one-side** (`"presence"` with an
add/create on one side).

Independent edits to the same table land on different slots and are never paired — the
**false conflict** case (§6), handled by construction.

### Pass 2 — cross-reference over the identity slots

Pass 2 skips any object that already carries a pass-1 conflict — a slot pairing that pass 1
resolved (as a conflict or an overlap) is settled and is not re-examined here. This is the
precedence rule: pass 1 wins.

The class 5 / class 6 discriminator is **subject vs reference**. An op's *subject* is the
object it creates, drops, renames, retypes, or redefines. Its *references* are the other ids
it names (`refTableId`, `columnIds` / `refColumnIds` members, index / FK / PK member columns).

- **Drop-vs-modify (class 5).** For every `drop*` on one side, scan the *other* side for an
  op whose **subject** is that same id, or a child of it (a column, index, unique, FK, or PK
  of a dropped table). A hit is a drop-vs-modify conflict. A rename counts as a modify.
- **Dependency conflict (class 6).** For every op that survived pass 1 as a `Δ_merge`
  candidate, check the ids it **references**. If a referenced id was `drop*`-ed on the other
  side, the candidate is dependency-broken: it is pulled from `Δ_merge` and raised as a
  class 6 conflict. Class 6 is drop-only — a referenced id the other side *renamed* still
  exists (references are held by id, §4), so the op applies verbatim and is recorded as a
  `rebased` change. Pass 2 is where that is confirmed rather than assumed.

---

## 3. Composition

Composition runs **only when pass 1 and pass 2 found no conflict**, or when every conflict
they found is settled by a supplied `Resolution`. Otherwise `threeWayMerge` returns
`merged: null` and a `conflicts` verdict — the report's per-conflict `base` / `ours` /
`theirs` payloads (§10) are everything the merge-review screen needs to render Zones A and B,
and a Zone D preview, if shown, is a separate explicitly-provisional call, not this output.

When it does run: `merged = applyDelta(Δ_merge, theirs)` where `Δ_merge` is the
non-conflicting, non-overlapping subset of `Δ_ours`, plus any ops synthesised by a resolution
(§9).

Onto `theirs` and not `base`, because `theirs` is the live target the merge request lands on,
it already contains `Δ_theirs`, and the merge queue re-runs the whole computation against
`theirs` = `main`'s head at the moment the request reaches the front (see `decisions.log.md`).
Replaying only `Δ_ours`'s independent ops is the minimal delta.

`applyDelta` (`engine/apply.ts`) never mutates its input and replays in four phases — a fixed
order, not a general topological sort, because the dependency graph is shallow
(`table → column → {index, PK, unique, FK}`, cross-table only via FK):

1. **A** — `createTable` (with its FKs stripped off and deferred), `renameTable`
2. **A2** — `dropPrimaryKey`, before B — so a one-side PK replacement
   (`dropPrimaryKey` + `addPrimaryKey` in one delta) does not trip "table already has a
   primary key". Safe for a plain PK drop too: a PK has no dependents to tear down after.
3. **B** — every intra-table edit: column add/rename/retype/nullable/default, PK add/change,
   index add/change, unique add/change
4. **C** — `addForeignKey` / `changeForeignKey`, plus the FKs deferred from phase A
5. **D** (reverse) — `dropForeignKey`, then `dropIndex` / `dropUnique`, then `dropColumn`,
   then `dropTable`

The FK-strip in A dissolves "new table A's FK references new table B" without ordering the
creates. Within a phase, ops are order-independent by construction: a `renameColumn` and a
dependent `addIndex` commute because the index holds the column's **id**, not its name.

---

## 4. Rename-rebase — where it falls out, and where it doesn't

**Falls out for free.** `Δ_ours` renames `col_email`; `Δ_theirs` adds a unique index whose
`columnIds` is `[col_email]`. Different slots (`(col_email, "name")` vs
`(idx, "definition")`) — no pairing, both apply. The index references `col_email` by id,
which still exists after the rename; the DDL renderer resolves it to the *current* name
(`email_address`) at emit time. This is the `contact-fields` worked example
(`examples/branched.*`), loaded as `ours` in the merge fixtures with a target branch that
adds the index. Nothing is rebased in the git sense — the op applies verbatim; it *stays*
resolved because identity is an id.

It is surfaced in the report as a **`rebased`** entry ("index followed rename
`email` → `email_address`") for the faint-success-wash UX, but the engine performs no
transformation.

**Where it does not hold:**

| Situation | Outcome |
|---|---|
| `theirs` **drops** `col_email` (not renames), `ours` adds a dependent on it | Not a rebase — **dependency conflict** (class 6). Correct: there is no id to follow. |
| Both sides rename `col_email` to different names | **rename-vs-rename** (class 3). The id survives, but there are two candidate names. |
| `ours` adds an FK whose `refColumnIds` includes `col_x`; `theirs` retypes `col_x` to an incompatible type | Structurally clean — the id resolves, DDL renders — but Postgres would reject the FK. **Known boundary: id resolution ≠ semantic validity.** The structural merge cannot see it. Type-compatibility enforcement is deferred to ticket 0008 (validation & warnings); the merge engine does not block on it. |

---

## 5. Conflict taxonomy — seven classes

Severity vocabulary is PlanetScale's (`CONTEXT.md`): **clear** = both sides changed the same
thing incompatibly; **subtle** = individually valid, combined result is order-dependent.

| # | Class | Severity | Detection rule | Resolution modes |
|---|---|---|---|---|
| 1 | **Divergent retype** | clear | both sides emit an op on slot `(colId, "type")`, `to` types not structurally equal | take ours · take theirs · **explicit type T** |
| 2 | **Add-vs-add** | clear | both sides create an object of the same name in one namespace — two `addColumn` colliding on `(tableId::name, "column-name")`, or two `createTable` colliding on `(name, "table-name")`. For columns, identical definitions minus id → overlap (§6); for tables, a name collision is always a conflict (§6) | `choice: "ours"` · `choice: "theirs"` — keep the chosen object and its id; drop the other side's create/add and remap the loser's id in that side's later ops |
| 3 | **Rename-vs-rename** | clear | both sides emit a rename on the same identity slot `(colId, "name")` or `(tableId, "name")` with differing `to`; **or** two renames (or a rename and an add) collide on one name slot, so two objects would carry one name | take ours (`choice: "ours"`) · take theirs (`choice: "theirs"`) — for a name-slot collision this also disposes of the losing object: a losing rename reverts to its base name, a losing add is dropped |
| 4 | **Divergent index definition** | clear | both sides emit an op on slot `(idxId, "definition")`, `to` definitions differ — **includes column-order divergence** `(a, b)` vs `(b, a)` | take ours · take theirs |
| 5 | **Drop-vs-modify** | clear | one side `drop*`s an id (or a dropped table's child); the other side has an op whose **subject** is that id (§2 pass 2). A rename counts as a modify | `choice: "ours"` · `choice: "theirs"` — keeps that side's ops for the object and discards the other side's, so whichever side dropped it either wins (object gone) or loses (object kept with the modifications) |
| 6 | **Dependency conflict** | subtle | a non-conflicting `ours` op **references** an id (`refTableId`, a `columnIds` / `refColumnIds` member, an index / FK / PK member) that `Δ_theirs` `drop*`-ed (§2 pass 2). Drop-only | `choice: "theirs"` — drop the dependent op. `choice: "ours"` (V1 cut) — also emit the inverse of theirs' drop. Else manual |
| 7 | **Divergent definition** | clear | catch-all: both sides change the same slot to different values and no rule 1–5 matched — covers `(colId, "default")`, `(tableId, "primaryKey-definition")`, a both-sides `(tableId, "primaryKey-presence")` replacement, `(uqId, "definition")`, `(fkId, "definition")` | take ours · take theirs |

Class 7 exists so nothing that diverges maps to *nowhere*. It is deliberately named and
queued rather than left to the commutativity oracle (§8): a named class carries a
resolution UX; "unclassified divergence" is reserved for a genuine bug in the enumeration.

`setNullable` cannot produce a divergent conflict — `nullable` is boolean and, relative to a
fixed `base`, both sides can only flip it the same direction, so a both-sides `setNullable`
is always an overlap.

---

## 6. Three non-conflicts, handled explicitly

### Overlap

Both sides make the identical change to the same slot. Detection rule (new — had none
anywhere): for a slot populated on both sides, canonicalise each side's op payload (its `to`
value, or the added object minus its id) and compare structurally. Equal → overlap: the
change is already in `theirs`, so it is dropped from `Δ_merge` and recorded as an
informational note. The merge proceeds silently.

**Degenerate overlap is `addColumn`-only.** Two branches each add
`phone varchar(30) NOT NULL DEFAULT ''` to the same table, with different fresh ids. The whole
column definition matches once the id is set aside — so it is *not* add-vs-add (class 2 fires
only when an attribute differs). Treated as an overlap: keep `theirs`' column and its id, drop
`ours`' `addColumn`, and **remap** every reference to `ours`' id (in later `ours` ops) to
`theirs`' id before composing. The cost is a silent id remap, recorded in the report as a
`remap`. If any column attribute differs (`nullable`, `default`, type), it is class 2.

**`createTable` is never a degenerate overlap.** Two branches independently creating a table
of the same name mint fresh ids for the table *and every nested column, PK, index, and FK*,
so a structural "identical minus id" comparison would almost never match and the id-remap
would have to rewrite a whole id graph. Not worth it: a `(name, "table-name")` collision
between two `createTable` ops is **always class 2**, resolved by picking one side's table
whole. Identical-shape parallel creates are the price.

### False conflict

Independent edits to the same table (or to unrelated objects) that a text merge would
collide on. Handled by construction: they land on different slots, so `classify` never pairs
them. The `merged` document contains both.

### Positional order

There is **no standalone ordering-conflict class**. Per `CONTEXT.md`'s three-way split:

- **Positional order** — a column's ordinal position in its table. Inexpressible in
  Postgres (no `ADD COLUMN ... AFTER`, no reorder). Two branches cannot hold competing
  intent about it. Dissolved — no class, no detection.
- **Dependency order** — a change presupposing an object the other side removed/renamed.
  Real, and survives as **dependency conflict** (class 6).
- **Column order within a composite index or primary key** — `(a, b) ≠ (b, a)`, fully
  significant. A divergence here is **divergent index definition** (class 4) for an index,
  or **divergent definition** (class 7) for a primary key. Must not be swept up by the
  first bullet.

---

## 7. Class mapping — ticket 0000's proposed taxonomy

Ticket 0000's findings proposed a longer list. Every entry lands somewhere; nothing is
silently dropped.

| 0000's proposed class | Lands at | Note |
|---|---|---|
| Rename/rename conflict | **Class 3** (rename-vs-rename) | 1:1 |
| Rename/delete conflict | **Class 5** (drop-vs-modify) | one side `drop*`s `colId`, the other renames it — pass 2 relates the drop to the rename whose *subject* is that id; a rename is a modify |
| Rename/modify conflict | **Not a conflict** — the rename-rebase clean case (§4): different slots, both apply, id-held refs resolve. Becomes **class 3** only if the "modify" is *also* a rename. |
| Dependency conflict | **Class 6** | 1:1 |
| Ordering conflict | **Dissolved** (positional) / **class 6** (dependency order) / **class 4** (within-index column order) | the three-way split, §6 |
| Prisma *schema drift* | **Not a merge-conflict class** | it is the pre-merge dry-run and post-apply introspection check (PlanetScale's shadow branch) — a separate mechanism, out of `classify` |
| Prisma *migration history conflict* / op-log divergence | **Not applicable** | the merge reconciles replayed end states, not op sequences (ADR 0001 §2); there is no authored migration artifact to diverge from |
| Django / Alembic *multiple leaf nodes* | **Not applicable** | that is the structural fact of divergence itself — here it is simply "an open merge request exists"; there is no migration graph with leaves to reconcile |

Nothing maps to nowhere. If a future scenario does, it is a missing class — and the
commutativity oracle (§8) catches it in the meantime *when the divergence is
order-dependent*. An order-independent hole (a merge that is stable but produces an invalid
document) is caught instead by 0008's structural-validity pass, not here.

---

## 8. Commutativity post-condition

Before `threeWayMerge` returns `verdict: "clean"` it applies the two **effective** deltas —
`Δ_ours'` = `mergeDelta` (ours minus overlaps and conflicted objects, plus resolution ops)
and `Δ_theirs'` = `deltaTheirs` minus the `theirs` op of every conflict a resolution let
`ours` (or an explicit type) win — to `base` in both orders:

```
merged = applyDelta(Δ_ours',   applyDelta(Δ_theirs', base))   // theirs' then ours'
other  = applyDelta(Δ_theirs', applyDelta(Δ_ours',   base))   // ours' then theirs'
clean  ⟺  merged == other
```

`merged` is *taken as* one order; the check is that the other order agrees. With no
resolutions `Δ_theirs'` === `deltaTheirs`, so `merged` matches the §3 "compose onto `theirs`"
definition. The symmetric pruning of `Δ_theirs'` is what stops a resolution that discards a
`theirs` op (take-ours, explicit-type) from re-applying that op in one order and spuriously
failing.

Equality is an **order-insensitive deep-equal**: canonicalise by sorting `tables` by id, each
table's `columns` / `indexes` / `uniques` / `foreignKeys` by id, and a recursive key sort,
before comparing — two application orders legitimately produce different array orderings.
Column order *within* an index / PK is preserved (significant); column order within a table is
canonicalised away (not significant).

The seven classes (§5) are only as complete as their enumeration. This check is the oracle
that catches what the enumeration missed: if the two orders disagree, the engine emits
`verdict: "unclassified-divergence"` and the merge is **blocked**. It never claims a clean
merge it cannot prove.

A `DeltaApplyError` thrown by any of the three `applyDelta` calls here — or by the composition
call in §3 — is caught and reported the same way: `verdict: "unclassified-divergence"`,
`merged: null`. A delta that will not replay is, for the caller, indistinguishable from a hole
in the enumeration, and gets the same escalation.

**What it does not catch.** Commutativity is a test for *order-dependence*, not for
*order-independent illegality*. Two `createTable` ops named `audit` with different ids
produce the same two-tables-one-name document in either application order — all three
documents are equal, the check passes, and the result is still invalid. Duplicate names
within a namespace, and references left dangling by the merge, are **structural-validity**
failures, not commutativity failures. That pass — every name unique in its namespace, every
`refTableId` / `columnIds` / index member resolving — is ticket 0008's, and it runs after the
merge produces a candidate `merged`. The name slots in §2 catch the *concurrent* creation of
a duplicate name; 0008's pass is the backstop for everything else.

**Failure report shape.**

```ts
interface UnclassifiedDivergence {
  kind: "unclassified-divergence";
  reason: "non-commutative" | "apply-error";
  detail: string;
  // tables whose canonical state differs between the two application orders
  divergingObjects: Array<{ kind: ObjectKind; id: string; table?: string }>;
}
```

**What the UI does with it.** The `held-on-commutativity-failure` material state from the
shape brief: the status dial stops at `In check`, Zone B shows no resolvable queue, and a
banner names the diverging objects and states plainly that the merge is held because the
engine could not prove the result is order-independent — not that the user's branch is
invalid. It is an escalation, not a task.

---

## 9. Resolution semantics

A `Resolution` is a recorded choice that settles one conflict. It is stored on the merge
request (domain layer), and re-fed to `threeWayMerge` as `resolutions`. The merge cannot
complete while any conflict is unresolved.

```ts
type Resolution =
  | { conflictId: string; choice: "ours" }
  | { conflictId: string; choice: "theirs" }
  | { conflictId: string; choice: "type"; type: ColumnType }   // divergent retype only
```

Every class resolves with `choice: "ours"` or `choice: "theirs"`; class 1 additionally
accepts `choice: "type"`. "Ours" / "theirs" name a **side**. When `ours` (or `type`) wins,
the classifier both adds `ours`' intent to `Δ_merge` *and* prunes the losing `theirs` op from
`Δ_theirs'` (§8) — no explicit "revert theirs" op is emitted. A `choice` not in the
conflict's `resolutionModes`, or on a conflict the spike holds, counts as unresolved so the
domain loop surfaces it.

| Class | `choice` | how it produces `merged` | spike |
|---|---|---|---|
| 1 Divergent retype | `ours` \| `theirs` \| `type` | `theirs`: nothing (its retype stays in `Δ_theirs'`). `ours` / `type`: `retypeColumn(colId → chosen)` into `Δ_merge`; theirs' retype pruned | complete |
| 2 Add-vs-add | `ours` \| `theirs` | keep the chosen side's `createTable` / `addColumn`; dispose of the loser (drop the added object, remap its id) | **held as unresolved** — name-slot disposal across two distinct objects is a V1 cut |
| 3 Rename-vs-rename | `ours` \| `theirs` | identity-slot form: `ours` → put ours' `rename*` into `Δ_merge`, theirs' pruned; `theirs` → nothing | identity-slot form complete; **name-collision form held as unresolved** |
| 4 Divergent index definition | `ours` \| `theirs` | `ours` → ours' `changeIndex` into `Δ_merge`, theirs' pruned; `theirs` → nothing | complete |
| 5 Drop-vs-modify | `ours` \| `theirs` | `ours` → carry every `ours` op for the object into `Δ_merge`; theirs' op for the object pruned from `Δ_theirs'`. `theirs` → nothing (ours' ops already removed) | complete |
| 6 Dependency conflict | `theirs` | omit the dependency-broken op. `ours` (revert) is a **V1 cut** — not an accepted mode | `theirs` complete |
| 7 Divergent definition | `ours` \| `theirs` | `ours` → chosen side's `change*` into `Δ_merge`, theirs' pruned. PK divergence (`kind: "primaryKey"`) is **held as unresolved** in the spike | non-PK complete |

The commutativity post-condition (§8) runs on the resolved (`Δ_merge`, `Δ_theirs'`) pair. A
resolution whose result is non-commutative re-raises `unclassified-divergence`.

**V1 UI scope** (`CONTEXT.md`): a full resolution UI for **divergent retype** (the three-way
picker with an explicit-type field) and the **rename-rebase** presentation (showing a
dependent change followed a rename, on the success wash). Classes 2–7 surface as
"manual — pick a branch" (a bare ours/theirs picker) or are listed as an explicit cut for
the submission. Class 6's take-ours (revert) path is a cut for V1.

---

## 10. The report

```ts
type MergeVerdict = "clean" | "conflicts" | "unclassified-divergence";

interface MergeReport {
  verdict: MergeVerdict;
  conflicts: Conflict[];       // Zone B queue; empty unless verdict === "conflicts"
  rebased: RebasedChange[];    // dependents that followed a rename — success wash, never queued
  overlaps: OverlapNote[];     // identical changes applied once — informational
  remaps: IdRemap[];           // degenerate-overlap id rewrites — informational
  divergence?: UnclassifiedDivergence;   // set iff verdict === "unclassified-divergence"
}

interface Conflict {
  id: string;                  // stable within a report; the key a Resolution references
  class: ConflictClass;        // 1..7 above
  severity: "clear" | "subtle";
  object: { kind: ObjectKind; id: string; table?: string };
  base:   unknown | null;      // the value at the ancestor (payload shape depends on class)
  ours:   unknown | null;
  theirs: unknown | null;
  resolutionModes: ResolutionMode[];
}

interface RebasedChange {
  op: Operation;                       // the dependent op, applied verbatim
  followedRename: { objectId: string; from: string; to: string };
}
```

The report is data, not a prompt. It is the same object whether the caller is the merge-
review screen, a CI check, or an agent. A `clean` verdict carries empty `conflicts` and a
possibly non-empty `rebased` / `overlaps` / `remaps`, and the sibling `merged` document is
non-null. A `conflicts` or `unclassified-divergence` verdict returns `merged: null` (§3): the
caller resolves conflicts by storing `Resolution`s and calling `threeWayMerge` again with the
full set until it comes back `clean`.

# ADR 0004 — Backend contract: persistence model and Hono API surface

Status: accepted (design lock). No code ships with this ticket — the Drizzle schema and the
endpoint table are a contract for the API/persistence out-of-band track and the `web/src/data/`
seam to build against. `docs/backend-contract.md` is the full companion: the Drizzle schema
listing and the endpoint table with request/response shapes. `decisions.md` carries the
narrative.

Builds on ADR 0001 (stable synthetic ids; the schema document; users/orgs modelled without
auth; drops blocked on dependents), ADR 0002 (`threeWayMerge`, the seven conflict classes,
`Resolution`, the commutativity oracle) and ADR 0003 (`emitMigration(source, target)`).

The load-bearing calls, one section each.

## 1. Schema states are stored as `jsonb`, not normalized into rows

Every schema state — a branch's `head`, a branch's `base_snapshot`, and a merge request's
frozen `base` / `ours` / `theirs` — is one `jsonb` column holding a `SchemaDocument`
(`engine/schema.ts`). There is no `tables` / `columns` / `indexes` table.

**Why.** The engine only ever consumes a whole `SchemaDocument` and clones it wholesale
(`structuredClone`); it never queries inside one. `decisions.md` ("The model is state-based,
with no commit graph") already committed to storing states whole rather than a chain of
deltas. The out-of-scope list keeps the object graph shallow
(`table → column → {index, FK, PK, unique}`, cross-table only via FK), so a document is
kilobytes. Normalizing would rebuild that tree on every read and create a second
representation that can drift from `engine/schema.ts` — the same drift argument ADR 0002 §1
and ADR 0003 §2 make for derived deltas and the DDL IR.

**Considered and rejected.** A normalized relational schema for the schema objects
themselves. It buys SQL-level queries over schema contents ("which branches have a `users`
table") that nothing in the slice needs, at the cost of a mapping layer that must stay in
lockstep with the engine's types.

**Consequences.** Postgres cannot index or constrain schema contents. Uniqueness of object
ids, referential soundness of FK/index members, and every other structural invariant are the
engine's job (ADR 0002 §"unclassified divergence"; ticket 0008), never a database
constraint. A `jsonb` column also means no column-level migration when `engine/schema.ts`
gains a field — the shape is versioned by the engine, not by Drizzle.

## 2. Table inventory

Six tables. `organizations` and `users` are ADR 0001's deferred primitives, verbatim from
`src/domain/users.ts`. `branches`, `operations`, `merge_requests`,
`merge_request_resolutions` are new.

```
organizations   id · name · created_at
users           id · org_id → organizations · username (unique) · display_name · created_at
branches        name (pk) · org_id → organizations · author_id → users · created_at
                head            jsonb  -- current SchemaDocument
                base_snapshot   jsonb  -- SchemaDocument at cut time; id-preserving copy
                head_version    int    -- bumped on every head write; staleness display
operations      branch_name → branches · seq · at · author_id → users · op jsonb
                pk (branch_name, seq)          -- LogEntry; History sub-sheet + undo
merge_requests  id (pk) · source_branch → branches · target_branch → branches
                author_id → users · status · created_at · merged_at (null until merged)
                base jsonb · ours jsonb · theirs jsonb    -- frozen; see §5
                previewed_main_version int
merge_request_resolutions
                mr_id → merge_requests · conflict_id · choice · payload jsonb (null)
                conflict_snapshot jsonb · saved_by → users · saved_at
                pk (mr_id, conflict_id)
```

**Why these and not the ticket's list verbatim.** Three reconciliations against decisions
made after ticket 0004 was written:

1. **No "base operation-log reference" on `branches`.** The ticket asks for one. The
   stable-id decision (`decisions.md` §"The operation log is a UI feature") demoted the op
   log to non-load-bearing for merge: the base is fully specified by `base_snapshot` alone.
   `operations` exists only for the History sub-sheet (V1) and undo, keyed per branch.
2. **`main` is an ordinary `branches` row.** It has no parent, so its `base_snapshot` equals
   its `head` at seed and its `author_id` is the seed user. Nothing else about it is special
   — the trunk constraint (`decisions.md` §"`main` is the trunk") lives in the API's branch
   and merge-request logic, not the schema.
3. **`merge_request_resolutions` is a child table, not a `jsonb` array on the MR row.**
   "Save a resolution" is an upsert by `(mr_id, conflict_id)`, and re-validation (§6) drops
   individual rows whose conflict changed shape. An array would be read-modify-write of the
   whole set on every save.

**Consequences.** `head_version` is a plain counter with no optimistic-check semantics — §4
uses a row lock, not a version compare — so it exists purely so `GET` can report "previewed
against `main@v3`, now at `v5`". `web/src/data/types.ts` `MergeSummary.status`
(`"clean" | "held"` today) widens to the four values in §3; that is a frontend-seam
follow-up, not part of this lock.

## 3. The merge queue is a stored `status`, strict FIFO, one active MR at a time

`merge_requests.status` is `queued | open | held | merged`. **Invariant: at most one merge
request per target branch is `open` or `held`** — the active MR, the front of the line.
Every other non-terminal MR is `queued`. The queue is this column plus `created_at` for
promotion order; there is no queue table and no background worker.

Transitions:

| From | Event | To | Side effect |
|---|---|---|---|
| — | create, no active MR | `open` | freeze triple (§5), set `previewed_main_version` |
| — | create, an active MR exists | `queued` | freeze triple (provisional) |
| `open` | merge succeeds (§4) | `merged` | write `main.head`, bump `head_version`, append `merge` marker; **promote oldest `queued` → `open`** |
| `open` | merge fails re-validation (§4) | `held` | respond `409` with fresh conflicts |
| `held` | merge succeeds | `merged` | as `open → merged`, incl. promote |
| `held` | merge fails | `held` | respond `409` |
| `open` / `held` | `DELETE` (abandon) | row removed | **promote oldest `queued` → `open`** |
| `queued` | `DELETE` | row removed | none |
| `queued` | active MR left | `open` | its next `GET` refreshes the triple (§5) |

**Why a stored status rather than a derived "oldest open" check.** The gate has to hold at
the API boundary, not just in the UI: a client hitting `POST .../resolutions` or
`POST .../merge` on a non-front MR must be refused. A stored status makes that one column
read on every mutating endpoint. Deriving "is this the oldest `open` MR" would recompute an
ordering on every such call for a fact that changes only on merge, abandon, or create.

**Why strict FIFO, and why `held` blocks.** The alternative — a `held` MR "steps aside" so a
clean MR behind it can merge — was considered and rejected. It reintroduces the ordering
question the queue exists to remove: if MR4 and MR5 are both clean behind three `held` MRs,
may MR5 merge before MR4? Do they form a sub-queue? Every answer is an edge case, and the
resulting workflow is neither a real queue nor a free-for-all. Strict single-file order:
exactly one MR is actionable, everything else waits.

**Considered and rejected.** (a) A derived line with advisory position, merge serialized only
by a row lock — too weak: it lets an MR merge out of order and shows a fully resolvable
three-way for an MR whose base is about to move. (b) An enforced auto-merge queue with
speculative re-validation of everything behind on each landing — a job processor, out of
scope for a ~20-hour V0/V1 whose spine is conflict resolution.

**Consequences.** A stuck active MR (author abandons a resolution mid-flight) freezes the
line until someone calls `DELETE /merge-requests/:id`. This is inherent to a merge queue —
the front must clear before the line moves — and abandon is the escape valve; acceptable at
one-team scale. `held` is rare under FIFO: the only ways a front MR's merge attempt fails
re-validation are its own source branch drifting between promotion and the merge click, or
the commutativity oracle (ADR 0002) failing. Promotion and create both run under the §4 row
lock, so two MRs cannot both land on `open`.

## 4. The merge transaction: a row lock on `main`, re-validate against live head

`POST /merge-requests/:id/merge`, in one transaction:

1. `SELECT * FROM branches WHERE name = <target> FOR UPDATE`. This serializes concurrent
   merges and every queue promotion — the second caller waits, it does not race.
2. Re-read `source.head` live (the author may have applied more operations).
3. `threeWayMerge(mr.base, source.head, main.head, survivingResolutions)` — against **live**
   `main.head`, never the frozen `theirs`. `survivingResolutions` is §6's re-apply set.
4. On `report.verdict`:
   - **`clean`** → `UPDATE branches SET head = <merged>, head_version = head_version + 1
     WHERE name = <target>`; append a `merge` marker (`MergeMarker`, `src/domain/operations.ts`)
     to the target's `operations`; `UPDATE merge_requests SET status = 'merged',
     merged_at = now()`; refresh this MR's frozen triple and `previewed_main_version` to what
     was just used; promote the oldest `queued` MR to `open`; archive and delete the source
     branch (ADR 0013 §6 — `INSERT` its row into `deleted_branches`, `DELETE` from `branches`,
     `operations` cascade). `COMMIT`. Respond `200 { status: "merged", migration }` —
     `emitMigration(theirs, merged)` computed here, the definitive DDL.
   - **`conflicts`** or **`unclassified-divergence`** → `UPDATE merge_requests SET
     status = 'held'`; refresh the frozen triple + `previewed_main_version` so the MR view
     now shows the current three-way; `COMMIT` (only the status and triple change; nothing
     merged). Respond `409` with the kick-back body (`docs/backend-contract.md`
     §"Merge — 409 body"): `reason`, `landed` (merges into the target since
     `previewed_main_version`), `conflicts` (fresh), `droppedResolutions` (§6), and a
     plain-language `summary`. Per the ticket, the message names what merged ahead and what
     now conflicts; it never says the author's state is invalid.

**Why a row lock rather than the ticket's "optimistic version check".** The ticket offers an
optimistic check on `main`'s head as the cheap alternative to a job runner. `FOR UPDATE` is
cheaper still and has identical semantics — the database serializes, and there is no
compare-and-retry loop to write. `head_version` survives for the `GET` staleness display
(§2), not for merge control.

**Considered and rejected.** `SERIALIZABLE` isolation for the whole transaction — broader
than needed; the contended resource is exactly one row, and a `FOR UPDATE` on it is precise
and obvious.

**Consequences.** All merge throughput is one row lock wide. At one-team scale that is free;
it would not scale to many concurrent target branches, which V0/V1 does not have (single
trunk, `decisions.md` §"`main` is the trunk"). Under strict FIFO (§3) the front MR is the
only mergeable one, so between its promotion `GET` and its merge click `main` cannot move —
the `conflicts` branch here fires only on own-branch drift or an oracle failure.

## 5. The MR row freezes the triple; report and migration recompute on every read

`merge_requests` stores `base` / `ours` / `theirs` and `previewed_main_version`, frozen at
creation and refreshed only on a merge attempt (§4) or on promotion to `open` (§3). It does
**not** store the `MergeReport`, the `Migration`, the queue position, or a staleness flag.

`GET /merge-requests/:id` recomputes, every call:

- `MergeReport` ← `threeWayMerge(base, ours, theirs, survivingResolutions)`.
- `Migration` ← `emitMigration(theirs, merged)` (ADR 0003 §1: `source = theirs`,
  `target = merged`) — the change rendered as DDL for the merge-review screen; nothing
  executes it (ticket 0009).
- `position` / `ahead` / `behind` ← the `created_at` ordering over non-terminal rows.
- `stale` ← `main.head_version !== previewed_main_version` (advisory; the frozen triple is
  internally consistent regardless).

**Promotion refresh.** When a `queued` MR becomes `open`, its next `GET` rewrites the frozen
`theirs` and `ours` to live `main.head` / `source.head` before computing (`base` never moves
— it is the branch cut point). So the active MR's resolution work is always against the real
current base. A `queued` MR keeps its stale frozen triple and `GET` returns the provisional
read-only view (§7).

**Why recompute rather than freeze.** The engine is pure and cheap (`decisions.md` leans on
this throughout). A frozen `MergeReport` or `Migration` JSON is a second copy that goes wrong
the moment the engine's internals change — the drift argument again (ADR 0002 §1, ADR 0003
§2). A merged MR stays fully reproducible: its triple was refreshed to the exact values used
at merge time, so a later `GET` recomputes the identical report and migration for the audit
view, and nothing needs persisting after the fact.

**Considered and rejected.** Freezing the computed report and migration alongside the triple
for a stable historical record. Rejected: reproducibility from the frozen triple already
gives that, without the drift surface.

**Consequences.** `GET /merge-requests/:id` runs `threeWayMerge` and `emitMigration` on every
call. Both are pure, dependency-free, and operate on kilobyte documents, so this is
acceptable; if it ever is not, a short-TTL cache keyed on
`(mr_id, head_version, source.head_version, resolution set hash)` is a transparent addition.
Refreshing the triple on promotion re-triggers §6's re-validation, which is the intended
behaviour, not a side effect.

## 6. Resolutions are keyed by `conflictId`, re-validated by a stored conflict snapshot

`engine/classify.ts` already forms `Conflict.id` as
`` `${cls}:${[...objectIds].sort().join("+")}` `` — a pure function of the conflict class and
the object id(s), nothing else. So the ticket's "key resolutions by object id plus conflict
class" is satisfied by keying on `conflictId` verbatim, with no engine change.

`merge_request_resolutions` row → engine `Resolution` (ADR 0002): `{ conflictId, choice }`,
or `{ conflictId, choice: "type", type: payload }` for a divergent retype.

**Save.** `POST /merge-requests/:id/resolutions` with `{ conflictId, choice, type? }`:
recompute the fresh report; reject `422` if `conflictId` is not among `report.conflicts` or
`choice` is not in that conflict's `resolutionModes`; snapshot the fresh conflict's
`{ base, ours, theirs }` into `conflict_snapshot`; upsert by `(mr_id, conflict_id)`; return
the report recomputed with the new resolution applied.

**Re-validation.** On every merge attempt and every `GET`, each stored row is checked against
the freshly computed `Conflict[]`:

| Fresh state | `conflict_snapshot` | Action |
|---|---|---|
| `conflict_id` present | matches current payloads | **re-apply** — include in `survivingResolutions` |
| `conflict_id` present | differs | **drop**, visible notice ("the other side changed its edit") |
| `conflict_id` absent | — | **drop**, quiet notice ("no longer conflicts") |

**Why a stored snapshot rather than trusting `conflictId` alone.** `conflictId` is stable
across re-runs of an *unchanged* conflict, but a conflict can keep its id while changing
shape — the other branch revises its proposed type, so the divergent-retype conflict now
offers different choices. Re-applying the old choice blindly would be wrong. The snapshot is
the fingerprint that distinguishes "same conflict" from "same id, new shape".

**Considered and rejected.** Deleting a resolution row as soon as its conflict changes or
disappears. Rejected: it loses the record that the author decided something, and the snapshot
guard already makes a stale row harmless (the engine ignores a `conflictId` not in its
current set, and the fingerprint blocks a wrong re-apply if the conflict later returns).
Only `DELETE /merge-requests/:id/resolutions/:conflictId` removes a row.

**Consequences.** `droppedResolutions` in the `409` kick-back body (§4) is the "changed" plus
"absent" set with reasons. A resolution's `choice` is validated against `resolutionModes` at
save time only; if the conflict's class later shifts such that the choice is invalid, the
snapshot mismatch drops it before it can reach the engine.

## 7. The API returns raw domain data; the client owns the view-model projection

`GET /overview`, `GET /branches/:name`, and `GET /merge-requests/:id` return domain and engine
data — `SchemaDocument`s, `MergeReport`, `Migration`, branch and database facts — plus request
framing the client cannot derive (queue position, staleness). They do **not** pre-render
display strings or assemble `MergeReview`. The projection into the shapes
`web/src/merge-review/model.ts` and `web/src/data/types.ts` define is done client-side.

For the merge-request endpoint that means
`{ base, ours, theirs, report: MergeReport, migration: Migration, queue, stale, droppedResolutions }`.
There is no `/report` sibling route — the primary endpoint already returns the raw report.

**Why.** The two candidate JSON shapes are raw engine output and a pre-assembled `MergeReview`;
both are `c.json(...)`, so this is not an SSR question. The projection between them (row
pairing, `RowResolution` gate states, `"int → varchar(32)"` rendering) has to run somewhere,
and the client is the right place here:

- The client is not a thin consumer. WU-E is a structured schema editor that already renders
  `SchemaDocument`s; server-side projection would create a second rendering path for the same
  data.
- `MergeReview` is defined in `web/`, and `web/src/merge-review/fixture.ts` already builds that
  shape. The real path is "fetch raw, run the transform the fixture author would write" —
  assembling it server-side would couple the API to a frontend-shaped type or force that type
  into a shared package.
- CI and agents want the raw typed `MergeReport`, not pre-rendered strings, so raw output
  serves the non-UI consumers the map flags *better* than a projected shape would.

**Considered and rejected.** A Hono-side adapter (`api/src/views/*`) mapping
`MergeReport` + the three documents + resolution rows → `MergeReview`, returned as the default.
It keeps the client dumb, but the client is not dumb, and it adds an adapter layer plus a
type-coupling the project does not otherwise have. A projected summary for a non-browser
consumer can be built when there is a concrete one — YAGNI until then.

**Consequences.** `web/src/data/` and `web/src/merge-review/` keep and grow their projection
logic; the fixture's hand-written assembly becomes the real client transform, fed by the API
instead of literals. The API contract is domain types, which move only when the engine's types
move (already a coordination point via ADR 0001–0003). Payload size is a near-wash: the
merge-request response ships three `SchemaDocument`s, but the branch workspace fetches those
anyway.

## 8. The server re-runs every operation and every merge through the engine

`POST /branches/:name/operations` applies each `Operation` (`engine/operations.ts`) in order
through a shared `applyOperation(doc, op)` that enforces ADR 0001 §3's dependency block — no
dropping a column while an index / unique / PK / FK references it, no dropping a table an FK
points at. A violation returns `422 { failedAt, op, reason: "drop-blocked", dependents }` and
the transaction rolls back — nothing persists. On success each op is appended to `operations`
as a `LogEntry`, `head_version` is bumped, and the new `head` is returned.

**Why.** ADR 0001 §3's block and ADR 0002's merge correctness are engine invariants, not UI
conveniences. An API that trusts the client to have enforced them can persist a corrupt head
or merge an unsound document. The client enforces the block too, for instant feedback, but
the server is authoritative.

**Considered and rejected.** Trusting the editor and only validating on merge. Rejected: it
lets a branch head go structurally wrong and defers the failure to a confusing point far from
the edit that caused it.

**Consequences.** `applyOperation(doc, op)` is **new engine surface** — `engine/apply.ts`
today exports only the batch four-phase `applyDelta`. It stays in `engine/`, framework-free,
and is owned by the API/persistence track. It is also the natural home for the dependency
check the structured editor (WU-E) needs, so the two share one implementation rather than
forking the rule.

# ADR 0005 — First-run experience and seed schema

Status: accepted. The seed schema document is `examples/seed.schema.ts` (promoted from
provisional); the full first-run workspace is `examples/seed.workspace.ts`. The empty-state
copy and the demo script are in `docs/first-run.md`. `decisions.log.md` carries the running
narrative (`decisions.md` is the curated record).

Builds on ADR 0001 (the seed document; `User` / `Organization`; the `contact-fields` worked
branch), ADR 0002 (that branch is the rename-rebase fixture) and ADR 0004 (the `branches` /
`operations` / `merge_requests` row shapes; `POST /workspace/reset`). No product code ships
here — the reset endpoint that loads `seedWorkspace` is the build track's (ticket 0010).

## 1. The seed keeps the blog domain

The versioned schema stays the five-table blog from `examples/seed.schema.ts` — `users`,
`posts`, `comments`, `tags`, `post_tags` — rather than switching to the SaaS sketch the
ticket names (`users` / `organizations` / `memberships` / `projects`).

**Why.** The blog seed is wired into `engine/__fixtures__/scenarios.ts` (~30 references, the
0002 merge spike), `engine/__fixtures__/migration-scenarios.ts` (the 0003 emit spike), and
both worked examples. All of that is green and reviewed. The seed already does everything a
seed needs to: it exercises every `ColumnType` kind once, single and composite primary keys,
unique constraints, indexes, foreign keys with `cascade` and `restrict`, nullable and
not-null columns, and literal and `now()` defaults — small enough to read at a glance,
meaty enough that branch / diff / merge are immediately interesting. The `contact-fields`
branch (rename + dependent index) is the headline rename-rebase demo and is already built.

**Considered and rejected.** The SaaS domain from the ticket. It would make the versioned
schema mirror ryft's own `Organization` / `Membership` shape — a reviewer seeing the tool
manage its own kind of schema — but that is thematic polish, and buying it means rebuilding
the 0002 and 0003 fixtures and both worked examples to the same coverage. Not worth the
churn to shipped code. The versioned schema is a sample *customer* database; it does not
need to resemble ryft's internals.

**Consequences.** `examples/seed.schema.ts` loses its "provisional" note and is the final
seed. The demo script's operation targets (§4) are all reachable in the blog schema. If the
thematic alignment is wanted later, the demo *organisation* can be named for a SaaS company
without touching the schema — `seedOrg.name` in `examples/seed.workspace.ts` does exactly
that.

## 2. The seeded workspace is populated, not bare

`POST /workspace/reset` re-creates `main` **plus** the `contact-fields` branch, its
three-entry operation log, and one open, clean merge request (`contact-fields → main`). The
branches list, the merge-requests list, and the three-way diff all have real content on the
first screen.

**Why.** The ticket asks for both the empty state *and* an optional pre-made merge request
"so the diff view is populated on first visit". Populated wins as the default: the
merge-review screen is the built surface and the one most worth showing working immediately,
and a reviewer landing on three empty lists learns less than one landing on a real branch
they can open, diff, and merge. The seeded MR is **clean**, not conflicted — V0's story ends
in a successful merge; the conflict beat is a second branch the script has the reviewer
create (§4), not seed furniture, so a fresh instance is never in a "you have unresolved
conflicts" state nobody chose.

**Considered and rejected.** A bare seed (`main` only). It shows every zero state on arrival
but makes the first meaningful action "create a branch and think of an edit", which is more
friction than a take-home reviewer should hit before seeing the product work. Also
considered: seeding a *conflicted* MR for drama — rejected because it front-loads V1 and
misrepresents the fresh-instance state.

**Consequences.** The empty-state copy (`docs/first-run.md`) is still fully specified and
must be reachable — deleting `contact-fields` returns the instance to bare, and
`docs/first-run.md` notes an optional `?bare` mode on the reset endpoint for screenshots.
`web/src/data/fixture.ts` currently carries four demonstration branches and different
stats; it should converge on `seedWorkspace` when the real API lands behind the data seam
(build-track work, not this ticket's).

## 3. The first branch is created clean; the workspace shows a suggestion

The one-click "create your first branch" path makes a branch whose head equals `main`'s —
zero divergence — and the branch workspace then shows a **dismissible suggestion** in copy
("Try a rename: `posts.body` → `content`"), not a pre-applied edit.

**Why.** The ticket says "pre-loaded with a suggested change to try", which reads two ways.
A branch that already contains an operation the user did not make fights `PRODUCT.md`'s "one
operation, one intent" — the first entry in the operation log would be something they have
to reverse-engineer, and the first undo would be ambiguous. A suggestion in copy gets the
same "here is something to try" without putting an unattributed edit in the history. The
suggested edit is step 1 of the demo script (§4), so the nudge and the script agree.

**Considered and rejected.** Pre-applying one operation on branch creation. Rejected per
above. Also considered: no nudge at all — rejected because the empty branch workspace is
exactly where a reviewer stalls.

**Consequences.** The suggestion text lives with the branch-workspace surface (WU-E) and
must stay in step with the demo script's opening step. It is dismissible and does not
reappear once the branch has any divergence.

## 4. The demo script is two tiers

`docs/first-run.md` carries two scripts, not one: a **golden path** (~5 minutes — land,
open the seeded MR, merge it, then follow the suggestion to branch, make two or three
edits, open an MR, merge) and a **full-coverage appendix** that exercises all 21 operation
classes exactly once across one scripted branch and then walks the V1 conflict beat (a
second branch that collides with `contact-fields`, classified conflicts, resolve, merge).

**Why.** "Exercises every operation class exactly once" and "make someone smile" want
different lengths. A 21-step script is a completeness proof, not a first impression; a
five-minute happy path is the first impression but does not demonstrate coverage. Splitting
them lets the reviewer take the short path first and consult the appendix if they want to
see the whole editor vocabulary.

**Considered and rejected.** One script that threads all 21 operations into a single
narrative. It is long, and the operations that matter least to the story (a `renameTable`,
a `changeUnique`) get the same weight as the rename-rebase case, flattening the demo.

**Consequences.** The appendix must be re-checked whenever `engine/operations.ts` changes
its vocabulary — it claims to cover every class. The V1 conflict beat depends on the
resolution UI (WU-E / V1 band); until that ships, the appendix's final section is marked
as V1.

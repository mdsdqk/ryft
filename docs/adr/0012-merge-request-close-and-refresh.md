# ADR 0012 — Merge-request lifecycle: refresh `ours` on read, and close without merging

Status: accepted. Prompted by the same usability review as ADR 0011
(`docs/usability-review-triage.md`, themes D-12 and F1+F3), but this one is not a naming
call: both items are functional gaps in the merge-request lifecycle. `decisions.md` carries
the narrative.

Builds on ADR 0004 §3 (the merge queue is a stored status, strict FIFO), §4 (the merge
transaction re-runs against live heads under a row lock), §5 (the MR row freezes the triple;
everything else recomputes), §6 (resolutions are re-validated against a stored conflict
snapshot) and §7 (the API returns raw domain data; the client renders).

Two decisions, one per gap.

## 1. `ours` follows the source branch's live head on every read

ADR 0004 §5 froze `base` / `ours` / `theirs` at creation and refreshed them only on a merge
attempt (§4) or on promotion to `open` (§3). The reviewer found the hole immediately: open a
merge request, keep editing the branch, and the merge screen goes on showing the schema as it
was when the request opened. Nothing on the screen says so. The `stale` flag does not cover it
— that reports the *target* moving, not the source.

**Decision.** `GET /merge-requests/:id` (and the `/merge-requests` list, which reads through
the same helper) re-freezes `ours` from the source branch's current `head` before it computes,
for every non-terminal request — `queued` as much as `open`/`held` — and persists it, so the
screen and a subsequent merge attempt agree on what "ours" means. `base` never moves: it is
the branch cut point, and moving it would change what the three-way is a merge *of*.

`views.ts`'s `refreshActiveTriple` is now `refreshTriple` and is the one place this happens.
It is the same re-read the merge transaction already does inside its lock (ADR 0004 §4 step 2:
"re-read `source.head` live — the author may have applied more operations"); the fix is to
stop making a merge click the only moment that read occurs.

**What stays frozen.** `theirs` still follows live `main` only for the active request. A
`queued` request keeps the `main` it was previewed against, because `stale`
(`previewed_main_version !== main.head_version`) is the honest signal that the trunk moved
while it waited — refreshing `theirs` on read would silently erase the very fact `stale`
exists to report, and ADR 0004 §3's promotion refresh is what is supposed to clear it.

**A terminal request is never re-frozen.** A `merged` request is a record: ADR 0004 §5 keeps
it reproducible precisely because its triple holds the exact values the merge used, and
re-freezing `ours` would make a later `GET` recompute a report of something that never
happened. §3's `closed` is terminal on the same grounds.

**Considered and rejected.** (a) Refreshing on the client, on MR-screen mount. It would leave
the persisted row disagreeing with the screen, so the merge could act on a triple the reviewer
never saw. (b) Leaving the freeze and adding a "the branch has moved" banner with a manual
refresh button. It states the problem instead of solving it, and it invents a second kind of
staleness for the user to learn.

**Consequences.** Every read of a live merge request may write one row. That is a plain
`UPDATE` with no `FOR UPDATE` — the merge transaction is still the only serialization point,
and a read that races a merge self-corrects on the next read. The refresh also re-triggers
ADR 0004 §6's resolution re-validation on every read rather than only on a merge attempt,
which is what §2 below is about.

## 2. A resolution the refresh invalidates is named on the screen, not dropped in silence

ADR 0004 §6 already drops a stored resolution whose conflict is gone (`absent`) or whose
`conflict_snapshot` no longer matches (`changed`), and already reports the set as
`droppedResolutions`. Until now that only reached the user in the `409` merge kick-back body.
With §1 making the refresh happen on every read, an author can un-choose their own conflict
resolutions simply by editing their branch — so the notice has to be on the screen.

**Decision.** `droppedResolutions` (already on the `GET` response) is projected into a new
`MergeReview.refreshNote` — `{ droppedResolutions: string[] }`, one pre-rendered line each —
and the merge-review title strip prints it as a non-blocking notice. Non-blocking is the whole
point: nothing is broken, the choices are simply open again, and the conflict queue below
already shows them that way.

**Why the pre-rendering is client-side.** ADR 0004 §7 is explicit that the API returns raw
domain data and the client owns display strings. `droppedResolutions` is already raw and
already sufficient — `conflictId` is `${class}:${sortedObjectIds}` (§6), so the class and the
objects are both recoverable from it, and `fromResponse.ts` has the name resolver. Adding
pre-rendered labels to the response would have put the first rendered string in the API for no
information the client lacked.

**Considered and rejected.** Blocking the merge until the author re-decides. The conflicts are
already unresolved, so the merge is already blocked by the ordinary path; a second gate would
be the same fact stated twice.

## 3. Closing a merge request is a status, not a delete

`merge_request_status` was `queued | open | held | merged`, and the only way to end a request
short of merging was `DELETE /merge-requests/:id`, which removed the row and cascaded its
resolutions away. So "we decided not to do this" and "this never existed" were the same
operation, and the reviewer had nowhere to see what had been abandoned.

**Decision.** Soft-close. `merge_request_status` gains `closed`, `merge_requests` gains
`closed_at`, and `POST /merge-requests/:id/close` sets both and keeps the row. `closed` is
terminal alongside `merged`: the request leaves the queue, stops blocking a new request from
the same source branch, and is never re-frozen on read (§1). If the closed request held the
front (`open` or `held`), the next `queued` request is promoted — the identical side effect
`DELETE` already had, so the queue invariant in ADR 0004 §3 is untouched.

Closing a `merged` request is refused with `409 { error: "already-merged" }` — a merge is a
record of something that happened to `main`, and there is nothing to withdraw. Closing an
already-closed one succeeds as a no-op, so the call is idempotent.

**Terminality is now one predicate.** `merged` and `closed` are terminal for the same reasons
everywhere, so `views.ts` exports `isTerminal(status)` and the queue framing, the branch
summaries, the open list, the source-branch reuse check and the refresh all consult it instead
of each spelling out `!== "merged"`. The web side mirrors it: `RevisionStatus` gains `closed`
and `merge-review/model.ts` exports its own `isTerminal`, which is what makes the screen
read-only.

**`DELETE` stays.** It is now the hard-delete escape valve for a request that should leave no
record at all — a mistaken open, a test fixture. Nothing in the web app calls it; "Close
request" is the only user-facing way to end a request without merging.

**Why not reuse `DELETE` for the soft close.** A `DELETE` that leaves the row is a lie to
every future reader of the endpoint table, and the hard delete is genuinely wanted by the
tests and the seed. A distinct verb costs one route.

**Considered and rejected.** `abandoned` as the status name. ADR 0011's rule is the word a
DBA or Git user already knows, and every forge in that user's hands says *closed*.

### Where it shows

- **`/merges`** gains Open / Closed as two links, not two buttons: the view lives in the URL
  (`/merges?state=closed`), so it is shareable and the back button works. The queue is still
  the default. `GET /merge-requests?state=closed` backs it, most recently closed first, and it
  deliberately does not re-run the three-way — a closed request will never merge, so deriving
  a conflict count for it is noise.
- **The merge-review screen** carries "Close request" in Zone D beside "Merge into main",
  because the two are one decision: this request either lands or it does not. It shows on any
  live request, `queued` included — a queued request is the one an author most often wants to
  withdraw — and disappears at either terminal state.
- **The dial** does not gain a fifth step. `closed` is a way *off* the Queued → Under review →
  Reviewed → Merged line, not a point along it, so `STATUS_SEQUENCE` is unchanged: the dial
  reads "Closed" and strikes the lifecycle through behind it rather than marking a step the
  request never reached.

## Consequences

- The `merge_request_status` enum and `merge_requests` are no longer the frozen ADR 0004 §1
  contract. This is the first migration on top of `0000`, and the only one either decision
  needs — §1 and §2 are pure behaviour.
- A closed request keeps a foreign key to its source branch, so
  `DELETE /branches/:name` still refuses while one exists (`blocked-by-merge-request`). That
  is the pre-existing app-level guard doing the right thing for the wrong reason: the same is
  already true of a `merged` request, where the guard *passes* and the foreign key would
  refuse instead. Reconciling the two — a tombstone, or `ON DELETE` behaviour for terminal
  rows — is a follow-up this ADR does not take, and it is the sibling of triage theme F2
  (deleted branches).
- `GET /merge-requests/:id` now writes on most reads. See §1's consequence note; if it ever
  matters, the short-TTL cache ADR 0004 §5 already sketches applies unchanged.

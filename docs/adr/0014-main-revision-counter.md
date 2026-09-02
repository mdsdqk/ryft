# ADR 0014 — `main`'s revision counter and revision list

Status: accepted. The counter and the list are assembled in `api/_server/views.ts`
(`assembleOverview`); the shapes are in `api/_server/types.ts` and mirrored in
`web/src/data/types.ts`; the surface is the `/db` dashboard's Revisions zone. `decisions.md`
carries the narrative.

Builds on ADR 0004 (`GET /overview` / `Overview`; the `operations` table; `head_version` on
`branches`), ADR 0010 §5 (the merge transaction: write the head, bump `head_version`, append
the merge marker) and the usability review (theme H — a real revision counter to replace the
hardcoded `@ rev N` the web fixture carried).

## 1. `main`'s revision is the count of merges into `main`

A revision of `main` is defined as **one landed merge**: 0 at seed, `+1` for each successful
`POST /merge-requests/:id/merge`. There is no per-edit notion of a `main` revision — the model
has no history and `main` is never edited directly (`POST /branches/main/operations` is
`403`), so the only thing that moves `main` is a merge.

## 2. Derive it from the merge markers, do not add a column

`assembleOverview` computes `trunkRevision` as the number of `operations` rows on `main` whose
`op` is a `MergeMarker` — the same rows the revision list is built from.

**Why not `main.headVersion`.** It already equals the merge count *today*: ADR 0010 §5's merge
transaction bumps it by one per merge, and nothing else writes `main`'s row. But `head_version`
is a **per-edit** counter on working branches (`POST .../operations` and the undo route each
bump it once), kept on the row so a merge-request `GET` can say "you previewed against
`main@v3`, it is now `v5`" (see `decisions.md`, "The merge is one transaction with a row
lock"). `main`'s value matching the merge count is a consequence of `main` being uneditable,
not a guarantee the field carries. Deriving from the markers makes the counter and the list
below consistent by construction and needs no migration.

**Considered and rejected.** A dedicated `main_revision` column bumped in the merge
transaction. It would be O(1) to read, but it is a second source of truth for a number the op
log already determines, it needs a migration, and the merge transaction already appends the
marker it would be counting. The op log for `main` is a handful of rows.

## 3. The revision list is only as rich as the merge marker

`MergeMarker` is `{ type: "merge", mergeRequestId, sourceBranch }` (`src/domain/operations.ts`)
plus the `operations` row's `at` and `authorId`. The list entry is
`{ n, sourceBranch, at, summary }`, newest first, capped at ten:

- `n` — the 1-based position of the merge in `main`'s full marker sequence, so the newest
  entry's `n` equals `trunkRevision` even when older entries are trimmed.
- `sourceBranch`, `at` — straight from the marker and its row.
- `summary` — the one fact the marker adds beyond the other two fields: who ran the merge,
  `authorId` resolved to a display name (`merged by <name>`).

**The gap, named.** There is no per-merge count of schema objects changed, no plain-language
description of the delta, and no `mergeRequestId` on the entry. `main`'s head document is not
snapshotted per merge, so a historical "N columns, 1 index" cannot be reconstructed without
replaying every source branch, and the merge markers do not store a description. This ADR does
not add a history subsystem to close that gap: the counter is real and the list carries what
the markers support. A richer entry is a future ticket that would put a `summary` on the
`MergeMarker` at merge time.

## 4. Surface

`GET /overview` gains `revisions: TrunkRevision[]`. The `/db` dashboard adds a **Revisions**
zone below Branches — hairline `Row`s reading `revision N · <sourceBranch> → main` with
`<date> · <summary>` beneath, `count` on the zone heading is `trunkRevision` (which may exceed
the ten shown). Empty state: "No merges into main yet." The rail's database line and the
dashboard subtitle already carried a `rev N` marker from the usability-review batch; it is now
backed by this real counter rather than the fixture's hardcoded `41`. Per ADR 0011's vocab
rule "revision" is stated plainly here — it is a real count of merges, not a metaphor — and
the list is a plain ruled list, no graph.

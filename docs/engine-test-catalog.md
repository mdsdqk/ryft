# Engine test catalogue and merge invariants

Ticket 0006. The scenario catalogue and invariant list that doubles as the engine's
executable spec — the "meaningful tests" evidence. `decisions.md` carries the narrative.

Runner: **vitest** (`pnpm test` → `vitest run`, `pnpm test:watch` → `vitest`). One root
`vitest.config.ts` covers `engine/**`, `src/**`, and `web/src/**/*.test.ts` (the pure
selectors — §5); `web/` code reaches the engine through the `@engine` alias mirrored from
`web/vite.config.ts`.

## 0. How this maps to test files

| Section | Test file | Runs through |
|---|---|---|
| §1 merge matrix | `engine/merge.test.ts` | `threeWayMerge` |
| §2 SQL-generation matrix | `engine/emit.test.ts` | `emitMigration` + `verifyPrefixes` |
| §3 invariants | `engine/invariants.test.ts` | swept over §1 and §2 |
| §4 API list | *(not built — ADR 0004 is design-only)* | — |
| §6 frontend | `web/src/merge-review/model.test.ts` | pure selectors |

The starting spike sets (`engine/merge.spike.ts` → `engine/__fixtures__/scenarios.ts`, 23
cases; `engine/emit.spike.ts` → `engine/__fixtures__/migration-scenarios.ts`, 3 cases) are
folded in and extended. The spikes stay as fast smoke runners.

## 1. Merge scenario matrix

All edits are mutations of a clone of `examples/seed.schema.ts`. `verdict` is the
`MergeReport.verdict`; `classes` the sorted `Conflict.class` list. "merged assertions" are
the structural checks on the returned `merged` document (ids compared as-is — the engine
preserves them).

### Clean paths

| # | Name | ours | theirs | verdict | merged assertions |
|---|---|---|---|---|---|
| 1 | fast-forward (ours only) | add `users.nickname` | — | clean | `merged` deep-equals `ours` |
| 2 | fast-forward (theirs only) | — | add `users.bio` | clean | `merged` deep-equals `theirs` |
| 3 | no-op | — | — | clean | `merged` deep-equals `base` |
| 4 | false conflict — same table, independent | `users.display_name` → nullable | add `users.bio` | clean | both edits present |
| 5 | false conflict — independent tables | add `users.nickname` | add `posts.slug` | clean | both present |
| 6 | false conflict — edit vs unrelated rename | add index on `posts.published` | rename `users.email` → `email_address` | clean | index present; column renamed |

### Rename-rebase (all clean; `rebased.length ≥ 1`)

| # | Name | ours | theirs | merged assertions |
|---|---|---|---|---|
| 7 | index follows rename | rename `users.email` → `email_address` | add unique index on `users.email` (by id) | index `columnIds` still `[<email id>]`; emit resolves it to `email_address` |
| 8 | NOT NULL follows rename | rename `users.email` → `email_address` | `setNullable(false)` on `users.email` | column renamed **and** `nullable: false` |
| 9 | FK follows rename | rename `users.email` → `email_address` | add table `newsletter` + FK `newsletter.email` → `users.email` (by id) | FK `refColumnIds` unchanged; target column now named `email_address` |
| 10 | table rename, dependent follows | rename table `posts` → `articles` | add index on `posts.title` | table `name` = `articles`; index present on it |

### Divergent retype (class 1)

| # | Name | ours | theirs | verdict | classes / resolution |
|---|---|---|---|---|---|
| 11 | divergent retype | `posts.view_count` → `text` | `posts.view_count` → `int` | conflicts | `[divergent-retype]` |
| 12 | …resolved take-ours | ″ | ″ | clean | `{choice:"ours"}` → merged type `text` |
| 13 | …resolved take-theirs | ″ | ″ | clean | `{choice:"theirs"}` → merged type `int` |
| 14 | …resolved explicit-type | ″ | ″ | clean | `{choice:"type", type:{kind:"bigint"}}` → merged type `bigint` |

### Add-vs-add (class 2) and overlap

| # | Name | ours | theirs | verdict | assertions |
|---|---|---|---|---|---|
| 15 | add-vs-add — different type | add `users.phone` varchar(30) | add `users.phone` text | conflicts | `[add-vs-add]` |
| 16 | overlap — identical rename | rename `users.email` → `email_address` | same | clean | `overlaps.length ≥ 1`; applied once |
| 17 | overlap — identical index | add index `X` on `posts.published` | same index | clean | one index in `merged`, not two |
| 18 | degenerate overlap — identical column, fresh ids | add `users.locale` text not-null `'en'` id `col_locale_o` | same column id `col_locale_t` | clean | one `locale` column; `remaps` maps the loser id to the keeper |

### Rename-vs-rename (class 3)

| # | Name | ours | theirs | verdict | classes / resolution |
|---|---|---|---|---|---|
| 19 | column | `users.email` → `email_address` | `users.email` → `contact_email` | conflicts | `[rename-vs-rename]` |
| 20 | table | `posts` → `articles` | `posts` → `entries` | conflicts | `[rename-vs-rename]` |
| 21 | …resolved take-ours | as #19 | ″ | clean | merged column name = `email_address` |

### Divergent index definition (class 4) — including column order

| # | Name | ours | theirs | verdict | classes |
|---|---|---|---|---|---|
| 22 | incompatible index change | `posts_author_id_idx` → `unique` | `posts_author_id_idx` → add `posts.id` to it | conflicts | `[divergent-index-definition]` |
| 23 | **composite index order swap** | index cols `[a, b]` | index cols `[b, a]` | conflicts | `[divergent-index-definition]` — **not** dissolved as positional order |

### Drop-vs-modify (class 5)

| # | Name | ours | theirs | verdict | classes |
|---|---|---|---|---|---|
| 24 | drop column vs rename it | drop `posts.body` | rename `posts.body` → `content` | conflicts | `[drop-vs-modify]` |
| 25 | drop table vs modify its column | drop table `comments` | `comments.flags` → `bigint` | conflicts | `[drop-vs-modify]` |

### Dependency conflict (class 6) — both directions

| # | Name | ours | theirs | verdict | classes |
|---|---|---|---|---|---|
| 26 | 6a — add dependent vs drop target | add index on `posts.body` | drop `posts.body` | conflicts | `[dependency-conflict]` |
| 27 | 6b — drop target vs add dependent | drop `posts.title` | add index on `posts.title` | conflicts | `[dependency-conflict]` |
| 28 | 6 via FK — add FK vs drop table | add table `note` + FK `note.comment_id` → `comments.id` | drop table `comments` | conflicts | `[dependency-conflict]` |

### Divergent definition (class 7 — catch-all)

| # | Name | ours | theirs | verdict | classes |
|---|---|---|---|---|---|
| 29 | divergent column default | `posts.view_count` default `"1"` | default `"2"` | conflicts | `[divergent-definition]` |
| 30 | divergent primary key | `posts` PK `[id, author_id]` | `posts` PK `[id, title]` | conflicts | `[divergent-definition]` |
| 31 | divergent PK column order | `post_tags` PK `[post_id, tag_id]` | `[tag_id, post_id]` | conflicts | `[divergent-definition]` |
| 32 | divergent unique definition | `users_email_key` → `[email, id]` | → `[email, display_name]` | conflicts | `[divergent-definition]` |
| 33 | divergent FK definition | `posts_author_id_fkey` onDelete → `restrict` | onDelete → `set null` | conflicts | `[divergent-definition]` |

### Boundaries and resolution round-trip

| # | Name | setup | verdict | note |
|---|---|---|---|---|
| 34 | nullable PK member | ours adds `posts.published` to PK; theirs `setNullable(true)` on `published` | clean | structurally invalid document, but order-independent — structural validity is ticket 0008 (`validateDocument`), asserted separately (§3 I8) |
| 35 | bad resolution stays held | #26 + `{choice:"ours"}` (not in `resolutionModes` for a dependency conflict) | conflicts | resolution ignored; still held |
| 36 | multi-conflict fully resolved | ours: retype `view_count`→`text` + rename `email`; theirs: retype→`int` + rename `email` differently; resolutions for both | clean | round-trips to `clean`; merged reflects both choices |

## 2. SQL-generation matrix

`source` → `target` document pair → the emitted `DdlStatement[]`. `kinds` is the exact
ordered list of statement `kind`s; `before` pairs are "first match of A precedes first match
of B"; `contains` are verbatim SQL substrings; every row must pass `verifyPrefixes`.

| # | Name | source → target | kinds (in order) | assertions |
|---|---|---|---|---|
| S1 | rename + dependent unique index | seed → `contact-fields` branch | `renameColumn`, `addColumn`, `createIndex` | `ALTER TABLE "users" RENAME COLUMN "email" TO "email_address";` (never DROP+ADD); `CREATE UNIQUE INDEX … ("email_address")` (id → **new** name); rename before createIndex |
| S2 | retype ordered before new index | seed → seed with `posts.view_count`→`int` + new index on it | `alterColumnType`, `createIndex` | `alterColumnType` before `createIndex`; **no** explicit drop/recreate around the retype |
| S3 | FK ordering knot | seed → seed + two mutually-referencing new tables | `createTable`, `createTable`, `addForeignKey`, `addForeignKey` | every `createTable` before every `addForeignKey`; all prefixes valid |
| S4 | new table with PK, no FK | seed → seed + `attachments(id, url)` PK `(id)` | `createTable` | one statement; carries columns + PK inline; no `addForeignKey` |
| S5 | drop a column, no dependents | seed → seed minus `posts.metadata` | `dropColumn` | statement carries `destructive: true`; in the teardown phase |
| S6 | drop a table | seed → seed minus `post_tags` | `dropTable` | one statement; a table's own FKs / PK are not dropped explicitly (Postgres removes them with the table). An *inbound* FK would block the drop at op-validation (0008), not here |
| S7 | change an index | seed → seed with `comments_post_id_idx` cols `[post_id]` → `[post_id, created_at]` | `dropIndex`, `createIndex` | adjacent pair, **in the alter phase**, not split into teardown |
| S8 | add FK between existing tables | seed → seed + FK `comments.post_id` already exists… use a fresh FK `posts.author_id` → a new `authors` table | `createTable`, `addForeignKey` | single `addForeignKey`, after the `createTable` |
| S9 | rename a table | seed → seed with `tags` → `labels` | `renameTable` | `ALTER TABLE "tags" RENAME TO "labels";` |
| S10 | mixed multi-table migration | seed → seed + create/alter/drop across 3 tables | kinds in phase order (creates+renames, alters, FKs, drops-reverse) | `verifyPrefixes` passes; no reference unresolved at any prefix |

## 3. Invariants (swept over §1 and §2)

Each runs as a `test.each` over the relevant catalogue rows.

| # | Invariant | Statement |
|---|---|---|
| I1 | **identity** | `threeWayMerge(base, X, base)` and `threeWayMerge(base, base, X)` are `clean`, and `merged` deep-equals `X` — a branch with no changes on one side merges to the other side untouched |
| I2 | **apply ⇒ merged** | for every `clean` §1 row: `applyDelta(diffSnapshots(theirs, merged), theirs)` deep-equals `merged`. Pure, in-memory. The real-Postgres version of this is ticket 0009's harness, run opportunistically — not required for V0/V1 |
| I3 | **re-diff empty** | `diffSnapshots(base, merged)` re-fed as a merge is a no-op; `threeWayMerge(merged, merged, merged).merged` deep-equals `merged`; `diffSnapshots(merged, merged)` is empty |
| I4 | **prefix validity** | every §2 row's `emitMigration` output passes `verifyPrefixes` — no `IntermediateStateError`; every prefix leaves all references resolvable |
| I5 | **commutativity** | for every `clean` §1 row whose two sides are independent: applying `Δours` then `Δtheirs` to `base` equals applying `Δtheirs` then `Δours`, and both equal `merged`. Any pair that is *not* order-independent must surface as a classified conflict or an `unclassified-divergence` — never a silent clean merge |
| I6 | **merged ⟺ clean** | `merged !== null` iff `verdict === "clean"` |
| I7 | **conflict identity** | every `Conflict.id` starts with its `class`; is stable across a re-run of the same unchanged scenario; base-bearing classes (`divergent-retype`, `rename-vs-rename`, `divergent-index-definition`) carry a non-null `base` unless the conflict is a composite (`+` in the id) |
| I8 | **structural validity is separate** | for row #34 the merge is `clean` but `validateDocument(merged)` (ticket 0008) returns a `nullable-primary-key-member` error — asserted here so the boundary is pinned, not so the merge changes |

**On the oracle.** No catalogue row should produce `unclassified-divergence`. The oracle
(ADR 0002's runtime commutativity post-condition) is exercised by the resolution rows (#12–14,
#36) proving it does *not* fire after a valid resolution. A row that trips it is a taxonomy
gap in the seven classes — file it, don't paper over it.

## 4. API integration test list (spec — not yet runnable)

The Hono API is design-only (ADR 0004). When built, the suite covers:

- `POST /session` — creates an unknown username; resumes a known one; returns the org.
- `POST /workspace/reset` — idempotent; re-seeds `main` + org + three users + `contact-fields` + one open MR (ADR 0005).
- Branch CRUD — create from `main` (id-preserving clone, `head_version` 0); `409` on a taken name or `main`; `DELETE` blocked (`409`) while a non-terminal MR sources from it.
- `POST /branches/:name/operations` — applies a batch in one transaction; `422 { failedAt, reason:"drop-blocked", dependents }` with nothing persisted; `head_version` bumped once; each op appended to `operations`.
- MR creation — freezes `base`/`ours`/`theirs`; status `open` if no active MR, else `queued`; `409` if a non-terminal MR already sources from that branch.
- Resolutions — `POST` upserts, returns the recomputed report with the choice applied; `422` for a `conflictId` not in the current report or a `choice` not in its `resolutionModes`; `DELETE` removes it.
- Merge — `clean` → `main.head` written, `head_version` bumped, `merge` marker appended, oldest `queued` promoted, `200 { status:"merged", migration }`; not-clean → `held`, `409` with the kick-back body; a `queued` (non-front) MR → `409`.
- Verify (stretch, ADR 0009) — `POST /merge-requests/:id/verify` writes the `verification` blob; cleared on triple refresh or resolution change.

## 5. Frontend test posture

**Pure functions only.** `web/src/merge-review/model.ts` — `openConflicts`, `isMergeable`,
`effectiveStatus` — and any pure formatters (`web/src/merge-review/format.ts`). No DOM,
component, or render tests.

Rationale: the surfaces are fixture-bound and thin; their logic is layout and wiring, which a
render test pins without adding confidence. The pure view-model derivations are where a wrong
edit ships a wrong verdict to the user, so those get direct unit tests.

`web/src/merge-review/model.test.ts` covers `openConflicts` / `isMergeable` /
`effectiveStatus` and the `format.ts` renderers (`sqlType`, `retypeDetail`, the label maps).
It runs under the single root `vitest.config.ts` — no separate `web/` runner, no `jsdom`
(the tested code is pure). `web/` still typechecks it under its own `tsc`
(`web/tsconfig.json` includes `src`).

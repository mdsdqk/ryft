# First-run experience — seed, empty states, demo script

Ticket 0005. What a reviewer lands in on a fresh instance and how they move through the
product without being told anything. `docs/adr/0005-first-run-and-seed.md` is the structured
rationale; `decisions.md` carries the narrative.

- **Seed schema document:** `examples/seed.schema.ts` (final).
- **First-run workspace:** `examples/seed.workspace.ts` — the object `POST /workspace/reset`
  loads. The endpoint itself is the build track's (ticket 0010).
- Copy voice follows `decisions.md` — plain, precise, concrete, explains the "why", no
  marketing register (`PRODUCT.md` § Brand Commitments).

---

## 1. The seeded workspace

| Piece | Content |
|---|---|
| Organisation | one — `Northwind Engineering` |
| Users | three — `grace` (Grace Okoro), `ravi` (Ravi Menon), `mara` (Mara Lindqvist) |
| `main` | the blog schema below; `baseSnapshot === head`; `headVersion` 0 |
| `contact-fields` branch | Grace's: rename `users.email` → `email_address`, add `users.phone`, add a unique index on the renamed column. Three operations in the log; `headVersion` 3 |
| Merge request | one, **open and clean** — `contact-fields → main`. `theirs` is the untouched seed, so the three-way is `ours` applied; the rename renders as a rename |
| Resolutions | none — the seeded MR is clean |

### The blog schema on `main`

Five tables, sized to read at a glance and to exercise every shape the engine handles.

| Table | Columns | Keys / constraints / indexes |
|---|---|---|
| `users` | `id` uuid, `email` varchar(255), `display_name` text, `created_at` timestamptz `now()` | pk `users_pkey(id)`; unique `users_email_key(email)` |
| `posts` | `id` uuid, `author_id` uuid, `title` text, `body` text?, `published` boolean `false`, `view_count` bigint `0`, `rating` numeric(3,2)?, `metadata` jsonb?, `created_at` timestamptz `now()` | pk `posts_pkey(id)`; fk `posts_author_id_fkey` → `users(id)` `on delete cascade`; index `posts_author_id_idx(author_id)` |
| `comments` | `id` uuid, `post_id` uuid, `author_id` uuid, `body` text, `flags` int `0`, `created_at` timestamptz `now()` | pk `comments_pkey(id)`; fk → `posts(id)` `cascade`; fk → `users(id)` `restrict`; index `comments_post_id_idx(post_id)` |
| `tags` | `id` uuid, `name` varchar(50) | pk `tags_pkey(id)`; unique `tags_name_key(name)` |
| `post_tags` | `post_id` uuid, `tag_id` uuid | composite pk `post_tags_pkey(post_id, tag_id)`; fk → `posts(id)` `cascade`; fk → `tags(id)` `cascade` |

Totals: 5 tables, 23 columns, 5 primary keys (one composite), 2 uniques, 2 indexes, 5
foreign keys (`cascade` ×4, `restrict` ×1). Every `ColumnType` kind appears; defaults are
both literal (`false`, `0`) and function (`now()`); columns are both nullable and not-null.

### Returning to bare

The empty-state copy in §2 must stay reachable. Deleting `contact-fields` (which first needs
its merge request deleted) returns the instance to `main` only. `POST /workspace/reset`
takes an optional `?bare` that seeds `main` alone, for screenshots of the zero states.

---

## 2. Empty-state copy

One plain sentence and the single action that changes the state. No illustration, the sheet
frame stays (`PRODUCT.md` § Empty states; work-breakdown WU-F).

| Surface | When | Headline | Body | Action |
|---|---|---|---|---|
| Branches list | no branches | No branches yet. | Every branch starts from `main`. Cut one to change the schema without touching the trunk. | **Create branch** |
| Merge requests list | none open | No open merge requests. | Open one from a branch that has diverged from `main`. | **View branches** |
| Dashboard · recent branches | no branches | No branches yet. | — | **Create branch** |
| Dashboard · open merges | none open | Nothing waiting to merge. | — | — |
| Divergence sub-sheet | branch equals `main` | This branch matches `main`. | Edit the schema on the Schema tab; changes show here as they land. | **Go to Schema** |
| Branch schema · a table card | no indexes | No indexes on this table. | Add one with `+ index` on this card. | *(inline)* |
| Branch schema · a table card | no constraints | No constraints on this table. | Primary key, unique, and foreign-key constraints appear here. | *(inline)* |
| Freshly seeded database | `main` only, no branches or merges | *(the dashboard keeps its facts panel; the branches and merges panels show their own zero states above)* | — | **Create branch** |

---

## 3. The first-run flow

1. **Sign in.** One field, a username. `grace`, `ravi`, or `mara` resume a seeded person; any
   other name creates a new user in `Northwind Engineering` and proceeds. No password.
2. **Land in the database.** The dashboard: schema facts, the `contact-fields` branch under
   recent branches, the open merge request under open merges.
3. **Two ways in.** Open the seeded merge request (§4 tier 1), or **Create branch** — which
   makes a branch equal to `main` and drops the reviewer in the branch workspace.
4. **The nudge.** A fresh branch workspace shows a dismissible suggestion: *"Try a rename:
   `posts.body` → `content`."* It disappears once the branch has any divergence.

---

## 4. Demo script — tier 1, the golden path

About five minutes. Ends in a successful V0 merge.

1. **Sign in** as `grace`.
2. On the dashboard, open the **`contact-fields → main`** merge request.
3. Read the three-way diff. `users.email` shows as **renamed** to `email_address` — struck
   old name, new name — not as a drop and an add. `phone` is a clean add. The unique index
   sits on `email_address`.
4. Check the generated migration: `ALTER TABLE users RENAME COLUMN email TO email_address`,
   `ADD COLUMN phone`, `CREATE UNIQUE INDEX ... ON users (email_address)` — dependency-ordered,
   wrapped in one transaction.
5. **Merge.** `main` now carries the three changes; the merge request closes as merged.
6. Back on the dashboard, **Create branch** — name it `titles`.
7. Follow the suggestion: on `posts`, rename `body` → `content`. Then retype
   `comments.flags` from `int` to `bigint`, and add a non-unique index on `posts.published`.
8. Open a merge request for `titles → main`. It is clean.
9. **Merge.** Read the DDL, done.

---

## 5. Demo script — tier 2, full coverage

One branch, `editor-tour`, cut from `main`, that applies **all 21 operation classes exactly
once** in a dependency-sane order (creates and renames first, intra-table alters, then
drops — the engine's own phase order). Then the V1 conflict beat.

Cut `editor-tour` from `main` and apply, in order:

| # | Operation class | Edit |
|---|---|---|
| 1 | `createTable` | `attachments` — `id` uuid, `post_id` uuid, `url` text, `created_at` timestamptz `now()`; no primary key yet |
| 2 | `renameTable` | `tags` → `labels` |
| 3 | `renameColumn` | `posts.body` → `content` |
| 4 | `addColumn` | `posts.slug` varchar(200), nullable |
| 5 | `retypeColumn` | `comments.flags` `int` → `bigint` |
| 6 | `setDefault` | `posts.slug` default `''` |
| 7 | `setNullable` | `posts.slug` → not null (safe now — it has a default) |
| 8 | `addPrimaryKey` | `attachments(id)` |
| 9 | `changePrimaryKey` | `users_pkey` `(id)` → `(id, email)` (`email` is not-null) |
| 10 | `dropPrimaryKey` | `comments_pkey` |
| 11 | `addUnique` | `posts.slug` unique |
| 12 | `changeUnique` | `users_email_key` `(email)` → `(email, id)` |
| 13 | `dropUnique` | `labels` name unique (`tags_name_key`) |
| 14 | `addIndex` | non-unique on `posts.published` |
| 15 | `changeIndex` | `comments_post_id_idx` `(post_id)` → `(post_id, created_at)` |
| 16 | `dropIndex` | `posts_author_id_idx` |
| 17 | `addForeignKey` | `attachments.post_id` → `posts(id)` `on delete cascade` |
| 18 | `changeForeignKey` | `posts_author_id_fkey` `cascade` → `restrict` |
| 19 | `dropForeignKey` | `comments_author_id_fkey` |
| 20 | `dropColumn` | `posts.metadata` (nothing references it) |
| 21 | `dropTable` | `post_tags` (no other table's foreign key points at it) |

Open `editor-tour → main` and merge. The migration should be one ordered transaction with
every statement above, renames as `ALTER … RENAME`, drops last.

### The V1 conflict beat

Needs the resolution UI (V1 band). Cut a second branch `rename-race` from `main` and rename
`users.email` → `contact_email`. Open `rename-race → main` **after `contact-fields` has
merged** (tier 1 step 5), so `main` now has the column as `email_address`.

- The merge review shows one **rename-vs-rename** conflict (clear severity): `main` says
  `email_address`, this branch says `contact_email`.
- Resolve it — take `email_address` — and merge. The migration renames nothing (the column
  already has the chosen name on `main`) and the branch's other edits, if any, apply clean.

Swap `rename-race`'s edit for *"add a unique index on `users.email`"* instead and there is
**no conflict**: the index rebases onto `email_address` automatically, because it holds the
column by id. That is the headline rename-rebase case, shown as a clean merge.

---

## 6. Keeping this in step

- The tier-1 suggestion copy (`posts.body` → `content`) is also step 7 of tier 1 and row 3
  of tier 2. Change it in one place, change it everywhere.
- Tier 2 claims to cover every operation class. Re-check it against `engine/operations.ts`
  whenever that vocabulary changes.
- `web/src/data/fixture.ts` is demonstration data for the fixture-bound UI and currently
  differs from the seed (more branches, different stats). It should converge on
  `examples/seed.workspace.ts` once the real API is behind the data seam.

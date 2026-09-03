# ADR 0013 — Deleted branches: an archive table, not a soft-delete flag

Status: accepted. Ships code. Usability review theme F2 (deleted branches) — marked stretch,
built because it is small and self-contained.

Builds on ADR 0004 (the Drizzle schema, the branch endpoints, `DELETE /branches/:name` and its
"held by an open merge request" guard) and ADR 0010 §1–§2 (the `api/` package, Neon + Drizzle,
the pglite test setup). Vocabulary follows the app-vocabulary rule: DBA/Git terms a reader
already knows — "deleted branch", "author", "branched from `main`".

## Context

`DELETE /branches/:name` dropped a working branch with a bare `db.delete(branches)`. Once gone
it left no trace: no list of what was deleted, no way to tell a typo'd delete from a real one
after the fact. The review asked for a "deleted branches" view.

The obstacle is the schema. `branches.name` is the table **primary key** (`api/_server/db/schema.ts`,
ADR 0004 §2). A soft-delete — keep the row, add a `deleted_at` column, filter it out of the
live list — pins the name forever: a new branch can never reuse a deleted name, because the
dead row still holds the key. Branch names are short and meaningful (`contact-fields`,
`drop-legacy-tags`); a team that deletes `contact-fields` and later wants it back would be
blocked by a tombstone. That is the wrong trade.

## Decision

### 1. On delete, move the row into a `deleted_branches` archive table

`DELETE /branches/:name` runs, inside one transaction:

1. `INSERT` the whole branch row into `deleted_branches` — every column of `branches`
   (`name`, `organizationId`, `authorId`, `createdAt`, `head`, `baseSnapshot`, `headVersion`)
   carried across unchanged, plus `deletedAt` (defaulted `now()`) and `deletedById` (the actor).
2. `DELETE` the row from `branches`. Its `operations` rows cascade away as before (ADR 0004 §2).

`branches` stays exactly as narrow as the ADR 0004 contract — nothing there changes, no column
added, no filter on the live list. The name leaves the primary key, so it is immediately
free to cut again. The archive is a plain append-only log.

The table:

```ts
export const deletedBranches = pgTable("deleted_branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  head: jsonb("head").$type<SchemaDocument>().notNull(),
  baseSnapshot: jsonb("base_snapshot").$type<SchemaDocument>().notNull(),
  headVersion: integer("head_version").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  deletedById: uuid("deleted_by_id").notNull().references(() => users.id),
});
```

- **`id` is a synthetic primary key, not `name`.** A name can be cut, dropped, cut again, and
  dropped again — two archive rows, same name. `name` is not unique here. `createdAt` and
  `headVersion` carry the branch's own values (no `defaultNow()` / no `default(0)`) — this is a
  copy, not a new record.
- `head` and `baseSnapshot` are kept whole. They cost nothing to store (same `jsonb` the live
  row held) and they are what a future restore or an "what was on it" view would need.

### 2. The guard is unchanged; `main` still cannot be deleted

The pre-existing refusal stands verbatim: a branch held by a non-`merged` merge request returns
`409 { error: "blocked-by-merge-request", mergeRequestId }` and is **not** archived — nothing
runs. `main` returns `403` and is never archived. The archive step is reached only on the same
success path the bare delete used.

### 3. `GET /branches/deleted` lists the archive

Registered before `GET /branches/:name` so `deleted` is not read as a branch name. Returns
`DeletedBranchSummary[]` — `{ name, author, deletedAt, divergence }` — most-recently dropped
first. `author` is the branch author resolved to a display name (the same `nameMap` the live
list uses). `divergence` is `diffSnapshots(baseSnapshot, head).length`, the identical cheap
computation `listBranchSummaries` already runs per row — so it is included rather than omitted.

### 4. No restore endpoint

Restoring is not built. It is not trivially safe: the freed name may have been taken by a new
branch in the meantime, so a restore is a create-or-conflict flow with its own UI, and the
archived `head` may reference a `main` that has moved on. Recorded as a follow-up. The archive
row keeps everything a restore would need if it is built later.

### 5. Surface: a collapsed zone at the foot of `/branches`

Not a new route and not a rail entry. The `/branches` sheet gets a collapsible "Deleted
branches" `<details>` section below the working list — a hairline list, `name · author ·
deleted date`, reusing the surface kit (`SheetList` + `Row`). Empty state is a quiet "No
deleted branches." A load failure hides the section rather than erroring the sheet: the archive
is reference, not a working surface.

### 6. A merge archives its source branch (added later)

`POST /merge-requests/:id/merge`, on a **clean, structurally-valid** merge, now runs the same
archive-then-delete as `DELETE /branches/:name` — inside the merge transaction, after the queue
promotion:

1. `INSERT` the whole source-branch row into `deleted_branches` (`deletedById` = the actor who
   ran the merge).
2. `DELETE` it from `branches`; its `operations` rows cascade.

**Why.** After a merge the branch's work is in `main`, but the model has no rebase: a branch is
measured only against its own frozen `base_snapshot` (the cut point), so `diffSnapshots(base,
head)` keeps returning the merged delta forever — a permanent phantom "N operations diverged"
with no way to clear it, and the branch surface re-offers "Open merge request" over a
now-empty three-way. The alternatives were to advance the branch's `base_snapshot` to the new
`main.head` on merge (adds a rebase concept and a "behind main" state the model otherwise
doesn't have) or to fast-forward the branch whole (rewrites its `head` and truncates its op
log). Removing the branch is the smallest mechanism that leaves a coherent state, and the
archive from §1 means the merged branch is still listed and its `head` still recoverable.

A kickback (`held`) or structural-failure merge returns before this step — only a landed merge
removes the branch. The name is freed immediately, as with any archived branch.

**The `source_branch` foreign key is dropped** (`merge_requests` → `branches.name`, migration
`0003_drop_source_branch_fk.sql`). A `merged` — and likewise a `closed` — request now routinely
outlives the branch it names, so the column becomes plain `NOT NULL` text: the historical
record of where the request came from. Nothing dereferences it for a terminal request
(`refreshTriple` returns early for terminal MRs; the queue and summary lists filter them out),
and the `merge` marker on `main` already stores `sourceBranch` as text, so the revisions list
is unaffected.

## Consequences

- **A migration must be generated for `deleted_branches`.** This ADR's iteration adds the
  table to `schema.ts` only; `drizzle-kit generate` and the committed `api/drizzle/` SQL are a
  separate step (owned by the consolidating branch). The API test (`api/_server/__tests__/deleted-branches.test.ts`)
  creates the table on its fresh pglite instance from the same definition until that migration
  lands.
- `DELETE /branches/:name` is now a transaction, not a single statement. One `INSERT` + one
  `DELETE`, no engine work, negligible cost.
- The archive grows unbounded. At the scale this tool targets (one team, one database) that is
  a non-issue; a retention sweep is a later concern if ever.
- Every landed merge adds an archive row (§6). At one-team scale this is the same non-issue as
  a manual delete; the "Deleted branches" list is now also the record of merged branches, most
  recent first.
- `DELETE /branches/:name`'s own guard still refuses a branch a *non-`merged`* merge request
  references — including a `closed` one. With the foreign key gone that refusal is no longer
  load-bearing (a dangling `source_branch` on a terminal row is harmless), so loosening it to
  "only a live queued/open/held request blocks" is a safe follow-up, not done here.

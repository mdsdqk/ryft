# Backend contract — persistence model and Hono API surface

Ticket 0004. The Drizzle schema and the endpoint table the API/persistence out-of-band track
and the `web/src/data/` seam build against. This is the companion reference;
`docs/adr/0004-backend-contract.md` is the structured rationale (one section per call) and
`decisions.md` carries the narrative.

Builds on `engine/schema.ts` (`SchemaDocument`), `engine/operations.ts` (`Operation`),
`src/domain/operations.ts` (`LogEntry`, `LogOp`, `MergeMarker`), `src/domain/users.ts`
(`User`, `Organization`), `engine/merge-types.ts` (`MergeReport`, `Conflict`, `Resolution`),
`engine/merge.ts` (`threeWayMerge`), `engine/emit.ts` (`emitMigration`, `Migration`).

No code ships with this ticket. `applyOperation(doc, op)` (ADR 0004 §8) is new engine surface
owned by the build track. The API returns raw domain data (ADR 0004 §7) — the projection into
`web/src/data/` and `web/src/merge-review/model.ts` shapes is the client's, grown from the
fixtures that hand-build those shapes today.

---

## 1. Drizzle schema

`drizzle-orm/pg-core`. Schema states are `jsonb` typed to the engine's `SchemaDocument`
(ADR 0004 §1). One Postgres enum for merge-request status.

```ts
import {
  pgTable, pgEnum, text, integer, timestamp, jsonb, uuid,
  primaryKey, uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SchemaDocument, ColumnType } from "../../engine/schema.js";
import type { LogOp } from "../domain/operations.js";

// ── identity (ADR 0001 §4; src/domain/users.ts) ──────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_org_username_uq").on(t.organizationId, t.username)],
);

// ── branches (ADR 0004 §2) ──────────────────────────────────────────────────

export const branches = pgTable("branches", {
  name: text("name").primaryKey(), // `main` is a row
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  head: jsonb("head").$type<SchemaDocument>().notNull(),
  baseSnapshot: jsonb("base_snapshot").$type<SchemaDocument>().notNull(),
  headVersion: integer("head_version").notNull().default(0),
});

// ── operation log (UI + audit only; ADR 0001 §2) ────────────────────────────

export const operations = pgTable(
  "operations",
  {
    branchName: text("branch_name")
      .notNull()
      .references(() => branches.name, { onDelete: "cascade" }),
    seq: integer("seq").notNull(), // per-branch monotonic from 1
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    authorId: uuid("author_id").notNull().references(() => users.id),
    op: jsonb("op").$type<LogOp>().notNull(), // Operation | MergeMarker
  },
  (t) => [primaryKey({ columns: [t.branchName, t.seq] })],
);

// ── merge requests (ADR 0004 §3–§5) ─────────────────────────────────────────

export const mergeRequestStatus = pgEnum("merge_request_status", [
  "queued",
  "open",
  "held",
  "merged",
]);

export const mergeRequests = pgTable("merge_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceBranch: text("source_branch").notNull().references(() => branches.name),
  targetBranch: text("target_branch").notNull().references(() => branches.name), // 'main' in V0
  authorId: uuid("author_id").notNull().references(() => users.id),
  status: mergeRequestStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  mergedAt: timestamp("merged_at", { withTimezone: true }), // null until merged
  // frozen at creation; refreshed on a merge attempt or on promotion to `open` (ADR 0004 §5)
  base: jsonb("base").$type<SchemaDocument>().notNull(),
  ours: jsonb("ours").$type<SchemaDocument>().notNull(),
  theirs: jsonb("theirs").$type<SchemaDocument>().notNull(),
  previewedMainVersion: integer("previewed_main_version").notNull(),
});

// ── stored conflict resolutions (ADR 0004 §6) ───────────────────────────────

export const mergeRequestResolutions = pgTable(
  "merge_request_resolutions",
  {
    mrId: uuid("mr_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    conflictId: text("conflict_id").notNull(), // engine's `${cls}:${sortedIds}` key
    choice: text("choice").$type<"ours" | "theirs" | "type">().notNull(),
    payload: jsonb("payload").$type<ColumnType>(), // set iff choice === 'type'
    conflictSnapshot: jsonb("conflict_snapshot")
      .$type<{ base: unknown; ours: unknown; theirs: unknown }>()
      .notNull(), // fingerprint for re-validation
    savedBy: uuid("saved_by").notNull().references(() => users.id),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mrId, t.conflictId] })],
);
```

Notes.

- **No table for schema objects.** Tables, columns, indexes, and constraints live only inside
  the `jsonb` documents (ADR 0004 §1). Their structural invariants are the engine's, not the
  database's.
- **`head_version`** is a plain counter bumped on every write to `head`. It drives the `GET`
  staleness display; it is not an optimistic-lock version (ADR 0004 §4 uses `FOR UPDATE`).
- **`main`** is a `branches` row seeded with `base_snapshot === head` and the seed user as
  `author_id`. The "branches are cut only from `main`" rule is enforced in API logic.
- **Enum vs check.** `merge_request_status` is a real `pgEnum` so an out-of-band writer
  cannot land an unknown status.

---

## 2. Identity resolution

Every request except `POST /session` carries `x-ryft-user: <username>`. Middleware resolves it
to a `users` row (scoped to the single organisation) and attaches the actor. An unknown
username → `401`. There is no token, no session store, no password — impersonation is a
documented non-goal (ADR 0001 §4).

---

## 3. Endpoint table

Base path `/api`. All bodies and responses are JSON. `Actor` = the resolved `x-ryft-user`.

### Identity & workspace

| Method · path | Request | Response | Notes |
|---|---|---|---|
| `POST /session` | `{ username: string }` | `{ user: User, organization: Organization }` | Create-or-resume by username. The only route that mints a `users` row. No `x-ryft-user` header required. |
| `POST /workspace/reset` | — | `{ ok: true, overview: Overview }` | Truncates `branches`, `operations`, `merge_requests`, `merge_request_resolutions`; re-inserts `main`, the organisation, and the three seed users. Idempotent. Seed *content* is ticket 0005; this endpoint and its semantics are 0004. |
| `GET /overview` | — | `Overview` | The landing aggregate — backs `DataSource.getOverview`. |

### Branches

| Method · path | Request | Response | Notes |
|---|---|---|---|
| `GET /branches` | — | `BranchSummary[]` | |
| `GET /branches/:name` | — | `BranchDetail` | `head` + `base` documents, divergence count, the branch's open MR id if any. |
| `POST /branches` | `{ name: string }` | `BranchDetail` | Cuts from `main`: `base_snapshot` and `head` are id-preserving clones of `main.head`; `head_version = 0`; `author_id = Actor`. `409` if `name` is taken or is `main`; `422` if `name` is not a valid identifier. |
| `DELETE /branches/:name` | — | `{ ok: true }` | `403` for `main`. `409` if a non-terminal merge request has this branch as `source_branch` — body: `{ error: "blocked-by-merge-request", mergeRequestId }`. |

### Structured editor

| Method · path | Request | Response | Notes |
|---|---|---|---|
| `POST /branches/:name/operations` | `{ ops: Operation[] }` | `{ head: SchemaDocument, appliedSeqs: number[], headVersion: number }` | Applies `ops` in order through `applyOperation` (ADR 0004 §8). One transaction: any failure rolls the whole batch back. `422` on a per-op dependency violation, or `422 { error: "structural-validation-failed", errors }` if the batch applies op-by-op but `validateDocument` rejects the resulting head (ADR 0008 §5 backstop) — see below. Each applied op is appended to `operations` as a `LogEntry` (`authorId = Actor`, `at = now()`, `seq` continuing the branch counter); `head_version` is bumped once. `409` if `:name` has a non-terminal MR and the branch is frozen for review (V0: not frozen — edits stay allowed; the MR's `ours` refreshes on promotion). |
| `GET /branches/:name/operations` | — | `LogEntry[]` | Whole log, ascending `seq`. History sub-sheet (V1); endpoint available now. |
| `DELETE /branches/:name/operations?after=<seq>` | — | `{ head: SchemaDocument, headVersion: number }` | Undo. Drops every log entry with `seq > after` and rebuilds `head` by replaying the surviving prefix from `base_snapshot` — the same fold `POST .../operations` runs. `after=0` clears the branch back to its cut. `head_version` is bumped once. One transaction. `403` for `main`; `404` for an unknown branch; `422` if `after` is missing or not an integer `≥ 0`. |

WU-E settled undo as `DELETE .../operations?after=<seq>` (truncate-and-replay), not inverse
ops through `POST .../operations` — replay keeps `head` byte-identical to a shorter history
and needs no inverse-op derivation. The structured editor's LIFO undo passes `last.seq - 1`.

### Merge requests

| Method · path | Request | Response | Notes |
|---|---|---|---|
| `GET /merge-requests` | — | `MergeSummary[]` | Non-terminal first, then merged; within non-terminal, ascending `created_at` (queue order). Each augmented with `position` / `ahead` / `behind`. |
| `POST /merge-requests` | `{ source: string }` | `MergeRequestResponse` | `target` is always `main` in V0. Freezes `base = source.base_snapshot`, `ours = source.head`, `theirs = main.head`, `previewed_main_version = main.head_version`. Status is `open` if no active MR exists, else `queued` (ADR 0004 §3). Runs under the §4 row lock so two creates cannot both become `open`. `409` if a non-terminal MR already has this `source`. |
| `GET /merge-requests/:id` | — | `MergeRequestResponse` | Recomputes `report`, `migration`, queue position, staleness (ADR 0004 §5). Raw engine output — no server-side projection (ADR 0004 §7). For a `queued` MR the frozen triple is stale by design; the client renders it read-only. |
| `POST /merge-requests/:id/resolutions` | `{ conflictId: string, choice: "ours" \| "theirs" \| "type", type?: ColumnType }` | `MergeRequestResponse` | Shipped (moved forward from V1 — the table already existed and the merge transaction needed to honour resolutions anyway). `409` unless `status !== "merged"` (V0 has no `held`). `422` if `conflictId` is not a current conflict or `choice` is not in its `resolutionModes`. Upserts by `(mr_id, conflict_id)`; stores `conflict_snapshot`. Returns the response recomputed with the resolution applied. |
| `DELETE /merge-requests/:id/resolutions/:conflictId` | — | `MergeRequestResponse` | Shipped. `409` unless `status !== "merged"`. Removes the stored choice; idempotent if absent. |
| `POST /merge-requests/:id/merge` | — | `{ status: "merged", migration: Migration }` | The §4 transaction. `409` unless status ∈ `{open, held}` (a `queued` MR is not at the front). `409` with the kick-back body if re-validation is not clean. `409` with `{ error: "structural-validation-failed", errors: StructuralError[] }` if the re-run is clean but the merged candidate fails `validateDocument` (ADR 0008 §5) — see below. |
| `DELETE /merge-requests/:id` | — | `{ ok: true }` | Abandon. If the MR was active (`open` / `held`), promote the oldest `queued` MR to `open`. |

---

## 4. Response shapes

`User`, `Organization` — `src/domain/users.ts`. `Operation`, `LogOp`, `LogEntry` — the engine
and `src/domain/operations.ts`. `MergeReport`, `Conflict`, `Resolution` — `engine/merge-types.ts`.
`Migration` — `engine/emit.ts`. `SchemaDocument`, `ColumnType` — `engine/schema.ts`.

Every response is domain and engine data plus framing the client cannot derive (queue
position, staleness). No pre-rendered display strings, no `MergeReview` assembly — the client
projects into the `web/src/merge-review/model.ts` and `web/src/data/types.ts` shapes itself,
growing the transform its fixtures hand-write today (ADR 0004 §7).

```ts
// GET /overview — DataSource.getOverview. An aggregate of three domain lists, not a
// projection: Database (counts + trunk revision), and the branch / merge summaries.
type Overview = {
  database: Database;          // web/src/data/types.ts
  branches: BranchSummary[];
  merges: MergeSummary[];
};

// GET /branches/:name — domain facts + the two raw documents
type BranchDetail = {
  name: string;
  author: string;             // resolved User.displayName
  cutOn: string;              // ISO date
  head: SchemaDocument;
  base: SchemaDocument;        // base_snapshot
  divergence: number;         // count of derived deltas base → head
  openMergeRequestId: string | null;
};

// GET /merge-requests/:id, POST /merge-requests, and the return of every resolution mutation
type MergeRequestResponse = {
  id: string;
  source: string;
  target: string;
  author: string;             // resolved User.displayName
  openedAt: string;           // ISO
  // the frozen triple (ADR 0004 §5)
  base: SchemaDocument;
  ours: SchemaDocument;
  theirs: SchemaDocument;
  // recomputed every read (ADR 0004 §5) — raw engine output
  report: MergeReport;        // engine/merge-types.ts
  migration: Migration;       // engine/emit.ts — emitMigration(theirs, merged)
  // queue framing (ADR 0004 §3)
  queue: {
    status: "queued" | "open" | "held" | "merged";
    position: number;         // 1 = front / active
    ahead: number;
    behind: number;
  };
  stale: boolean;             // main.head_version !== previewed_main_version
  // stored resolutions currently in force — a resolved conflict is absent from
  // `report.conflicts` (the engine Conflict carries no resolvedWith), so the
  // client rebuilds its card from this row plus the conflictId's `${class}:
  // ${sortedObjectIds}` encoding.
  appliedResolutions: Array<{
    conflictId: string;
    choice: "ours" | "theirs" | "type";
    type: ColumnType | null;
    snapshot: { base: unknown; ours: unknown; theirs: unknown };
  }>;
  droppedResolutions: Array<{ conflictId: string; why: "changed" | "absent" }>;
};
```

The client feeds `report` + `migration` + `base`/`ours`/`theirs` into the `MergeReview`
transform (`rows`, `RowResolution` gate states, pre-rendered `detail` strings,
`fabricationOrder`) — the same shape `web/src/merge-review/fixture.ts` builds from literals
now.

---

## 5. `POST .../operations` — 422 body

```ts
{
  error: "drop-blocked",
  failedAt: number,          // index into the submitted ops[]
  op: Operation,             // the offending op, echoed back
  dependents: Array<{
    kind: "index" | "unique" | "primaryKey" | "foreignKey";
    id: string;
    name: string;            // the stored constraint/index name
    table: string;           // owning table id
  }>,
}
```

Nothing in the batch is persisted. The editor lists the dependents and the user removes them
first, each as its own operation (ADR 0001 §3 — drops are never cascaded).

### The structural backstop (ADR 0008 §5)

If every op applies cleanly but the resulting branch head fails `validateDocument`, the
response is instead:

```ts
{
  error: "structural-validation-failed",
  errors: Array<{
    reason: "duplicate-name" | "dangling-reference" | "nullable-primary-key-member"
          | "unsafe-default" | "orphaned-foreign-key",
    message: string,
    objectId: string,
  }>,
}
```

Also `422`, nothing persisted. `validateOperation` should already have blocked any single-op
route to an invalid whole, so this fires only on a gap in the per-op rules or a batch that
composes to an incoherent document — there is no single failing op, so the body carries no
`failedAt` / `op`. Same `StructuralError[]` shape as the merge path's `409` (§6).

---

## 6. `POST .../merge` — 409 body (the kick-back)

Returned when re-validation against live `main` is not `clean`. Per the ticket, the message
names what merged ahead and what now conflicts; it never tells the author their state is
invalid.

```ts
{
  error: "revalidation-failed",
  reason: "conflicts" | "unclassified-divergence",
  landed: Array<{ branch: string; mergedAt: string }>,   // merges into main since previewed_main_version
  conflicts: Conflict[],                                  // fresh from the re-run
  droppedResolutions: Array<{ conflictId: string; why: "changed" | "absent" }>,
  summary: string,   // e.g. "main moved on while this was open: contact-fields and
                     //       audit-log merged ahead of you. Two of your changes now
                     //       conflict with what landed."
}
```

The MR's status becomes `held`; its frozen triple and `previewed_main_version` are refreshed,
so the next `GET /merge-requests/:id` shows the current three-way. The MR stays at the front
of the queue (ADR 0004 §3) — the author resolves and retries, or abandons.

### Structural-validation failure (ADR 0008 §5)

Returned when the re-run against live `main` is `clean` but `validateDocument` finds the
merged candidate structurally broken — two individually-valid deltas that compose into a
duplicate name, a dangling reference, or a foreign key whose target lost its key backing
(the "order-independent illegality" ADR 0002 deferred).

```ts
{
  error: "structural-validation-failed",
  errors: Array<{
    reason: "duplicate-name" | "dangling-reference" | "nullable-primary-key-member"
          | "unsafe-default" | "orphaned-foreign-key",
    message: string,   // names the offending object
    objectId: string,  // the table / column / constraint / index id at fault
  }>,
}
```

Nothing is written and the MR is untouched — status, queue position, and frozen triple all
stay as they were. The author edits the source branch to remove the incompatibility and
retries. Unlike the kick-back, this is not a divergence the queue can resolve, so the MR is
not moved to `held`.

---

## 7. Transaction boundaries

| Operation | Lock / atomicity |
|---|---|
| `POST /branches/:name/operations` | Fold the batch in memory (pure `applyOperation`), then `validateDocument` the resulting head; only a fully clean batch reaches the one write transaction. Rollback on any op failure. |
| `POST /merge-requests` | `SELECT … FOR UPDATE` on the target `branches` row while checking for an active MR and inserting, so status assignment (`open` vs `queued`) is race-free. |
| `POST /merge-requests/:id/merge` | One transaction: `FOR UPDATE` on the target row → re-read `source.head` → `threeWayMerge` → on `clean`, `validateDocument` the candidate; if that passes, write head + bump version + append merge marker + set `merged` + refresh triple + promote next. On not-clean, set `held` + refresh triple. On a structural failure, return `409` and write nothing. |
| `DELETE /merge-requests/:id` | `FOR UPDATE` on the target row while removing the MR and promoting the next `queued` MR if the removed one was active. |
| `POST /workspace/reset` | One transaction over all truncates + re-seed. |

All merge throughput is one row lock wide (the target branch). V0/V1 has one trunk, so there
is exactly one such lock.

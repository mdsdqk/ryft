# Ryft full-codebase review log

- **Date:** 2026-09-03
- **Revision:** `c355e1ff` (`main` = `origin/main`, "fix: Usability fixes")
- **Scope:** entire tree (not a PR diff). `/review-security` against merge-base of `main` found **no diff** and did not start. Security findings below come from the API, DB, and UI specialists plus a source check of those claims.
- **Method:** parallel specialists (architecture, docs reliability, Hono API, Postgres/Drizzle, domain/engine, React UI), then parent verification of P0/P1 claims against source.

Specialists: architecture, docs-reliability, Hono API, Postgres/Drizzle, domain/engine, React UI. `/review-security` could not start (empty branch diff on `main`).

---

## How to read this

Severity:

| Tag | Meaning |
|---|---|
| **critical** | Data loss, wipe, crash, or merge that silently drops work |
| **high** | Wrong product behavior a user will hit on the happy / next-to-happy path |
| **medium** | Real bug or contract lie; narrower trigger or workaround exists |
| **low / smell** | Drift, duplication, missing tests, docs, a11y, scale |

`V0-documented` means an ADR or comment already admits the gap. It is still listed because it is user-visible or a production footgun.

Parent verification of the highest-severity items (unauthenticated reset, no `FOR UPDATE` on apply, merge not locking source, `conflictedIds` stripping sibling ops, Rules of Hooks on `?scenario=`, overview including `main`, closed MR blocking delete, `JSON.stringify` fingerprint, 422 collapse) **matched source**. Lower-severity specialist items are included as reported; they were not all line-checked.

---

## Executive summary

The package graph is sound: `engine/` is a pure leaf, the Hono API owns persistence and orchestration, the SPA projects engine output. Headline merge invariants (stable ids, rename-rebase on the catalog’s happy paths) hold.

The damage is in **concurrency**, **resolution application**, **status/DTO maps**, and **docs that still describe a fixture-bound V0**.

If you only fix five things:

1. **`POST /api/workspace/reset` is unauthenticated** and truncates the database. On a public Vercel URL this is a wipe button for strangers.
2. **`POST /branches/:name/operations` and undo do not lock the branch.** Concurrent edits can desync `head` from the op log or 500 on `(branch_name, seq)`.
3. **Merge `FOR UPDATE`s only `main`, then archives/deletes the source.** In-flight ops on the source can vanish with the branch.
4. **Classifier resolutions are keyed by object id, not slot.** Resolving one column conflict can strip independent attributes on the same column; table rename-vs-rename “take ours” and class-7 `setDefault` “take ours” are silent no-ops.
5. **Closed merge requests still block `DELETE /branches/:name`** (`status !== "merged"`), and the UI only offers Close — so withdraw → delete is 409 forever.

Also user-facing on HTTP (the default data source): dashboard/rail count `main` as a working branch; merge-review drops non-primary tables; queued reviews are not read-only; 422s that are not drop-blocked become `target-not-found`.

Docs reliability score from the specialist: **81/100**. Local `pnpm` scripts and ports match. The documented Vercel recipe (`db:push` then `db:migrate`) and the curl walk (`@titles-ops.json`) do not.

---

## Consolidated finding register

Deduplicated across specialists. Location is `file:line` in `c355e1ff`.

### Critical

| ID | Severity | Area | Location | Finding |
|---|---|---|---|---|
| C1 | critical / security | API | `api/_server/app.ts:39-40`, `api/_server/routes/session.ts:48-51` | `POST /api/workspace/reset` is mounted before identity middleware. Anyone who can hit the URL truncates orgs/users/branches/MRs and reseeds. No secret, env gate, or confirm token. Sign-in UI calls it with no header. Documented as chicken-and-egg for a fresh DB; still a production wipe on Vercel. |
| C2 | critical / race | API+DB | `api/_server/routes/branches.ts:126-193` | Apply reads `head` and `max(seq)` outside a lock, applies in memory, then writes. Two concurrent POSTs can share `startSeq` → PK 500, or last writer overwrites `head` so the log has both batches and `head` has only one. Undo (`:199-240`) is the same pattern. |
| C3 | critical / race | API+DB | `api/_server/routes/merge-requests.ts:208-289` | Merge `FOR UPDATE`s only `main`. Source is a plain select (`:219`). Then archive uses that snapshot and `DELETE`s the source (ops cascade). Concurrent `POST .../operations` can commit a newer head that is never merged and is destroyed. |
| C4 | critical / invariant | engine | `engine/classify.ts:590-593`, `:611-639`, `:732-777` | `conflictedIds` / `theirsLosers` / `applyResolution` are keyed by **object id**, not slot. After one column conflict, remaining ours ops on that column are dropped. Same-column retype+nullable: `setNullable` is stripped. Same-column rename+retype: `find(subject.id)` can read `.to` off a rename. Catalog #36 uses two different columns, so tests miss this. |
| C5 | critical / invariant | engine | `engine/classify.ts:751-755` | Class 3 `rename-vs-rename` “take ours” only pushes `renameColumn`. `renameTable` is never applied; theirs’ rename is still pruned → merged keeps the **base** name. The editor can rename tables. |
| C6 | critical / invariant | engine | `engine/classify.ts:756-762` | Class 7 “take ours” only replays `changeIndex` / `changeUnique` / `changeForeignKey`. Divergent `setDefault` with `choice: "ours"` is a silent no-op; merged default is base. API still accepts `ours`/`theirs` for class 7. |
| C7 | critical / crash | UI | `web/src/surfaces/MergeReviewRoute.tsx:18-38` | `useResource` runs only after early returns for `?scenario=loading\|error\|clean\|…`. Changing the query string changes hook count → React “Rendered more hooks than during the previous render”. |

### High

| ID | Severity | Area | Location | Finding |
|---|---|---|---|---|
| H1 | high / race | API | `api/_server/views.ts:148-169` | `refreshTriple` bails in JS if terminal, then `UPDATE … WHERE id = ?` with **no status predicate**. A GET that read `open` racing a merge can rewrite the historical freeze. Overview list calls this on every live MR. |
| H2 | high / bug | API | `api/_server/views.ts:30, :83-85` | `conflict_snapshot` compared via `JSON.stringify`. Postgres jsonb does not preserve key order; pglite tests often do. False “changed” → every saved resolution dropped on Neon (`droppedResolutions`). Sticky by ADR 0004 §6 (rows are never deleted). |
| H3 | high / bug | API | `api/_server/routes/merge-requests.ts:127-178` | POST resolutions does not `refreshTriple`. Validates against the stored freeze, then GET assembly refreshes. Choice saved against yesterday’s conflict and immediately dropped. |
| H4 | high / ADR violation | API | `api/_server/routes/branches.ts:89-91` | Delete guard is `status !== "merged"`. `closed` (and queued/open/held) block. `views.isTerminal` already treats `closed` as terminal. UI only exposes Close, not hard-delete of the MR. Withdraw → delete branch → 409 forever. Client copy says an **open** request holds the branch (`web/src/data/http.ts:129-130`). |
| H5 | high / bug | API | `api/_server/routes/merge-requests.ts:121-124` (and merge/close/delete/resolutions) | Non-UUID `:id` → PG `22P02` → `{ error: "internal error" }` 500, not 404. |
| H6 | high / bug | API | `api/_server/routes/branches.ts:147-160`; `merge-requests.ts:157-160` | `ops[i] as Operation` with no runtime shape. Unknown `op.type` → `validateOperation` returns `undefined` → `.find` throws 500. `choice === "type"` only checks `typeof type === "object"`. |
| H7 | high / emit | engine | `engine/diff.ts:126-130`; `engine/emit.ts:252-268`, `PHASE` `:375-393`; skip in `engine/invariants.test.ts:53,96-118` | PK **id** replacement emits unpaired `dropPrimaryKey` + `addPrimaryKey`. Apply drops first; emit `ADD`s while old PK exists → `verifyPrefixes` throws. `test.fails` + `EMIT_SWEEP_SKIP` hide a production throw on `GET /merge-requests/:id` (`views.ts:102-103` `emitMigration` uncaught). Editor `changePrimaryKey` path is safer. |
| H8 | high / emit | engine | `engine/emit.ts:375-378` | `createTable` and `renameTable` share phase 1. Rename `users`→`people` and create new `users` can `CREATE TABLE "users"` while `"users"` still exists. Column rename vs add got the split; tables did not. |
| H9 | high / invariant | engine | `engine/classify.ts:176-189`; `engine/validate.ts:702-820` | No name slots for indexes/uniques/FKs/PKs. Duplicate index names: clean merge, then emit/replay throws. Duplicate constraint names: emit SQL Postgres rejects. `validateDocument` only de-dupes table names and column names within a table. |
| H10 | high / invariant | engine | `engine/classify.ts:267-292` | PK member ids are not in `refs()`. Add/change PK vs drop column is not class 6. Clean merge with dangling PK members; `validateDocument` 409s later. Catalog #26 is index vs drop, not PK. |
| H11 | high / bug | engine | `engine/classify.ts:629`, `:764-769` | Table-level drop-vs-modify “take ours” does not prune child ops (retype of a column). Order “drop then retype” → `unclassified-divergence` after the user resolved a clear class 5. |
| H12 | high / ADR | engine | `engine/validate.ts:289-312` | `createTable` does not validate nested ids / indexes / uniques / FKs. Inline FK to a missing table applies; batch `validateDocument` 422s. Nested duplicate ids break global stable-id uniqueness. |
| H13 | high / purity | engine | `engine/diff.ts:92,139,244`; `engine/classify.ts:476-480`, `:683-719` | `diffSnapshots` stores live object refs; `remapRefs` mutates them in place → mutates **`ours`**. Degenerate-overlap remap also misses nested createTable FKs/indexes, addPrimaryKey, addColumn.column.id. |
| H14 | high / UI | UI | `web/src/surfaces/Dashboard.tsx:198-204,277-279,325-333`; `web/src/shell/Rail.tsx:25`; `api/_server/views.ts:447-448,262-284` | HTTP `GET /overview` includes `main` (`trunk: true`). Dashboard does not filter `!b.trunk`. Fixture uses `listWorking`. Production: “Working branches” off by one; Recent branches lists `main`; rail count includes trunk. |
| H15 | high / UI | UI | `web/src/merge-review/fromResponse.ts:334-346,425-440` | Zone A/C built from the table with the most ops. Other tables’ edits dropped. Table-level create/drop/rename never become rows. Conflicts still come from the full report → Zone B can show an object Zone A never lists. |
| H16 | high / UI | UI | `web/src/merge-review/fromResponse.ts:537-546`; `api/_server/views.ts:340-345` | List never emits `status: "stale"`. Review model ignores `res.stale`. After `main` moves, a queued request looks like a normal queue row. “Stale base” is fixture-only. |
| H17 | high / UI | UI | `web/src/merge-review/MergeReview.tsx:90,112-136` | `readOnly` is only `isTerminal`. Queued reviews still accept 1/2/3; POST 409 `not-front` rolls back with no message. Contract: queued is read-only. |
| H18 | high / UI | UI | `web/src/merge-review/model.ts:232-235`; `fromResponse.ts:544-546` | Queued + clean three-way: `effectiveStatus` promotes to `cleared` (dial **Reviewed**) while Zone D stays **Queued** and Merge stays hidden (`canRelease` needs `in-check`). |
| H19 | high / UI | UI | `web/src/merge-review/MergeReview.tsx:94-98,140-157` | Undo resolution is optimistic; failed DELETE swallowed. `canRelease` uses server `live`, not the overlay. Merge can land the choice the user just undid. |
| H20 | high / UI | UI | `web/src/merge-review/components/ConflictQueue.tsx:106-108`; `TitleBlock.tsx:21` | Closed MR copy is always “Merged — this queue is a record…”. Title block never has a closed state (ready/awaiting/complete). Withdrawn request reads as merged. |
| H21 | high / UI | UI | `web/src/surfaces/branch/TableCard.tsx:297-312,345-384,439-454` | `+ column` / `+ index` / `+ unique` set open state but forms only render when the group is expanded. Collapse all → buttons look live and do nothing. |
| H22 | high / UI | UI | `web/src/data/http.ts:181-186` | HTTP op log maps `author: e.authorId` (UUID). Fixture shows `"grace"`. |
| H23 | high / UI | UI | `web/src/data/http.ts:38-54`; `Rail.tsx:23-54` | 401 does not sign out. Stale `localStorage` after reset → every call 401; rail stays “loading…”. Only recovery is Sign out. |
| H24 | high / mapping | UI | `web/src/data/http.ts:203-213,313-330` | Editor 422 without `dependents` becomes `reason: "target-not-found"`. Structural validation looks like “target not found”. Merge 409 `structural-validation-failed` is not mapped (unlike `revalidation-failed`). |
| H25 | high / UX | UI | `web/src/shell/routes.tsx:31-36`; `SignIn.tsx:89` | Signed-out deep link (`/merge/:id`, `/branch/:name`) is replaced with `/`. After authenticate, always `/db`. |
| H26 | high / docs | docs | `docs/build.md:171`; `vercel.json:5` vs `docs/build.md:66-78` | Curl walk uses missing `@titles-ops.json`. Deploy docs say `db:push` then `vercel deploy`; `vercel.json` runs `db:migrate` — push then migrate on the same Neon DB fails. |
| H27 | high / contract | docs | `docs/backend-contract.md`; `docs/build.md:90-118` | Implemented but missing from the contract: `closed` + `closed_at`, `POST .../close`, `GET /branches/deleted`, dropped `source_branch` FK, apply `warnings`, ADR 0014 trunk revision. Reset auth: contract §2 vs §3 disagree. |
| H28 | high / fixture | UI | `web/src/data/branches.ts:34-38`; `mergeReview.ts:44-48` | Fixture lists branches/MRs that 404 or all open the same `ordersReview`. HTTP default hides this; `VITE_DATA_SOURCE=fixture` does not. |
| H29 | high / integrity | DB | `api/_server/db/schema.ts:123-129`; `0003_drop_source_branch_fk.sql` | Dropping `source_branch` FK is **correct** for terminal rows (merge deletes the source). Live `queued/open/held` rows can still orphan: create reads source outside the tx; delete takes no row lock. Dangling live MR → merge `source.head` TypeError 500. |
| H30 | high / integrity | DB | `api/_server/views.ts:362-389` | Terminal MR summaries count ops by reusable `source_branch` **name**. After merge the name is free; recutting aliases the new log onto the old merged request. |

### Medium (selected; full lists in specialist sections)

| ID | Area | Finding |
|---|---|---|
| M1 | API | Merge list never emits `stale`; `GET /merge-requests` default is live queue only (contract: non-terminal then merged, with ahead/behind). |
| M2 | API | Resolved conflicts remain in `report.conflicts`; engine only decrements `unresolvedCount`. Web filters by `appliedResolutions`; a naive client double-renders. |
| M3 | API | Duplicate `POST /merge-requests` 409 `{ error: "merge-request-exists", mergeRequestId }` — client treats as success with `status: "open"` even if existing is queued/held. |
| M4 | API | Check-then-insert on branch create and session create: unique violation → 500, not 409. |
| M5 | API | `GET /branches/:name/operations` never 404s (empty `[]` for missing/deleted). `GET /branches/deleted` shadows a branch literally named `deleted`. |
| M6 | API | Merge/close crash if `main` or `source` is missing (`source.head` with no null check). |
| M7 | API | `DATABASE_URL` missing throws in `db()` before Hono `onError` — not `{ error: "internal error" }`. |
| M8 | API | Hard DELETE of MR is not idempotent (second → 404). Merge of already-merged → `not-front`, not `already-merged`. |
| M9 | engine | Unique column order compared as a set (`eqSet`) — order-only edits emit no op (I1 can fail). Indexes/PKs use `eqSeq`. |
| M10 | engine | Add FK vs drop of backing unique/PK is not a merge conflict; `validateDocument` 409s after a `clean` report. |
| M11 | engine | `createTable` with zero columns validates and emits invalid SQL. |
| M12 | engine | Catalog #23 “composite index order swap” fixture is not that scenario (theirs changes the set). I8 never calls `validateDocument`. |
| M13 | engine | Pure `dropIndex`/`dropConstraint` never set `destructive: true`; `alterColumnType` cannot. Tests lock the wrong ADR 0003 §5 behavior. |
| M14 | UI | Resolve rollback on failed POST deletes the previous choice instead of restoring it. |
| M15 | UI | Editor `apply` closes over stale `head`; overlapping card submits validate against an old schema. |
| M16 | UI | Table rename has no error UI (name snaps back). Deleted-branches section shows “No deleted branches.” while loading. |
| M17 | UI | `clock()` is local TZ; `formatDate()` is UTC — same timestamp disagrees across surfaces. Merge list pills use raw ISO. |
| M18 | UI | Session always `fetch("/api/session")` — fixture mode cannot sign in if API is down. Reset also bypasses the data seam. |
| M19 | UI | Escape does not cancel Confirm merge (handler on non-focusable `<p>`; Confirm has autoFocus). Close has no confirm. |
| M20 | UI | Comparison filter freezes on “Conflicts only”; after last resolve Zone A looks empty. |
| M21 | arch | No shared wire-type package (`api/_server/types.ts` vs `web/src/data/types.ts` vs `fromResponse.ts`). Import cycle `data` ↔ `merge-review` ↔ `surfaces/branch`. Five status taxonomies. |
| M22 | arch | Resolution application still a spike (`classify.ts:613-625` refuses add-vs-add, PK, `conflictId` containing `+`). UI stores choices; `unresolvedCount` stays > 0. Documented V0. |
| M23 | DB | No partial unique for one live MR per source / one open\|held per target. Queue invariants are application-only. |
| M24 | DB | No CHECK tying `status` to `merged_at`/`closed_at`. `choice`/`payload` unconstrained. JSON documents not validated on undo/seed/refreshTriple. |
| M25 | docs | README/ADR 0010/scope still say fixture-bound web and unbuilt editor. Structured editor and HTTP DataSource have shipped. “or local Postgres” is a blocker (Neon serverless driver needs a WS proxy). Node ≥ 20.12 and pnpm 11 undocumented. |

### Low / smells (index)

Unauthenticated-by-design username header (ADR 0001); no CORS (same-origin today); two error JSON dialects (`HTTPException.message` vs `{ error: code }`); branch names silently lowercased; GET-as-write (ADR 0012, locked); date formats mixed ISO vs `YYYY-MM-DD`; `openMergeId` vs `openMergeRequestId`; identity lookup ignores `organization_id`; `branches.name` is a global PK (org column is decoration); N+1 three-way on overview; `sameDoc` via stringify; seed `headVersion` 1:1 with ops vs API once-per-request; seed TRUNCATE omits `deleted_branches` by name (CASCADE today); `0000` rewritten in place + `0002` patch; migrate-on-static-build; pglite typed as Neon; engine spikes beside production tests; `classify.ts` still titled spike; `src/index.ts` leftover; `src/domain/` types-only stub; `?scenario=` / `?empty` / `?wide` on production routes; duplicate `sqlType` / `CreatePlate` / `todayStamp`; unused `useTheme().toggle`; GET sends `content-type: application/json`; no web component/e2e tests; `puppeteer-core` is screenshots only; RLS off; no jsonb schema version field; `freshId` is 32-bit; `looksLossy` warns on `int→bigint`; ADR 0002 / PRODUCT.md / merge-engine.md still say classify/merge unwritten.

---

## Security (full tree; PR-diff review did not run)

`/review-security` on `Diff: branch changes` while HEAD = `main`: **no diff to review.**

Full-tree security picture from API/DB/UI specialists + source check:

| Severity | Location | Finding |
|---|---|---|
| critical | `api/_server/app.ts:39-40`, `session.ts:48-51` | Unauthenticated workspace wipe (`POST /api/workspace/reset`). |
| high | `api/_server/app.ts:42-52` | Identity is `x-ryft-user` = username. No token, no cookie, no CSRF token. Any client that can set the header is that user. **Locked** by ADR 0001 §4 (impersonation is a non-goal). Still: any signed-in user can merge/delete/edit any branch; header is not trimmed (session create is). |
| high | `web/src/session/session.ts` | Durable identity is `localStorage` key `ryft.user` (the username). XSS in the SPA would be session theft; no `dangerouslySetInnerHTML` found (good). |
| medium | `api/_server/app.ts:63` | `console.error(err)` on 500 may log PG/driver messages (connection strings) to serverless logs. Response body is the generic `"internal error"`. |
| medium | deploy | Reset + username auth + public Vercel URL = demo-shaped security on a production host. |
| low | `api/_server/app.ts` | No CORS middleware. First-party web is same-origin (Vite proxy / Vercel rewrite). A foreign-origin browser POST of reset does not need CORS if it is a “simple” request; there is no cookie to attach. CSRF is mainly relevant if a cookie is added later. |
| low | `api/_server/db/schema.ts` | RLS off. Database trusts the API. |
| clean | persistence | Parameterized Drizzle; the only raw SQL interpolates Drizzle table objects (`TRUNCATE`), not user strings. |
| clean | UI | Names/SQL rendered as text nodes; XSS surface is low. |

---

## Architecture

Layering at the package level is intact:

```
web  ──HTTP──►  api  ──►  domain (types)
  │              │
  └── @engine ◄──┘
                     domain ──► engine
                     examples ──► engine + domain
                     engine ──► (nothing)
```

Web importing `validateOperation` / `applyOperation` / `diffSnapshots` is **locked policy** (ADR 0004 §7, 0008 §1), not a layer violation.

### What is strong (do not “clean up”)

- Engine isolation is real: production `engine/*.ts` imports only siblings; zero runtime deps.
- One `Operation` vocabulary owned by the engine; `src/domain/operations.ts` re-exports it.
- `jsonb` `SchemaDocument` — no second relational model of tables/columns.
- Server re-applies every edit through `applyOperation`; merge is pure; queue/resolutions are API.
- Same Hono app in pglite tests, local `node-server`, and Vercel `app.fetch`.
- Recompute report/migration on read rather than freezing a second copy of engine internals.
- `OverviewProvider` dedupes `GET /overview`.

### Architectural smells

**P0 — ADR lock violated**

- Closed MRs still block branch delete (`branches.ts` vs ADR 0012/0013 / `views.isTerminal`).

**P1**

- No shared contract package; three DTO copies. Field rename (`openMergeRequestId` vs `openMergeId`) is a silent client bug.
- Five status taxonomies (pg enum, engine verdict, list DTO, `RevisionStatus`, ADR 0011 labels). `"stale"` already drifted (type yes, HTTP list no).
- Import cycle: `data` ↔ `merge-review` ↔ `surfaces/branch`.
- HTTP 422 → `target-not-found` for every non-drop failure.
- Resolution spike in production `classify.ts`. UI/API persist choices the engine ignores.
- Fixture vs `seedWorkspace` are two products (ADR 0005 §2 convergence not done).
- Inconsistent error JSON: human sentence vs kebab-case code in the same `error` field.
- Session and reset bypass `DataSource`.

**P2**

- `api/_server/views.ts` (~500 lines) is a god module (read assembly, merge folding, queue refresh, kick-back copy).
- `fromResponse.ts` (~576 lines) is a god projection (single-table drop, class maps, gates).
- `merge-requests.ts` still calls `threeWayMerge` beside SQL (second resolution path can skip fingerprinting).
- `GET /branches/:name/operations` no 404.
- `?scenario=` / `?empty` / `?wide` on production routes.
- Dual dependency-order implementations (`apply.ts` / `emit.ts` / `replay.ts`); PK id-swap emit gap already pinned with `test.fails`.
- `listOpenMergeSummaries` runs a full three-way per open MR.
- `sameDoc` via `JSON.stringify` vs engine `canon()`.
- No web component/e2e tests; pglite typed `as unknown as Db`.
- `vercel.json` migrates production Postgres on every frontend deploy.

**P3 — stale locks**

ADR 0002 / 0010 / `docs/build.md` / engine-test-catalog / `examples/seed.workspace.ts` / SignIn/session comments still describe a fixture-bound V0. `src/index.ts` leftover. Engine `*.spike.ts` not on the production import graph.

`src/domain/` is a types-only stub (`User`, `Organization`, `LogEntry`, `MergeMarker`). Branch/MR/queue/resolution types live as Drizzle + API DTOs + UI VMs. Engine isolation is why this is thin; “domain” is not the anti-corruption layer the ADRs imply.

GET-as-write (`refreshTriple`) is **locked** (ADR 0012 §1), not a smell to fix without an ADR.

---

## Docs reliability

**Score: 81/100**

A cold agent with pnpm, Node 20.12+, and a Neon `DATABASE_URL` who follows **docs/build.md Local** (and ignores leftover “fixture-bound / editor unbuilt” sentences) gets a running API + SPA.

Ports: API `8787`, web `5180` (proxies `/api`). Seed: `POST /api/workspace/reset` (no auth). Tests: `pnpm test` — 347 passed + 1 expected fail, no database.

### Documented path vs actual

| Documented | Actual |
|---|---|
| `pnpm install` / `pnpm test` / `pnpm typecheck` | Exist. `typecheck` is root-only (`web/`/`api/` excluded); full check is undocumented `typecheck:all`. |
| `pnpm --filter @ryft/api db:push` / `dev` | Exist. |
| `pnpm --filter @ryft/web dev` | Exist. Port 5180. |
| `DATABASE_URL`, `VITE_DATA_SOURCE=fixture` | Actual. HTTP is the **default** DataSource. |
| `http://localhost:8787/api` | Actual (`PORT` default 8787). |
| Deploy: `db:push` then `vercel deploy` building only `@ryft/web` | `vercel.json` `buildCommand`: `db:migrate && @ryft/web build`. |
| Golden-path `curl -d @titles-ops.json` | **File does not exist.** Ops live in `api/_server/__tests__/golden-path.test.ts`. |

### Blockers if followed literally

1. `curl … -d @titles-ops.json` — missing file.
2. `db:push` then Vercel `db:migrate` on the same DB — reapplies `0000` CREATE TYPE/TABLE, fails.
3. `DATABASE_URL` to local Postgres then `api dev` — Neon serverless `Pool` needs a WebSocket proxy; TCP local pg will not speak that protocol. `drizzle-kit push` may still succeed (TCP), then `dev` fails.
4. Node 18 + `process.loadEnvFile` in `api/_server/dev.ts` — throws. Node ≥ 20.12 and pnpm ^11.13.0 are undocumented in README.
5. `POST /api/session` on an unseeded DB → 409 until reset. UI has Reset workspace; docs mostly show curl reset.

### Misleading / stale (not boot blockers)

- README layout table + ADR 0010 + `docs/scope.md` + `decisions.md` / `decisions.log.md`: web fixture-bound, editor unbuilt. Code: HTTP default; `BranchWorkspace` / `SchemaView` / `ColumnEditor` / `POST /branches/:name/operations`.
- Test counts: “223 engine tests”, “15-test API suite”. Today: 347 passed + 1 expected fail; API `it()` count ~52 across five files.
- `docs/backend-contract.md`: six tables, no `closed`, `source_branch` FK present, no close/deleted endpoints, “No code ships with this ticket”.
- `docs/build.md`: `trunkRevision = main.head_version` (ADR 0014 uses merge markers); GET refresh only `open`/`held` (also refreshes `ours` for `queued`); V1 rows (resolutions, queue) “omitted” — shipped.
- ADR 0010: `validateDocument` on merge is V1 — runs in `POST .../merge`. Golden-path “409 when one MR already open” is 409 for the **same source**, not a global one-open guard.
- `docs/first-run.md`: nudge “Try a rename: posts.body → content” — no such copy in `web/src`. Empty-state “Cut one…” vs UI “Create one…”.
- `PRODUCT.md`: merge-review built, rest planned; classify/threeWayMerge “not yet written”; cites `.scratch/` which is gitignored.
- `docs/engine-test-catalog.md` §4: API tests “not built”.
- Windows: README `curl localhost` without `http://`; PowerShell `curl` is often `Invoke-WebRequest`; `jq` assumed.

### Missing from docs but real

Node ≥ 20.12, pnpm 11; Vercel build runs `db:migrate` so `DATABASE_URL` must exist at **build** time and you should not `db:push` first; UI Reset workspace; `GET /branches/deleted` and `POST /merge-requests/:id/close`; clean merge archives the source branch (ADR 0013 §6) so `contact-fields` disappears after the golden-path merge; apply success `warnings[]`.

---

## API (Hono) — specialist detail

Identity gate on everything except session + reset. Merge/create/close/hard-delete serialize on `main` via `FOR UPDATE` **among themselves**. Structural backstop on apply (422) and merge (409, writes nothing) matches ADR 0008 and has tests. Kick-back holds the front. Close is idempotent. `GET /branches/deleted` is registered before `/:name`. Vite proxy makes missing CORS a non-issue for the first-party app. No secrets in JSON responses.

### Additional API notes not in the consolidated table

- **Error envelope two dialects:** `HTTPException` → `{ error: <human message> }`; structured paths → `{ error: <code>, … }`.
- **Branch create** `name.trim().toLowerCase()` then identifier regex. `"Contact-Fields"` → 201 `contact-fields`.
- **Undo** with `after` ≥ last seq still bumps `headVersion`. Undo replay skips `validateDocument`.
- **`after` query parsing:** `Number(afterRaw)` + `Number.isInteger` accepts `1e2`, `0x10`.
- **Username length:** API `username.length` (UTF-16); client `[...clean].length` (code points).
- **Kick-back `reason`** typed as `MergeReport["verdict"]` including `"clean"`; path only runs when `!merged`.
- **Dead fallback** `emitMigration(main.head, merged)` in merge-requests — `resolveMerge` always sets migration when merged.
- **PUT/PATCH/HEAD** exported on Vercel with no routes.
- **Unknown paths:** Hono text 404 after auth (`GET /api/nope` without header → 401 first).
- **GET of a live MR is a write** (ADR 0012). `http.ts` coalesces in-flight GETs, which can share a mutating read.
- **Date formats:** `cutOn` / `openedOn` / `trunkRevision.at` / `mergedOn` are `YYYY-MM-DD`; `openedAt`, `deletedAt`, op-log `at` are full ISO.

### Test gaps (API)

- “Does not re-freeze a merged request” never edits after merge (source is archived, so the assertion is vacuous).
- No test that reset clears `deleted_branches`.
- No test that a **closed** MR blocks (or doesn’t) branch delete.
- No concurrency tests for apply / merge vs `POST .../operations` / GET refresh.
- No tests for 422 empty ops, invalid UUID, GET operations 404, `after=1e2`, unknown op type, `choice: "type"` without a real `ColumnType`.
- Golden path never asserts close, `?state=closed`, or `GET /branches/deleted`.
- `MergeSummary.stale`, list `ahead`/`behind`, and `warnings` unasserted.

### ADR alignment (API)

| ADR | Status |
|---|---|
| 0012 §1 `ours` follows source on live GET | Implemented. Race on UPDATE (H1). `docs/build.md` still says only open/held. |
| 0012 §2 `droppedResolutions` | Implemented; sticky rows; stringify fingerprint (H2). |
| 0012 §3 close, `closed` terminal, DELETE kept | Implemented. Contract not updated. Close-blocks-delete follow-up not done (H4). |
| 0013 archive, deleted list, merge archives source | Implemented. Guard still `!== "merged"`. |
| 0014 `trunkRevision` = merge-marker count | Implemented. `docs/build.md` still says `main.head_version`. |

---

## DB (Postgres / Drizzle) — specialist detail

Sound for **single-user sequential** use: merge is one transaction with `FOR UPDATE` on `main`; JSON schema docs are intentional (ADR 0004 §1); parameterized queries; pglite tests apply the same committed SQL files.

Archive-then-delete of a merged source is the right reason to drop the `source_branch` FK. The cost is unconstrained **live** rows (H29).

### Schema / migration

- `merge_request_status` enum: `queued \| open \| held \| merged \| closed`. No CHECK that `merged_at`/`closed_at` match status.
- `choice` is `text` with TypeScript `$type` only; `payload` optional jsonb; weak `typeof === "object"` for `"type"`.
- Only secondary index is `users_org_username_uq`. Missing indexes: `merge_requests.source_branch`, `(target_branch, status, created_at)`, `status`, `deleted_branches.deleted_at`.
- `deleted_branches.name` is **not** unique (by design). Recutting does not PK-collide. Failure mode is name-as-FK by convention (H30), not row resurrection.
- `operations` `ON DELETE cascade` wipes the op log on archive (ADR 0013 explicit). Restore, if built, can only put back frozen documents.
- Hard `DELETE /merge-requests/:id` cascades resolution history.
- `target_branch` FK remains `ON DELETE no action` (correct while target is only `main`).
- `branches.name` is a global PK; `organization_id` does not scope it. Multi-tenant is a rewrite.
- `0000` was edited in place after apply; `0002` is `IF NOT EXISTS` so pglite (current `0000`) and old Neon both converge. Migration history is not append-only.
- Local docs/`api/.env.example`: **`db:push`**. Production: **`db:migrate`**. Tests: migrator on SQL files. A push-initialized DB then migrated tries to run `0000` and fails.

### Transactions / races (beyond C2/C3/H1)

- Create-MR source snapshot taken outside the transaction; next GET `refreshTriple` repairs `ours` for live MRs.
- Resolutions save/delete are not under the merge lock; upsert onto a `merged` row is allowed by the table.
- `promoteNext` does not assert no remaining `open`/`held`.
- `POST /session` lookup by `username` not `(organization_id, username)`; unique is per-org. Concurrent first sign-in → 500. Second org would make login non-deterministic.
- `nextSeq` / max-seq loaded in application code (`reduce`). Under the main lock this is safe for merge; on working branches it is racy (C2).
- Seed TRUNCATE list: `merge_requests, operations, branches, users, organizations`. Relies on CASCADE for `deleted_branches` and resolutions.
- Seed `contact-fields` has 3 ops and `headVersion: 3`. API bumps once per request (golden path: 3 ops → `headVersion: 1`).
- `examples/seed.workspace.ts` status union omits `closed`.
- Domain timestamps are ISO strings; Drizzle returns `Date`.
- Pool singleton: `poolQueryViaFetch` for queries; transactions still open WS. No `max`/`idleTimeout`. Process-wide singleton never `end()`s.
- Overview loads full jsonb `head`/`base_snapshot` only to run `diffSnapshots(...).length`.
- Revision list `at` is `YYYY-MM-DD`; two merges the same UTC day look identical (ADR 0014 accepted a date).
- Dual counters: marker count vs `main.head_version`. They match today because `main` is uneditable. No DB constraint.
- No jsonb document `version` field. Adding a required `Table` field is an invisible break for stored rows.
- `LogOp` allows `MergeMarker` on any branch; only merge writes them, and only onto `main`.
- pglite tests: one in-process connection, `as unknown as Db`. Cannot see multi-session locking, Neon HTTP vs WS, or Vercel freeze. C2/C3/H1 will stay green in CI.

---

## Domain / engine — specialist detail

`src/domain/operations.ts` correctly re-exports `engine/operations.ts` (no second `Operation` union). Engine does not import domain types. Catalog happy paths (rename-rebase, independent slots, commutativity on independent rows) work. `examples/branched.schema.ts` index holds `seedIds.users.email` across the rename — headline path is real.

There is no second merge implementation in the API. Dangerous duplicates are **mode tables** (`fromResponse.resolutionModesFor` vs classify) and **warning derivation** (`deltaWarnings` vs `applyOperation`), not a parallel classifier.

### Additional engine notes

- **Held (documented spike):** class 2, name-collision class 3, PK class 7. UI `resolutionModesFor` hard-codes class 1 / 6 / default and does **not** know those are held — can show ours/theirs for conflicts the engine will ignore (`unresolvedCount++`).
- **`applyDelta` drops** are silent no-ops if the object is already gone; adds/changes throw. New `Operation` kind is silently skipped (`bucket()` has no `never` default). Emit `expand` is exhaustive.
- **`change*` ops** copy columns/flags but **not** `name`. Diff also ignores `name`. No `renameConstraint` in V0.
- **`canonicalDoc`** drops unique `name` — oracle can hide unique-name divergence. Indexes/FKs keep full objects.
- **`threeWayMerge` composes** `applyDelta(theirsDelta, base)`, not onto live `theirs`. Table/column order follow apply `push` order. I1/I2 use `canon` so tests pass.
- **`divergingObjects`** only reports tables. Unclassified-divergence banner cannot name a column/index.
- Class 6a and PK class 7 report `base: null` even when `from` exists on the op.
- **`checkReferences`** vs replay `createIndex` vs `validateDocument` disagree on index/constraint name uniqueness.
- **`quoteIdent` comments** still say “placeholder until 0008”; implementation matches 0008.
- **`freshId`** is 32 bits; uniqueness test is 5k samples. Collisions rejected by `validateOperation`.
- **`numeric(0,0)`** allowed (`precision >= scale >= 0`).
- **`looksLossy`** warns on every cross-kind retype including `int→bigint`. Test name locks “narrowing” for a widening. Spec-faithful to `docs/robustness.md` §2.
- **FK type mismatch** after rename-rebase/retype is a documented non-conflict. `validateDocument` does not check FK endpoint types.
- **`deltaWarnings`** (web) validates every derived op against **base**, not progressive apply; errors from “target created later” are dropped, and so are those ops’ warnings.
- Catalog many rows only check `verdict` + sorted `class` list. `minRebased` / `minOverlaps` / `minRemaps` are `>= 1`. `rebased[].followedRename` never asserted against the renamed id.
- ADR 0002 header and `docs/merge-engine.md` still say classify/merge are unwritten.
- Spike files `engine/merge.spike.ts`, `engine/emit.spike.ts` sit next to production tests (catalog §0: keep as smoke runners).

### Suggested engine fix order (not implemented)

1. Key `conflictedIds` / `theirsLosers` / `keep` by **slot**, not object id; pick ops in `applyResolution` by `type`, not `find(subject.id)`.
2. Push `renameTable` on class 3 ours; push `setDefault` on class 7 ours.
3. Emit: `renameTable` before `createTable`; group unpaired `dropPrimaryKey`+`addPrimaryKey` like `changePrimaryKey`. Fix the I4 comment.
4. Name slots (or `validateDocument` duplicate-name) for indexes and constraints.
5. Put PK member ids in `refs()`.
6. `structuredClone` payloads in `diffSnapshots` (or clone before `remapRefs`).
7. Point I8 at `validateDocument`; add same-column multi-attribute and true `[a,b]` vs `[b,a]` fixtures; catch `emitMigration` on GET.

---

## UI (React) — specialist detail

Default data source is HTTP (`VITE_DATA_SOURCE=fixture` is the offline opt-in). Session is a module store via `useSyncExternalStore`. Inflight GET coalescing matches rail+dashboard overview share. ADR 0011 user-facing copy on lists is largely applied. Close vs merge in Zone D exists; refresh-note for dropped resolutions exists in the transform. Branch 404 vs generic error is distinguished. Open-MR 409 recovers `mergeRequestId`. Skip link and `#main` focus-on-navigate are present. Theme `localStorage` + `data-theme` work.

### Additional UI notes

- Bare `/merge` routes to `MergeReviewRoute` with `id === undefined` → not found.
- `held` and `open` both become `in-check` in `fromResponse`. Dial is Under review for both; Zone D still says Held when conflicts remain.
- ADR 0011: “Fabrication order” is still the Zone D heading (coined word to retire).
- Keyboard help is merge-review-only; shell G-then-letter was never built.
- Conflict queue: buttons inside `role="option"` (listbox vs inner controls).
- Sign-in `autoFocus` on username; workspace reset is inside the sign-in `<form>` (`type="button"`, so it works).
- Overview `?error` / `?empty` desync the rail (dashboard fakes failure; rail still live). `/merges?empty` empties the list but not the rail badge.
- `createMergeRequest` 409 recovery always reports `status: "open"`.
- Apply/undo `invalidateData()` in `finally` — failed edit still refetches.
- `useCollapse` never reseeds `initialCollapsed` (comment claims it does).
- Duplicate `CreatePlate` / `todayStamp` (Dashboard + Branches).
- `fixture.ts` header still says every surface shows “Demonstration data” (ADR 0011 removed that tag).
- Internal names still `cut` / `cutting` / `cutOn`; user copy is Create / branched.
- `useTheme().toggle` unused.
- `useDocumentTitle` depends on the `useMatch` object (extra title effect).
- Rail double-`decodeURIComponent` (RR already decodes). `%` in an id could throw.
- Unknown `?sheet=` leaves neither Schema nor Divergence current in the rail; workspace still shows SchemaView.
- OperationList comment: author filter “arrives with E2” — E2 shipped; filter never did.
- NewTableCard column `key={i}`. Column name field stays enabled while `busy` (blur can double-submit a rename).
- Comparison warning fragments lack keys.
- Keyboard `<details> open` state survives leaving the review.
- GET still sends `content-type: application/json`.
- `toBranchSummary` unused for list/overview (only `createBranch`).
- `parseConflictId` / `CLASS_MAP` on a malformed id can throw while rendering dropped/applied resolutions.
- `heldByMergeMessage` hard-codes target `"main"`.
- Theme group is `role="group"` + `aria-pressed`, not radiogroup.
- `#main:focus { outline: none }` — skip-to-content then shows no ring on main.
- OpenRow is a giant `<button>` containing the whole spec line.
- `TypePick` `autoFocus` inside the listbox.
- `OverviewProvider` fetches on every signed-in route including `/merge/:id`.
- `index.html` direction-contract comment still says “Received → In check → Cleared → Released”.
- WU-E brief: PK/FK/unique/`setDefault`/`renameTable` were out of V0 — they shipped. Hover-reveal Edit became an always-visible row button.
- Common ancestor identity is the target **name** (`base: res.target`), not `main@rev`. Model comment still says `"main@3a91f4"`.
- “All N objects” is only changed objects (op buckets), not the table’s full object set.
- Global J/K do not `preventDefault` — conflict moves and the sheet jumps.
- `todayStamp()` uses the local calendar; fixture `cutOn` can be “tomorrow” vs UTC.

### UI tests that miss regressions

- `merges.test.ts` pins ISO date labels (`Closed · 2026-02-05`) so `formatDate` never gets onto the pill. No HTTP vs fixture stale coverage.
- `fromResponse.test.ts`: no `stale: true`, `held`, `open`, multi-table ops, createTable/dropTable rows, queued+clean → `effectiveStatus`.
- `model.test.ts`: `effectiveStatus` never asserts `received` + mergeable.
- `divergenceModel.test.ts`: only warning roll-ups.
- Missing entirely: `MergeReviewRoute` hook order, overview trunk filtering, `heldByMergeMessage` vs closed MRs, 401 → session, `http.ts` 422/409 mappings. No component tests, no jsdom, no Playwright in CI.

---

## Cross-cutting map

These are the same bug seen from two layers:

| Theme | API/DB | Engine | Web |
|---|---|---|---|
| Closed ≠ terminal in delete | `status !== "merged"` | — | Copy says “open merge request”; Close is the only UI |
| Stale | List never emits `"stale"`; detail has a boolean | — | Fixture-only “Stale base”; `fromResponse` ignores `res.stale` |
| Warnings / 422 | API returns `warnings[]` and many `OpError.reason`s | `validateOperation` reasons | Client type omits warnings; non-drop 422 → `target-not-found` |
| Resolutions | Stringify fingerprint; POST doesn’t refresh; sticky dropped rows | Slot vs id; table rename / setDefault no-ops; spike holds | Optimistic undo; queued not read-only; UI modes ≠ engine holds |
| Status vocab | pg enum vs `MergeSummary.status` | `MergeReport.verdict` | `RevisionStatus` + ADR 0011 labels |
| Authors | `authorId` UUID in op log | — | HTTP shows UUID; fixture shows `"grace"` |
| GET mutate | `refreshTriple` on overview and detail | — | Coalesced GETs share a write |
| Docs | Contract missing close/deleted/closed | ADR 0002 says merge unwritten | README/ADR 0010 say fixture-bound / editor unbuilt |

---

## Suggested fix order (not implemented)

1. Gate or remove unauthenticated `POST /workspace/reset` on any shared deployment (env secret, or auth-except-when-zero-users).
2. `SELECT … FOR UPDATE` the working branch in apply/undo; compute `seq` and bump `head_version` inside that transaction (`UPDATE … WHERE head_version = $read`).
3. `FOR UPDATE` the **source** branch in merge; re-read it for the archive copy.
4. `refreshTriple` `UPDATE … WHERE id = $id AND status NOT IN ('merged','closed')`. Canonicalize jsonb (or compare via engine `canon()`) before fingerprinting resolutions.
5. Treat `closed` as non-blocking for `DELETE /branches/:name`; use `isTerminal`. Fix client copy.
6. Classifier: slot-keyed conflict sets; `renameTable` + `setDefault` on “take ours”; clone before remap.
7. Emit: renameTable before createTable; group unpaired PK drop+add; catch `emitMigration` on GET.
8. Dashboard/rail: filter `!b.trunk`. Merge-review: don’t drop non-primary tables; honor `stale`; queued = read-only; fix `effectiveStatus` vs Zone D; don’t merge after optimistic undo.
9. Stop collapsing 422 reasons to `target-not-found`. Map `structural-validation-failed`.
10. Fix `MergeReviewRoute` hooks (call `useResource` unconditionally). Preserve deep link through sign-in.
11. One apply path in docs + `vercel.json` (`migrate`); never rewrite `0000`. Restore or drop `titles-ops.json`. Document Node/pnpm. Strike “fixture-bound / editor unbuilt”.
12. Shared wire types. Partial unique indexes for queue invariants. Name slots or `validateDocument` for index/constraint names.

---

## Appendix A — Docs specialist raw scorecard

See “Docs reliability” above. Score 81/100. Specialist: docs-reliability-review.

## Appendix B — Architecture specialist closing line

> The architecture will scale to V1 conflict UX if the **contract types are unified**, the **delete guard uses `isTerminal`**, and **classify actually applies stored resolutions**. Until then the layering looks disciplined while the **status and DTO maps** do the damage.

## Appendix C — What was not done

- `/review-security` did not review a PR diff (empty on `main`). Full-tree security is covered in the Security section.
- No code was changed. No tests were added. No PR was opened.
- Lower-severity specialist items were not all re-read line-by-line; P0/P1 claims in the consolidated table were checked against source at `c355e1ff`.
- Browser e2e of the UI findings was not run in this pass.
- `pnpm test` was not re-run by the parent; the docs specialist reported 347 passed + 1 expected fail.

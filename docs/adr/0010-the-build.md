# ADR 0010 — The build: monorepo layout, persistence, deploy, and the V0 endpoint subset

Status: accepted (design lock). This is the build ticket — execution against ADRs 0001–0009,
which are design locks. It still carries build-shape calls that were not settled anywhere else: where
the API code lives, what datastore backs it, how it deploys, and which slice of the ADR 0004
endpoint table V0 actually ships. Those are recorded here, one section each.

`docs/build.md` is the companion: the setup steps, the endpoint subset table with
request/response shapes, and the local + deployed `curl` walk. `decisions.md` carries the
narrative.

Builds on ADR 0004 (the Drizzle schema, the endpoint table, the merge lifecycle), ADR 0005 +
`examples/seed.workspace.ts` (seed content — already written as typed objects), ADR 0008
§1–§2 + `docs/robustness.md` §1–§2 (`validateOperation`, the drop-with-dependents block), and
`docs/first-run.md` §4 (the golden path this slice persists).

Scope: **V0 — the thin real slice** (`docs/scope.md`). One merge request at a time. The
merge queue, resolution persistence, `validateDocument` on the merge path, and the `verify`
endpoint are V1 and are not built here.

**This iteration is backend only.** `web/src/data/` still reads the fixture; swapping it for
an HTTP client against this API is a separate follow-up (§7). The frontend already deploys
fixture-bound and is unchanged.

## 1. A new `api/` workspace package

The Hono app, the Drizzle schema, and the seed live in a new `api/` pnpm workspace package —
a sibling of `web/`, added to `pnpm-workspace.yaml`. It has its own `package.json` (the only
place `hono`, `drizzle-orm`, and the Postgres driver are declared) and its own `tsconfig.json`
extending the root — NodeNext ESM with `.js` import specifiers, matching `engine/` and
`src/domain/` exactly. It imports the engine by relative path (`../engine/merge.js`), the
same way `src/domain/operations.ts` already does.

**Why a package, not a folder under `src/` or `web/`.** The engine's rule (`decisions.md` §
Stack) is that the merge engine has zero framework imports and could be lifted into a CLI
untouched. A folder under `src/` would put Hono and Drizzle on the same compile unit as the
engine and blur that line. `web/` is a Vite React app with `moduleResolution: bundler` and
`.tsx` everywhere — the API is a Node service and does not belong on that config. A separate
package with its own dependency list and its own tsconfig keeps all three layers —
`engine/` (pure), `api/` (Node service), `web/` (browser app) — independently buildable.

**Considered and rejected.** A single flat repo with the API in `src/`. It saves one
`package.json` and costs the engine's isolation guarantee, which is the submission's depth
play — not a trade worth making.

**Consequences.** `pnpm -r` now spans three packages. The root `package.json` keeps the
engine/`src` scripts; `api/` and `web/` carry their own. `pnpm test` still runs one Vitest
config at the root (§6).

## 2. Persistence is Neon + Drizzle `pg-core`, chosen now, not deferred

The datastore is Neon Postgres via `drizzle-orm` with the `pg-core` schema builders and the
`@neondatabase/serverless` driver. The Drizzle schema is `docs/backend-contract.md` §1
verbatim — all six tables, including `merge_request_resolutions`, which V0 code never writes
but which is part of the frozen contract. Schema states are `jsonb` columns `$type`d to
`SchemaDocument`; Postgres enforces nothing about their contents and the engine owns every
structural invariant (ADR 0004 §1).

**Why not SQLite now with Neon later.** The question was whether an interim SQLite datastore
would save enough to be worth a later migration. It would not:

- The deploy target is Vercel serverless (`decisions.md` § Stack). A serverless function has
  no persistent local filesystem, so SQLite there means a hosted service — Turso / libSQL —
  which is the *same class* of external hosted-DB dependency as Neon. The premise that SQLite
  avoids the dependency does not hold for this deploy.
- ADR 0004 §1–§7 and `docs/backend-contract.md` §1 are written entirely in `pg-core` terms:
  `pgTable`, `pgEnum`, `jsonb`, `uuid().defaultRandom()`, `timestamptz`, `SELECT … FOR
  UPDATE`. Building on `sqlite-core` means writing a different schema file and rewriting it
  for V1, not extending it — the "sum of two efforts is much greater than doing it once"
  case.
- The one genuinely Postgres-specific runtime mechanism the contract leans on — `SELECT …
  FOR UPDATE` to serialise merges — is **already V1** in `docs/scope.md`. V0 assumes one
  merge request at a time (§4), so V0 on Neon uses a plain transaction and forgoes nothing
  it was supposed to have.
- The marginal cost of Neon over an interim store is one `DATABASE_URL` secret, a drop-in
  driver, and one `drizzle-kit` apply against a Neon branch. There is no connection-pool
  process to run.

**Considered and rejected.** (a) SQLite/libSQL for V0 — above. (b) An in-memory store behind
the endpoint contract — the user ruled it out; it also would not exercise transactions or the
`jsonb` round-trip, which is most of what the persistence layer has to get right.

**Consequences.** `pnpm test` must not need Neon — it does not (§6, pglite). A contributor
running the app locally needs a `DATABASE_URL` (a free Neon branch, or any local Postgres);
`docs/build.md` spells this out. `drizzle-kit generate` output is committed under
`api/drizzle/` so the schema can be applied to Neon (deploy) and pglite (tests) from one
source.

## 3. Deploy: `web/` static + `api/` as one Vercel function

`web/` builds to static assets served from the CDN. `api/` deploys as a single Vercel Node
serverless function: `api/index.ts` is `export default handle(app)` from `hono/vercel`,
wrapping the app in `api/src/app.ts`. A root `vercel.json` sets the build command to build
`@ryft/web`, the output directory to `web/dist`, and rewrites `/api/(.*)` to the function so
every API path lands on the one handler and Hono routes internally. `DATABASE_URL` is a
Vercel project env var.

Local development runs the same `app` under `@hono/node-server` via
`pnpm --filter @ryft/api dev` (tsx watch), on a fixed port, with `DATABASE_URL` from a local
`.env`.

**Why one function, not a function per route.** Hono's router is the routing layer; splitting
across Vercel filesystem routes would duplicate it and fragment the middleware. One function
keeps the app identical in all three run modes (test via `app.request`, local via
`node-server`, prod via `handle`).

**Why the Node runtime, not Edge.** `@neondatabase/serverless` works on both, but Drizzle's
`node-postgres`-style session and transactions are the well-trodden path on Node, and V0 has
no latency budget that Edge would rescue. Edge is a later swap if it is ever wanted.

**Considered and rejected.** A standalone API host (Fly, Railway) — more infra to explain in
`docs/build.md` for a submission whose setup experience is judged; Vercel already hosts the
frontend.

## 4. The V0 endpoint subset

V0 ships the `docs/backend-contract.md` §3 table **minus the queue machinery and the
resolutions routes**:

**Ships now:** `POST /session`, `POST /workspace/reset` (with `?bare`), `GET /overview`,
`GET /branches`, `GET /branches/:name`, `POST /branches`, `DELETE /branches/:name`,
`POST /branches/:name/operations`, `GET /branches/:name/operations`, `GET /merge-requests`,
`POST /merge-requests`, `GET /merge-requests/:id`, `POST /merge-requests/:id/merge`,
`DELETE /merge-requests/:id`.

Added after WU-E settled its shape: `DELETE /branches/:name/operations?after=<seq>` — undo
by truncate-and-replay (`docs/backend-contract.md` §3). The endpoint table left undo to WU-E;
this is that decision landing in the V0 API.

**V1, not built here:** `POST /merge-requests/:id/resolutions` and its `DELETE`; the
`queued` / `held` status transitions, FIFO promotion, `previewed_main_version` tracking, and
the `409` kick-back body (ADR 0004 §3–§4); `validateDocument` on the merge path (ADR 0008
§5); `POST /merge-requests/:id/verify` (ADR 0009); `SELECT … FOR UPDATE` contention control.

`merge_requests.status` takes only `open` and `merged` in V0 — there is no `queued` state
because there is no queue. Multiple `open` merge requests are allowed; `POST /merge-requests`
does not block on an existing one.

**Why no `queued` state and no creation guard.** The queue's job is to serialise merges,
order them, and give a kicked-back author a good message — all V1, multi-author concerns.
Correctness for V0 does not need it: `GET /merge-requests/:id` and the merge transaction both
recompute the three-way against **live `main.head`** every time (ADR 0004 §5), so every open
merge request always has a well-defined result against the current trunk. Merge one and
`main` moves; the next read of another open request re-runs against the new `main` and
reports clean or conflicting honestly. Blocking creation would add a restriction the contract
never asked for and buy nothing.

**Consequences.** `GET /merge-requests` still lists non-terminal first, ascending
`created_at`; `position` / `ahead` / `behind` are informational only and are all reported as
`1` / `0` / `0` in V0. Two simultaneous merge clicks on different open requests are the same
unguarded-race case as §5 and get the same answer: fine at one reviewer, fixed by the V1 row
lock.

## 5. The merge transaction, V0 form: one transaction, no row lock

`POST /merge-requests/:id/merge`, in one Drizzle transaction:

1. Load the merge request; respond `409` unless `status = open`.
2. Re-read `source.head` and `main.head` **live** from `branches` (the author may have
   applied more operations since the request opened).
3. `threeWayMerge(mr.base, source.head, main.head, [])` — no stored resolutions in V0.
4. On `report.verdict`:
   - **`clean`** → `emitMigration(main.head, merged)` (ADR 0003 §1: `source = theirs =
     main.head`, `target = merged`); `UPDATE branches SET head = merged, head_version =
     head_version + 1 WHERE name = target`; append a `MergeMarker`
     (`src/domain/operations.ts`) to the target's `operations` at the next `seq`;
     `UPDATE merge_requests SET status = 'merged', merged_at = now()`; rewrite the frozen
     triple to what was used. `COMMIT`. Respond `200 { status: "merged", migration }`.
   - **`conflicts`** or **`unclassified-divergence`** → `COMMIT` (nothing changed); respond
     `409 { error: "revalidation-failed", report }`. The merge request stays `open`; there is
     no `held` status and no kick-back body in V0.

**Why no `FOR UPDATE`.** ADR 0004 §4 uses a row lock to serialise concurrent merges and
queue promotions. V0 has neither — one merge request at a time (§4), single trunk — so there
is nothing to serialise against. A plain transaction gives atomicity, which is all V0 needs.
The row lock arrives with the queue in V1, as ADR 0004 specifies.

**Consequences.** Two simultaneous merge clicks on the same (only) open request could both
read `status = open` before either commits. At one reviewer driving one demo this does not
happen; the honest fix is the V1 row lock, and this ADR does not pretend otherwise.
`head_version` is still bumped on every head write, so the V1 staleness display has its
counter from day one.

## 6. Tests run on `@electric-sql/pglite` — no external database

`api/` tests exercise the real Hono app in-process through `app.request(...)`, against a
`drizzle-orm/pglite` database — Postgres compiled to WebAssembly, running in the test
process. A per-suite setup helper spins up a fresh pglite instance and applies the committed
`api/drizzle/` SQL; the same SQL is what `drizzle-kit` applies to Neon for the deployed
instance, so tests and production share one schema definition.

The golden path (`docs/first-run.md` §4) is one integration test: sign in, open the seeded
merge request, merge it, assert `main.head` carries the rename + add + unique index and a
merge marker was appended; then create `titles`, apply `renameColumn` + `retypeColumn` +
`addIndex`, open a merge request, merge. Focused tests cover the failure paths the contract
specifies: the `drop-blocked` `422` body, unknown-user `401`, the `POST /merge-requests`
`409` when one is already open, an invalid branch name `422`.

The root `vitest.config.ts` `include` gains `api/**/*.test.ts`; the runner stays one config
for the whole repo (`environment: "node"`, no jsdom), as `docs/engine-test-catalog.md` set
up.

**Why pglite, not a test container or a Neon test branch.** `pnpm test` staying a
zero-dependency single command is part of the setup experience being judged. pglite is a real
Postgres — `jsonb`, transactions, enums all behave — so the tests are faithful, and there is
no Docker daemon or network key to configure. A Neon test branch would re-introduce the
external dependency the deploy already carries, on the one path that should not need it.

**Considered and rejected.** `pg-mem` (a JS reimplementation — diverges from Postgres on
`jsonb` and transactions, which is exactly what the persistence layer must get right);
Testcontainers (a Docker requirement in the setup path).

## 7. Named follow-up: the frontend data-seam swap

Reconciling this API's response shapes with the `web/src/data/` seam types
(`web/src/data/types.ts`, `web/src/merge-review/model.ts`), writing the HTTP `DataSource`
implementation, and swapping `source` in `web/src/data/index.ts` is a distinct piece of work,
deliberately out of this iteration. At that point `web/src/data/types.ts`
`MergeSummary.status` widens to the four merge-request statuses (ADR 0004 §2's noted
frontend-seam follow-up), and the `MergeReview` transform in `web/src/merge-review/` is fed
by `GET /merge-requests/:id` instead of the scenario fixtures. Building the structured editor
(WU-E) so the golden path is drivable through the UI is part of that same follow-up.

**Why split it out.** The backend is a self-contained, testable deliverable — the API plus
its integration suite plus a deployed URL. Wiring the UI is a large surface (the editor is
the biggest unbuilt screen, `docs/scope.md` V0 band) and gates on shape decisions best made
against a running API. Shipping the backend first de-risks both.

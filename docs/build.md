# Build — setup, the V0 endpoint subset, and the golden-path walk

Ticket 0010. Companion to `docs/adr/0010-the-build.md` (the rationale, one section per
call). This is the operational reference: how to run it, what the API surface is in V0, and
the `curl` walk that proves the golden path.

Builds on `docs/backend-contract.md` (the full ADR 0004 contract — this doc ships a subset)
and `docs/first-run.md` §4 (the golden path).

---

## 1. Layout

```
api/                       new pnpm workspace package (§ ADR 0010 §1)
  package.json             hono · drizzle-orm · @neondatabase/serverless
  tsconfig.json            extends root; NodeNext ESM, .js specifiers
  drizzle.config.ts        drizzle-kit: schema → api/drizzle/*.sql
  drizzle/                 committed generated SQL — applied to Neon and to pglite
  index.ts                 export default handle(app)   (Vercel function entry)
  src/
    app.ts                 the Hono app + identity middleware
    db/schema.ts           the six Drizzle tables (docs/backend-contract.md §1)
    db/client.ts           drizzle(Neon) from DATABASE_URL; injectable for tests
    seed.ts                inserts examples/seed.workspace.ts  (+ ?bare)
    views.ts               Overview / BranchDetail / MergeRequestResponse assembly
    routes/session.ts
    routes/workspace.ts
    routes/branches.ts
    routes/merge-requests.ts
    dev.ts                 @hono/node-server for local dev
    __tests__/             pglite-backed, app.request(...)
web/                       unchanged — still fixture-bound this iteration
vercel.json                web static + /api/(.*) → the function
```

## 2. Running it

### Local

```
# one-time
cp api/.env.example api/.env          # set DATABASE_URL (a free Neon branch or local pg)
cp web/.env.example web/.env          # optional — every web var has a default
pnpm install
pnpm --filter @ryft/api db:push       # apply api/drizzle/*.sql to DATABASE_URL

# every day
pnpm --filter @ryft/api dev           # http://localhost:8787
curl -sX POST localhost:8787/api/workspace/reset | jq   # seed the workspace
pnpm --filter @ryft/web dev           # http://localhost:5180 (proxies /api → :8787)
```

The web dev server proxies `/api` to `:8787` (`web/vite.config.ts`), so the SPA talks to the
real API. `VITE_DATA_SOURCE=fixture pnpm --filter @ryft/web dev` restores the offline fixture.

### Tests

```
pnpm test                             # engine + api, all on pglite, no DATABASE_URL needed
```

### Deploy (Vercel)

`vercel.json` at the repo root: build `@ryft/web` → `web/dist` (static), mount `api/index.ts`
as one Node function, rewrite `/api/(.*)` → the function and every other path → `index.html`
(SPA fallback).

```
# 1. a Neon database (free tier) — copy its pooled connection string
# 2. apply the schema to it, once:
DATABASE_URL='postgres://…' pnpm --filter @ryft/api db:push

# 3. Vercel project: set env var DATABASE_URL to the same string, then
vercel deploy --prod            # or connect the GitHub repo and push

# 4. seed the deployed instance:
curl -X POST https://<app>.vercel.app/api/workspace/reset
```

The deployed **web app** reads the live **API** at `/api/*` through `web/src/data/http.ts` (the
`DataSource` seam) and `POST /api/session`; the same origin serves both. The `curl` walk in §5
and the golden-path test exercise the API directly. The structured editor remains unbuilt
(ADR 0010 §7).

## 3. Identity

Every request except `POST /api/session` carries `x-ryft-user: <username>`. Middleware
resolves it against `users.username` (one organisation) and attaches the actor. Missing or
unknown → `401`. No token, no session store, no password — impersonation is a documented
non-goal (ADR 0001 §4).

## 4. The V0 endpoint subset

Base path `/api`. All JSON. `Actor` = the resolved `x-ryft-user`. Shapes not restated here
are in `docs/backend-contract.md` §4. **V1 rows from that table are omitted** — see ADR 0010
§4 for the list (resolutions, the queue status machine, `verify`).

| Method · path | Notes vs. `docs/backend-contract.md` §3 |
|---|---|
| `POST /session` | Unchanged. Create-or-resume by username; the only route that mints a user. No `x-ryft-user`. Resume → `200`; new user → `201`. |
| `POST /workspace/reset` | `?bare` seeds `main` alone. Truncates the V0 tables (CASCADE) and re-seeds. **No `x-ryft-user`** — on a fresh database there is no user to authenticate as until the seed runs; it is the one read/write endpoint outside the identity gate besides `/session`. |
| `GET /overview` | Unchanged. `database` counts derived from `main.head`; `trunkRevision = main.head_version`. |
| `GET /branches` | Unchanged. |
| `GET /branches/:name` | Unchanged. `divergence = diffSnapshots(base_snapshot, head).length`. |
| `POST /branches` | Unchanged. Cuts from `main`: `structuredClone(main.head)` for both `head` and `base_snapshot`; `head_version = 0`. `409` taken / `main`; `422` bad identifier. |
| `DELETE /branches/:name` | Unchanged. `403` for `main`; `409` if a non-terminal MR has this `source`. |
| `POST /branches/:name/operations` | `ops` applied in order through `applyOperation`; progressive `validateOperation` (batch semantics — `docs/robustness.md` §5). One transaction. `422` body per `docs/backend-contract.md` §5 on the first `OpError`. `OpWarning[]` returned with the success body. No MR-freeze interaction (V0 branches are never frozen). |
| `GET /branches/:name/operations` | Unchanged. Whole log, ascending `seq`. |
| `DELETE /branches/:name/operations?after=<seq>` | Undo (WU-E). Drops entries past `<seq>`, replays the surviving prefix from `base_snapshot`, bumps `head_version` once. `403` `main`; `404` unknown branch; `422` missing / non-integer / negative `after`. Returns `{ head, headVersion }`. |
| `GET /merge-requests` | Unchanged shape. Non-terminal first, ascending `created_at`. `position`/`ahead`/`behind` are informational, always `1`/`0`/`0` in V0. |
| `POST /merge-requests` | Freezes `base = source.base_snapshot`, `ours = source.head`, `theirs = main.head`. Status is always `open` — no `queued` state, no guard on an existing open MR (ADR 0010 §4). `409` only if a non-terminal MR already has this `source`. |
| `GET /merge-requests/:id` | Recomputes `report` + `migration` every call. `queue = { status, position: 1, ahead: 0, behind: 0 }`; `stale: false`; `droppedResolutions: []` (all V1-inert in V0). |
| `POST /merge-requests/:id/merge` | The ADR 0010 §5 transaction. `409` unless `status = open`. `409 { error: "revalidation-failed", report }` if the re-run is not `clean` — MR stays `open`, no `held`. |
| `DELETE /merge-requests/:id` | Abandon. No queue promotion (nothing queued in V0). |

### `POST /branches/:name/operations` — 422 body

Exactly `docs/backend-contract.md` §5:

```ts
{ error: "drop-blocked", failedAt: number, op: Operation,
  dependents: Array<{ kind: "index"|"unique"|"primaryKey"|"foreignKey";
                      id: string; name: string; table: string }> }
```

Other `OpError` reasons (`docs/robustness.md` §1) return
`422 { error: <reason>, failedAt, op, message }` with no `dependents`.

## 5. The golden-path curl walk (`docs/first-run.md` §4)

Run against `localhost:8787` or the deployed origin. `U=grace`.

```
BASE=http://localhost:8787/api
curl -sX POST $BASE/workspace/reset

# 1. sign in
curl -sX POST $BASE/session -d '{"username":"grace"}' -H 'content-type: application/json'

# 2. the seeded contact-fields → main request
MR=$(curl -s $BASE/merge-requests -H "x-ryft-user: grace" | jq -r '.[0].id')
curl -s $BASE/merge-requests/$MR -H "x-ryft-user: grace" | jq '.report.verdict, .migration.sql'

# 3. merge it
curl -sX POST $BASE/merge-requests/$MR/merge -H "x-ryft-user: grace" | jq '.status'
curl -s $BASE/branches/main -H "x-ryft-user: grace" | jq '.head.tables[0].columns[] | .name'
#   → email is now email_address; phone present; users_email_address_key on the renamed column

# 4. create titles and evolve it
curl -sX POST $BASE/branches -d '{"name":"titles"}' -H "x-ryft-user: grace" -H 'content-type: application/json'
curl -sX POST $BASE/branches/titles/operations -H "x-ryft-user: grace" -H 'content-type: application/json' \
  -d @titles-ops.json        # renameColumn posts.body→content, retypeColumn comments.flags int→bigint, addIndex posts.published

# 4b. undo everything back to the cut, then re-apply the batch — head rebuilds from base_snapshot
curl -sX DELETE "$BASE/branches/titles/operations?after=0" -H "x-ryft-user: grace" | jq '.headVersion'
curl -sX POST $BASE/branches/titles/operations -H "x-ryft-user: grace" -H 'content-type: application/json' -d @titles-ops.json

# 5. open and merge
MR2=$(curl -sX POST $BASE/merge-requests -d '{"source":"titles"}' -H "x-ryft-user: grace" -H 'content-type: application/json' | jq -r '.id')
curl -s $BASE/merge-requests/$MR2 -H "x-ryft-user: grace" | jq '.report.verdict'
curl -sX POST $BASE/merge-requests/$MR2/merge -H "x-ryft-user: grace" | jq '.status, .migration.sql'
```

The same walk is `api/src/__tests__/golden-path.test.ts`, asserted structurally.

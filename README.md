# ryft

Version control for a Postgres schema: branch it, change it through a structured editor that
records renames as renames, see exactly what diverged, and merge it back with a **semantic
three-way merge** that follows a column across a rename by stable id — so an index added on
one branch rebases onto a column the other branch renamed, instead of erroring or being
dropped.

Row data is out of scope. The schema document is the artifact under version control; the
generated Postgres DDL is a *rendering* of what a merge does, not a migration you run.

Full framing, the alternatives weighed, and everything deliberately cut: **`decisions.md`**
(its brief answers the problem statement). Design is locked in **`docs/adr/`**.

## Layout

| Path | What | Build unit |
|---|---|---|
| `engine/` | the merge engine — `diff → classify → threeWayMerge → emit → replay`, plus `validateOperation` / `applyOperation`. Pure TypeScript, zero framework imports, zero runtime deps. | root `tsconfig` |
| `src/domain/` | app primitives the engine must not know about — `User`, `Organization`, the branch operation log. | root `tsconfig` |
| `api/` | the Hono API on Neon + Drizzle. `docs/build.md` is its reference. | `@ryft/api` |
| `web/` | React SPA — app shell, `/branches`, `/merges`, the merge-review screen. Fixture-bound today (see below). | `@ryft/web` |
| `examples/` | the worked seed schema, the branched example, the first-run workspace. |
| `docs/` | `adr/` (design locks), `build.md`, `backend-contract.md`, `robustness.md`, `first-run.md`, `engine-test-catalog.md`, `scope.md`. |

## Run it

```
pnpm install
pnpm test          # engine + api, all in-process (pglite) — no database needed
pnpm typecheck     # root; api and web have their own: pnpm --filter @ryft/api typecheck
```

Local API:

```
cp api/.env.example api/.env          # set DATABASE_URL (free Neon branch or local pg)
pnpm --filter @ryft/api db:push       # apply the schema
pnpm --filter @ryft/api dev           # http://localhost:8787/api
curl -sX POST localhost:8787/api/workspace/reset | jq
```

The golden-path `curl` walk and the deploy steps are in **`docs/build.md`**.

## Status

The engine is finished (**223 tests** — the rename-rebase edge case, a typed conflict report
usable from CI or an agent, an exhaustive scenario catalogue). Ticket 0010 adds the engine's
server surface and the **V0 backend**: a Hono API persisting the golden-path demo on Neon,
with a 15-test in-process integration suite (`docs/scope.md` for the band breakdown).

Not yet wired: `web/src/data/` still reads a fixture rather than the API, and the structured
editor screen is a placeholder. That is the next iteration (`docs/adr/0010-the-build.md` §7).

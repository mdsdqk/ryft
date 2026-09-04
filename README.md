# ryft

**Version control for a Postgres schema.** Branch it, change it through a structured editor,
see what diverged, and merge it back with a semantic three-way merge.

ryft versions the schema document itself, not a SQL dump and not the migration files. It
merges on schema semantics: it knows a column has a type, that an index depends on it, and
that a column keeps its identity through a rename.

Row data is out of scope.

[Try the working demo](https://ryft-db.vercel.app)

### The hard case

Branch A renames `email` to `email_address`. Branch B adds a unique index on `email`. Applied
together the naive way, the index points at a column that is no longer there.

ryft produces an index on `email_address`. Every object carries a stable id, so the rename and
the index compose instead of colliding. Other tools either raise a conflict here or drop the
index. Neither is right.

## Quickstart

Node 20+ and pnpm 11+ (`corepack enable` installs pnpm).

```bash
pnpm install
pnpm test        # ~350 tests across engine, API, and the web view-model
```

Tests run in-process against `pglite` (real Postgres compiled to WebAssembly). No database to
set up.

Run the API and the app against a real Postgres:

```bash
cp api/.env.example api/.env         # set DATABASE_URL: a free Neon branch or local pg
pnpm --filter @ryft/api db:push      # create the tables
pnpm --filter @ryft/api dev          # API on http://localhost:8787/api
pnpm --filter @ryft/web dev          # app on http://localhost:5180
```

Seed a workspace, then follow the golden path in the app:

```bash
curl -sX POST localhost:8787/api/workspace/reset | jq
```

The full `curl` walkthrough and the Vercel deploy steps are in
[`docs/build.md`](docs/build.md).

## What's inside

| Path | What |
|---|---|
| `engine/` | The merge engine: `diff → classify → merge → emit → replay`, plus `validateOperation` and `applyOperation`. Pure TypeScript, no runtime dependencies. |
| `src/domain/` | App primitives the engine never sees: `User`, `Organization`, the branch operation log. |
| `api/` | The Hono API, on Neon and Drizzle. `@ryft/api`. |
| `web/` | The React app: shell, `/branches`, the structured editor, `/merges`, and the merge-review screen. `@ryft/web`. |
| `examples/` | The seed schema, a worked branch, the first-run workspace. |
| `docs/adr/` | One ADR per design session. The `docs/*.md` files are their companions. |

## How a merge works

A branch is a schema document plus a snapshot of `main` taken when the branch was cut. A merge
is a three-way operation over those snapshots:

1. **diff** each side against the common ancestor, by object id rather than by name.
2. **classify** every change. An identical change on both sides is an overlap; a real
   disagreement is one of seven typed conflict classes.
3. **merge** the changes that do not conflict, then **check commutativity**: apply both sides
   in both orders and confirm the results match. A rule-based taxonomy can miss a case; this
   check does not depend on the taxonomy.
4. **emit** the merged document as ordered Postgres DDL, and **replay** it one statement at a
   time to confirm every prefix leaves a valid schema.

The merged document is the source of truth. The DDL is a rendering of the change.

## Docs

| | |
|---|---|
| [`decisions.md`](decisions.md) | The choices that shaped ryft, in impact order. Start here. |
| [`decisions.log.md`](decisions.log.md) | The full working log: every reversal, every implementation note. |
| [`docs/adr/`](docs/adr/) | Per-session design locks. |
| [`docs/build.md`](docs/build.md) | Setup, the golden-path `curl` walk, and deploy. |
| [`docs/scope.md`](docs/scope.md) | Delivery bands and what each one contains. |

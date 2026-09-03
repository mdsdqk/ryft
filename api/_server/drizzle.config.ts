import { defineConfig } from "drizzle-kit";

/**
 * Schema → SQL under `api/drizzle/`. The generated SQL is committed and applied
 * two ways: `drizzle-kit push`/`migrate` against Neon for the deployed instance,
 * and `migrate(...)` against a fresh PGlite instance in the test setup helper
 * (ADR 0010 §6). One schema definition, one migration set, both targets.
 *
 * Lives in `_server/` — not directly under `api/` — because Vercel turns every
 * file directly under `api/` into a Serverless Function, and `_server/` is the
 * support dir Vercel never does that to (ADR 0010 §3). The `db:*` scripts run
 * from `api/` and pass `--config=_server/drizzle.config.ts`; `schema` and `out`
 * below stay relative to that `api/` working directory, not to this file.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./_server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://unset",
  },
});

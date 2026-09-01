import { defineConfig } from "drizzle-kit";

/**
 * Schema → SQL under `api/drizzle/`. The generated SQL is committed and applied
 * two ways: `drizzle-kit push`/`migrate` against Neon for the deployed instance,
 * and `migrate(...)` against a fresh PGlite instance in the test setup helper
 * (ADR 0010 §6). One schema definition, one migration set, both targets.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./_server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://unset",
  },
});

/**
 * A fresh in-process Postgres per test (ADR 0010 §6). `@electric-sql/pglite` is
 * real Postgres compiled to WebAssembly; `migrate` applies the committed
 * `api/drizzle/` SQL — the same SQL `drizzle-kit` applies to Neon for the
 * deployed instance. No Docker, no network, no `DATABASE_URL`.
 */

import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { schema } from "../db/schema.js";
import type { Db } from "../db/client.js";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function freshDb(): Promise<Db> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

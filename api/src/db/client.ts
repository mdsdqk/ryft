/**
 * The database handle. One Drizzle instance per process, created from
 * `DATABASE_URL` via the Neon serverless driver (WebSocket pool — it supports
 * the interactive transactions the merge endpoint needs, ADR 0010 §5).
 *
 * Tests do not use this module: the pglite setup helper builds its own Drizzle
 * instance over the same `schema` and the same generated SQL (ADR 0010 §6). `Db`
 * is the shared type both paths satisfy; route code is written against it and
 * never against a concrete driver.
 */

import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { schema } from "./schema.js";

export type Db = NeonDatabase<typeof schema>;

let singleton: Db | null = null;

/** The process-wide handle. Lazily built; safe to call per request. */
export function db(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Node has no global WebSocket before 22; the driver needs one for the pool.
  neonConfig.webSocketConstructor = (globalThis as { WebSocket?: unknown }).WebSocket ?? ws;
  singleton = drizzle(new Pool({ connectionString: url }), { schema });
  return singleton;
}

/**
 * The database handle. One Drizzle instance per process, created from
 * `DATABASE_URL` via the Neon serverless driver.
 *
 * Serverless note (the cause of a Vercel function timeout): a `Pool` cached at
 * module scope keeps a WebSocket to Neon open, and Vercel freezes the function
 * between invocations — the next request then hangs on a dead socket until the
 * platform kills it. `poolQueryViaFetch` sends one-shot `pool.query()` calls
 * over Neon's stateless HTTP endpoint instead, so there is no socket to go
 * stale. `db.transaction(...)` (the merge path, ADR 0010 §5) still opens a fresh
 * WebSocket via `pool.connect()` per transaction and closes it in `finally`.
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

// Global driver config — idempotent, safe to set at module load.
neonConfig.webSocketConstructor = ws; // the transaction path needs a WS ctor on Node
neonConfig.poolQueryViaFetch = true; // one-shot queries over HTTP — no persistent socket

export type Db = NeonDatabase<typeof schema>;

let singleton: Db | null = null;

/** The process-wide handle. Lazily built; safe to call per request. */
export function db(): Db {
  if (singleton) return singleton;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  singleton = drizzle(new Pool({ connectionString: url }), { schema });
  return singleton;
}

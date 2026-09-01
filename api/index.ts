/**
 * Vercel serverless entry (ADR 0010 §3). `hono/vercel` adapts the same `app`
 * used in tests and local dev. One function; `vercel.json` rewrites every
 * `/api/*` path onto it and Hono routes internally.
 *
 * This is the only file directly under `api/`, so it is the only Serverless
 * Function Vercel creates. The rest of the service lives in `api/_server/` — an
 * underscore-prefixed dir is a support dir, imported into this function's
 * bundle but never turned into its own function (Vercel's Hobby plan caps a
 * deployment at 12).
 *
 * The handler is built on the first request, not at import, so a missing
 * `DATABASE_URL` surfaces as a clean per-request error rather than a cold-start
 * crash.
 */

import { handle } from "hono/vercel";
import { createApp } from "./_server/app.js";
import { db } from "./_server/db/client.js";

let cached: ((req: Request) => Response | Promise<Response>) | null = null;

export default function handler(req: Request): Response | Promise<Response> {
  cached ??= handle(createApp(db()));
  return cached(req);
}

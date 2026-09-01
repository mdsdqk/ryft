/**
 * Vercel serverless entry (ADR 0010 §3). One function; `vercel.json` rewrites
 * every `/api/*` path onto it and Hono routes internally.
 *
 * This is the only file directly under `api/`, so it is the only Serverless
 * Function Vercel creates. The rest of the service lives in `api/_server/` — an
 * underscore-prefixed dir is a support dir, imported into this function's
 * bundle but never turned into its own function (Vercel's Hobby plan caps a
 * deployment at 12).
 *
 * The exports are per-method Web handlers (`(request: Request) => Response`) —
 * the one function signature Vercel's `nodejs` runtime accepts without
 * ambiguity. A bare default export gets misclassified as the Node
 * `(req, res) => void` form and its returned `Response` dropped; per-method
 * exports are routed by verb and their return is honoured.
 *
 * The app is built on the first request, not at import, so a missing
 * `DATABASE_URL` surfaces as a clean per-request error rather than a cold-start
 * crash.
 */

import { createApp } from "./_server/app.js";
import { db } from "./_server/db/client.js";

export const config = { runtime: "nodejs" };

let app: ReturnType<typeof createApp> | null = null;

const handler = (request: Request): Response | Promise<Response> => {
  app ??= createApp(db());
  return app.fetch(request);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;

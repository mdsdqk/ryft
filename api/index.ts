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
 * The export is the Node `(req, res)` signature Vercel's `nodejs` runtime
 * expects. `getRequestListener` (`@hono/node-server`) bridges Node's req/res to
 * the Web `fetch` the Hono app speaks — the same adapter `_server/dev.ts` uses
 * via `serve()`. A Web-`fetch`-style default export is only reliably detected on
 * the `edge` runtime; on `nodejs` a returned `Response` is silently dropped.
 *
 * The listener is built on the first request, not at import, so a missing
 * `DATABASE_URL` surfaces as a clean per-request error rather than a cold-start
 * crash.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createApp } from "./_server/app.js";
import { db } from "./_server/db/client.js";

export const config = { runtime: "nodejs" };

let listener: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null;

export default function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!listener) {
    const app = createApp(db());
    listener = getRequestListener((request) => app.fetch(request));
  }
  return listener(req, res);
}

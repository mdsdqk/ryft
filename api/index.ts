/**
 * Vercel serverless entry (ADR 0010 §3). `hono/vercel` adapts the same `app`
 * used in tests and local dev. One function; `vercel.json` rewrites every
 * `/api/*` path onto it and Hono routes internally.
 */

import { handle } from "hono/vercel";
import { createApp } from "./src/app.js";
import { db } from "./src/db/client.js";

export const config = { runtime: "nodejs" };

export default handle(createApp(db()));

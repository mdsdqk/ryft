/**
 * Local dev server — the same `app`, served by Node instead of Vercel. Reads
 * `api/.env` (copy `.env.example`) for `DATABASE_URL`: a free Neon branch or any
 * local Postgres. `pnpm --filter @ryft/api dev`.
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { db } from "./db/client.js";

const envPath = fileURLToPath(new URL("../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp(db()).fetch, port }, (info) => {
  console.log(`ryft api → http://localhost:${info.port}/api`);
});

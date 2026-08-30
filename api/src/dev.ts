/**
 * Local dev server — the same `app`, served by Node instead of Vercel. Needs
 * `DATABASE_URL` (a free Neon branch or any local Postgres). `pnpm --filter
 * @ryft/api dev`.
 */

import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { db } from "./db/client.js";

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp(db()).fetch, port }, (info) => {
  console.log(`ryft api → http://localhost:${info.port}/api`);
});

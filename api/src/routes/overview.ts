/**
 * GET /overview — the landing aggregate (`docs/backend-contract.md` §3). Backs
 * `DataSource.getOverview`: database counts, the branch summaries, the open
 * merge summaries, in one read. Requires `x-ryft-user`.
 */

import { Hono } from "hono";
import type { Env } from "../app.js";
import { assembleOverview } from "../views.js";

export const overviewRoutes = new Hono<Env>();

overviewRoutes.get("/overview", async (c) => {
  return c.json(await assembleOverview(c.get("db")));
});

/**
 * Bootstrap routes — the two that do not require `x-ryft-user`, because they are
 * how you get a workspace and an identity in the first place.
 *
 *  POST /session          create-or-resume a user by username
 *  POST /workspace/reset  wipe and re-seed the workspace (`?bare` → `main` only)
 *
 * `docs/backend-contract.md` §3. `reset` is exempt from identity for the
 * chicken-and-egg reason: on a fresh database there is no user to authenticate
 * as until the seed has run.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Env } from "../app.js";
import { organizations, users } from "../db/schema.js";
import { seedWorkspaceInto } from "../seed.js";
import { assembleOverview } from "../views.js";

export const sessionRoutes = new Hono<Env>();

sessionRoutes.post("/session", async (c) => {
  const body = await c.req.json<{ username?: unknown }>().catch(() => ({}) as { username?: unknown });
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username || username.length > 64) {
    throw new HTTPException(422, { message: "username is required (1–64 characters)" });
  }

  const db = c.get("db");
  const [existing] = await db.select().from(users).where(eq(users.username, username));
  if (existing) {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, existing.organizationId));
    return c.json({ user: existing, organization: org });
  }

  const [org] = await db.select().from(organizations).limit(1);
  if (!org) {
    throw new HTTPException(409, { message: "no workspace yet — POST /workspace/reset first" });
  }
  const [created] = await db
    .insert(users)
    .values({ organizationId: org.id, username, displayName: username })
    .returning();
  return c.json({ user: created, organization: org }, 201);
});

sessionRoutes.post("/workspace/reset", async (c) => {
  const bare = c.req.query("bare") !== undefined;
  await seedWorkspaceInto(c.get("db"), { bare });
  return c.json({ ok: true, overview: await assembleOverview(c.get("db")) });
});

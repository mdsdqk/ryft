/**
 * The Hono app. `createApp(db)` wires one database handle into a fresh app so
 * the same object serves three run modes unchanged: `app.request(...)` in tests
 * (pglite `db`), `@hono/node-server` locally, and `hono/vercel` in production.
 *
 * Every route is under `/api`. Every request except `POST /api/session` carries
 * `x-ryft-user: <username>`; the identity middleware resolves it to a `users`
 * row and puts it on the context as `actor`. Missing or unknown → 401. No
 * token, no session store (`docs/backend-contract.md` §2).
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client.js";
import { users } from "./db/schema.js";
import { sessionRoutes } from "./routes/session.js";
import { overviewRoutes } from "./routes/overview.js";

export type Actor = typeof users.$inferSelect;

export type Env = {
  Variables: {
    db: Db;
    actor: Actor;
  };
};

export function createApp(db: Db): Hono<Env> {
  const app = new Hono<Env>().basePath("/api");

  app.use("*", async (c, next) => {
    c.set("db", db);
    await next();
  });

  // `POST /session` is the only route with no `x-ryft-user` requirement.
  app.route("/", sessionRoutes);

  app.use("*", async (c, next) => {
    const username = c.req.header("x-ryft-user");
    if (!username) {
      throw new HTTPException(401, { message: "x-ryft-user header is required" });
    }
    const [row] = await c.get("db").select().from(users).where(eq(users.username, username));
    if (!row) {
      throw new HTTPException(401, { message: `no user "${username}" — sign in first` });
    }
    c.set("actor", row);
    await next();
  });

  app.route("/", overviewRoutes);

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json({ error: err.message }, err.status);
    }
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

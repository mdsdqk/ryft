/**
 * Merge-request routes (`docs/backend-contract.md` §3, ADR 0004 §3–§5,
 * ADR 0010 §4–§5). All behind the identity gate.
 *
 *  GET    /merge-requests           the open queue (non-terminal only)
 *  POST   /merge-requests           open one: freeze base / ours / theirs
 *  GET    /merge-requests/:id       recompute report + migration + queue framing
 *  POST   /merge-requests/:id/merge the V0 merge transaction (no row lock)
 *  DELETE /merge-requests/:id       abandon
 *
 * V0: status is only `open` or `merged`; there is no queue, no `held`
 * persistence, no resolutions. A second open request from a *different* source
 * is allowed — every read recomputes against live `main`.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { threeWayMerge } from "../../../engine/merge.js";
import { emitMigration } from "../../../engine/emit.js";
import type { MergeMarker } from "../../../src/domain/operations.js";
import type { Env } from "../app.js";
import { branches, mergeRequests, operations } from "../db/schema.js";
import { assembleMergeResponse, listOpenMergeSummaries } from "../views.js";

export const mergeRequestRoutes = new Hono<Env>();

const nextSeq = async (db: Env["Variables"]["db"], branchName: string): Promise<number> => {
  const rows = await db.select({ seq: operations.seq }).from(operations).where(eq(operations.branchName, branchName));
  return rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
};

mergeRequestRoutes.get("/merge-requests", async (c) => {
  return c.json(await listOpenMergeSummaries(c.get("db")));
});

mergeRequestRoutes.post("/merge-requests", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const body = await c.req.json<{ source?: unknown }>().catch(() => ({}) as { source?: unknown });
  const src = typeof body.source === "string" ? body.source.trim() : "";
  if (!src) throw new HTTPException(422, { message: "source is required" });
  if (src === "main") throw new HTTPException(422, { message: "cannot open a merge request from main" });

  const [source] = await db.select().from(branches).where(eq(branches.name, src));
  if (!source) throw new HTTPException(404, { message: `no branch "${src}"` });

  const existing = await db.select().from(mergeRequests).where(eq(mergeRequests.sourceBranch, src));
  const live = existing.find((m) => m.status !== "merged");
  if (live) {
    return c.json({ error: "merge-request-exists", mergeRequestId: live.id }, 409);
  }

  const [main] = await db.select().from(branches).where(eq(branches.name, "main"));
  const [mr] = await db
    .insert(mergeRequests)
    .values({
      sourceBranch: src,
      targetBranch: "main",
      authorId: actor.id,
      status: "open",
      base: source.baseSnapshot,
      ours: source.head,
      theirs: main.head,
      previewedMainVersion: main.headVersion,
    })
    .returning();
  return c.json(await assembleMergeResponse(db, mr), 201);
});

mergeRequestRoutes.get("/merge-requests/:id", async (c) => {
  const db = c.get("db");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, c.req.param("id")));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  return c.json(await assembleMergeResponse(db, mr));
});

mergeRequestRoutes.post("/merge-requests/:id/merge", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, c.req.param("id")));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  if (mr.status !== "open") {
    return c.json({ error: "not-open", status: mr.status }, 409);
  }

  // Re-read both heads live and re-run against current `main` (ADR 0010 §5).
  const [source] = await db.select().from(branches).where(eq(branches.name, mr.sourceBranch));
  const [main] = await db.select().from(branches).where(eq(branches.name, mr.targetBranch));
  const { merged, report } = threeWayMerge(mr.base, source.head, main.head, []);

  if (!merged) {
    return c.json({ error: "revalidation-failed", report }, 409);
  }

  const migration = emitMigration(main.head, merged);
  const now = new Date();
  const marker: MergeMarker = { type: "merge", mergeRequestId: mr.id, sourceBranch: mr.sourceBranch };
  const seq = await nextSeq(db, main.name);

  await db.transaction(async (tx) => {
    await tx
      .update(branches)
      .set({ head: merged, headVersion: main.headVersion + 1 })
      .where(eq(branches.name, main.name));
    await tx.insert(operations).values({
      branchName: main.name,
      seq,
      at: now, // defaulted column set explicitly — assert the row shape (see api/src/seed.ts)
      authorId: actor.id,
      op: marker,
    } as typeof operations.$inferInsert);
    await tx
      .update(mergeRequests)
      .set({
        status: "merged",
        mergedAt: now,
        ours: source.head,
        theirs: main.head,
        previewedMainVersion: main.headVersion,
      })
      .where(eq(mergeRequests.id, mr.id));
  });

  return c.json({ status: "merged", migration });
});

mergeRequestRoutes.delete("/merge-requests/:id", async (c) => {
  const db = c.get("db");
  const [mr] = await db.select({ id: mergeRequests.id }).from(mergeRequests).where(eq(mergeRequests.id, c.req.param("id")));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  await db.delete(mergeRequests).where(eq(mergeRequests.id, mr.id));
  return c.json({ ok: true });
});

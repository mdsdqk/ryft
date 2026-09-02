/**
 * Merge-request routes (`docs/backend-contract.md` §3–§6, ADR 0004 §3–§6).
 * All behind the identity gate.
 *
 *  GET    /merge-requests           the queue (non-terminal, oldest first)
 *  POST   /merge-requests           enqueue one: `open` if the front is free, else `queued`
 *  GET    /merge-requests/:id       recompute report + migration + real queue framing
 *  POST   /merge-requests/:id/resolutions           record a conflict choice (front MR only)
 *  DELETE /merge-requests/:id/resolutions/:conflictId   drop a recorded choice (front MR only)
 *  POST   /merge-requests/:id/merge the merge transaction (§4 — `SELECT … FOR UPDATE`)
 *  DELETE /merge-requests/:id       abandon; promote the next queued MR if this one was active
 *
 * The queue is strict single-file FIFO: at most one MR per target branch is
 * `open` or `held` (the front). Every mutating route locks the target
 * `branches` row (`FOR UPDATE`) so creates, merges, and promotions serialize.
 * Conflict resolutions persist (ADR 0004 §6), keyed by the engine's
 * `${class}:${sortedObjectIds}` conflict id.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq } from "drizzle-orm";
import { emitMigration } from "../../../engine/emit.js";
import type { ColumnType } from "../../../engine/schema.js";
import type { MergeMarker } from "../../../src/domain/operations.js";
import type { DbOrTx } from "../db/client.js";
import type { Env } from "../app.js";
import { branches, mergeRequests, mergeRequestResolutions, operations } from "../db/schema.js";
import {
  assembleMergeResponse,
  listOpenMergeSummaries,
  resolveMerge,
  revalidationKickback,
} from "../views.js";
import { threeWayMerge } from "../../../engine/merge.js";

export const mergeRequestRoutes = new Hono<Env>();

const nextSeq = async (db: DbOrTx, branchName: string): Promise<number> => {
  const rows = await db.select({ seq: operations.seq }).from(operations).where(eq(operations.branchName, branchName));
  return rows.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
};

/** Is there an `open` or `held` MR for `target` right now? (the front is taken) */
const frontTaken = async (db: DbOrTx, target: string): Promise<boolean> => {
  const rows = await db
    .select({ status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.targetBranch, target));
  return rows.some((r) => r.status === "open" || r.status === "held");
};

/** Promote the oldest `queued` MR for `target` to `open` (its triple refreshes on next GET). */
const promoteNext = async (db: DbOrTx, target: string): Promise<void> => {
  const [next] = await db
    .select({ id: mergeRequests.id })
    .from(mergeRequests)
    .where(and(eq(mergeRequests.targetBranch, target), eq(mergeRequests.status, "queued")))
    .orderBy(asc(mergeRequests.createdAt))
    .limit(1);
  if (next) await db.update(mergeRequests).set({ status: "open" }).where(eq(mergeRequests.id, next.id));
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

  const created = await db.transaction(async (tx) => {
    // lock the target row so status assignment (`open` vs `queued`) is race-free
    const [main] = await tx.select().from(branches).where(eq(branches.name, "main")).for("update");

    const existing = await tx.select().from(mergeRequests).where(eq(mergeRequests.sourceBranch, src));
    const live = existing.find((m) => m.status !== "merged");
    if (live) return { conflict: live.id as string };

    const status = (await frontTaken(tx, "main")) ? ("queued" as const) : ("open" as const);
    const [mr] = await tx
      .insert(mergeRequests)
      .values({
        sourceBranch: src,
        targetBranch: "main",
        authorId: actor.id,
        status,
        base: source.baseSnapshot,
        ours: source.head,
        theirs: main.head,
        previewedMainVersion: main.headVersion,
      })
      .returning();
    return { mr };
  });

  if ("conflict" in created) {
    return c.json({ error: "merge-request-exists", mergeRequestId: created.conflict }, 409);
  }
  return c.json(await assembleMergeResponse(db, created.mr), 201);
});

mergeRequestRoutes.get("/merge-requests/:id", async (c) => {
  const db = c.get("db");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, c.req.param("id")));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  return c.json(await assembleMergeResponse(db, mr));
});

mergeRequestRoutes.post("/merge-requests/:id/resolutions", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, c.req.param("id")));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  if (mr.status !== "open" && mr.status !== "held") {
    return c.json({ error: "not-front", status: mr.status }, 409);
  }

  const body = await c.req
    .json<{ conflictId?: unknown; choice?: unknown; type?: unknown }>()
    .catch(() => ({}) as Record<string, unknown>);
  const conflictId = typeof body.conflictId === "string" ? body.conflictId : "";
  const choice = body.choice;
  if (!conflictId) throw new HTTPException(422, { message: "conflictId is required" });
  if (choice !== "ours" && choice !== "theirs" && choice !== "type") {
    throw new HTTPException(422, { message: 'choice must be "ours", "theirs", or "type"' });
  }

  // Validate against the current conflict set for the frozen triple.
  const { report } = threeWayMerge(mr.base, mr.ours, mr.theirs, []);
  const conflict = report.conflicts.find((x) => x.id === conflictId);
  if (!conflict) {
    throw new HTTPException(422, { message: `no open conflict "${conflictId}"` });
  }
  if (!conflict.resolutionModes.includes(choice)) {
    throw new HTTPException(422, {
      message: `conflict "${conflictId}" does not accept choice "${choice}" (modes: ${conflict.resolutionModes.join(", ")})`,
    });
  }
  const type = choice === "type" ? (body.type as ColumnType | undefined) : undefined;
  if (choice === "type" && (!type || typeof type !== "object")) {
    throw new HTTPException(422, { message: 'choice "type" requires a ColumnType `type`' });
  }

  const snapshot = { base: conflict.base, ours: conflict.ours, theirs: conflict.theirs };
  await db
    .insert(mergeRequestResolutions)
    .values({
      mrId: mr.id,
      conflictId,
      choice,
      payload: type ?? null,
      conflictSnapshot: snapshot,
      savedBy: actor.id,
    })
    .onConflictDoUpdate({
      target: [mergeRequestResolutions.mrId, mergeRequestResolutions.conflictId],
      set: { choice, payload: type ?? null, conflictSnapshot: snapshot, savedBy: actor.id, savedAt: new Date() },
    });

  return c.json(await assembleMergeResponse(db, mr));
});

mergeRequestRoutes.delete("/merge-requests/:id/resolutions/:conflictId", async (c) => {
  const db = c.get("db");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, c.req.param("id")));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  if (mr.status !== "open" && mr.status !== "held") {
    return c.json({ error: "not-front", status: mr.status }, 409);
  }

  await db
    .delete(mergeRequestResolutions)
    .where(
      and(
        eq(mergeRequestResolutions.mrId, mr.id),
        eq(mergeRequestResolutions.conflictId, c.req.param("conflictId")),
      ),
    );

  return c.json(await assembleMergeResponse(db, mr));
});

mergeRequestRoutes.post("/merge-requests/:id/merge", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const id = c.req.param("id");
  const [pre] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, id));
  if (!pre) throw new HTTPException(404, { message: "no such merge request" });

  // The whole thing in one transaction under a `FOR UPDATE` lock on the target
  // branch row — serializes concurrent merges and every queue promotion (§4).
  const result = await db.transaction(async (tx) => {
    const [main] = await tx.select().from(branches).where(eq(branches.name, pre.targetBranch)).for("update");
    const [mr] = await tx.select().from(mergeRequests).where(eq(mergeRequests.id, id)); // re-read under the lock
    if (!mr) return { kind: "gone" as const };
    if (mr.status !== "open" && mr.status !== "held") {
      return { kind: "not-front" as const, status: mr.status };
    }

    // live heads inside the lock; re-run against live `main.head`, never frozen `theirs`
    const [source] = await tx.select().from(branches).where(eq(branches.name, mr.sourceBranch));
    const { merged, report, migration, droppedResolutions } = await resolveMerge(tx, mr, {
      base: mr.base,
      ours: source.head,
      theirs: main.head,
    });

    if (!merged) {
      // kick back: hold, refresh the triple so the next GET shows the current
      // three-way, keep the place at the front (§4, §6).
      await tx
        .update(mergeRequests)
        .set({ status: "held", ours: source.head, theirs: main.head, previewedMainVersion: main.headVersion })
        .where(eq(mergeRequests.id, mr.id));
      const body = await revalidationKickback(tx, mr, report, droppedResolutions);
      return { kind: "kickback" as const, body };
    }

    const now = new Date();
    const newVersion = main.headVersion + 1;
    const seq = await nextSeq(tx, main.name);
    const marker: MergeMarker = { type: "merge", mergeRequestId: mr.id, sourceBranch: mr.sourceBranch };

    await tx.update(branches).set({ head: merged, headVersion: newVersion }).where(eq(branches.name, main.name));
    await tx.insert(operations).values({
      branchName: main.name,
      seq,
      at: now, // defaulted column set explicitly — assert the row shape (see api/_server/seed.ts)
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
        previewedMainVersion: newVersion,
      })
      .where(eq(mergeRequests.id, mr.id));
    await promoteNext(tx, mr.targetBranch);

    return { kind: "merged" as const, migration: migration ?? emitMigration(main.head, merged) };
  });

  if (result.kind === "gone") throw new HTTPException(404, { message: "no such merge request" });
  if (result.kind === "not-front") return c.json({ error: "not-front", status: result.status }, 409);
  if (result.kind === "kickback") return c.json(result.body, 409);
  return c.json({ status: "merged", migration: result.migration });
});

mergeRequestRoutes.delete("/merge-requests/:id", async (c) => {
  const db = c.get("db");
  const id = c.req.param("id");
  const [pre] = await db.select().from(mergeRequests).where(eq(mergeRequests.id, id));
  if (!pre) throw new HTTPException(404, { message: "no such merge request" });

  await db.transaction(async (tx) => {
    await tx.select().from(branches).where(eq(branches.name, pre.targetBranch)).for("update");
    const [mr] = await tx.select({ status: mergeRequests.status }).from(mergeRequests).where(eq(mergeRequests.id, id));
    if (!mr) return;
    await tx.delete(mergeRequests).where(eq(mergeRequests.id, id)); // resolutions cascade
    if (mr.status === "open" || mr.status === "held") await promoteNext(tx, pre.targetBranch);
  });

  return c.json({ ok: true });
});

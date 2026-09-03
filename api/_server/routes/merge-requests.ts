/**
 * Merge-request routes (`docs/backend-contract.md` §3–§6, ADR 0004 §3–§6).
 * All behind the identity gate.
 *
 *  GET    /merge-requests           the queue (non-terminal, oldest first)
 *                                   `?state=closed` — terminal list (closed + merged), newest first
 *  POST   /merge-requests           enqueue one: `open` if the front is free, else `queued`
 *  GET    /merge-requests/:id       recompute report + migration + real queue framing
 *  POST   /merge-requests/:id/resolutions           record a conflict choice (front MR only)
 *  DELETE /merge-requests/:id/resolutions/:conflictId   drop a recorded choice (front MR only)
 *  POST   /merge-requests/:id/merge the merge transaction (§4 — `SELECT … FOR UPDATE`)
 *  POST   /merge-requests/:id/close soft-close; keeps the row, promotes the next queued MR
 *  DELETE /merge-requests/:id       hard delete; promote the next queued MR if this one was active
 *
 * The queue is strict single-file FIFO: at most one MR per target branch is
 * `open` or `held` (the front). Every mutating route locks the target
 * `branches` row (`FOR UPDATE`) so creates, merges, and promotions serialize.
 * Conflict resolutions persist (ADR 0004 §6), keyed by the engine's
 * `${class}:${sortedObjectIds}` conflict id.
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, sql } from "drizzle-orm";
import { emitMigration } from "../../../engine/emit.js";
import type { ColumnType } from "../../../engine/schema.js";
import type { MergeMarker } from "../../../src/domain/operations.js";
import type { DbOrTx } from "../db/client.js";
import type { Env } from "../app.js";
import { branches, deletedBranches, mergeRequests, mergeRequestResolutions, operations } from "../db/schema.js";
import {
  assembleMergeResponse,
  isTerminal,
  listOpenMergeSummaries,
  listTerminalMergeSummaries,
  resolveMerge,
  revalidationKickback,
} from "../views.js";
import { threeWayMerge } from "../../../engine/merge.js";
import { validateDocument } from "../../../engine/validate.js";

export const mergeRequestRoutes = new Hono<Env>();

/**
 * The `:id` route segment is a merge request's public `number` (ADR 0004) —
 * `/merge-requests/12`, never the uuid. Parse it to an integer or 404; a
 * non-numeric segment cannot name a request.
 */
const mrNumber = (raw: string): number => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new HTTPException(404, { message: "no such merge request" });
  return n;
};

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
  const db = c.get("db");
  // `?state=closed` is the terminal-request record list — `closed` and `merged`
  // both (ADR 0012 §3, ADR 0013 §6). Anything else, including no query at all,
  // is the live queue this endpoint has always been.
  if (c.req.query("state") === "closed") return c.json(await listTerminalMergeSummaries(db));
  return c.json(await listOpenMergeSummaries(db));
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
    const live = existing.find((m) => !isTerminal(m.status));
    if (live) return { conflict: live.number };

    const status = (await frontTaken(tx, "main")) ? ("queued" as const) : ("open" as const);
    // gapless per-workspace counter — the `FOR UPDATE` on `main` above serialises
    // this read against every other create (ADR 0004).
    const [{ next } = { next: 1 }] = await tx
      .select({ next: sql<number>`coalesce(max(${mergeRequests.number}), 0) + 1` })
      .from(mergeRequests);
    const [mr] = await tx
      .insert(mergeRequests)
      .values({
        number: Number(next),
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
    return c.json({ error: "merge-request-exists", mergeRequestNumber: created.conflict }, 409);
  }
  return c.json(await assembleMergeResponse(db, created.mr), 201);
});

mergeRequestRoutes.get("/merge-requests/:id", async (c) => {
  const db = c.get("db");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.number, mrNumber(c.req.param("id"))));
  if (!mr) throw new HTTPException(404, { message: "no such merge request" });
  return c.json(await assembleMergeResponse(db, mr));
});

mergeRequestRoutes.post("/merge-requests/:id/resolutions", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.number, mrNumber(c.req.param("id"))));
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
  const [mr] = await db.select().from(mergeRequests).where(eq(mergeRequests.number, mrNumber(c.req.param("id"))));
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
  const [pre] = await db.select().from(mergeRequests).where(eq(mergeRequests.number, mrNumber(c.req.param("id"))));
  if (!pre) throw new HTTPException(404, { message: "no such merge request" });

  // The whole thing in one transaction under a `FOR UPDATE` lock on the target
  // branch row — serializes concurrent merges and every queue promotion (§4).
  const result = await db.transaction(async (tx) => {
    const [main] = await tx.select().from(branches).where(eq(branches.name, pre.targetBranch)).for("update");
    const [mr] = await tx.select().from(mergeRequests).where(eq(mergeRequests.id, pre.id)); // re-read under the lock
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

    // ADR 0008 §5: the merge is `clean`, but two individually-valid deltas can
    // still compose into a structurally broken document (a dangling reference, a
    // duplicate name, an FK orphaned by a dropped constraint). Validate the
    // candidate before it becomes `main.head`; on failure respond `409` and
    // leave the MR where it is — nothing is written, the author fixes the source
    // branch and retries.
    const structural = validateDocument(merged);
    if (structural.length) {
      return { kind: "structural" as const, errors: structural };
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

    // ADR 0013 §6: a merged branch is finished — its work is in `main`, and
    // leaving it standing only shows a permanent phantom divergence against its
    // own frozen cut point (there is no rebase in this model). Archive it to
    // `deleted_branches` and drop it from `branches`, in this same transaction —
    // the same archive-then-delete `DELETE /branches/:name` runs. Its op log
    // cascades; this MR's now-FK-less `source_branch` keeps the name as a record.
    await tx.insert(deletedBranches).values({
      name: source.name,
      organizationId: source.organizationId,
      authorId: source.authorId,
      createdAt: source.createdAt,
      head: source.head,
      baseSnapshot: source.baseSnapshot,
      headVersion: source.headVersion,
      deletedById: actor.id,
    });
    await tx.delete(branches).where(eq(branches.name, source.name));

    return { kind: "merged" as const, migration: migration ?? emitMigration(main.head, merged) };
  });

  if (result.kind === "gone") throw new HTTPException(404, { message: "no such merge request" });
  if (result.kind === "not-front") return c.json({ error: "not-front", status: result.status }, 409);
  if (result.kind === "kickback") return c.json(result.body, 409);
  if (result.kind === "structural") {
    return c.json({ error: "structural-validation-failed", errors: result.errors }, 409);
  }
  return c.json({ status: "merged", migration: result.migration });
});

/**
 * Soft-close (ADR 0012 §3). The row survives with `status = 'closed'` and
 * `closed_at = now()`, so "what happened to that request" keeps an answer and
 * the recorded resolutions stay attached to it. `closed` is terminal, so the
 * request leaves the queue — and if it was the front (`open`/`held`), the next
 * `queued` request is promoted, exactly as abandoning it does. A `merged`
 * request is a record of something that happened and cannot be closed (409);
 * closing an already-closed one is a no-op, so the call is idempotent.
 */
mergeRequestRoutes.post("/merge-requests/:id/close", async (c) => {
  const db = c.get("db");
  const [pre] = await db.select().from(mergeRequests).where(eq(mergeRequests.number, mrNumber(c.req.param("id"))));
  if (!pre) throw new HTTPException(404, { message: "no such merge request" });

  const result = await db.transaction(async (tx) => {
    // the same lock every queue mutation takes — closing the front promotes
    await tx.select().from(branches).where(eq(branches.name, pre.targetBranch)).for("update");
    const [mr] = await tx.select().from(mergeRequests).where(eq(mergeRequests.id, pre.id)); // re-read under the lock
    if (!mr) return { kind: "gone" as const };
    if (mr.status === "merged") return { kind: "merged" as const };
    if (mr.status === "closed") return { kind: "closed" as const, mr };

    const [updated] = await tx
      .update(mergeRequests)
      .set({ status: "closed", closedAt: new Date() })
      .where(eq(mergeRequests.id, mr.id))
      .returning();
    if (mr.status === "open" || mr.status === "held") await promoteNext(tx, mr.targetBranch);
    return { kind: "closed" as const, mr: updated ?? mr };
  });

  if (result.kind === "gone") throw new HTTPException(404, { message: "no such merge request" });
  if (result.kind === "merged") {
    return c.json({ error: "already-merged", status: "merged" }, 409);
  }
  return c.json(await assembleMergeResponse(db, result.mr));
});

/**
 * Hard delete — the row and its resolutions go. Kept alongside the soft close
 * (ADR 0012 §3) as the escape valve for a request that should leave no record
 * at all (a mistaken open, a test fixture). Nothing in the web app calls it;
 * "Close request" is the user-facing action.
 */
mergeRequestRoutes.delete("/merge-requests/:id", async (c) => {
  const db = c.get("db");
  const [pre] = await db.select().from(mergeRequests).where(eq(mergeRequests.number, mrNumber(c.req.param("id"))));
  if (!pre) throw new HTTPException(404, { message: "no such merge request" });

  await db.transaction(async (tx) => {
    await tx.select().from(branches).where(eq(branches.name, pre.targetBranch)).for("update");
    const [mr] = await tx.select({ status: mergeRequests.status }).from(mergeRequests).where(eq(mergeRequests.id, pre.id));
    if (!mr) return;
    await tx.delete(mergeRequests).where(eq(mergeRequests.id, pre.id)); // resolutions cascade
    if (mr.status === "open" || mr.status === "held") await promoteNext(tx, pre.targetBranch);
  });

  return c.json({ ok: true });
});

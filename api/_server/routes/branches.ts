/**
 * Branch routes (`docs/backend-contract.md` §3, ADR 0004 §8). All behind the
 * identity gate.
 *
 *  GET    /branches                list summaries (trunk first)
 *  GET    /branches/deleted        list the archived (dropped) branches (ADR 0013)
 *  GET    /branches/:name          head + base documents, divergence, open MR id
 *  POST   /branches                cut a working branch from `main`
 *  DELETE /branches/:name          drop a working branch — archive-then-delete (ADR 0013)
 *  POST   /branches/:name/operations   apply a batch through applyOperation
 *  GET    /branches/:name/operations   the whole log, ascending seq
 *  DELETE /branches/:name/operations?after=<seq>   undo: drop every op past <seq>
 */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, gt, lte } from "drizzle-orm";
import { applyOperation, OperationBlockedError } from "../../../engine/apply-operation.js";
import { validateDocument } from "../../../engine/validate.js";
import type { Operation } from "../../../engine/operations.js";
import type { SchemaDocument } from "../../../engine/schema.js";
import type { Env } from "../app.js";
import { branches, deletedBranches, mergeRequests, operations } from "../db/schema.js";
import { assembleBranchDetail, listBranchSummaries, listDeletedBranches } from "../views.js";
import type { LogEntry, OperationsResponse, UndoResponse } from "../types.js";

export const branchRoutes = new Hono<Env>();

/** Branch names are row keys, not Postgres identifiers — hyphens allowed (demo: `contact-fields`). */
const BRANCH_NAME = /^[a-z][a-z0-9_-]{0,38}$/;

branchRoutes.get("/branches", async (c) => {
  return c.json(await listBranchSummaries(c.get("db")));
});

// Registered before `/branches/:name` so `deleted` is not read as a branch name.
branchRoutes.get("/branches/deleted", async (c) => {
  return c.json(await listDeletedBranches(c.get("db")));
});

branchRoutes.get("/branches/:name", async (c) => {
  const detail = await assembleBranchDetail(c.get("db"), c.req.param("name"));
  if (!detail) throw new HTTPException(404, { message: `no branch "${c.req.param("name")}"` });
  return c.json(detail);
});

branchRoutes.post("/branches", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const body = await c.req.json<{ name?: unknown }>().catch(() => ({}) as { name?: unknown });
  const name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";

  if (name === "main") throw new HTTPException(409, { message: "main is the trunk" });
  if (!BRANCH_NAME.test(name)) {
    throw new HTTPException(422, { message: "name must be lowercase: a letter then letters, digits, hyphen, underscore (≤ 39)" });
  }
  const [existing] = await db.select({ name: branches.name }).from(branches).where(eq(branches.name, name));
  if (existing) throw new HTTPException(409, { message: `branch "${name}" already exists` });

  const [main] = await db.select().from(branches).where(eq(branches.name, "main"));
  if (!main) throw new HTTPException(409, { message: "no main branch — reset the workspace" });

  // id-preserving clone of main's head for both head and base (ADR 0004 §2).
  const snapshot = structuredClone(main.head) as SchemaDocument;
  await db.insert(branches).values({
    name,
    organizationId: actor.organizationId,
    authorId: actor.id,
    head: snapshot,
    baseSnapshot: structuredClone(snapshot),
    headVersion: 0,
  });
  return c.json(await assembleBranchDetail(db, name), 201);
});

branchRoutes.delete("/branches/:name", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const name = c.req.param("name");
  if (name === "main") throw new HTTPException(403, { message: "main cannot be deleted" });

  const [b] = await db.select().from(branches).where(eq(branches.name, name));
  if (!b) throw new HTTPException(404, { message: `no branch "${name}"` });

  const mrs = await db
    .select({ id: mergeRequests.id, status: mergeRequests.status })
    .from(mergeRequests)
    .where(eq(mergeRequests.sourceBranch, name));
  const blocking = mrs.find((m) => m.status !== "merged");
  if (blocking) {
    return c.json({ error: "blocked-by-merge-request", mergeRequestId: blocking.id }, 409);
  }

  // Archive-then-delete in one transaction (ADR 0013): copy the whole row into
  // `deleted_branches`, then drop it from `branches` (operations cascade). The
  // branch leaves `branches` — the primary key on `name` is freed — so the name
  // can be cut again, and the archived row keeps the deleted list.
  await db.transaction(async (tx) => {
    await tx.insert(deletedBranches).values({
      name: b.name,
      organizationId: b.organizationId,
      authorId: b.authorId,
      createdAt: b.createdAt,
      head: b.head,
      baseSnapshot: b.baseSnapshot,
      headVersion: b.headVersion,
      deletedById: actor.id,
    });
    await tx.delete(branches).where(eq(branches.name, name));
  });
  return c.json({ ok: true });
});

branchRoutes.get("/branches/:name/operations", async (c) => {
  const db = c.get("db");
  const name = c.req.param("name");
  const rows = await db
    .select()
    .from(operations)
    .where(eq(operations.branchName, name))
    .orderBy(asc(operations.seq));
  const log: LogEntry[] = rows.map((r) => ({ seq: r.seq, at: r.at.toISOString(), authorId: r.authorId, op: r.op }));
  return c.json(log);
});

branchRoutes.post("/branches/:name/operations", async (c) => {
  const db = c.get("db");
  const actor = c.get("actor");
  const name = c.req.param("name");

  if (name === "main") throw new HTTPException(403, { message: "main changes only through a merge" });

  const [branch] = await db.select().from(branches).where(eq(branches.name, name));
  if (!branch) throw new HTTPException(404, { message: `no branch "${name}"` });

  const body = await c.req.json<{ ops?: unknown }>().catch(() => ({}) as { ops?: unknown });
  const ops = body.ops;
  if (!Array.isArray(ops) || ops.length === 0) {
    throw new HTTPException(422, { message: "ops must be a non-empty array" });
  }

  // Fold the batch in memory — applyOperation is pure, so validation needs no
  // transaction. Op n is checked against the head with ops 1..n-1 applied
  // (`docs/robustness.md` §5). Persist only on a fully clean batch.
  let head = branch.head;
  const warnings: OperationsResponse["warnings"] = [];
  for (let i = 0; i < ops.length; i++) {
    try {
      const r = applyOperation(head, ops[i] as Operation);
      head = r.head;
      for (const w of r.warnings) warnings.push({ reason: w.reason, message: w.message, objectId: w.objectId });
    } catch (e) {
      if (e instanceof OperationBlockedError) {
        const base = { failedAt: i, op: e.op };
        return e.error.reason === "drop-blocked"
          ? c.json({ error: "drop-blocked", ...base, dependents: e.error.dependents ?? [] }, 422)
          : c.json({ error: e.error.reason, ...base, message: e.error.message }, 422);
      }
      throw e;
    }
  }

  // Whole-document backstop (ADR 0008 §5, `docs/robustness.md` §5): `validateOperation`
  // should already have blocked any single-op route to an invalid document, so a
  // `StructuralError` here means either a gap in the per-op rules or a batch that
  // composed to an incoherent whole (a dangling reference, a duplicate name, an
  // orphaned foreign key). Reject the batch — nothing is persisted.
  const structural = validateDocument(head);
  if (structural.length) {
    return c.json({ error: "structural-validation-failed", errors: structural }, 422);
  }

  const seqs = await db.select({ seq: operations.seq }).from(operations).where(eq(operations.branchName, name));
  const startSeq = seqs.reduce((m, r) => Math.max(m, r.seq), 0) + 1;
  const appliedSeqs = ops.map((_, k) => startSeq + k);
  const headVersion = branch.headVersion + 1;
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.update(branches).set({ head, headVersion }).where(eq(branches.name, name));
    await tx.insert(operations).values(
      (ops as Operation[]).map(
        (op, k) =>
          ({
            branchName: name,
            seq: startSeq + k,
            at: now, // defaulted column set explicitly — assert the row shape (see api/_server/seed.ts)
            authorId: actor.id,
            op,
          }) as typeof operations.$inferInsert,
      ),
    );
  });

  const res: OperationsResponse = { head, appliedSeqs, headVersion, warnings };
  return c.json(res);
});

branchRoutes.delete("/branches/:name/operations", async (c) => {
  const db = c.get("db");
  const name = c.req.param("name");

  if (name === "main") throw new HTTPException(403, { message: "main has no editable log" });

  const [branch] = await db.select().from(branches).where(eq(branches.name, name));
  if (!branch) throw new HTTPException(404, { message: `no branch "${name}"` });

  // `?after=<seq>` — keep the log up to and including <seq>, drop everything
  // past it. `after=0` clears the branch back to its cut. The structured
  // editor's LIFO undo passes `last.seq - 1` (`docs/backend-contract.md` §3).
  const afterRaw = c.req.query("after");
  const after = Number(afterRaw);
  if (afterRaw === undefined || !Number.isInteger(after) || after < 0) {
    throw new HTTPException(422, { message: "after must be an integer ≥ 0 (the last seq to keep)" });
  }

  // Rebuild head by replaying the surviving prefix from base_snapshot — the
  // same fold `POST .../operations` runs, so head is byte-identical to what a
  // shorter edit history would have produced. These ops applied cleanly once,
  // so a replay cannot raise OperationBlockedError.
  const kept = await db
    .select()
    .from(operations)
    .where(and(eq(operations.branchName, name), lte(operations.seq, after)))
    .orderBy(asc(operations.seq));

  let head = branch.baseSnapshot;
  for (const row of kept) {
    if (row.op.type === "merge") continue; // markers never land on a working branch
    head = applyOperation(head, row.op as Operation).head;
  }

  const headVersion = branch.headVersion + 1;
  await db.transaction(async (tx) => {
    await tx.delete(operations).where(and(eq(operations.branchName, name), gt(operations.seq, after)));
    await tx.update(branches).set({ head, headVersion }).where(eq(branches.name, name));
  });

  const res: UndoResponse = { head, headVersion };
  return c.json(res);
});

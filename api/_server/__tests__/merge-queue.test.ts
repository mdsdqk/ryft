/**
 * The V1 merge queue (ADR 0004 §3–§6): strict single-file FIFO, `SELECT … FOR
 * UPDATE` on every mutating route, promotion on merge/abandon, lazy triple
 * refresh for the active MR, real `queue.position`/`stale`, and the `409`
 * kick-back body. Each test starts from a workspace with the seeded
 * `contact-fields` MR abandoned so the front is free.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { freshDb } from "./setup.js";
import { seedIds } from "../../../examples/seed.schema.js";
import type { Operation } from "../../../engine/operations.js";

let app: ReturnType<typeof createApp>;
const grace = { "x-ryft-user": "grace", "content-type": "application/json" };
const j = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

const retype = (n: number): Operation => ({
  type: "retypeColumn",
  tableId: seedIds.users.table,
  columnId: seedIds.users.email,
  from: { kind: "varchar", n: 255 },
  to: { kind: "varchar", n },
});

beforeEach(async () => {
  app = createApp(await freshDb());
  await app.request("/api/workspace/reset", { method: "POST" });
  const list = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{ id: string }>;
  if (list[0]) await app.request(`/api/merge-requests/${list[0].id}`, { method: "DELETE", headers: grace });
});

const branch = (name: string) =>
  app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name }) });
const apply = (name: string, ops: Operation[]) =>
  app.request(`/api/branches/${name}/operations`, { method: "POST", headers: grace, body: JSON.stringify({ ops }) });
const openMr = async (source: string) =>
  j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source }) }));
const getMr = async (id: string) => j(await app.request(`/api/merge-requests/${id}`, { headers: grace }));
const mergeMr = (id: string) => app.request(`/api/merge-requests/${id}/merge`, { method: "POST", headers: grace });
const abandon = (id: string) => app.request(`/api/merge-requests/${id}`, { method: "DELETE", headers: grace });

describe("the queue", () => {
  it("the second MR queues behind the first; queue framing is real", async () => {
    await branch("a");
    await branch("b");
    const a = await openMr("a");
    const b = await openMr("b");

    expect((await getMr(a.id as string)).queue).toMatchObject({ status: "open", position: 1, ahead: 0 });
    expect((await getMr(b.id as string)).queue).toMatchObject({ status: "queued", position: 2, ahead: 1, behind: 0 });
  });

  it("merging the front promotes the next queued MR to open", async () => {
    await branch("a");
    await branch("b");
    const a = await openMr("a");
    const b = await openMr("b");

    expect((await j(await mergeMr(a.id as string))).status).toBe("merged");

    const bv = await getMr(b.id as string);
    expect(bv.queue).toMatchObject({ status: "open", position: 1 });
    expect(bv.stale).toBe(false); // its GET refreshed the triple to live main
  });

  it("abandoning the front promotes the next queued MR", async () => {
    await branch("a");
    await branch("b");
    const a = await openMr("a");
    const b = await openMr("b");

    await abandon(a.id as string);
    expect((await getMr(b.id as string)).queue).toMatchObject({ status: "open", position: 1 });
  });

  it("a queued MR cannot be merged or resolved", async () => {
    await branch("a");
    await branch("b");
    await openMr("a");
    const b = await openMr("b");

    const m = await mergeMr(b.id as string);
    expect(m.status).toBe(409);
    expect((await j(m)).error).toBe("not-front");

    const res = await app.request(`/api/merge-requests/${b.id as string}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId: "x", choice: "ours" }),
    });
    expect(res.status).toBe(409);
    expect((await j(res)).error).toBe("not-front");
  });

  it("a same-source second request is still refused", async () => {
    await branch("a");
    await openMr("a");
    const dup = await app.request("/api/merge-requests", {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ source: "a" }),
    });
    expect(dup.status).toBe(409);
    expect((await j(dup)).error).toBe("merge-request-exists");
  });
});

describe("staleness", () => {
  it("a queued MR behind the promoted one goes stale when main moves; the active MR does not", async () => {
    await branch("a");
    await branch("b");
    await branch("c");
    await apply("a", [retype(500)]);
    const a = await openMr("a");
    const b = await openMr("b");
    const c = await openMr("c");

    expect((await getMr(c.id as string)).stale).toBe(false);

    expect((await j(await mergeMr(a.id as string))).status).toBe("merged"); // main.head_version 0 → 1, b promoted

    const cv = await getMr(c.id as string);
    expect(cv.queue).toMatchObject({ status: "queued", position: 2 });
    expect(cv.stale).toBe(true);
    expect((await getMr(b.id as string)).stale).toBe(false);
  });
});

describe("the kick-back", () => {
  /** a → main lands a retype of users.email; b (behind it) retyped the same column. */
  async function landAheadOf(): Promise<{ bId: string }> {
    await branch("a");
    await branch("b");
    await apply("a", [retype(500)]);
    await apply("b", [retype(1000)]);
    const a = await openMr("a");
    const b = await openMr("b");
    expect((await j(await mergeMr(a.id as string))).status).toBe("merged"); // b promoted, triple refreshes on next GET
    return { bId: b.id as string };
  }

  it("a non-clean re-run at the front returns the kick-back body and holds", async () => {
    const { bId } = await landAheadOf();

    const m = await mergeMr(bId);
    expect(m.status).toBe(409);
    const body = await j(m);
    expect(body.error).toBe("revalidation-failed");
    expect(body.reason).toBe("conflicts");
    expect(body.landed).toEqual([{ branch: "a", mergedAt: expect.any(String) }]);
    expect((body.conflicts as unknown[]).length).toBeGreaterThan(0);
    expect(body.summary).toMatch(/moved on .* merged ahead of you\. one of your changes now conflicts with what landed\./i);

    const held = await getMr(bId);
    expect(held.queue).toMatchObject({ status: "held", position: 1 });
  });

  it("a held MR can be resolved and then merged", async () => {
    const { bId } = await landAheadOf();
    await mergeMr(bId); // → held

    const held = await getMr(bId);
    const conflictId = (held.report as { conflicts: Array<{ id: string }> }).conflicts[0]!.id;
    const res = await app.request(`/api/merge-requests/${bId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "theirs" }),
    });
    expect(res.status).toBe(200);

    expect((await j(await mergeMr(bId))).status).toBe("merged");
  });
});

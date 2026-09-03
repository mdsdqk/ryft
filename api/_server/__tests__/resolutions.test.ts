/**
 * `POST /merge-requests/:id/resolutions` and its `DELETE` (ADR 0004 §6,
 * `docs/backend-contract.md` §3). Drives a real `divergent-retype` conflict by
 * merging two branches that each retyped `users.email` differently, then
 * resolves it, confirms it persists across a `GET`, shows up on the `/merges`
 * list, and reverts on delete.
 *
 * Also covers the on-read `ours` refresh (ADR 0012 §1–§2): an edit to the source
 * branch after the request opened shows up on the next `GET`, and a stored
 * resolution the refresh invalidates comes back named in `droppedResolutions`
 * rather than vanishing.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { freshDb } from "./setup.js";
import { seedIds } from "../../../examples/seed.schema.js";
import type { SchemaDocument } from "../../../engine/schema.js";
import type { Operation } from "../../../engine/operations.js";

let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  app = createApp(await freshDb());
  await app.request("/api/workspace/reset", { method: "POST" });
});

const grace = { "x-ryft-user": "grace", "content-type": "application/json" };
const j = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

const retypeEmail = (n: number): Operation => ({
  type: "retypeColumn",
  tableId: seedIds.users.table,
  columnId: seedIds.users.email,
  from: { kind: "varchar", n: 255 },
  to: { kind: "varchar", n },
});

/** Cuts two branches that each retype `users.email`, merges the first (clean),
 * then opens the second — which now collides with what landed. Returns the
 * second's MR id and the id of its lone `divergent-retype` conflict. */
async function openConflictedMr(): Promise<{ mrId: number; conflictId: string }> {
  // the queue is strict FIFO — abandon the seeded contact-fields MR so the
  // front is free and wide-email's request opens active.
  const seeded = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{ number: number }>;
  if (seeded[0]) await app.request(`/api/merge-requests/${seeded[0].number}`, { method: "DELETE", headers: grace });

  await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wide-email" }) });
  await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wider-email" }) });
  await app.request("/api/branches/wide-email/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: [retypeEmail(500)] }) });
  await app.request("/api/branches/wider-email/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: [retypeEmail(1000)] }) });

  const mr1 = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "wide-email" }) }));
  expect((mr1.report as { verdict: string }).verdict).toBe("clean");
  const merged1 = await j(await app.request(`/api/merge-requests/${mr1.number as number}/merge`, { method: "POST", headers: grace }));
  expect(merged1.status).toBe("merged");

  const mr2 = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "wider-email" }) }));
  const report = mr2.report as { verdict: string; conflicts: Array<{ id: string; class: string; resolutionModes: string[] }> };
  expect(report.verdict).toBe("conflicts");
  expect(report.conflicts).toHaveLength(1);
  expect(report.conflicts[0]!.class).toBe("divergent-retype");
  return { mrId: mr2.number as number, conflictId: report.conflicts[0]!.id };
}

/** `users.email`'s varchar width in a returned schema document. */
const emailWidth = (doc: unknown): number => {
  const t = (doc as SchemaDocument).tables.find((x) => x.id === seedIds.users.table)!;
  const c = t.columns.find((x) => x.id === seedIds.users.email)!;
  return c.type.kind === "varchar" ? c.type.n : -1;
};

const applyTo = (branch: string, ops: Operation[]) =>
  app.request(`/api/branches/${branch}/operations`, { method: "POST", headers: grace, body: JSON.stringify({ ops }) });

describe("GET /merge-requests/:id re-freezes `ours` (ADR 0012 §1)", () => {
  it("an edit to the source branch after the request opened shows up on the next read", async () => {
    const seeded = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{ number: number }>;
    if (seeded[0]) await app.request(`/api/merge-requests/${seeded[0].number}`, { method: "DELETE", headers: grace });

    await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wide-email" }) });
    await applyTo("wide-email", [retypeEmail(500)]);
    const mr = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "wide-email" }) }));
    expect(emailWidth(mr.ours)).toBe(500);

    // the author keeps working on the branch after opening the request
    await applyTo("wide-email", [
      { type: "retypeColumn", tableId: seedIds.users.table, columnId: seedIds.users.email, from: { kind: "varchar", n: 500 }, to: { kind: "varchar", n: 900 } },
    ]);

    const reGet = await j(await app.request(`/api/merge-requests/${mr.number as number}`, { headers: grace }));
    expect(emailWidth(reGet.ours)).toBe(900);
    // and the migration is re-derived from the moved `ours`, not the frozen one
    const sql = JSON.stringify(reGet.migration);
    expect(sql).toContain("900");
    expect(sql).not.toContain("500");
  });

  it("refreshes a queued request's `ours` too, without moving its `theirs`", async () => {
    const seeded = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{ number: number }>;
    if (seeded[0]) await app.request(`/api/merge-requests/${seeded[0].number}`, { method: "DELETE", headers: grace });

    await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "front" }) });
    await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "behind" }) });
    await applyTo("behind", [retypeEmail(500)]);
    await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "front" }) });
    const queued = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "behind" }) }));
    expect((queued.queue as { status: string }).status).toBe("queued");

    await applyTo("behind", [
      { type: "retypeColumn", tableId: seedIds.users.table, columnId: seedIds.users.email, from: { kind: "varchar", n: 500 }, to: { kind: "varchar", n: 900 } },
    ]);

    const reGet = await j(await app.request(`/api/merge-requests/${queued.number as number}`, { headers: grace }));
    expect((reGet.queue as { status: string }).status).toBe("queued");
    expect(emailWidth(reGet.ours)).toBe(900);
    // `theirs` stays the `main` this request was previewed against — `stale` is
    // what reports the trunk moving, and the refresh must not erase it.
    expect(emailWidth(reGet.theirs)).toBe(255);
  });

  it("does not re-freeze a merged request — it is a record", async () => {
    const seeded = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{ number: number }>;
    if (seeded[0]) await app.request(`/api/merge-requests/${seeded[0].number}`, { method: "DELETE", headers: grace });

    await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wide-email" }) });
    await applyTo("wide-email", [retypeEmail(500)]);
    const mr = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "wide-email" }) }));
    expect((await j(await app.request(`/api/merge-requests/${mr.number as number}/merge`, { method: "POST", headers: grace }))).status).toBe("merged");

    await applyTo("wide-email", [
      { type: "retypeColumn", tableId: seedIds.users.table, columnId: seedIds.users.email, from: { kind: "varchar", n: 500 }, to: { kind: "varchar", n: 900 } },
    ]);

    const reGet = await j(await app.request(`/api/merge-requests/${mr.number as number}`, { headers: grace }));
    expect(emailWidth(reGet.ours)).toBe(500);
  });

  it("names a resolution the refresh invalidated instead of discarding it", async () => {
    const { mrId, conflictId } = await openConflictedMr();
    await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "theirs" }),
    });
    expect(((await j(await app.request(`/api/merge-requests/${mrId}`, { headers: grace }))).report as { verdict: string }).verdict).toBe("clean");

    // the author revises their side of the very conflict they just settled: the
    // conflict keeps its id but changes shape, so the stored choice cannot stand.
    await applyTo("wider-email", [
      { type: "retypeColumn", tableId: seedIds.users.table, columnId: seedIds.users.email, from: { kind: "varchar", n: 1000 }, to: { kind: "varchar", n: 2000 } },
    ]);

    const reGet = await j(await app.request(`/api/merge-requests/${mrId}`, { headers: grace }));
    expect(emailWidth(reGet.ours)).toBe(2000);
    expect(reGet.droppedResolutions).toEqual([{ conflictId, why: "changed" }]);
    expect(reGet.appliedResolutions).toEqual([]);
    expect((reGet.report as { verdict: string }).verdict).toBe("conflicts");
  });
});

describe("POST /merge-requests/:id/resolutions", () => {
  it("resolves the conflict, persists it, and the /merges list agrees", async () => {
    const { mrId, conflictId } = await openConflictedMr();

    const resolved = await j(
      await app.request(`/api/merge-requests/${mrId}/resolutions`, {
        method: "POST",
        headers: grace,
        body: JSON.stringify({ conflictId, choice: "theirs" }),
      }),
    );
    expect((resolved.report as { verdict: string }).verdict).toBe("clean");
    const applied = resolved.appliedResolutions as Array<{ conflictId: string; choice: string }>;
    expect(applied).toEqual([{ conflictId, choice: "theirs", type: null, snapshot: expect.anything() }]);

    // persisted — a fresh GET recomputes from storage, not from the POST response
    const reGet = await j(await app.request(`/api/merge-requests/${mrId}`, { headers: grace }));
    expect((reGet.report as { verdict: string }).verdict).toBe("clean");
    expect((reGet.appliedResolutions as unknown[]).length).toBe(1);

    // the list's status/conflicts must agree with the detail screen
    const list = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{
      number: number;
      status: string;
      conflicts: number;
    }>;
    const row = list.find((m) => m.number === mrId)!;
    expect(row.status).toBe("clean");
    expect(row.conflicts).toBe(0);
  });

  it("DELETE reopens the conflict", async () => {
    const { mrId, conflictId } = await openConflictedMr();
    await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "theirs" }),
    });

    const reopened = await j(
      await app.request(`/api/merge-requests/${mrId}/resolutions/${encodeURIComponent(conflictId)}`, {
        method: "DELETE",
        headers: grace,
      }),
    );
    expect((reopened.report as { verdict: string }).verdict).toBe("conflicts");
    expect((reopened.appliedResolutions as unknown[]).length).toBe(0);
  });

  it("a resolved merge request can then be merged", async () => {
    const { mrId, conflictId } = await openConflictedMr();
    await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "theirs" }),
    });
    const merged = await j(await app.request(`/api/merge-requests/${mrId}/merge`, { method: "POST", headers: grace }));
    expect(merged.status).toBe("merged");
  });

  it("422 for an unknown conflictId", async () => {
    const { mrId } = await openConflictedMr();
    const r = await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId: "no-such-conflict", choice: "theirs" }),
    });
    expect(r.status).toBe(422);
  });

  it("422 for a choice outside the conflict's resolutionModes", async () => {
    const { mrId, conflictId } = await openConflictedMr();
    // divergent-retype accepts "type"; "add-vs-add"-only choices would not — here
    // exercise the reverse: an unrecognised choice value entirely.
    const r = await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "sideways" }),
    });
    expect(r.status).toBe(422);
  });

  it("409 once the merge request is merged", async () => {
    const { mrId, conflictId } = await openConflictedMr();
    await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "theirs" }),
    });
    await app.request(`/api/merge-requests/${mrId}/merge`, { method: "POST", headers: grace });

    const r = await app.request(`/api/merge-requests/${mrId}/resolutions`, {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ conflictId, choice: "ours" }),
    });
    expect(r.status).toBe(409);
  });
});

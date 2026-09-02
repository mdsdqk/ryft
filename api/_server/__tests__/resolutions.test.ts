/**
 * `POST /merge-requests/:id/resolutions` and its `DELETE` (ADR 0004 §6,
 * `docs/backend-contract.md` §3). Drives a real `divergent-retype` conflict by
 * merging two branches that each retyped `users.email` differently, then
 * resolves it, confirms it persists across a `GET`, shows up on the `/merges`
 * list, and reverts on delete.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { freshDb } from "./setup.js";
import { seedIds } from "../../../examples/seed.schema.js";
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
async function openConflictedMr(): Promise<{ mrId: string; conflictId: string }> {
  await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wide-email" }) });
  await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wider-email" }) });
  await app.request("/api/branches/wide-email/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: [retypeEmail(500)] }) });
  await app.request("/api/branches/wider-email/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: [retypeEmail(1000)] }) });

  const mr1 = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "wide-email" }) }));
  expect((mr1.report as { verdict: string }).verdict).toBe("clean");
  const merged1 = await j(await app.request(`/api/merge-requests/${mr1.id as string}/merge`, { method: "POST", headers: grace }));
  expect(merged1.status).toBe("merged");

  const mr2 = await j(await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "wider-email" }) }));
  const report = mr2.report as { verdict: string; conflicts: Array<{ id: string; class: string; resolutionModes: string[] }> };
  expect(report.verdict).toBe("conflicts");
  expect(report.conflicts).toHaveLength(1);
  expect(report.conflicts[0]!.class).toBe("divergent-retype");
  return { mrId: mr2.id as string, conflictId: report.conflicts[0]!.id };
}

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
      id: string;
      status: string;
      conflicts: number;
    }>;
    const row = list.find((m) => m.id === mrId)!;
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

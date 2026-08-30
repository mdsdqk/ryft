/**
 * The golden path (`docs/first-run.md` §4) as one end-to-end walk, plus the
 * failure paths the contract names. Everything in-process on pglite.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { freshDb } from "./setup.js";
import { seedIds } from "../../../examples/seed.schema.js";
import type { Operation } from "../../../engine/operations.js";

let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  app = createApp(await freshDb());
});

const grace = { "x-ryft-user": "grace", "content-type": "application/json" };
const j = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

/** The `titles` branch edits from `docs/first-run.md` §4 step 7. */
const titlesOps: Operation[] = [
  { type: "renameColumn", tableId: seedIds.posts.table, columnId: seedIds.posts.body, from: "body", to: "content" },
  { type: "retypeColumn", tableId: seedIds.comments.table, columnId: seedIds.comments.flags, from: { kind: "int" }, to: { kind: "bigint" } },
  {
    type: "addIndex",
    tableId: seedIds.posts.table,
    index: { id: "idx_posts_published_g1", name: "posts_published_idx", columnIds: [seedIds.posts.published], unique: false },
  },
];

describe("golden path", () => {
  it("seeded merge, then a fresh branch merged", async () => {
    await app.request("/api/workspace/reset", { method: "POST" });
    expect((await app.request("/api/session", { method: "POST", headers: grace, body: JSON.stringify({ username: "grace" }) })).status).toBe(200);

    // ── the seeded contact-fields → main request ──────────────────────────
    const list = (await j(await app.request("/api/merge-requests", { headers: grace }))) as unknown as Array<{ id: string }>;
    const seededId = list[0]!.id;
    const mr = await j(await app.request(`/api/merge-requests/${seededId}`, { headers: grace }));
    expect((mr.report as { verdict: string }).verdict).toBe("clean");
    const sql = (mr.migration as { sql: string }).sql;
    expect(sql).toMatch(/RENAME COLUMN "email" TO "email_address"/);
    expect(sql).toMatch(/ADD COLUMN "phone"/);
    expect(sql).toMatch(/CREATE UNIQUE INDEX "users_email_address_key" ON "users" \("email_address"\)/);

    // ── merge it ─────────────────────────────────────────────────────────
    const merged = await j(await app.request(`/api/merge-requests/${seededId}/merge`, { method: "POST", headers: grace }));
    expect(merged.status).toBe("merged");

    const main = await j(await app.request("/api/branches/main", { headers: grace }));
    const usersTable = (main.head as { tables: Array<{ id: string; columns: { name: string }[]; indexes: { name: string }[] }> }).tables.find(
      (t) => t.id === seedIds.users.table,
    )!;
    expect(usersTable.columns.map((c) => c.name)).toEqual(expect.arrayContaining(["email_address", "phone"]));
    expect(usersTable.indexes.map((i) => i.name)).toContain("users_email_address_key");

    const mainLog = (await j(await app.request("/api/branches/main/operations", { headers: grace }))) as unknown as Array<{ op: { type: string } }>;
    expect(mainLog.at(-1)!.op.type).toBe("merge");

    // ── create `titles` and evolve it ────────────────────────────────────
    const branch = await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "titles" }) });
    expect(branch.status).toBe(201);

    const applied = await j(
      await app.request("/api/branches/titles/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: titlesOps }) }),
    );
    expect(applied.appliedSeqs).toEqual([1, 2, 3]);
    expect(applied.headVersion).toBe(1);
    expect((applied.warnings as unknown[]).some((w) => (w as { reason: string }).reason === "narrowing-retype")).toBe(true);

    // ── open and merge ──────────────────────────────────────────────────
    const opened = await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "titles" }) });
    expect(opened.status).toBe(201);
    const openedBody = await j(opened);
    expect((openedBody.report as { verdict: string }).verdict).toBe("clean");

    const merge2 = await j(await app.request(`/api/merge-requests/${openedBody.id as string}/merge`, { method: "POST", headers: grace }));
    expect(merge2.status).toBe("merged");
    const sql2 = (merge2.migration as { sql: string }).sql;
    expect(sql2).toMatch(/RENAME COLUMN "body" TO "content"/);
    expect(sql2).toMatch(/ALTER COLUMN "flags" TYPE bigint/);
    expect(sql2).toMatch(/CREATE INDEX "posts_published_idx" ON "posts" \("published"\)/);

    // main advanced twice
    const overview = await j(await app.request("/api/overview", { headers: grace }));
    expect((overview.database as { trunkRevision: number }).trunkRevision).toBe(2);
    expect((overview.merges as unknown[]).length).toBe(0);
  });
});

describe("failure paths", () => {
  beforeEach(async () => {
    await app.request("/api/workspace/reset", { method: "POST" });
  });

  it("401 for an unknown user", async () => {
    expect((await app.request("/api/overview", { headers: { "x-ryft-user": "ghost" } })).status).toBe(401);
  });

  it("422 for a bad branch name", async () => {
    const r = await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "Bad Name" }) });
    expect(r.status).toBe(422);
  });

  it("409 opening a second merge request for the same source", async () => {
    await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "titles" }) });
    await app.request("/api/branches/titles/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: titlesOps }) });
    expect((await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "titles" }) })).status).toBe(201);
    const dup = await app.request("/api/merge-requests", { method: "POST", headers: grace, body: JSON.stringify({ source: "titles" }) });
    expect(dup.status).toBe(409);
    expect((await j(dup)).error).toBe("merge-request-exists");
  });

  it("422 drop-blocked carries the dependents list", async () => {
    await app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name: "wip" }) });
    const dropEmail: Operation = {
      type: "dropColumn",
      tableId: seedIds.users.table,
      column: { id: seedIds.users.email, name: "email", type: { kind: "varchar", n: 255 }, nullable: false, default: null },
    };
    const r = await app.request("/api/branches/wip/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: [dropEmail] }) });
    expect(r.status).toBe(422);
    const body = await j(r);
    expect(body.error).toBe("drop-blocked");
    expect(body.failedAt).toBe(0);
    expect((body.dependents as unknown[]).length).toBeGreaterThan(0);
  });

  it("403 editing main directly", async () => {
    const r = await app.request("/api/branches/main/operations", { method: "POST", headers: grace, body: JSON.stringify({ ops: titlesOps }) });
    expect(r.status).toBe(403);
  });
});

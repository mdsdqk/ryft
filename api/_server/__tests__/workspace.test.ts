/**
 * Bootstrap + overview (Checkpoint B). Seed the workspace, resume and create
 * users, read the landing aggregate, and check the identity gate.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { freshDb } from "./setup.js";

let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  app = createApp(await freshDb());
});

const reset = (q = "") => app.request(`/api/workspace/reset${q}`, { method: "POST" });
const json = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

describe("POST /workspace/reset", () => {
  it("seeds the blog schema, the branch, and the one open merge request", async () => {
    const r = await reset();
    expect(r.status).toBe(200);
    const body = await json(r);
    expect(body.ok).toBe(true);

    const o = body.overview as {
      database: Record<string, number | string>;
      branches: Array<{ name: string; trunk?: boolean; divergence: number; openMergeId?: string }>;
      merges: Array<{ id: string; source: string; status: string }>;
    };
    expect(o.database).toMatchObject({ tables: 5, columns: 23, indexes: 2, constraints: 12, trunk: "main", trunkRevision: 0 });
    expect(o.branches.map((b) => b.name)).toEqual(["main", "contact-fields"]);
    expect(o.branches.find((b) => b.name === "main")?.trunk).toBe(true);
    expect(o.branches.find((b) => b.name === "contact-fields")?.divergence).toBe(3);
    expect(o.merges).toHaveLength(1);
    expect(o.merges[0]).toMatchObject({ source: "contact-fields", status: "clean", position: 1 });
    // the branch summary carries the open merge request id
    expect(o.branches.find((b) => b.name === "contact-fields")?.openMergeId).toBe(o.merges[0]!.id);
  });

  it("?bare seeds main alone", async () => {
    const body = await json(await reset("?bare"));
    const o = body.overview as { branches: Array<{ name: string }>; merges: unknown[] };
    expect(o.branches.map((b) => b.name)).toEqual(["main"]);
    expect(o.merges).toEqual([]);
  });

  it("is idempotent", async () => {
    await reset();
    const body = await json(await reset());
    const o = body.overview as { branches: unknown[] };
    expect(o.branches).toHaveLength(2);
  });
});

describe("POST /session", () => {
  beforeEach(async () => {
    await reset();
  });

  it("resumes a seeded user", async () => {
    const r = await app.request("/api/session", {
      method: "POST",
      body: JSON.stringify({ username: "grace" }),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(200);
    const body = await json(r);
    expect((body.user as { username: string }).username).toBe("grace");
    expect((body.organization as { name: string }).name).toBe("Northwind Engineering");
  });

  it("creates an unknown user with displayName = username", async () => {
    const r = await app.request("/api/session", {
      method: "POST",
      body: JSON.stringify({ username: "newbie" }),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(201);
    const body = await json(r);
    expect(body.user).toMatchObject({ username: "newbie", displayName: "newbie" });
  });

  it("422s an empty username", async () => {
    const r = await app.request("/api/session", {
      method: "POST",
      body: JSON.stringify({ username: "   " }),
      headers: { "content-type": "application/json" },
    });
    expect(r.status).toBe(422);
  });
});

describe("identity gate on GET /overview", () => {
  beforeEach(async () => {
    await reset();
  });

  it("401 without the header", async () => {
    expect((await app.request("/api/overview")).status).toBe(401);
  });

  it("401 for an unknown user", async () => {
    expect((await app.request("/api/overview", { headers: { "x-ryft-user": "ghost" } })).status).toBe(401);
  });

  it("200 for a seeded user", async () => {
    const r = await app.request("/api/overview", { headers: { "x-ryft-user": "grace" } });
    expect(r.status).toBe(200);
    const o = await json(r);
    expect((o.database as { tables: number }).tables).toBe(5);
  });
});

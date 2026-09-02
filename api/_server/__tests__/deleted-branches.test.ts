/**
 * The deleted-branches archive (ADR 0013). `DELETE /branches/:name` moves the
 * whole row into `deleted_branches` and drops it from `branches` in one
 * transaction; `GET /branches/deleted` lists the archive. Deleting a branch a
 * merge request holds is still refused, and a freed name can be cut again.
 *
 * The archive table has no committed migration yet (the parent session owns the
 * consolidated one) — `archiveTable()` creates it on the fresh pglite instance,
 * mirroring the `schema.ts` definition.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { createApp } from "../app.js";
import { freshDb } from "./setup.js";
import { seedIds } from "../../../examples/seed.schema.js";
import type { Operation } from "../../../engine/operations.js";

let app: ReturnType<typeof createApp>;

/** `deleted_branches` as `schema.ts` declares it — see the note above. */
const archiveTable = [
  sql`CREATE TABLE "deleted_branches" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "name" text NOT NULL,
    "organization_id" uuid NOT NULL,
    "author_id" uuid NOT NULL,
    "created_at" timestamp with time zone NOT NULL,
    "head" jsonb NOT NULL,
    "base_snapshot" jsonb NOT NULL,
    "head_version" integer NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
    "deleted_by_id" uuid NOT NULL
  )`,
  sql`ALTER TABLE "deleted_branches" ADD CONSTRAINT "deleted_branches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action`,
  sql`ALTER TABLE "deleted_branches" ADD CONSTRAINT "deleted_branches_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
  sql`ALTER TABLE "deleted_branches" ADD CONSTRAINT "deleted_branches_deleted_by_id_users_id_fk" FOREIGN KEY ("deleted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action`,
];

beforeEach(async () => {
  const db = await freshDb();
  for (const stmt of archiveTable) await db.execute(stmt);
  app = createApp(db);
  await app.request("/api/workspace/reset", { method: "POST" });
});

const grace = { "x-ryft-user": "grace", "content-type": "application/json" };
const j = async (r: Response) => r.json() as Promise<Record<string, unknown>>;

const rename: Operation = {
  type: "renameColumn",
  tableId: seedIds.posts.table,
  columnId: seedIds.posts.body,
  from: "body",
  to: "content",
};

const cut = (name: string) =>
  app.request("/api/branches", { method: "POST", headers: grace, body: JSON.stringify({ name }) });
const drop = (name: string) =>
  app.request(`/api/branches/${name}`, { method: "DELETE", headers: grace });
const listBranches = async () =>
  (await j(await app.request("/api/branches", { headers: grace }))) as unknown as Array<{ name: string }>;
const listDeleted = async () =>
  (await j(
    await app.request("/api/branches/deleted", { headers: grace }),
  )) as unknown as Array<{ name: string; author: string; deletedAt: string; divergence: number }>;

describe("DELETE /branches/:name — archive-then-delete", () => {
  it("moves the branch out of `branches` and into the archive list", async () => {
    await cut("scratch");
    await app.request("/api/branches/scratch/operations", {
      method: "POST",
      headers: grace,
      body: JSON.stringify({ ops: [rename] }),
    });

    const r = await drop("scratch");
    expect(r.status).toBe(200);
    expect((await j(r)).ok).toBe(true);

    expect((await listBranches()).map((b) => b.name)).not.toContain("scratch");

    const archived = await listDeleted();
    const row = archived.find((b) => b.name === "scratch");
    expect(row).toBeDefined();
    expect(row!.author).toBe("Grace Okoro");
    expect(row!.divergence).toBe(1);
    expect(Number.isNaN(Date.parse(row!.deletedAt))).toBe(false);
  });

  it("still refuses a branch an open merge request holds, and does not archive it", async () => {
    // `contact-fields` is seeded with an open merge request against `main`.
    const r = await drop("contact-fields");
    expect(r.status).toBe(409);
    expect((await j(r)).error).toBe("blocked-by-merge-request");

    expect((await listBranches()).map((b) => b.name)).toContain("contact-fields");
    expect((await listDeleted()).map((b) => b.name)).not.toContain("contact-fields");
  });

  it("frees the name — a new branch can reuse a deleted one", async () => {
    await cut("scratch");
    expect((await drop("scratch")).status).toBe(200);

    const again = await cut("scratch");
    expect(again.status).toBe(201);
    expect((await listBranches()).map((b) => b.name)).toContain("scratch");

    // dropping it a second time leaves two archive rows under the one name
    expect((await drop("scratch")).status).toBe(200);
    expect((await listDeleted()).filter((b) => b.name === "scratch")).toHaveLength(2);
  });

  it("404 for an unknown branch, 403 for main", async () => {
    expect((await drop("ghost")).status).toBe(404);
    expect((await drop("main")).status).toBe(403);
    expect((await listDeleted())).toEqual([]);
  });
});

/**
 * Seed / reset the workspace — the object `POST /workspace/reset` loads.
 *
 * Content is ticket 0005's (`examples/seed.workspace.ts`, imported wholesale);
 * this is only the inserter (ADR 0004 §2, ADR 0010 §1). One transaction:
 * truncate every V0 table, re-insert the organisation, the three users, `main`
 * (+ `contact-fields` and its log and the one open merge request, unless
 * `bare`).
 *
 * ISO date strings in the fixture become `Date`s for the timestamp columns.
 */

import { sql } from "drizzle-orm";
import type { Db } from "./db/client.js";
import {
  branches,
  mergeRequests,
  operations,
  organizations,
  users,
} from "./db/schema.js";
import { seedWorkspace } from "../../examples/seed.workspace.js";

const d = (iso: string) => new Date(iso);

// Row-shape aliases for the explicit-value inserts below. This seed restores a
// fixed fixture — known UUIDs and timestamps — so it sets `id` / `created_at` /
// `at` even though those columns carry DB defaults. Drizzle's `$inferInsert`
// keeps defaulted columns as optional keys; asserting to it lets the seed
// compile identically under the workspace `tsc` and under Vercel's function
// typechecker, whose bundled TypeScript infers that mapped type more narrowly.
type OrgInsert = typeof organizations.$inferInsert;
type UserInsert = typeof users.$inferInsert;
type BranchInsert = typeof branches.$inferInsert;
type OpInsert = typeof operations.$inferInsert;
type MrInsert = typeof mergeRequests.$inferInsert;

export async function seedWorkspaceInto(db: Db, opts: { bare?: boolean } = {}): Promise<void> {
  const w = seedWorkspace;

  await db.transaction(async (tx) => {
    await tx.execute(
      sql`TRUNCATE ${mergeRequests}, ${operations}, ${branches}, ${users}, ${organizations} RESTART IDENTITY CASCADE`,
    );

    await tx.insert(organizations).values({
      id: w.organization.id,
      name: w.organization.name,
      createdAt: d(w.organization.createdAt),
    } as OrgInsert);

    await tx.insert(users).values(
      w.users.map(
        (u) =>
          ({
            id: u.id,
            organizationId: u.organizationId,
            username: u.username,
            displayName: u.displayName,
            createdAt: d(u.createdAt),
          }) as UserInsert,
      ),
    );

    const branchRows = (opts.bare ? w.branches.filter((b) => b.name === "main") : w.branches).map(
      (b) =>
        ({
          name: b.name,
          organizationId: b.organizationId,
          authorId: b.authorId,
          createdAt: d(b.createdAt),
          head: b.head,
          baseSnapshot: b.baseSnapshot,
          headVersion: b.headVersion,
        }) as BranchInsert,
    );
    await tx.insert(branches).values(branchRows);

    if (opts.bare) return;

    await tx.insert(operations).values(
      w.operations.map(
        (o) =>
          ({
            branchName: o.branchName,
            seq: o.seq,
            at: d(o.at),
            authorId: o.authorId,
            op: o.op,
          }) as OpInsert,
      ),
    );

    await tx.insert(mergeRequests).values(
      w.mergeRequests.map(
        (m) =>
          ({
            id: m.id,
            sourceBranch: m.sourceBranch,
            targetBranch: m.targetBranch,
            authorId: m.authorId,
            status: m.status,
            createdAt: d(m.createdAt),
            mergedAt: m.mergedAt ? d(m.mergedAt) : null,
            base: m.base,
            ours: m.ours,
            theirs: m.theirs,
            previewedMainVersion: m.previewedMainVersion,
          }) as MrInsert,
      ),
    );
  });
}

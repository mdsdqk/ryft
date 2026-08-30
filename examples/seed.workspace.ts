/**
 * The first-run workspace — what a reviewer lands in on a fresh instance, and
 * what `POST /workspace/reset` re-creates (ADR 0004 §2, ADR 0005).
 *
 * Ticket 0005 owns this *content*; the endpoint that loads it into Postgres is
 * the build track's (ticket 0010). The shapes below mirror the ADR 0004 Drizzle
 * tables one row-object per table; they are typed locally rather than against a
 * Drizzle schema module because none is committed yet (0004 is a design lock).
 *
 * Populated, not bare (ADR 0005 §2): `main` plus one branch and one open, clean
 * merge request, so every list and the three-way diff have real content on the
 * first screen. The empty-state copy for the bare case is specified in
 * `docs/first-run.md` and reachable by deleting the branch.
 *
 * The versioned schema is the blog domain from `seed.schema.ts` (ADR 0005 §1) —
 * it is a sample *customer* database, unrelated to ryft's own `Organization` /
 * `User` primitives, which are what this file's `seedOrg` / `seedUsers` model.
 */

import type { Organization, User } from "../src/domain/users.js";
import type { LogEntry } from "../src/domain/operations.js";
import type { SchemaDocument } from "../engine/schema.js";
import { seedSchema } from "./seed.schema.js";
import { branchedSchema } from "./branched.schema.js";
import { branchedLog, GRACE } from "./branched.log.js";

const clone = <T>(v: T): T => structuredClone(v);

// ── identity: one organisation, three people (ADR 0001 §4) ───────────────────

const RAVI = "b81c4e07-2d6a-4f39-8c15-7a0e9d3b62f4";
const MARA = "c4d9a1f8-5e30-42b7-9f6d-1c8b7e04a539";

export const seedOrg: Organization = {
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Northwind Engineering",
  createdAt: "2026-01-05T00:00:00.000Z",
};

/** `grace` authored the seeded branch and merge request; `ravi` and `mara` exist so the team is legible. */
export const seedUsers: User[] = [
  {
    id: GRACE,
    organizationId: seedOrg.id,
    username: "grace",
    displayName: "Grace Okoro",
    createdAt: "2026-01-05T00:00:00.000Z",
  },
  {
    id: RAVI,
    organizationId: seedOrg.id,
    username: "ravi",
    displayName: "Ravi Menon",
    createdAt: "2026-01-06T00:00:00.000Z",
  },
  {
    id: MARA,
    organizationId: seedOrg.id,
    username: "mara",
    displayName: "Mara Lindqvist",
    createdAt: "2026-01-08T00:00:00.000Z",
  },
];

// ── branches (ADR 0004 §2 `branches`) ───────────────────────────────────────

export interface SeedBranch {
  name: string;
  organizationId: string;
  authorId: string;
  createdAt: string;
  head: SchemaDocument;
  baseSnapshot: SchemaDocument;
  headVersion: number;
}

/**
 * `main` is an ordinary row (ADR 0004 §2): its `baseSnapshot` equals its `head`
 * at seed because it has no parent, and `headVersion` is 0 — nothing has merged
 * into it yet.
 */
export const seedMain: SeedBranch = {
  name: "main",
  organizationId: seedOrg.id,
  authorId: GRACE,
  createdAt: "2026-01-05T00:00:00.000Z",
  head: clone(seedSchema),
  baseSnapshot: clone(seedSchema),
  headVersion: 0,
};

/**
 * `contact-fields` — Grace's branch: rename `users.email` → `email_address`, add
 * `users.phone`, add a unique index on the renamed column (held by the id it
 * kept across the rename). Three operations, so `headVersion` is 3. Its
 * `baseSnapshot` is `main`'s head at cut time, i.e. the untouched seed.
 */
export const seedContactFields: SeedBranch = {
  name: "contact-fields",
  organizationId: seedOrg.id,
  authorId: GRACE,
  createdAt: "2026-02-10T09:14:00.000Z",
  head: clone(branchedSchema),
  baseSnapshot: clone(seedSchema),
  headVersion: 3,
};

export const seedBranches: SeedBranch[] = [seedMain, seedContactFields];

// ── operation log rows (ADR 0004 §2 `operations`) ───────────────────────────

export interface SeedOperationRow extends LogEntry {
  branchName: string;
}

/** `main` has no operations; `contact-fields` carries the three edits from `branched.log`. */
export const seedOperations: SeedOperationRow[] = branchedLog.map((entry) => ({
  ...clone(entry),
  branchName: "contact-fields",
}));

// ── the one open merge request (ADR 0004 §3–§5) ─────────────────────────────

export interface SeedMergeRequest {
  id: string;
  sourceBranch: string;
  targetBranch: string;
  authorId: string;
  status: "queued" | "open" | "held" | "merged";
  createdAt: string;
  mergedAt: string | null;
  base: SchemaDocument;
  ours: SchemaDocument;
  theirs: SchemaDocument;
  previewedMainVersion: number;
}

/**
 * `contact-fields` → `main`, open and clean: `theirs` (main's head) is the
 * untouched seed, so the three-way is just `ours` applied — the merge-review
 * screen is populated on first visit and the rename renders as a rename, not a
 * drop-and-add. It is the active MR (`open`, front of an empty queue), so
 * `previewedMainVersion` is `main`'s `headVersion`, 0. No stored resolutions.
 */
export const seedMergeRequest: SeedMergeRequest = {
  id: "11111111-1111-4111-8111-111111111111",
  sourceBranch: "contact-fields",
  targetBranch: "main",
  authorId: GRACE,
  status: "open",
  createdAt: "2026-02-11T10:02:00.000Z",
  mergedAt: null,
  base: clone(seedSchema),
  ours: clone(branchedSchema),
  theirs: clone(seedSchema),
  previewedMainVersion: 0,
};

// ── the whole workspace, one object ─────────────────────────────────────────

export const seedWorkspace = {
  organization: seedOrg,
  users: seedUsers,
  branches: seedBranches,
  operations: seedOperations,
  mergeRequests: [seedMergeRequest],
  /** No stored resolutions on the seeded MR — it is clean. */
  resolutions: [] as [],
} as const;

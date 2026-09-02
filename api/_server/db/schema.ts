/**
 * Drizzle schema — `docs/backend-contract.md` §1, verbatim (ADR 0004 §1–§3),
 * plus the `deleted_branches` archive (ADR 0013).
 *
 * Schema states (`head`, `base_snapshot`, and a merge request's
 * frozen `base` / `ours` / `theirs`) are `jsonb` columns typed to the engine's
 * `SchemaDocument`: the engine consumes whole documents and clones them, never
 * queries inside one, so there is no table for schema objects and Postgres
 * enforces nothing about their contents — every structural invariant is the
 * engine's job (ADR 0004 §1).
 *
 * The original six tables are the frozen ADR 0004 §1 contract. The
 * `merge_request_status` enum carried all four lifecycle values and
 * `previewed_main_version` exists, so the V1 merge queue (ADR 0004 §3–§6) needed
 * no migration on top of that. Two additions since: a fifth status `closed` plus
 * `closed_at` for the soft-close (ADR 0012 §3), and the `deleted_branches`
 * archive (ADR 0013) — both additive, nothing in the contract references them.
 */

import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  jsonb,
  uuid,
  primaryKey,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { SchemaDocument, ColumnType } from "../../../engine/schema.js";
import type { LogOp } from "../../../src/domain/operations.js";

// ── identity (ADR 0001 §4; src/domain/users.ts) ─────────────────────────────

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_org_username_uq").on(t.organizationId, t.username)],
);

// ── branches (ADR 0004 §2) ─────────────────────────────────────────────────

export const branches = pgTable("branches", {
  name: text("name").primaryKey(), // `main` is a row
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  head: jsonb("head").$type<SchemaDocument>().notNull(),
  baseSnapshot: jsonb("base_snapshot").$type<SchemaDocument>().notNull(),
  headVersion: integer("head_version").notNull().default(0),
});

// ── deleted branches (archive; ADR 0013) ──────────────────────────────────

/**
 * A dropped working branch, moved here whole by `DELETE /branches/:name` in the
 * same transaction that removes it from `branches` (ADR 0013). `branches.name`
 * is the primary key, so a soft-delete flag on the live table would pin the
 * name forever; archiving the row here frees the name for reuse and still keeps
 * the list. Columns mirror `branches` exactly — `created_at` / `head_version`
 * carry the branch's own values, not fresh ones — plus `deleted_at` and
 * `deleted_by_id`. `name` is deliberately not unique: a name can be cut,
 * dropped, cut again, and dropped again, leaving two rows.
 */
export const deletedBranches = pgTable("deleted_branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id),
  authorId: uuid("author_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  head: jsonb("head").$type<SchemaDocument>().notNull(),
  baseSnapshot: jsonb("base_snapshot").$type<SchemaDocument>().notNull(),
  headVersion: integer("head_version").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  deletedById: uuid("deleted_by_id").notNull().references(() => users.id),
});

// ── operation log (UI + audit only; ADR 0001 §2) ───────────────────────────

export const operations = pgTable(
  "operations",
  {
    branchName: text("branch_name")
      .notNull()
      .references(() => branches.name, { onDelete: "cascade" }),
    seq: integer("seq").notNull(), // per-branch monotonic from 1
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    authorId: uuid("author_id").notNull().references(() => users.id),
    op: jsonb("op").$type<LogOp>().notNull(), // Operation | MergeMarker
  },
  (t) => [primaryKey({ columns: [t.branchName, t.seq] })],
);

// ── merge requests (ADR 0004 §3–§5) ────────────────────────────────────────

/**
 * `closed` is the soft-close (ADR 0012 §3): a request withdrawn without
 * merging. It is terminal alongside `merged` — out of the queue, no longer
 * blocking its source branch — but the row survives so "what happened to that
 * request" has an answer. Hard `DELETE` remains as the admin escape valve.
 */
export const mergeRequestStatus = pgEnum("merge_request_status", [
  "queued",
  "open",
  "held",
  "merged",
  "closed",
]);

export const mergeRequests = pgTable("merge_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceBranch: text("source_branch").notNull().references(() => branches.name),
  targetBranch: text("target_branch").notNull().references(() => branches.name), // 'main' in V0
  authorId: uuid("author_id").notNull().references(() => users.id),
  status: mergeRequestStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  mergedAt: timestamp("merged_at", { withTimezone: true }), // null until merged
  closedAt: timestamp("closed_at", { withTimezone: true }), // null unless soft-closed (ADR 0012 §3)
  // frozen at creation; refreshed on a merge attempt or on promotion to `open` (ADR 0004 §5)
  base: jsonb("base").$type<SchemaDocument>().notNull(),
  ours: jsonb("ours").$type<SchemaDocument>().notNull(),
  theirs: jsonb("theirs").$type<SchemaDocument>().notNull(),
  previewedMainVersion: integer("previewed_main_version").notNull(),
});

// ── stored conflict resolutions (ADR 0004 §6) ──────────────────────────────

export const mergeRequestResolutions = pgTable(
  "merge_request_resolutions",
  {
    mrId: uuid("mr_id")
      .notNull()
      .references(() => mergeRequests.id, { onDelete: "cascade" }),
    conflictId: text("conflict_id").notNull(), // engine's `${cls}:${sortedIds}` key
    choice: text("choice").$type<"ours" | "theirs" | "type">().notNull(),
    payload: jsonb("payload").$type<ColumnType>(), // set iff choice === 'type'
    conflictSnapshot: jsonb("conflict_snapshot")
      .$type<{ base: unknown; ours: unknown; theirs: unknown }>()
      .notNull(),
    savedBy: uuid("saved_by").notNull().references(() => users.id),
    savedAt: timestamp("saved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.mrId, t.conflictId] })],
);

export const schema = {
  organizations,
  users,
  branches,
  deletedBranches,
  operations,
  mergeRequests,
  mergeRequestResolutions,
};

/**
 * Drizzle schema — `docs/backend-contract.md` §1, verbatim (ADR 0004 §1–§3).
 *
 * Six tables. Schema states (`head`, `base_snapshot`, and a merge request's
 * frozen `base` / `ours` / `theirs`) are `jsonb` columns typed to the engine's
 * `SchemaDocument`: the engine consumes whole documents and clones them, never
 * queries inside one, so there is no table for schema objects and Postgres
 * enforces nothing about their contents — every structural invariant is the
 * engine's job (ADR 0004 §1).
 *
 * `merge_request_resolutions` is defined here as the frozen contract even though
 * V0 code never writes it — resolution persistence is V1 (ADR 0010 §4).
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

export const mergeRequestStatus = pgEnum("merge_request_status", [
  "queued",
  "open",
  "held",
  "merged",
]);

export const mergeRequests = pgTable("merge_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceBranch: text("source_branch").notNull().references(() => branches.name),
  targetBranch: text("target_branch").notNull().references(() => branches.name), // 'main' in V0
  authorId: uuid("author_id").notNull().references(() => users.id),
  status: mergeRequestStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  mergedAt: timestamp("merged_at", { withTimezone: true }), // null until merged
  // frozen at creation; refreshed on a merge attempt or on promotion to `open` (ADR 0004 §5)
  base: jsonb("base").$type<SchemaDocument>().notNull(),
  ours: jsonb("ours").$type<SchemaDocument>().notNull(),
  theirs: jsonb("theirs").$type<SchemaDocument>().notNull(),
  previewedMainVersion: integer("previewed_main_version").notNull(),
});

// ── stored conflict resolutions (ADR 0004 §6) — defined, unused until V1 ────

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
  operations,
  mergeRequests,
  mergeRequestResolutions,
};

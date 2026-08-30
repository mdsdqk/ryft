/**
 * Migration-generation scenarios — the worked examples ticket 0003 asks for.
 *
 * Each is a `source` → `target` document pair plus the shape the emitted
 * migration must have: the statement kinds in order, and any ordering assertion
 * that is the point of the example. `engine/emit.spike.ts` runs them.
 *
 * Three examples, one of which forces the foreign-key ordering knot (§3).
 */

import { seedSchema, seedIds } from "../../examples/seed.schema.js";
import { branchedSchema } from "../../examples/branched.schema.js";
import type { SchemaDocument, Table } from "../schema.js";
import type { DdlStatement } from "../emit.js";

const clone = (d: SchemaDocument): SchemaDocument => structuredClone(d);
const table = (d: SchemaDocument, id: string): Table => d.tables.find((t) => t.id === id)!;
const column = (d: SchemaDocument, tableId: string, columnId: string) =>
  table(d, tableId).columns.find((c) => c.id === columnId)!;

export interface MigrationScenario {
  name: string;
  source: SchemaDocument;
  target: SchemaDocument;
  expect: {
    /** Statement `kind`s, in the exact order the migration must emit them. */
    kinds: DdlStatement["kind"][];
    /**
     * Optional ordering assertions beyond `kinds` — pairs `[a, b]` meaning "the
     * first statement matching `a` must come before the first matching `b`". A
     * statement matches if the substring is in its JSON form or its SQL.
     */
    before?: [string, string][];
    /** Optional: substrings the serialized migration SQL must contain, verbatim. */
    contains?: string[];
    /** The migration must pass the intermediate-state replay check. */
    prefixesValid: boolean;
  };
}

// ── 1. rename + dependent index (seed → contact-fields branch) ────────────
//
// The canonical rename case. `branched.schema.ts` renames `users.email` to
// `email_address` (same id), adds `users.phone`, and adds a unique index whose
// member column id is the RENAMED column's original id. The migration must:
//   - emit ALTER … RENAME COLUMN, never DROP + ADD (forward-only, §D-rename)
//   - resolve the index's column id to the CURRENT name `email_address`
//   - order the rename (phase 1) before the CREATE INDEX (phase 2)
const renameThenIndex: MigrationScenario = {
  name: "rename column + add dependent unique index",
  source: clone(seedSchema),
  target: clone(branchedSchema),
  expect: {
    kinds: ["renameColumn", "addColumn", "createIndex"],
    before: [['"kind":"renameColumn"', '"kind":"createIndex"']],
    contains: [
      'ALTER TABLE "users" RENAME COLUMN "email" TO "email_address";', // never DROP + ADD
      'CREATE UNIQUE INDEX "users_email_address_key" ON "users" ("email_address");', // id resolved to the NEW name
    ],
    prefixesValid: true,
  },
};

// ── 2. retype ordered against a dependent index (§D4) ────────────────────
//
// `target` = seed with `posts.view_count` retyped bigint → int (an illustrative
// "we don't need 64 bits" change) and a NEW index on that same column. The
// migration must emit `alterColumnType` BEFORE `createIndex` — Postgres rebuilds
// a dependent index on a type change, so building it first would be wasted work
// — and it must NOT emit an explicit DROP INDEX / CREATE INDEX around the retype.
const retypeVsIndex: MigrationScenario = {
  name: "retype column ordered before a new index on it",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    column(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "int" };
    table(d, seedIds.posts.table).indexes.push({
      id: "idx_posts_view_count_0003",
      name: "posts_view_count_idx",
      columnIds: [seedIds.posts.viewCount],
      unique: false,
    });
    return d;
  })(),
  expect: {
    kinds: ["alterColumnType", "createIndex"],
    before: [['"kind":"alterColumnType"', '"kind":"createIndex"']],
    prefixesValid: true,
  },
};

// ── 3. the foreign-key ordering knot ────────────────────────────────────
//
// `target` = seed + two new tables that reference each other:
//   organizations.primary_team_id → teams.id            (nullable, ON DELETE SET NULL)
//   teams.org_id                  → organizations.id     (ON DELETE CASCADE)
// A naive "create tables in dependency order" has no valid order — each CREATE
// TABLE would name the other. The migration must emit both CREATE TABLEs with no
// foreign keys, then both ADD CONSTRAINT … FOREIGN KEY once every table exists,
// and every prefix must stay structurally sound.
const org = "tbl_organizations_0003";
const team = "tbl_teams_0003";
const orgId = "col_organizations_id_0003";
const orgPrimaryTeam = "col_organizations_primary_team_id_0003";
const teamId = "col_teams_id_0003";
const teamOrg = "col_teams_org_id_0003";

const organizations: Table = {
  id: org,
  name: "organizations",
  columns: [
    { id: orgId, name: "id", type: { kind: "uuid" }, nullable: false, default: null },
    { id: orgPrimaryTeam, name: "primary_team_id", type: { kind: "uuid" }, nullable: true, default: null },
  ],
  primaryKey: { id: "pk_organizations_0003", name: "organizations_pkey", columnIds: [orgId] },
  foreignKeys: [
    {
      id: "fk_organizations_primary_team_id_0003",
      name: "organizations_primary_team_id_fkey",
      columnIds: [orgPrimaryTeam],
      refTableId: team,
      refColumnIds: [teamId],
      onDelete: "set null",
    },
  ],
  uniques: [],
  indexes: [],
};

const teams: Table = {
  id: team,
  name: "teams",
  columns: [
    { id: teamId, name: "id", type: { kind: "uuid" }, nullable: false, default: null },
    { id: teamOrg, name: "org_id", type: { kind: "uuid" }, nullable: false, default: null },
  ],
  primaryKey: { id: "pk_teams_0003", name: "teams_pkey", columnIds: [teamId] },
  foreignKeys: [
    {
      id: "fk_teams_org_id_0003",
      name: "teams_org_id_fkey",
      columnIds: [teamOrg],
      refTableId: org,
      refColumnIds: [orgId],
      onDelete: "cascade",
    },
  ],
  uniques: [],
  indexes: [],
};

const foreignKeyKnot: MigrationScenario = {
  name: "mutually-referencing new tables (FK ordering knot)",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    d.tables.push(structuredClone(organizations), structuredClone(teams));
    return d;
  })(),
  expect: {
    kinds: ["createTable", "createTable", "addForeignKey", "addForeignKey"],
    before: [['"kind":"createTable"', '"kind":"addForeignKey"']],
    prefixesValid: true,
  },
};

export const migrationScenarios: MigrationScenario[] = [
  renameThenIndex,
  retypeVsIndex,
  foreignKeyKnot,
];

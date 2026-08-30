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
    /** Statement `kind`s, in the exact order the migration must emit them. Omit to assert ordering (`before`) only. */
    kinds?: DdlStatement["kind"][];
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

// ── 4. new table with an inline primary key, no foreign keys (§S4) ──────
const newTableWithPk: MigrationScenario = {
  name: "new table with inline primary key",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    d.tables.push({
      id: "tbl_attachments_0006",
      name: "attachments",
      columns: [
        { id: "col_attachments_id_0006", name: "id", type: { kind: "uuid" }, nullable: false, default: null },
        { id: "col_attachments_url_0006", name: "url", type: { kind: "text" }, nullable: false, default: null },
      ],
      primaryKey: { id: "pk_attachments_0006", name: "attachments_pkey", columnIds: ["col_attachments_id_0006"] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    return d;
  })(),
  expect: {
    kinds: ["createTable"],
    contains: ['CREATE TABLE "attachments"'],
    prefixesValid: true,
  },
};

// ── 5. drop a column with no dependents (§S5) ──────────────────────────
const dropPlainColumn: MigrationScenario = {
  name: "drop a column with no dependents",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    const t = table(d, seedIds.posts.table);
    t.columns = t.columns.filter((c) => c.id !== seedIds.posts.metadata);
    return d;
  })(),
  expect: {
    kinds: ["dropColumn"],
    contains: ['ALTER TABLE "posts" DROP COLUMN "metadata"'],
    prefixesValid: true,
  },
};

// ── 6. drop a table (§S6) ────────────────────────────────────────────
const dropWholeTable: MigrationScenario = {
  name: "drop a table",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    d.tables = d.tables.filter((t) => t.id !== seedIds.postTags.table);
    return d;
  })(),
  expect: {
    // A single DROP TABLE. post_tags' own foreign keys and composite primary key
    // are not dropped explicitly — Postgres removes a table's own constraints
    // with it. (An *inbound* FK from another table would still block the drop at
    // the operation-validation layer, ticket 0008 — nothing points at post_tags.)
    kinds: ["dropTable"],
    contains: ['DROP TABLE "post_tags";'],
    prefixesValid: true,
  },
};

// ── 7. change an index — adjacent drop+recreate in the alter phase (§S7) ─
const changeIndexPair: MigrationScenario = {
  name: "change an index (adjacent drop + recreate, not deferred)",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    const idx = table(d, seedIds.comments.table).indexes.find((i) => i.id === seedIds.comments.postIdx)!;
    idx.columnIds = [seedIds.comments.postId, seedIds.comments.createdAt];
    return d;
  })(),
  expect: {
    kinds: ["dropIndex", "createIndex"],
    before: [['"kind":"dropIndex"', '"kind":"createIndex"']],
    prefixesValid: true,
  },
};

// ── 8. add a foreign key to a new table (§S8) ─────────────────────────
const addForeignKeyToNewTable: MigrationScenario = {
  name: "add a column + new table + a foreign key between them",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    d.tables.push({
      id: "tbl_region_0006",
      name: "region",
      columns: [{ id: "col_region_id_0006", name: "id", type: { kind: "uuid" }, nullable: false, default: null }],
      primaryKey: { id: "pk_region_0006", name: "region_pkey", columnIds: ["col_region_id_0006"] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    const users = table(d, seedIds.users.table);
    users.columns.push({ id: "col_users_region_id_0006", name: "region_id", type: { kind: "uuid" }, nullable: true, default: null });
    users.foreignKeys.push({
      id: "fk_users_region_id_0006",
      name: "users_region_id_fkey",
      columnIds: ["col_users_region_id_0006"],
      refTableId: "tbl_region_0006",
      refColumnIds: ["col_region_id_0006"],
      onDelete: "set null",
    });
    return d;
  })(),
  expect: {
    kinds: ["createTable", "addColumn", "addForeignKey"],
    before: [
      ['"kind":"createTable"', '"kind":"addForeignKey"'],
      ['"kind":"addColumn"', '"kind":"addForeignKey"'],
    ],
    prefixesValid: true,
  },
};

// ── 9. rename a table (§S9) ───────────────────────────────────────────
const renameTable: MigrationScenario = {
  name: "rename a table",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    table(d, seedIds.tags.table).name = "labels";
    return d;
  })(),
  expect: {
    kinds: ["renameTable"],
    contains: ['ALTER TABLE "tags" RENAME TO "labels";'],
    prefixesValid: true,
  },
};

// ── 10. mixed multi-table migration, phase order + prefix validity (§S10) ─
const mixedMigration: MigrationScenario = {
  name: "mixed multi-table migration (phase order, all prefixes valid)",
  source: clone(seedSchema),
  target: (() => {
    const d = clone(seedSchema);
    d.tables.push({
      id: "tbl_audit_0006",
      name: "audit",
      columns: [{ id: "col_audit_id_0006", name: "id", type: { kind: "uuid" }, nullable: false, default: null }],
      primaryKey: { id: "pk_audit_0006", name: "audit_pkey", columnIds: ["col_audit_id_0006"] },
      foreignKeys: [],
      uniques: [],
      indexes: [],
    });
    column(d, seedIds.posts.table, seedIds.posts.body).name = "content";
    column(d, seedIds.comments.table, seedIds.comments.flags).type = { kind: "bigint" };
    const posts = table(d, seedIds.posts.table);
    posts.columns = posts.columns.filter((c) => c.id !== seedIds.posts.metadata);
    return d;
  })(),
  expect: {
    before: [
      ['"kind":"createTable"', '"kind":"dropColumn"'],
      ['"kind":"renameColumn"', '"kind":"dropColumn"'],
      ['"kind":"alterColumnType"', '"kind":"dropColumn"'],
    ],
    prefixesValid: true,
  },
};

export const migrationScenarios: MigrationScenario[] = [
  renameThenIndex,
  retypeVsIndex,
  foreignKeyKnot,
  newTableWithPk,
  dropPlainColumn,
  dropWholeTable,
  changeIndexPair,
  addForeignKeyToNewTable,
  renameTable,
  mixedMigration,
];

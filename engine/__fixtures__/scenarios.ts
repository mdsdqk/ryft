/**
 * Merge scenarios — the nasty cases the engine is designed against.
 *
 * Each scenario is a `base` / `ours` / `theirs` triple built by mutating clones
 * of the seed schema, plus the verdict and conflict classes it should produce.
 * The full table-test catalogue is ticket 0006's; this is the spike's set,
 * one per class plus the clean paths and a resolution round-trip.
 */

import { seedSchema, seedIds } from "../../examples/seed.schema.js";
import type { SchemaDocument, Table } from "../schema.js";
import type { ConflictClass, Resolution } from "../merge-types.js";

const base = (): SchemaDocument => structuredClone(seedSchema);
const usersOf = (d: SchemaDocument) => d.tables.find((t) => t.id === seedIds.users.table)!;
const postsOf = (d: SchemaDocument) => d.tables.find((t) => t.id === seedIds.posts.table)!;
const col = (d: SchemaDocument, tableId: string, colId: string) =>
  d.tables.find((t) => t.id === tableId)!.columns.find((c) => c.id === colId)!;
const dropTable = (d: SchemaDocument, tableId: string) => {
  d.tables = d.tables.filter((t) => t.id !== tableId);
};

export interface Scenario {
  name: string;
  base: SchemaDocument;
  ours: SchemaDocument;
  theirs: SchemaDocument;
  resolutions?: Resolution[];
  expect: {
    verdict: "clean" | "conflicts" | "unclassified-divergence";
    classes?: ConflictClass[];
    minRebased?: number;
    minOverlaps?: number;
    minRemaps?: number;
  };
}

function make(
  name: string,
  mutOurs: (d: SchemaDocument) => void,
  mutTheirs: (d: SchemaDocument) => void,
  expect: Scenario["expect"],
  resolutions?: Resolution[],
): Scenario {
  const o = base();
  const t = base();
  mutOurs(o);
  mutTheirs(t);
  return { name, base: base(), ours: o, theirs: t, resolutions, expect };
}

/**
 * Like `make`, but a `setupBase` mutation is applied to all three documents
 * first — for scenarios whose common ancestor is not the bare seed (e.g. both
 * sides diverge an object the seed does not have).
 */
function makeFrom(
  name: string,
  setupBase: (d: SchemaDocument) => void,
  mutOurs: (d: SchemaDocument) => void,
  mutTheirs: (d: SchemaDocument) => void,
  expect: Scenario["expect"],
  resolutions?: Resolution[],
): Scenario {
  const b = base();
  setupBase(b);
  const o = structuredClone(b);
  const t = structuredClone(b);
  mutOurs(o);
  mutTheirs(t);
  return { name, base: b, ours: o, theirs: t, resolutions, expect };
}

/** A minimal well-formed table to attach in "new table" scenarios. */
function attach(d: SchemaDocument, table: Table): void {
  d.tables.push(table);
}

export const scenarios: Scenario[] = [
  make(
    "fast-forward (ours only)",
    (d) => usersOf(d).columns.push({ id: "col_ff", name: "nickname", type: { kind: "text" }, nullable: true, default: null }),
    () => {},
    { verdict: "clean" },
  ),

  make(
    "false conflict (independent same-table edits)",
    (d) => (col(d, seedIds.users.table, seedIds.users.displayName).nullable = true),
    (d) => usersOf(d).columns.push({ id: "col_bio", name: "bio", type: { kind: "text" }, nullable: true, default: null }),
    { verdict: "clean" },
  ),

  make(
    "rename-rebase (ours renames, theirs indexes)",
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    (d) => usersOf(d).indexes.push({ id: "idx_email_addr", name: "users_email_addr_key", columnIds: [seedIds.users.email], unique: true }),
    { verdict: "clean", minRebased: 1 },
  ),

  make(
    "overlap (both make the same rename)",
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    { verdict: "clean", minOverlaps: 1 },
  ),

  make(
    "divergent retype",
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "text" }),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "int" }),
    { verdict: "conflicts", classes: ["divergent-retype"] },
  ),

  make(
    "rename-vs-rename",
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "contact_email"),
    { verdict: "conflicts", classes: ["rename-vs-rename"] },
  ),

  make(
    "drop-vs-modify",
    (d) => (postsOf(d).columns = postsOf(d).columns.filter((c) => c.id !== seedIds.posts.body)),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.body).name = "content"),
    { verdict: "conflicts", classes: ["drop-vs-modify"] },
  ),

  make(
    "dependency conflict (ours indexes a column theirs drops)",
    (d) => postsOf(d).indexes.push({ id: "idx_body", name: "posts_body_idx", columnIds: [seedIds.posts.body], unique: false }),
    (d) => (postsOf(d).columns = postsOf(d).columns.filter((c) => c.id !== seedIds.posts.body)),
    { verdict: "conflicts", classes: ["dependency-conflict"] },
  ),

  make(
    "add-vs-add (same name, different type)",
    (d) => usersOf(d).columns.push({ id: "col_phone_o", name: "phone", type: { kind: "varchar", n: 30 }, nullable: true, default: null }),
    (d) => usersOf(d).columns.push({ id: "col_phone_t", name: "phone", type: { kind: "text" }, nullable: true, default: null }),
    { verdict: "conflicts", classes: ["add-vs-add"] },
  ),

  make(
    "divergent index definition (class 4)",
    (d) => (postsOf(d).indexes.find((i) => i.id === seedIds.posts.authorIdx)!.unique = true),
    (d) => postsOf(d).indexes.find((i) => i.id === seedIds.posts.authorIdx)!.columnIds.push(seedIds.posts.id),
    { verdict: "conflicts", classes: ["divergent-index-definition"] },
  ),

  make(
    "divergent definition — divergent setDefault (class 7)",
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).default = "1"),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).default = "2"),
    { verdict: "conflicts", classes: ["divergent-definition"] },
  ),

  make(
    "divergent definition — two-side PK divergence (class 7)",
    (d) => (postsOf(d).primaryKey!.columnIds = [seedIds.posts.id, seedIds.posts.authorId]),
    (d) => (postsOf(d).primaryKey!.columnIds = [seedIds.posts.id, seedIds.posts.title]),
    { verdict: "conflicts", classes: ["divergent-definition"] },
  ),

  make(
    "renameTable rename-vs-rename (class 3)",
    (d) => (postsOf(d).name = "articles"),
    (d) => (postsOf(d).name = "entries"),
    { verdict: "conflicts", classes: ["rename-vs-rename"] },
  ),

  make(
    "symmetric dependency — ours drops a column theirs indexes (class 6b)",
    (d) => (postsOf(d).columns = postsOf(d).columns.filter((c) => c.id !== seedIds.posts.title)),
    (d) => postsOf(d).indexes.push({ id: "idx_title", name: "posts_title_idx", columnIds: [seedIds.posts.title], unique: false }),
    { verdict: "conflicts", classes: ["dependency-conflict"] },
  ),

  make(
    "degenerate overlap — both add an identical column",
    (d) => usersOf(d).columns.push({ id: "col_locale_o", name: "locale", type: { kind: "text" }, nullable: false, default: "'en'" }),
    (d) => usersOf(d).columns.push({ id: "col_locale_t", name: "locale", type: { kind: "text" }, nullable: false, default: "'en'" }),
    { verdict: "clean" },
  ),

  make(
    "divergent retype, resolved (take theirs)",
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "text" }),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "int" }),
    { verdict: "clean" },
    [{ conflictId: "divergent-retype:col_posts_view_count_4c88", choice: "theirs" }],
  ),

  make(
    "divergent retype, resolved (take ours) — regression for the oracle-priming bug",
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "text" }),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "int" }),
    { verdict: "clean" },
    [{ conflictId: "divergent-retype:col_posts_view_count_4c88", choice: "ours" }],
  ),

  make(
    "divergent retype, resolved (explicit type) — oracle-priming regression",
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "text" }),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "int" }),
    { verdict: "clean" },
    [{ conflictId: "divergent-retype:col_posts_view_count_4c88", choice: "type", type: { kind: "bigint" } }],
  ),

  make(
    "multi-conflict, fully resolved — round-trip to clean",
    (d) => {
      col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "text" };
      col(d, seedIds.users.table, seedIds.users.email).name = "email_address";
    },
    (d) => {
      col(d, seedIds.posts.table, seedIds.posts.viewCount).type = { kind: "int" };
      col(d, seedIds.users.table, seedIds.users.email).name = "contact_email";
    },
    { verdict: "clean" },
    [
      { conflictId: "divergent-retype:col_posts_view_count_4c88", choice: "type", type: { kind: "bigint" } },
      { conflictId: "rename-vs-rename:col_users_email_9f31", choice: "ours" },
    ],
  ),

  make(
    "bad resolution — choice not in resolutionModes stays held",
    (d) => postsOf(d).indexes.push({ id: "idx_body", name: "posts_body_idx", columnIds: [seedIds.posts.body], unique: false }),
    (d) => (postsOf(d).columns = postsOf(d).columns.filter((c) => c.id !== seedIds.posts.body)),
    { verdict: "conflicts", classes: ["dependency-conflict"] },
    [{ conflictId: "dependency-conflict:col_posts_body_4c88+idx_body", choice: "ours" }],
  ),

  make(
    "primary-key replacement (one side)",
    (d) => {
      const t = postsOf(d);
      t.primaryKey = { id: "pk_posts_new", name: "posts_pkey", columnIds: [seedIds.posts.id, seedIds.posts.authorId] };
    },
    () => {},
    { verdict: "clean" },
  ),

  // Documented boundary (ADR 0002 §7 / ticket 0008): ours adds a column to the PK,
  // theirs makes that column nullable. Different slots — no conflict — and both
  // application orders agree on the same structurally invalid document (nullable
  // PK member). The merge engine reports `clean`; structural validity is 0008's.
  make(
    "boundary — nullable PK member (0008 territory, stays clean)",
    (d) => (postsOf(d).primaryKey!.columnIds = [seedIds.posts.id, seedIds.posts.published]),
    (d) => (col(d, seedIds.posts.table, seedIds.posts.published).nullable = true),
    { verdict: "clean" },
  ),

  // ── catalogue additions (ticket 0006, docs/engine-test-catalog.md §1) ──────

  make(
    "fast-forward (theirs only)",
    () => {},
    (d) => usersOf(d).columns.push({ id: "col_bio_t", name: "bio", type: { kind: "text" }, nullable: true, default: null }),
    { verdict: "clean" },
  ),

  make("no-op merge (no edits either side)", () => {}, () => {}, { verdict: "clean" }),

  make(
    "false conflict — fully independent tables",
    (d) => usersOf(d).columns.push({ id: "col_nick_o", name: "nickname", type: { kind: "text" }, nullable: true, default: null }),
    (d) => postsOf(d).columns.push({ id: "col_slug_t", name: "slug", type: { kind: "varchar", n: 200 }, nullable: true, default: null }),
    { verdict: "clean" },
  ),

  make(
    "false conflict — edit vs unrelated rename",
    (d) => postsOf(d).indexes.push({ id: "idx_pub_o", name: "posts_published_idx", columnIds: [seedIds.posts.published], unique: false }),
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    { verdict: "clean" },
  ),

  make(
    "rename-rebase — NOT NULL follows rename",
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    (d) => (col(d, seedIds.users.table, seedIds.users.email).nullable = false),
    { verdict: "clean" },
  ),

  make(
    "rename-rebase — foreign key follows rename",
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    (d) =>
      attach(d, {
        id: "tbl_newsletter_0006",
        name: "newsletter",
        columns: [
          { id: "col_newsletter_id_0006", name: "id", type: { kind: "uuid" }, nullable: false, default: null },
          { id: "col_newsletter_email_0006", name: "email", type: { kind: "varchar", n: 255 }, nullable: false, default: null },
        ],
        primaryKey: { id: "pk_newsletter_0006", name: "newsletter_pkey", columnIds: ["col_newsletter_id_0006"] },
        foreignKeys: [
          {
            id: "fk_newsletter_email_0006",
            name: "newsletter_email_fkey",
            columnIds: ["col_newsletter_email_0006"],
            refTableId: seedIds.users.table,
            refColumnIds: [seedIds.users.email],
            onDelete: "cascade",
          },
        ],
        uniques: [],
        indexes: [],
      }),
    { verdict: "clean" },
  ),

  make(
    "rename-rebase — table rename, dependent follows",
    (d) => (postsOf(d).name = "articles"),
    (d) => postsOf(d).indexes.push({ id: "idx_title_t", name: "posts_title_idx", columnIds: [seedIds.posts.title], unique: false }),
    { verdict: "clean" },
  ),

  make(
    "overlap — both add the identical index",
    (d) => postsOf(d).indexes.push({ id: "idx_pub_shared", name: "posts_published_idx", columnIds: [seedIds.posts.published], unique: false }),
    (d) => postsOf(d).indexes.push({ id: "idx_pub_shared", name: "posts_published_idx", columnIds: [seedIds.posts.published], unique: false }),
    { verdict: "clean", minOverlaps: 1 },
  ),

  make(
    "rename-vs-rename, resolved (take ours)",
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "email_address"),
    (d) => (col(d, seedIds.users.table, seedIds.users.email).name = "contact_email"),
    { verdict: "clean" },
    [{ conflictId: "rename-vs-rename:col_users_email_9f31", choice: "ours" }],
  ),

  makeFrom(
    "divergent index definition — composite column-order swap (not dissolved)",
    (d) =>
      postsOf(d).indexes.push({
        id: "idx_posts_ai_0006",
        name: "posts_author_id_id_idx",
        columnIds: [seedIds.posts.authorId, seedIds.posts.id],
        unique: false,
      }),
    (d) => (postsOf(d).indexes.find((i) => i.id === "idx_posts_ai_0006")!.columnIds = [seedIds.posts.id, seedIds.posts.authorId]),
    (d) => (postsOf(d).indexes.find((i) => i.id === "idx_posts_ai_0006")!.columnIds = [seedIds.posts.authorId, seedIds.posts.title]),
    { verdict: "conflicts", classes: ["divergent-index-definition"] },
  ),

  make(
    "drop-vs-modify — drop table vs modify its column",
    (d) => dropTable(d, seedIds.comments.table),
    (d) => (col(d, seedIds.comments.table, seedIds.comments.flags).type = { kind: "bigint" }),
    { verdict: "conflicts", classes: ["drop-vs-modify"] },
  ),

  make(
    "dependency conflict — add FK vs drop the target table",
    (d) =>
      attach(d, {
        id: "tbl_note_0006",
        name: "note",
        columns: [
          { id: "col_note_id_0006", name: "id", type: { kind: "uuid" }, nullable: false, default: null },
          { id: "col_note_comment_id_0006", name: "comment_id", type: { kind: "uuid" }, nullable: false, default: null },
        ],
        primaryKey: { id: "pk_note_0006", name: "note_pkey", columnIds: ["col_note_id_0006"] },
        foreignKeys: [
          {
            id: "fk_note_comment_id_0006",
            name: "note_comment_id_fkey",
            columnIds: ["col_note_comment_id_0006"],
            refTableId: seedIds.comments.table,
            refColumnIds: [seedIds.comments.id],
            onDelete: "cascade",
          },
        ],
        uniques: [],
        indexes: [],
      }),
    (d) => dropTable(d, seedIds.comments.table),
    { verdict: "conflicts", classes: ["dependency-conflict"] },
  ),

  make(
    "divergent definition — primary-key column order",
    (d) => (postsOf(d).primaryKey!.columnIds = [seedIds.posts.id, seedIds.posts.authorId]),
    (d) => (postsOf(d).primaryKey!.columnIds = [seedIds.posts.authorId, seedIds.posts.id]),
    { verdict: "conflicts", classes: ["divergent-definition"] },
  ),

  make(
    "divergent definition — divergent unique definition",
    (d) => (usersOf(d).uniques.find((u) => u.id === seedIds.users.emailUnique)!.columnIds = [seedIds.users.email, seedIds.users.id]),
    (d) => (usersOf(d).uniques.find((u) => u.id === seedIds.users.emailUnique)!.columnIds = [seedIds.users.email, seedIds.users.displayName]),
    { verdict: "conflicts", classes: ["divergent-definition"] },
  ),

  make(
    "divergent definition — divergent foreign-key definition",
    (d) => (postsOf(d).foreignKeys.find((f) => f.id === seedIds.posts.authorFk)!.onDelete = "restrict"),
    (d) => (postsOf(d).foreignKeys.find((f) => f.id === seedIds.posts.authorFk)!.onDelete = "set null"),
    { verdict: "conflicts", classes: ["divergent-definition"] },
  ),

  make(
    "degenerate overlap — remap recorded",
    (d) => usersOf(d).columns.push({ id: "col_locale_o2", name: "locale", type: { kind: "text" }, nullable: false, default: "'en'" }),
    (d) => usersOf(d).columns.push({ id: "col_locale_t2", name: "locale", type: { kind: "text" }, nullable: false, default: "'en'" }),
    { verdict: "clean", minRemaps: 1 },
  ),
];

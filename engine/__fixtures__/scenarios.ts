/**
 * Merge scenarios — the nasty cases the engine is designed against.
 *
 * Each scenario is a `base` / `ours` / `theirs` triple built by mutating clones
 * of the seed schema, plus the verdict and conflict classes it should produce.
 * The full table-test catalogue is ticket 0006's; this is the spike's set,
 * one per class plus the clean paths and a resolution round-trip.
 */

import { seedSchema, seedIds } from "../../examples/seed.schema.js";
import type { SchemaDocument } from "../schema.js";
import type { ConflictClass, Resolution } from "../merge-types.js";

const base = (): SchemaDocument => structuredClone(seedSchema);
const usersOf = (d: SchemaDocument) => d.tables.find((t) => t.id === seedIds.users.table)!;
const postsOf = (d: SchemaDocument) => d.tables.find((t) => t.id === seedIds.posts.table)!;
const col = (d: SchemaDocument, tableId: string, colId: string) =>
  d.tables.find((t) => t.id === tableId)!.columns.find((c) => c.id === colId)!;

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
];

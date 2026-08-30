/**
 * A worked merge review: `orders-v2-rework → main`.
 *
 * A significant table rewrite that exercises every path the screen has to show —
 * a rename followed across branches, a rename+retype auto-merged on one id, two
 * indexes rebased across a rename, and all four clear/subtle conflict classes,
 * one of which gates a downstream object.
 *
 * When the semantic merge engine (ticket 0002) lands, an adapter produces this
 * same `MergeReview` shape from real snapshots. Until then this fixture is the
 * contract, and its `RevisionRef.op` values are real `engine/operations.ts`
 * `Operation`s so the vocabulary cannot drift.
 */

import type { Column, ColumnType } from "@engine/schema.js";
import type { Operation } from "@engine/operations.js";

import type { MergeReview, Party, RevisionRef } from "./model.ts";
import { retypeDetail, sqlType } from "./format.ts";

const SADIQ: Party = { userId: "u-sadiq", name: "m.sadiq" };
const OKAFOR: Party = { userId: "u-okafor", name: "a.okafor" };

const T = "tbl_orders";

const col = (id: string, name: string, type: ColumnType, nullable = false, def: string | null = null): Column => ({
  id,
  name,
  type,
  nullable,
  default: def,
});

const varchar = (n: number): ColumnType => ({ kind: "varchar", n });

// ── the derived edits, one per △ ────────────────────────────────────────────

const rev = (
  n: number,
  side: "ours" | "theirs",
  author: Party,
  at: string,
  op: Operation,
  summary: string,
): RevisionRef => ({ n, side, author, at, op, summary });

const revisions: RevisionRef[] = [
  rev(1, "ours", SADIQ, "2026-08-29T09:12:00+05:30",
    { type: "renameColumn", tableId: T, columnId: "col_total", from: "total_cents", to: "amount_minor" },
    "rename col_total → amount_minor"),
  rev(2, "ours", SADIQ, "2026-08-29T09:14:00+05:30",
    { type: "retypeColumn", tableId: T, columnId: "col_status", from: varchar(20), to: varchar(32) },
    "retype col_status → varchar(32)"),
  rev(3, "ours", SADIQ, "2026-08-29T09:15:00+05:30",
    { type: "renameColumn", tableId: T, columnId: "col_placed", from: "placed_at", to: "ordered_at" },
    "rename col_placed → ordered_at"),
  rev(4, "ours", SADIQ, "2026-08-29T09:18:00+05:30",
    { type: "addColumn", tableId: T, column: col("col_fulfilled", "fulfilled_at", { kind: "timestamptz" }, true) },
    "add col_fulfilled fulfilled_at"),
  rev(5, "ours", SADIQ, "2026-08-29T09:19:00+05:30",
    { type: "addColumn", tableId: T, column: col("col_refunded", "refunded_minor", { kind: "int" }, true) },
    "add col_refunded refunded_minor"),
  rev(6, "ours", SADIQ, "2026-08-29T09:24:00+05:30",
    { type: "dropColumn", tableId: T, column: col("col_notes", "notes", { kind: "text" }, true) },
    "drop col_notes"),
  rev(7, "ours", SADIQ, "2026-08-29T09:27:00+05:30",
    { type: "addIndex", tableId: T, index: { id: "idx_ordered", name: "idx_orders_ordered_at", columnIds: ["col_placed"], unique: false } },
    "add index idx_ordered on col_placed"),
  rev(8, "ours", SADIQ, "2026-08-29T09:30:00+05:30",
    { type: "retypeColumn", tableId: T, columnId: "col_currency", from: varchar(3), to: { kind: "text" } },
    "retype col_currency → text"),
  rev(9, "ours", SADIQ, "2026-08-29T09:33:00+05:30",
    { type: "addUnique", tableId: T, unique: { id: "uq_tracking", name: "uq_orders_tracking", columnIds: ["col_tracking"] } },
    "add unique uq_tracking on col_tracking"),
  rev(10, "ours", SADIQ, "2026-08-29T09:36:00+05:30",
    {
      type: "addForeignKey",
      tableId: T,
      fk: { id: "fk_coupon", name: "fk_orders_coupon", columnIds: ["col_coupon"], refTableId: "tbl_coupons", refColumnIds: ["col_coupons_code"], onDelete: "set null" },
    },
    "add fk fk_coupon col_coupon → coupons"),
  rev(11, "ours", SADIQ, "2026-08-29T09:38:00+05:30",
    { type: "renameColumn", tableId: T, columnId: "col_tracking", from: "tracking_no", to: "tracking_code" },
    "rename col_tracking → tracking_code"),
  rev(12, "ours", SADIQ, "2026-08-29T09:41:00+05:30",
    { type: "addColumn", tableId: T, column: col("col_channel", "channel", varchar(24), false, "'web'") },
    "add col_channel channel"),

  rev(13, "theirs", OKAFOR, "2026-08-28T22:03:00+05:30",
    { type: "retypeColumn", tableId: T, columnId: "col_status", from: varchar(20), to: varchar(24) },
    "retype col_status → varchar(24)"),
  rev(14, "theirs", OKAFOR, "2026-08-28T22:05:00+05:30",
    { type: "retypeColumn", tableId: T, columnId: "col_total", from: { kind: "int" }, to: { kind: "bigint" } },
    "retype col_total → bigint"),
  rev(15, "theirs", OKAFOR, "2026-08-28T22:09:00+05:30",
    { type: "addColumn", tableId: T, column: col("col_tax", "tax_minor", { kind: "int" }, true) },
    "add col_tax tax_minor"),
  rev(16, "theirs", OKAFOR, "2026-08-28T22:14:00+05:30",
    { type: "dropColumn", tableId: T, column: col("col_coupon", "coupon_code", varchar(50), true) },
    "drop col_coupon coupon_code"),
  rev(17, "theirs", OKAFOR, "2026-08-28T22:20:00+05:30",
    {
      type: "changeIndex",
      tableId: T,
      indexId: "idx_status",
      from: { name: "idx_orders_status", columnIds: ["col_status"], unique: false },
      to: { name: "idx_orders_status", columnIds: ["col_status", "col_placed"], unique: false },
    },
    "modify index idx_status → (status, placed_at)"),
  rev(18, "theirs", OKAFOR, "2026-08-28T22:26:00+05:30",
    { type: "renameColumn", tableId: T, columnId: "col_shipped", from: "shipped_at", to: "dispatched_at" },
    "rename col_shipped → dispatched_at"),
  rev(19, "theirs", OKAFOR, "2026-08-28T22:31:00+05:30",
    { type: "renameColumn", tableId: T, columnId: "col_tracking", from: "tracking_no", to: "carrier_ref" },
    "rename col_tracking → carrier_ref"),
  rev(20, "theirs", OKAFOR, "2026-08-28T22:35:00+05:30",
    { type: "dropColumn", tableId: T, column: col("col_updated", "updated_at", { kind: "timestamptz" }) },
    "drop col_updated updated_at"),
  rev(21, "theirs", OKAFOR, "2026-08-28T22:41:00+05:30",
    { type: "addColumn", tableId: T, column: col("col_channel_t", "channel", varchar(16), true) },
    "add col_channel_t channel"),
];

// ── the review ─────────────────────────────────────────────────────────────

export const ordersReview: MergeReview = {
  source: "orders-v2-rework",
  target: "main",
  base: "main@3a91f4",
  table: "orders",
  openedBy: SADIQ,
  openedAt: "2026-08-29T09:44:00+05:30",
  status: "in-check",
  autoMergedCount: 2,
  commutativity: "pending",
  revisions,

  conflicts: [
    {
      id: "c-status",
      cls: "divergent-retype",
      severity: "clear",
      objectLabel: "orders.status",
      objectId: "col_status",
      title: "Both sides retype status to a different width.",
      ours: { author: SADIQ, detail: retypeDetail(varchar(20), varchar(32)) },
      theirs: { author: OKAFOR, detail: retypeDetail(varchar(20), varchar(24)) },
      options: [
        { id: "ours", kind: "ours", hint: "1", label: `Take ours — ${sqlType(varchar(32))}` },
        { id: "theirs", kind: "theirs", hint: "2", label: `Take theirs — ${sqlType(varchar(24))}` },
        { id: "custom", kind: "custom", hint: "3", label: "Specify target type…" },
      ],
      resolvedWith: null,
      gates: [],
    },
    {
      id: "c-tracking",
      cls: "rename-vs-rename",
      severity: "clear",
      objectLabel: "orders.tracking_no",
      objectId: "col_tracking",
      title: "The same column (col_tracking) is renamed on both sides.",
      ours: { author: SADIQ, detail: "→ tracking_code" },
      theirs: { author: OKAFOR, detail: "→ carrier_ref" },
      options: [
        { id: "ours", kind: "ours", hint: "1", label: "Take ours — tracking_code" },
        { id: "theirs", kind: "theirs", hint: "2", label: "Take theirs — carrier_ref" },
        { id: "custom", kind: "custom", hint: "3", label: "Specify name…" },
      ],
      resolvedWith: null,
      gates: ["uq_orders_tracking"],
    },
    {
      id: "c-coupon",
      cls: "drop-vs-modify",
      severity: "subtle",
      objectLabel: "orders.coupon_code",
      objectId: "col_coupon",
      title: "Ours adds a foreign key on coupon_code; theirs drops the column.",
      ours: { author: SADIQ, detail: "add fk_orders_coupon → coupons(code)" },
      theirs: { author: OKAFOR, detail: "drop column coupon_code" },
      options: [
        { id: "ours", kind: "ours", hint: "1", label: "Keep column + foreign key (ours)" },
        { id: "theirs", kind: "theirs", hint: "2", label: "Drop column + drop foreign key (theirs)" },
      ],
      resolvedWith: null,
      gates: ["fk_orders_coupon"],
    },
    {
      id: "c-channel",
      cls: "add-vs-add",
      severity: "clear",
      objectLabel: "orders.channel",
      objectId: "col_channel / col_channel_t",
      title: "Both sides add a column named channel with a different type.",
      ours: { author: SADIQ, detail: "varchar(24) NOT NULL DEFAULT 'web'" },
      theirs: { author: OKAFOR, detail: "varchar(16) NULL" },
      options: [
        { id: "ours", kind: "ours", hint: "1", label: "Take ours — varchar(24) NOT NULL" },
        { id: "theirs", kind: "theirs", hint: "2", label: "Take theirs — varchar(16) NULL" },
        { id: "custom", kind: "custom", hint: "3", label: "Specify column…" },
      ],
      resolvedWith: null,
      gates: [],
    },
  ],

  rows: [
    // ── columns ──
    {
      objectId: "col_total",
      objectLabel: "orders.total_cents",
      group: "columns",
      ours: { kind: "rename", revision: 1, detail: "", wasName: "total_cents", newName: "amount_minor" },
      theirs: { kind: "retype", revision: 14, detail: retypeDetail({ kind: "int" }, { kind: "bigint" }) },
      resolution: { state: "auto-merged", note: "same id, different facets — merged to amount_minor bigint" },
      leader: { text: "rename (ours) and retype (theirs) commute on one id", tone: "ok" },
    },
    {
      objectId: "col_status",
      objectLabel: "orders.status",
      group: "columns",
      ours: { kind: "retype", revision: 2, detail: retypeDetail(varchar(20), varchar(32)) },
      theirs: { kind: "retype", revision: 13, detail: retypeDetail(varchar(20), varchar(24)) },
      resolution: { state: "conflict", conflictId: "c-status" },
    },
    {
      objectId: "col_placed",
      objectLabel: "orders.placed_at",
      group: "columns",
      ours: { kind: "rename", revision: 3, detail: "", wasName: "placed_at", newName: "ordered_at" },
      theirs: null,
      resolution: { state: "clean" },
    },
    {
      objectId: "col_shipped",
      objectLabel: "orders.shipped_at",
      group: "columns",
      ours: null,
      theirs: { kind: "rename", revision: 18, detail: "", wasName: "shipped_at", newName: "dispatched_at" },
      resolution: { state: "clean" },
    },
    {
      objectId: "col_tracking",
      objectLabel: "orders.tracking_no",
      group: "columns",
      ours: { kind: "rename", revision: 11, detail: "", wasName: "tracking_no", newName: "tracking_code" },
      theirs: { kind: "rename", revision: 19, detail: "", wasName: "tracking_no", newName: "carrier_ref" },
      resolution: { state: "conflict", conflictId: "c-tracking" },
    },
    {
      objectId: "col_coupon",
      objectLabel: "orders.coupon_code",
      group: "columns",
      ours: { kind: "add-fk", revision: 10, detail: "fk_orders_coupon → coupons(code)" },
      theirs: { kind: "drop-column", revision: 16, detail: "column removed" },
      resolution: { state: "conflict", conflictId: "c-coupon" },
    },
    {
      objectId: "col_notes",
      objectLabel: "orders.notes",
      group: "columns",
      ours: { kind: "drop-column", revision: 6, detail: "column removed · no dependents" },
      theirs: null,
      resolution: { state: "clean" },
    },
    {
      objectId: "col_currency",
      objectLabel: "orders.currency",
      group: "columns",
      ours: { kind: "retype", revision: 8, detail: retypeDetail(varchar(3), { kind: "text" }) },
      theirs: null,
      resolution: { state: "clean" },
    },
    {
      objectId: "col_updated",
      objectLabel: "orders.updated_at",
      group: "columns",
      ours: null,
      theirs: { kind: "drop-column", revision: 20, detail: "column removed" },
      resolution: { state: "clean" },
    },
    {
      objectId: "col_channel / col_channel_t",
      objectLabel: "orders.channel",
      group: "columns",
      ours: { kind: "add-column", revision: 12, detail: "varchar(24) NOT NULL DEFAULT 'web'" },
      theirs: { kind: "add-column", revision: 21, detail: "varchar(16) NULL" },
      resolution: { state: "conflict", conflictId: "c-channel" },
    },
    {
      objectId: "col_fulfilled",
      objectLabel: "orders.fulfilled_at",
      group: "columns",
      ours: { kind: "add-column", revision: 4, detail: "timestamptz NULL" },
      theirs: null,
      resolution: { state: "clean" },
    },
    {
      objectId: "col_refunded",
      objectLabel: "orders.refunded_minor",
      group: "columns",
      ours: { kind: "add-column", revision: 5, detail: "int NULL" },
      theirs: null,
      resolution: { state: "clean" },
    },
    {
      objectId: "col_tax",
      objectLabel: "orders.tax_minor",
      group: "columns",
      ours: null,
      theirs: { kind: "add-column", revision: 15, detail: "int NULL" },
      resolution: { state: "clean" },
    },
    {
      objectId: "col_id",
      objectLabel: "orders.id",
      group: "columns",
      ours: null,
      theirs: null,
      resolution: { state: "clean" },
    },
    {
      objectId: "col_user",
      objectLabel: "orders.user_id",
      group: "columns",
      ours: null,
      theirs: null,
      resolution: { state: "clean" },
    },

    // ── indexes ──
    {
      objectId: "idx_status",
      objectLabel: "idx_orders_status",
      group: "indexes",
      ours: null,
      theirs: { kind: "change-index", revision: 17, detail: "(status) → (status, placed_at)" },
      resolution: { state: "auto-merged", note: "rebased per △3 → (status, ordered_at)" },
      leader: { text: "index columns held by id — the △3 rename re-points the definition", tone: "ok" },
    },
    {
      objectId: "idx_ordered",
      objectLabel: "idx_orders_ordered_at",
      group: "indexes",
      ours: { kind: "add-index", revision: 7, detail: "(placed_at)" },
      theirs: null,
      resolution: { state: "clean" },
      leader: { text: "reference held by col_placed id → renders as (ordered_at)", tone: "ok" },
    },
    {
      objectId: "uq_tracking",
      objectLabel: "uq_orders_tracking",
      group: "indexes",
      ours: { kind: "add-unique", revision: 9, detail: "UNIQUE (tracking_no)" },
      theirs: null,
      resolution: { state: "gated", byConflictId: "c-tracking", note: "column name resolves after conflict 2" },
    },

    // ── constraints ──
    {
      objectId: "fk_coupon",
      objectLabel: "fk_orders_coupon",
      group: "constraints",
      ours: { kind: "add-fk", revision: 10, detail: "(coupon_code) → coupons(code)" },
      theirs: { kind: "drop-column", revision: 16, detail: "target column dropped" },
      resolution: { state: "gated", byConflictId: "c-coupon", note: "settled by conflict 3" },
    },
    {
      objectId: "fk_user",
      objectLabel: "fk_orders_user",
      group: "constraints",
      ours: null,
      theirs: null,
      resolution: { state: "clean" },
    },
  ],

  fabricationOrder: {
    transactional: true,
    statements: [
      { sql: `ALTER TABLE "orders" RENAME COLUMN "total_cents" TO "amount_minor";`, revision: 1, side: "ours" },
      { sql: `ALTER TABLE "orders" ALTER COLUMN "amount_minor" TYPE bigint;`, revision: 14, side: "theirs" },
      { sql: `ALTER TABLE "orders" RENAME COLUMN "placed_at" TO "ordered_at";`, revision: 3, side: "ours" },
      { sql: `ALTER TABLE "orders" RENAME COLUMN "shipped_at" TO "dispatched_at";`, revision: 18, side: "theirs" },
      { sql: `ALTER TABLE "orders" ALTER COLUMN "currency" TYPE text;`, revision: 8, side: "ours" },
      { sql: `ALTER TABLE "orders" DROP COLUMN "notes";`, revision: 6, side: "ours" },
      { sql: `ALTER TABLE "orders" DROP COLUMN "updated_at";`, revision: 20, side: "theirs" },
      { sql: `ALTER TABLE "orders" ADD COLUMN "fulfilled_at" timestamptz NULL;`, revision: 4, side: "ours" },
      { sql: `ALTER TABLE "orders" ADD COLUMN "refunded_minor" int NULL;`, revision: 5, side: "ours" },
      { sql: `ALTER TABLE "orders" ADD COLUMN "tax_minor" int NULL;`, revision: 15, side: "theirs" },
      { sql: `CREATE INDEX "idx_orders_ordered_at" ON "orders" ("ordered_at");`, revision: 7, side: "ours", rebased: true },
      { sql: `DROP INDEX "idx_orders_status";`, revision: 17, side: "theirs" },
      {
        sql: `CREATE INDEX "idx_orders_status" ON "orders" ("status", "ordered_at");`,
        revision: 17,
        side: "theirs",
        rebased: true,
      },
    ],
    blocked: [
      { conflictId: "c-status", reason: `ALTER COLUMN "status" TYPE … — conflict 1, divergent retype` },
      {
        conflictId: "c-tracking",
        reason: `RENAME COLUMN "tracking_no" … + CREATE UNIQUE INDEX "uq_orders_tracking" — conflict 2, rename vs rename; also gates the unique index`,
      },
      { conflictId: "c-coupon", reason: `coupon_code + fk_orders_coupon — conflict 3, drop vs modify` },
      { conflictId: "c-channel", reason: `ADD COLUMN "channel" … — conflict 4, add vs add` },
    ],
  },
};

/**
 * applyOperation — the validated single-op entry point (ADR 0004 §8).
 *
 * Covers: a clean op returns a fresh document plus its warnings and never
 * mutates the input; a blocking op throws `OperationBlockedError` carrying the
 * first `OpError` (with `dependents` for a drop) and applies nothing; and the
 * three golden-path edits (`renameColumn`, `retypeColumn`, `addIndex`) land
 * correctly.
 */

import { describe, expect, it } from "vitest";
import { applyOperation, OperationBlockedError } from "./apply-operation.js";
import { seedIds, seedSchema } from "../examples/seed.schema.js";
import type { SchemaDocument } from "./schema.js";

const doc = (): SchemaDocument => structuredClone(seedSchema);
const U = seedIds.users;
const P = seedIds.posts;
const C = seedIds.comments;

const tableOf = (d: SchemaDocument, id: string) => d.tables.find((t) => t.id === id)!;
const colOf = (d: SchemaDocument, tableId: string, colId: string) =>
  tableOf(d, tableId).columns.find((c) => c.id === colId)!;

describe("clean apply", () => {
  it("renameColumn returns a new document with the name changed, input untouched", () => {
    const before = doc();
    const { head, warnings } = applyOperation(before, {
      type: "renameColumn",
      tableId: P.table,
      columnId: P.body,
      from: "body",
      to: "content",
    });
    expect(colOf(head, P.table, P.body).name).toBe("content");
    expect(colOf(before, P.table, P.body).name).toBe("body"); // not mutated
    expect(head).not.toBe(before);
    expect(warnings).toEqual([]);
  });

  it("retypeColumn int → bigint applies and surfaces the narrowing warning", () => {
    const { head, warnings } = applyOperation(doc(), {
      type: "retypeColumn",
      tableId: C.table,
      columnId: C.flags,
      from: { kind: "int" },
      to: { kind: "bigint" },
    });
    expect(colOf(head, C.table, C.flags).type).toEqual({ kind: "bigint" });
    expect(warnings.map((w) => w.reason)).toEqual(["narrowing-retype"]);
  });

  it("addIndex on posts.published applies", () => {
    const { head } = applyOperation(doc(), {
      type: "addIndex",
      tableId: P.table,
      index: { id: "idx_posts_published_0001", name: "posts_published_idx", columnIds: [P.published], unique: false },
    });
    expect(tableOf(head, P.table).indexes.some((i) => i.name === "posts_published_idx")).toBe(true);
  });

  it("createTable applies with its foreign key inline", () => {
    const { head } = applyOperation(doc(), {
      type: "createTable",
      table: {
        id: "tbl_attachments_0001",
        name: "attachments",
        columns: [
          { id: "col_att_id_0001", name: "id", type: { kind: "uuid" }, nullable: false, default: null },
          { id: "col_att_post_0001", name: "post_id", type: { kind: "uuid" }, nullable: false, default: null },
        ],
        primaryKey: { id: "pk_att_0001", name: "attachments_pkey", columnIds: ["col_att_id_0001"] },
        foreignKeys: [
          {
            id: "fk_att_post_0001",
            name: "attachments_post_id_fkey",
            columnIds: ["col_att_post_0001"],
            refTableId: P.table,
            refColumnIds: [P.id],
            onDelete: "cascade",
          },
        ],
        uniques: [],
        indexes: [],
      },
    });
    expect(tableOf(head, "tbl_attachments_0001").foreignKeys).toHaveLength(1);
  });
});

describe("blocking apply", () => {
  it("throws OperationBlockedError and changes nothing on an unsafe default", () => {
    const before = doc();
    try {
      applyOperation(before, {
        type: "setDefault",
        tableId: C.table,
        columnId: C.flags,
        from: "0",
        to: "1 + 1",
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(OperationBlockedError);
      expect((e as OperationBlockedError).error.reason).toBe("unsafe-default");
      expect((e as OperationBlockedError).op.type).toBe("setDefault");
    }
    expect(colOf(before, C.table, C.flags).default).toBe("0");
  });

  it("drop-blocked error carries the dependents list", () => {
    try {
      applyOperation(doc(), {
        type: "dropColumn",
        tableId: U.table,
        column: { ...colOf(doc(), U.table, U.email) },
      });
      expect.unreachable("should have thrown");
    } catch (e) {
      const err = (e as OperationBlockedError).error;
      expect(err.reason).toBe("drop-blocked");
      expect(err.dependents && err.dependents.length).toBeGreaterThan(0);
    }
  });
});

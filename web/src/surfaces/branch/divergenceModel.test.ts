/**
 * Divergence sub-sheet projection — the destructive / risk warnings it derives
 * from a base/head pair (ADR 0008 §6). The row layout itself is fixture-bound
 * and thin; what is worth pinning is that a drop and a lossy retype in the
 * delta reach the row, and the roll-up count matches.
 */

import { describe, expect, it } from "vitest";
import type { SchemaDocument } from "@engine/schema.js";

import { toDivergenceSections } from "./divergenceModel.tsx";

const TABLE = "tbl_users";

function table(columns: SchemaDocument["tables"][number]["columns"]): SchemaDocument {
  return {
    database: "app",
    tables: [
      { id: TABLE, name: "users", columns, primaryKey: null, foreignKeys: [], uniques: [], indexes: [] },
    ],
  };
}

const email = { id: "col_email", name: "email", type: { kind: "text" as const }, nullable: false, default: null };
const legacy = { id: "col_legacy", name: "legacy", type: { kind: "varchar" as const, n: 255 }, nullable: true, default: null };

function rowsOf(r: ReturnType<typeof toDivergenceSections>) {
  return r.sections.flatMap((s) => s.groups.flatMap((g) => g.rows));
}

describe("toDivergenceSections — destructive warnings", () => {
  it("flags a dropped column and counts it", () => {
    const r = toDivergenceSections(table([email, legacy]), table([email]));
    expect(r.destructiveCount).toBe(1);
    const row = rowsOf(r).find((x) => x.key === "col_legacy");
    expect(row?.warnings).toHaveLength(1);
  });

  it("flags a narrowing retype without counting it as destructive", () => {
    const wide = { ...legacy, type: { kind: "varchar" as const, n: 255 } };
    const narrow = { ...legacy, type: { kind: "varchar" as const, n: 32 } };
    const r = toDivergenceSections(table([email, wide]), table([email, narrow]));
    expect(r.destructiveCount).toBe(0);
    const row = rowsOf(r).find((x) => x.key === "col_legacy");
    expect(row?.warnings).toHaveLength(1);
  });

  it("stays quiet on a clean widening retype", () => {
    const small = { ...legacy, type: { kind: "varchar" as const, n: 32 } };
    const big = { ...legacy, type: { kind: "varchar" as const, n: 255 } };
    const r = toDivergenceSections(table([email, small]), table([email, big]));
    expect(r.destructiveCount).toBe(0);
    expect(rowsOf(r).find((x) => x.key === "col_legacy")?.warnings).toBeUndefined();
  });
});

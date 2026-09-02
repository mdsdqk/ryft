import { describe, expect, it } from "vitest";
import type { SchemaDocument } from "@engine/schema.js";
import { threeWayMerge } from "@engine/merge.js";
import { emitMigration } from "@engine/emit.js";

import { mergeReviewFromResponse, type MergeRequestResponseBody } from "./fromResponse.ts";
import { openConflicts } from "./model.ts";

const TABLE = "tbl_users";
const COL = "col_email";

function doc(colType: SchemaDocument["tables"][0]["columns"][0]["type"]): SchemaDocument {
  return {
    database: "app",
    tables: [
      {
        id: TABLE,
        name: "users",
        columns: [{ id: COL, name: "email", type: colType, nullable: false, default: null }],
        primaryKey: null,
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    ],
  };
}

const base = doc({ kind: "varchar", n: 255 });
const oursWide = doc({ kind: "varchar", n: 500 }); // ours: retype to 500
const theirsWide = doc({ kind: "varchar", n: 300 }); // theirs: retype to 300 (conflicts with ours)
const theirsUnchanged = base;

function response(over: Partial<MergeRequestResponseBody>): MergeRequestResponseBody {
  return {
    id: "mr-1",
    source: "wide-email",
    target: "main",
    author: "grace",
    openedAt: "2026-02-11T10:00:00.000Z",
    base,
    ours: oursWide,
    theirs: theirsUnchanged,
    report: { verdict: "clean", conflicts: [], rebased: [], overlaps: [], remaps: [] },
    migration: null,
    queue: { status: "open", position: 1, ahead: 0, behind: 0 },
    stale: false,
    appliedResolutions: [],
    droppedResolutions: [],
    ...over,
  };
}

describe("mergeReviewFromResponse — clean", () => {
  it("projects a one-sided retype with no conflicts", () => {
    const { merged, report } = threeWayMerge(base, oursWide, theirsUnchanged, []);
    expect(report.verdict).toBe("clean");
    const migration = merged ? emitMigration(theirsUnchanged, merged) : null;

    const review = mergeReviewFromResponse(response({ report, migration }));

    expect(review.commutativity).toBe("passed");
    expect(review.conflicts).toHaveLength(0);
    expect(openConflicts(review)).toHaveLength(0);
    const row = review.rows.find((r) => r.objectId === COL);
    expect(row?.resolution.state).toBe("clean");
    expect(row?.ours?.detail).toBe("varchar(255) → varchar(500)");
    expect(row?.theirs).toBeNull();
    expect(review.table).toBe("users");
    expect(review.fabricationOrder.statements.length).toBeGreaterThan(0);
  });
});

describe("mergeReviewFromResponse — conflict", () => {
  it("projects a divergent-retype as one conflicting row and one queue card", () => {
    const { report } = threeWayMerge(base, oursWide, theirsWide, []);
    expect(report.verdict).toBe("conflicts");
    expect(report.conflicts).toHaveLength(1);

    const review = mergeReviewFromResponse(response({ ours: oursWide, theirs: theirsWide, report, migration: null }));

    expect(review.commutativity).toBe("pending");
    const row = review.rows.find((r) => r.objectId === COL);
    expect(row?.resolution).toEqual({ state: "conflict", conflictId: report.conflicts[0]!.id });

    expect(review.conflicts).toHaveLength(1);
    const card = review.conflicts[0]!;
    expect(card.cls).toBe("divergent-retype");
    expect(card.resolvedWith).toBeNull();
    expect(card.options.map((o) => o.id).sort()).toEqual(["custom", "ours", "theirs"]);
    expect(card.options.map((o) => o.hint)).toEqual(["1", "2", "3"]);
    expect(card.ours.detail).toBe("varchar(500)");
    expect(card.theirs.detail).toBe("varchar(300)");
  });
});

describe("mergeReviewFromResponse — applied resolution", () => {
  it("renders a resolved conflict as an auto-merged row and a resolved queue card", () => {
    const conflictId = threeWayMerge(base, oursWide, theirsWide, []).report.conflicts[0]!.id;
    const { merged, report } = threeWayMerge(base, oursWide, theirsWide, [{ conflictId, choice: "theirs" }]);
    expect(report.verdict).toBe("clean");
    // the engine's `report.conflicts` still lists it — verdict is the only
    // resolution signal it carries; the projection must exclude it itself via
    // `appliedResolutions`.
    expect(report.conflicts).toHaveLength(1);
    const migration = merged ? emitMigration(theirsWide, merged) : null;

    const review = mergeReviewFromResponse(
      response({
        ours: oursWide,
        theirs: theirsWide,
        report,
        migration,
        appliedResolutions: [
          { conflictId, choice: "theirs", type: null, snapshot: { base: { kind: "varchar", n: 255 }, ours: { kind: "varchar", n: 500 }, theirs: { kind: "varchar", n: 300 } } },
        ],
      }),
    );

    expect(review.commutativity).toBe("passed");
    const row = review.rows.find((r) => r.objectId === COL);
    expect(row?.resolution).toEqual({ state: "auto-merged", note: "resolved — kept theirs" });

    expect(review.conflicts).toHaveLength(1);
    expect(review.conflicts[0]!.resolvedWith).toBe("theirs");
    expect(openConflicts(review)).toHaveLength(0);
  });
});

describe("mergeReviewFromResponse — destructive warnings (ADR 0008 §6)", () => {
  const twoCol: SchemaDocument = {
    database: "app",
    tables: [
      {
        id: TABLE,
        name: "users",
        columns: [
          { id: COL, name: "email", type: { kind: "text" }, nullable: false, default: null },
          { id: "col_legacy", name: "legacy", type: { kind: "text" }, nullable: true, default: null },
        ],
        primaryKey: null,
        foreignKeys: [],
        uniques: [],
        indexes: [],
      },
    ],
  };
  const dropsLegacy: SchemaDocument = {
    ...twoCol,
    tables: [{ ...twoCol.tables[0]!, columns: [twoCol.tables[0]!.columns[0]!] }],
  };

  it("marks the dropped column's row and rolls the count up, and tags the DDL line", () => {
    const { merged, report } = threeWayMerge(twoCol, dropsLegacy, twoCol, []);
    expect(report.verdict).toBe("clean");
    const migration = merged ? emitMigration(twoCol, merged) : null;

    const review = mergeReviewFromResponse(
      response({ base: twoCol, ours: dropsLegacy, theirs: twoCol, report, migration }),
    );

    const row = review.rows.find((r) => r.objectId === "col_legacy");
    expect(row?.warnings).toEqual([
      { kind: "destructive", message: 'dropping column "legacy" is irreversible' },
    ]);
    expect(review.destructiveCount).toBe(1);

    const dropLine = review.fabricationOrder.statements.find((s) => /DROP COLUMN/.test(s.sql));
    expect(dropLine?.destructive).toBe(true);
  });

  it("leaves a non-lossy retype unwarned", () => {
    const review = mergeReviewFromResponse(response({})); // varchar(255) → varchar(500), widening
    const row = review.rows.find((r) => r.objectId === COL);
    expect(row?.warnings).toBeUndefined();
    expect(review.destructiveCount).toBe(0);
  });
});

describe("mergeReviewFromResponse — dropped resolutions (ADR 0012 §2)", () => {
  it("has no refresh note when nothing dropped", () => {
    expect(mergeReviewFromResponse(response({})).refreshNote).toBeUndefined();
  });

  it("pre-renders one line per dropped resolution, naming the class, the object, and why", () => {
    const conflictId = threeWayMerge(base, oursWide, theirsWide, []).report.conflicts[0]!.id;
    const review = mergeReviewFromResponse(
      response({
        ours: oursWide,
        theirs: theirsWide,
        droppedResolutions: [
          { conflictId, why: "changed" },
          { conflictId: `add-vs-add:${COL}`, why: "absent" },
        ],
      }),
    );

    expect(review.refreshNote?.droppedResolutions).toEqual([
      "divergent retype on email — the conflict changed since you chose — choose again",
      "add vs add on email — no longer conflicts — nothing left to choose",
    ]);
  });
});

describe("mergeReviewFromResponse — queue status", () => {
  it("maps a merged queue status to Released", () => {
    const review = mergeReviewFromResponse(response({ queue: { status: "merged", position: 1, ahead: 0, behind: 0 } }));
    expect(review.status).toBe("released");
  });

  it("maps a queued request to Received", () => {
    const review = mergeReviewFromResponse(response({ queue: { status: "queued", position: 2, ahead: 1, behind: 0 } }));
    expect(review.status).toBe("received");
  });

  it("maps a closed request to Closed (ADR 0012 §3)", () => {
    const review = mergeReviewFromResponse(response({ queue: { status: "closed", position: 0, ahead: 0, behind: 0 } }));
    expect(review.status).toBe("closed");
  });
});

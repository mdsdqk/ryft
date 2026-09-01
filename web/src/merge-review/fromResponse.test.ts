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

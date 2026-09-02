/**
 * Merge-review view-model selectors — `docs/engine-test-catalog.md` §5.
 *
 * Pure-function tests only. The surfaces around these are fixture-bound and
 * thin; the logic worth pinning is the derivations that decide what verdict the
 * user sees.
 */

import { describe, expect, it } from "vitest";
import {
  effectiveStatus,
  isMergeable,
  isTerminal,
  openConflicts,
  type Conflict,
  type MergeReview,
} from "./model.ts";
import { changeLabel, conflictLabel, retypeDetail, sqlType, statusLabel } from "./format.ts";
import { ordersReview } from "./fixture.ts";

const base = ordersReview;
const aConflict = base.conflicts[0];
const open = (id: string): Conflict => ({ ...aConflict, id, resolvedWith: null });
const resolved = (id: string): Conflict => ({ ...aConflict, id, resolvedWith: "opt-ours" });

const review = (over: Partial<MergeReview>): MergeReview => ({ ...base, ...over });

describe("openConflicts", () => {
  it("returns only the conflicts with no recorded choice", () => {
    const r = review({ conflicts: [open("a"), resolved("b"), open("c")] });
    expect(openConflicts(r).map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("is empty when every conflict is resolved", () => {
    const r = review({ conflicts: [resolved("a"), resolved("b")] });
    expect(openConflicts(r)).toEqual([]);
  });
});

describe("isMergeable", () => {
  it("is false while any conflict is open", () => {
    const r = review({ conflicts: [open("a")], commutativity: "passed" });
    expect(isMergeable(r)).toBe(false);
  });

  it("is false when the commutativity oracle has not passed, even with no open conflicts", () => {
    expect(isMergeable(review({ conflicts: [], commutativity: "pending" }))).toBe(false);
    expect(isMergeable(review({ conflicts: [], commutativity: "failed" }))).toBe(false);
  });

  it("is true only with zero open conflicts and a passed oracle", () => {
    const r = review({ conflicts: [resolved("a")], commutativity: "passed" });
    expect(isMergeable(r)).toBe(true);
  });
});

describe("effectiveStatus", () => {
  it("is 'released' whenever the stored status is released, regardless of mergeability", () => {
    const r = review({ status: "released", conflicts: [open("a")], commutativity: "pending" });
    expect(effectiveStatus(r)).toBe("released");
  });

  it("is 'cleared' when mergeable and not yet released", () => {
    const r = review({ status: "in-check", conflicts: [], commutativity: "passed" });
    expect(effectiveStatus(r)).toBe("cleared");
  });

  it("passes the stored status through when not mergeable", () => {
    const r = review({ status: "received", conflicts: [open("a")], commutativity: "pending" });
    expect(effectiveStatus(r)).toBe("received");
  });

  it("is 'closed' whatever the conflicts now say — a withdrawn request is not Reviewed", () => {
    const r = review({ status: "closed", conflicts: [resolved("a")], commutativity: "passed" });
    expect(effectiveStatus(r)).toBe("closed");
  });
});

describe("isTerminal", () => {
  it("covers both finished states and nothing else", () => {
    expect(isTerminal("released")).toBe(true);
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("cleared")).toBe(false);
    expect(isTerminal("in-check")).toBe(false);
    expect(isTerminal("received")).toBe(false);
  });

  it("labels closed in the app's own vocabulary (ADR 0011)", () => {
    expect(statusLabel("closed")).toBe("Closed");
  });
});

describe("format — pure renderers", () => {
  it("sqlType spells parameterised types canonically", () => {
    expect(sqlType({ kind: "int" })).toBe("int");
    expect(sqlType({ kind: "varchar", n: 32 })).toBe("varchar(32)");
    expect(sqlType({ kind: "numeric", precision: 10, scale: 2 })).toBe("numeric(10, 2)");
  });

  it("retypeDetail renders a from → to pair", () => {
    expect(retypeDetail({ kind: "int" }, { kind: "varchar", n: 32 })).toBe("int → varchar(32)");
  });

  it("label maps cover their unions", () => {
    expect(conflictLabel("dependency")).toBe("dependency conflict");
    expect(changeLabel("drop-table")).toBe("drop table");
  });
});

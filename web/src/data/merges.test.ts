/**
 * Merge-queue list labels. The list shape is a projection of queue place plus
 * the front-of-queue three-way; the pill must not call a queued row Clean.
 */

import { describe, expect, it } from "vitest";
import { mergeStatusLabel, mergeStatusTone } from "./merges.ts";
import type { MergeSummary } from "./types.ts";

const row = (over: Partial<MergeSummary>): MergeSummary => ({
  id: "1",
  source: "contact-fields",
  target: "main",
  author: "grace",
  openedOn: "2026-02-11",
  operations: 3,
  position: 1,
  status: "clean",
  conflicts: 0,
  ...over,
});

describe("mergeStatusLabel", () => {
  it("names a queued request by its 1-based place", () => {
    expect(mergeStatusLabel(row({ status: "queued", position: 2 }))).toBe("Queued · #2");
  });

  it("keeps the front-of-queue words", () => {
    expect(mergeStatusLabel(row({ status: "clean" }))).toBe("Clean");
    expect(mergeStatusLabel(row({ status: "held", conflicts: 1 }))).toBe("Held · 1 conflict");
    expect(mergeStatusLabel(row({ status: "stale" }))).toBe("Stale base");
  });

  it("dates a closed request, and does not fall back to its old queue place", () => {
    expect(mergeStatusLabel(row({ status: "closed", position: 0, closedOn: "2026-02-05" }))).toBe(
      "Closed · 2026-02-05",
    );
    expect(mergeStatusLabel(row({ status: "closed", position: 0 }))).toBe("Closed");
  });

  it("dates a merged request", () => {
    expect(mergeStatusLabel(row({ status: "merged", position: 0, mergedOn: "2026-02-06" }))).toBe(
      "Merged · 2026-02-06",
    );
    expect(mergeStatusLabel(row({ status: "merged", position: 0 }))).toBe("Merged");
  });
});

describe("mergeStatusTone", () => {
  it("does not paint queued as mergeable", () => {
    expect(mergeStatusTone(row({ status: "queued", position: 2 }))).toBe("neutral");
    expect(mergeStatusTone(row({ status: "clean" }))).toBe("ok");
    expect(mergeStatusTone(row({ status: "held" }))).toBe("held");
  });

  it("reads a closed request as an outcome, not a failure", () => {
    expect(mergeStatusTone(row({ status: "closed", position: 0 }))).toBe("neutral");
  });

  it("reads a merged request as ok, like a clean front-of-queue row", () => {
    expect(mergeStatusTone(row({ status: "merged", position: 0 }))).toBe("ok");
  });
});

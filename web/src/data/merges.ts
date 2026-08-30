/**
 * The open-merge-request resource — list, oldest first. Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-B). Surfaces import through
 * `source.listMerges`, never this file.
 *
 * This list is a merge queue, not an activity feed: oldest-first, no create,
 * no delete. Opening a request is a branch-workspace action.
 */

import type { MergeSummary } from "./types.ts";

const clone = <T>(v: T): T => structuredClone(v);

/**
 * Worked-example queue. `1` is the contact-fields review the merge-review
 * surface already ships. The other two exist so the list can show a clean
 * request and a stale base in the same queue.
 */
let open: MergeSummary[] = [
  {
    id: "2",
    source: "drop-legacy-tags",
    target: "main",
    author: "mara",
    openedOn: "2026-02-07",
    operations: 2,
    status: "stale",
    conflicts: 0,
  },
  {
    id: "1",
    source: "contact-fields",
    target: "main",
    author: "grace",
    openedOn: "2026-02-11",
    operations: 3,
    status: "held",
    conflicts: 1,
  },
  {
    id: "3",
    source: "post-metrics",
    target: "main",
    author: "ravi",
    openedOn: "2026-02-12",
    operations: 4,
    status: "clean",
    conflicts: 0,
  },
];

function byQueue(a: MergeSummary, b: MergeSummary): number {
  return a.openedOn.localeCompare(b.openedOn) || a.id.localeCompare(b.id);
}

/** Oldest-first. The `/merges` list and the dashboard preview share this order. */
export function listOpen(): MergeSummary[] {
  return clone(open)
    .filter((m) => m.id.trim() !== "" && m.source.trim() !== "")
    .sort(byQueue);
}

/** StatusPill tone: colour never carries the state alone — the label does. */
export function mergeStatusTone(
  merge: MergeSummary,
): "ok" | "held" | "neutral" {
  if (merge.status === "held") return "held";
  if (merge.status === "stale") return "neutral";
  return "ok";
}

export function mergeStatusLabel(merge: MergeSummary): string {
  if (merge.status === "held") {
    const n = Math.max(0, merge.conflicts);
    if (n === 0) return "Held";
    return `Held · ${n.toLocaleString()} conflict${n === 1 ? "" : "s"}`;
  }
  if (merge.status === "stale") return "Stale base";
  return "Clean";
}

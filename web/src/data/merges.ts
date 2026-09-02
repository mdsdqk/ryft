/**
 * The open-merge-request resource — list, oldest first. Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-B). Surfaces import through
 * `source.listMerges`, never this file.
 *
 * This list is a merge queue, not an activity feed: oldest-first, no create,
 * no delete. Opening a request is a branch-workspace action.
 */

import type { MergeSummary } from "./types.ts";
import { invalidateData } from "./watch.ts";

const clone = <T>(v: T): T => structuredClone(v);

export class MergeRequestNotFoundError extends Error {
  override name = "MergeRequestNotFoundError";
  constructor(id: string) {
    super(`No merge request "${id}".`);
  }
}

/**
 * `POST /merge-requests/:id/merge` came back 409 — live `main` no longer
 * produces a clean three-way. The request stays open (V0) or becomes `held`
 * (V1 queue); the next GET is the current three-way.
 */
export class MergeRevalidationError extends Error {
  override name = "MergeRevalidationError";
  constructor(message = "main moved on while this was open. The three-way no longer merges clean.") {
    super(message);
  }
}

/**
 * Worked-example queue. `1` is the contact-fields review the merge-review
 * surface already ships. The other two exist so the list can show a stale
 * base and a queued request in the same queue.
 */
let open: MergeSummary[] = [
  {
    id: "2",
    source: "drop-legacy-tags",
    target: "main",
    author: "mara",
    openedOn: "2026-02-07",
    operations: 2,
    position: 1,
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
    position: 2,
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
    position: 3,
    status: "queued",
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

let nextId = 4;
const todayIso = (): string => new Date().toISOString().slice(0, 10);

/**
 * Open a merge request for `source → main` (WU-E · E4). Idempotent: if one is
 * already open for `source` it is returned unchanged, so the caller can never
 * trip the API's `409`. `status` is `clean` when the queue is empty of active
 * requests, else `queued` (ADR 0004 §3).
 */
export function createFor(source: string, operations: number): { id: string } {
  const existing = open.find((m) => m.source === source);
  if (existing) return { id: existing.id };
  const created: MergeSummary = {
    id: String(nextId++),
    source,
    target: "main",
    author: "grace",
    openedOn: todayIso(),
    operations,
    position: open.length + 1,
    status: open.length === 0 ? "clean" : "queued",
    conflicts: 0,
  };
  open = [...open, created];
  invalidateData();
  return { id: created.id };
}

/** StatusPill tone: colour never carries the state alone — the label does. */
export function mergeStatusTone(
  merge: MergeSummary,
): "ok" | "held" | "neutral" {
  if (merge.status === "held") return "held";
  if (merge.status === "stale" || merge.status === "queued") return "neutral";
  return "ok";
}

export function mergeStatusLabel(merge: MergeSummary): string {
  if (merge.status === "queued") return `Queued · #${merge.position}`;
  if (merge.status === "held") {
    const n = Math.max(0, merge.conflicts);
    if (n === 0) return "Held";
    return `Held · ${n.toLocaleString()} conflict${n === 1 ? "" : "s"}`;
  }
  if (merge.status === "stale") return "Stale base";
  return "Clean";
}

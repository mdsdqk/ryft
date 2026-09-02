/**
 * The merge-request resource — the open queue, oldest first, plus the closed
 * record (ADR 0012 §3). Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-B). Surfaces import through
 * `source.listMerges`, never this file.
 *
 * The open list is a merge queue, not an activity feed: oldest-first, no create,
 * no delete. Opening a request is a branch-workspace action. Closing one moves
 * it out of the queue and into the closed list, where it stays.
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

/**
 * One request already withdrawn, so the closed list is not empty on first look
 * and the offline path exercises the state the API produces.
 */
let closed: MergeSummary[] = [
  {
    id: "0",
    source: "index-experiment",
    target: "main",
    author: "ravi",
    openedOn: "2026-02-03",
    operations: 1,
    position: 0,
    status: "closed",
    conflicts: 0,
    closedOn: "2026-02-05",
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

/** Most recently closed first — the record, not a queue, so it reads newest-down. */
export function listClosed(): MergeSummary[] {
  return clone(closed).sort(
    (a, b) => (b.closedOn ?? "").localeCompare(a.closedOn ?? "") || b.id.localeCompare(a.id),
  );
}

/**
 * Withdraw a request: it leaves the queue, keeps its row in the closed list,
 * and every row behind it moves up one place — the fixture's stand-in for the
 * API promoting the next queued request.
 */
export function closeById(id: string): void {
  const found = open.find((m) => m.id === id);
  if (!found) {
    if (closed.some((m) => m.id === id)) return; // closing twice is a no-op
    throw new MergeRequestNotFoundError(id);
  }
  open = open.filter((m) => m.id !== id).map((m, i) => ({ ...m, position: i + 1 }));
  closed = [
    ...closed,
    { ...found, position: 0, status: "closed", conflicts: 0, closedOn: todayIso() },
  ];
  invalidateData();
}

/** Has this request been withdrawn? The merge-review fixture reads the same store. */
export function isClosed(id: string): boolean {
  return closed.some((m) => m.id === id);
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
  // closed is an outcome, not a failure — quiet, the same as waiting or stale
  if (merge.status === "stale" || merge.status === "queued" || merge.status === "closed") {
    return "neutral";
  }
  return "ok";
}

export function mergeStatusLabel(merge: MergeSummary): string {
  if (merge.status === "closed") {
    return merge.closedOn ? `Closed · ${merge.closedOn}` : "Closed";
  }
  if (merge.status === "queued") return `Queued · #${merge.position}`;
  if (merge.status === "held") {
    const n = Math.max(0, merge.conflicts);
    if (n === 0) return "Held";
    return `Held · ${n.toLocaleString()} conflict${n === 1 ? "" : "s"}`;
  }
  if (merge.status === "stale") return "Stale base";
  return "Clean";
}

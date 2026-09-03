/**
 * Fixture-side `getMergeReview` / resolution mutations. The merge-review
 * screen's own worked sample (`web/src/merge-review/fixture.ts` `ordersReview`,
 * selected via `?scenario=`) predates the `/merges` queue fixture in
 * `./merges.ts` and is not keyed by that queue's ids — every row still opens
 * the same sample, same as before this seam existed (`web/src/surfaces/
 * MergeReviewRoute.tsx` keeps `?scenario=` as the fixture/dev override, so
 * this only serves the plain-`/merge/:id` path).
 *
 * Resolutions and release are session-local so the screen can round-trip
 * through `adopt()` the same way the HTTP source does.
 */

import type { ColumnType } from "@engine/schema.js";

import type { MergeReview } from "../merge-review/model.ts";
import { REVIEW_SCENARIOS, readScenario } from "../merge-review/scenarios.ts";
import { closeById, isClosed, listClosed, listOpen, MergeRequestNotFoundError } from "./merges.ts";

function currentReview(): MergeReview {
  const scenario = readScenario();
  return REVIEW_SCENARIOS[scenario === "loading" || scenario === "error" ? "default" : scenario];
}

const released = new Set<number>();
const picks = new Map<number, Record<string, string>>();

function withSession(number: number, review: MergeReview): MergeReview {
  const by = picks.get(number) ?? {};
  const conflicts = review.conflicts.map((c) => ({
    ...c,
    resolvedWith: by[c.id] ?? c.resolvedWith,
  }));
  const allResolved = conflicts.every((c) => c.resolvedWith !== null);
  return {
    ...review,
    conflicts,
    commutativity: allResolved ? "passed" : review.commutativity,
    // both terminal; closed wins because a closed request never merged
    status: isClosed(number) ? "closed" : released.has(number) ? "released" : review.status,
  };
}

export async function getByNumber(number: number): Promise<MergeReview> {
  const known =
    listOpen().some((m) => m.number === number) ||
    listClosed().some((m) => m.number === number) ||
    released.has(number);
  if (!known) throw new MergeRequestNotFoundError(number);
  return withSession(number, currentReview());
}

export async function postResolution(
  number: number,
  conflictId?: string,
  choice?: "ours" | "theirs" | "type",
  _type?: ColumnType,
): Promise<MergeReview> {
  if (conflictId && choice) {
    const by = picks.get(number) ?? {};
    by[conflictId] = choice === "type" ? "custom" : choice;
    picks.set(number, by);
  }
  return getByNumber(number);
}

export async function deleteResolution(number: number, conflictId?: string): Promise<MergeReview> {
  if (conflictId) {
    const by = picks.get(number);
    if (by) delete by[conflictId];
  }
  return getByNumber(number);
}

export async function mergeMergeRequest(number: number): Promise<{ status: "merged" }> {
  await getByNumber(number);
  released.add(number);
  return { status: "merged" };
}

/** Withdraw the request — it leaves the queue and the screen goes read-only. */
export async function closeMergeRequest(number: number): Promise<void> {
  await getByNumber(number);
  if (released.has(number)) {
    throw new Error("This merge request has already merged and cannot be closed.");
  }
  closeById(number);
}

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
import { listOpen, MergeRequestNotFoundError } from "./merges.ts";

function currentReview(): MergeReview {
  const scenario = readScenario();
  return REVIEW_SCENARIOS[scenario === "loading" || scenario === "error" ? "default" : scenario];
}

const released = new Set<string>();
const picks = new Map<string, Record<string, string>>();

function withSession(id: string, review: MergeReview): MergeReview {
  const by = picks.get(id) ?? {};
  const conflicts = review.conflicts.map((c) => ({
    ...c,
    resolvedWith: by[c.id] ?? c.resolvedWith,
  }));
  const allResolved = conflicts.every((c) => c.resolvedWith !== null);
  return {
    ...review,
    conflicts,
    commutativity: allResolved ? "passed" : review.commutativity,
    status: released.has(id) ? "released" : review.status,
  };
}

export async function getById(id: string): Promise<MergeReview> {
  if (!listOpen().some((m) => m.id === id) && !released.has(id)) {
    throw new MergeRequestNotFoundError(id);
  }
  return withSession(id, currentReview());
}

export async function postResolution(
  id: string,
  conflictId?: string,
  choice?: "ours" | "theirs" | "type",
  _type?: ColumnType,
): Promise<MergeReview> {
  if (conflictId && choice) {
    const by = picks.get(id) ?? {};
    by[conflictId] = choice === "type" ? "custom" : choice;
    picks.set(id, by);
  }
  return getById(id);
}

export async function deleteResolution(id: string, conflictId?: string): Promise<MergeReview> {
  if (conflictId) {
    const by = picks.get(id);
    if (by) delete by[conflictId];
  }
  return getById(id);
}

export async function mergeMergeRequest(id: string): Promise<{ status: "merged" }> {
  await getById(id);
  released.add(id);
  return { status: "merged" };
}

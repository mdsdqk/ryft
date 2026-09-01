/**
 * Fixture-side `getMergeReview` / resolution mutations. The merge-review
 * screen's own worked sample (`web/src/merge-review/fixture.ts` `ordersReview`,
 * selected via `?scenario=`) predates the `/merges` queue fixture in
 * `./merges.ts` and is not keyed by that queue's ids — every row still opens
 * the same sample, same as before this seam existed (`web/src/surfaces/
 * MergeReviewRoute.tsx` keeps `?scenario=` as the fixture/dev override, so
 * this only serves the plain-`/merge/:id` path).
 *
 * `postResolution` / `deleteResolution` are inert here: the fixture has no
 * per-id storage to persist a choice into, and `MergeReview.tsx` only calls
 * the seam when it's given a real `mergeId` (the http path) — on the fixture
 * path it keeps its existing pure local-state resolve/reopen. They exist so
 * `fixtureSource` satisfies `DataSource` and so calling them directly (a
 * test, a script) does not throw.
 */

import type { MergeReview } from "../merge-review/model.ts";
import { REVIEW_SCENARIOS, readScenario } from "../merge-review/scenarios.ts";
import { listOpen, MergeRequestNotFoundError } from "./merges.ts";

function currentReview(): MergeReview {
  const scenario = readScenario();
  return REVIEW_SCENARIOS[scenario === "loading" || scenario === "error" ? "default" : scenario];
}

export async function getById(id: string): Promise<MergeReview> {
  if (!listOpen().some((m) => m.id === id)) throw new MergeRequestNotFoundError(id);
  return currentReview();
}

export async function postResolution(id: string): Promise<MergeReview> {
  return getById(id);
}

export async function deleteResolution(id: string): Promise<MergeReview> {
  return getById(id);
}

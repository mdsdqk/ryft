/**
 * Alternate merge-review states, for hardening the surface against the shapes a
 * real merge produces beyond the worked `ordersReview` case:
 *
 *   default        the full worked review (four open conflicts)
 *   clean          a fast-forward: divergence on one side only, nothing conflicts
 *   unclassified   the commutativity post-condition failed — an order-dependent
 *                  divergence that is not one of the named conflict classes
 *   unchanged      the branch has not diverged from main at all
 *
 * The screen also renders `loading` and `error` shells; those are driven by the
 * App wrapper, not by a `MergeReview` value.
 */

import type { MergeReview } from "./model.ts";
import { ordersReview } from "./fixture.ts";

/** A clean fast-forward — ours changed, theirs did not, nothing collides. */
const cleanReview: MergeReview = {
  ...ordersReview,
  source: "add-fulfilled-at",
  status: "cleared",
  commutativity: "passed",
  autoMergedCount: 0,
  conflicts: [],
  rows: ordersReview.rows
    .filter((r) => r.ours !== null && r.theirs === null && r.resolution.state !== "gated")
    .map((r) => ({ ...r, resolution: { state: "clean" as const } })),
  revisions: ordersReview.revisions.filter((r) => r.side === "ours").slice(0, 4),
  fabricationOrder: {
    transactional: true,
    statements: ordersReview.fabricationOrder.statements.filter((s) => s.side === "ours").slice(0, 4),
    blocked: [],
  },
};

/** Commutativity failed: applying each side's delta in the two orders disagrees. */
const unclassifiedReview: MergeReview = {
  ...ordersReview,
  conflicts: ordersReview.conflicts.map((c) => ({ ...c, resolvedWith: "ours" })),
  commutativity: "failed",
  status: "in-check",
};

/** The branch matches main — nothing to review. */
const unchangedReview: MergeReview = {
  ...ordersReview,
  source: "spike-idea",
  status: "in-check",
  commutativity: "passed",
  autoMergedCount: 0,
  conflicts: [],
  revisions: [],
  rows: ordersReview.rows.map((r) => ({
    ...r,
    ours: null,
    theirs: null,
    resolution: { state: "clean" as const },
    leader: undefined,
  })),
  fabricationOrder: { transactional: true, statements: [], blocked: [] },
};

export type ScenarioKey =
  | "default"
  | "clean"
  | "unclassified"
  | "unchanged"
  | "loading"
  | "error";

export const REVIEW_SCENARIOS: Record<
  Exclude<ScenarioKey, "loading" | "error">,
  MergeReview
> = {
  default: ordersReview,
  clean: cleanReview,
  unclassified: unclassifiedReview,
  unchanged: unchangedReview,
};

export function readScenario(): ScenarioKey {
  try {
    const v = new URLSearchParams(location.search).get("scenario");
    if (
      v === "clean" ||
      v === "unclassified" ||
      v === "unchanged" ||
      v === "loading" ||
      v === "error"
    ) {
      return v;
    }
  } catch {
    /* no location (SSR / tests) — fall through */
  }
  return "default";
}

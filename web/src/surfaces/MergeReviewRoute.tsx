/**
 * Route wrapper for the built merge-review surface. In production this is a data
 * fetch keyed by the merge-request id in the path; in V0 the id is accepted but
 * unused, and `?scenario=` selects one of the worked shapes (including the
 * `loading` and `error` shells) so every state stays exercisable.
 */

import { useRouter } from "../router/router.tsx";
import { MergeReview } from "../merge-review/MergeReview.tsx";
import {
  MergeReviewError,
  MergeReviewLoading,
} from "../merge-review/components/ReviewShell.tsx";
import { REVIEW_SCENARIOS, readScenario } from "../merge-review/scenarios.ts";

export function MergeReviewRoute() {
  const { navigate } = useRouter();
  const scenario = readScenario();

  if (scenario === "loading") return <MergeReviewLoading />;
  if (scenario === "error") {
    return (
      <MergeReviewError
        message="The server returned 503 while fetching the three snapshots. This is usually transient."
        onRetry={() => navigate("/merge/1", { replace: true })}
      />
    );
  }
  return <MergeReview base={REVIEW_SCENARIOS[scenario]} />;
}

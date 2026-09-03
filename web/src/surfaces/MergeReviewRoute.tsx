/**
 * Route wrapper for the merge-review surface. Fetches `GET /merge-requests/:id`
 * through the seam and projects it (`web/src/merge-review/fromResponse.ts`).
 * `?scenario=` stays a fixture/dev override, independent of the path id — it
 * exercises the built shapes (`clean`/`unclassified`/`unchanged`/`loading`/
 * `error`) without a real merge request, the way it always has.
 */

import { useNavigate, useParams } from "react-router";
import { source, useResource } from "../data/index.ts";
import { MergeReview } from "../merge-review/MergeReview.tsx";
import {
  MergeReviewError,
  MergeReviewLoading,
} from "../merge-review/components/ReviewShell.tsx";
import { REVIEW_SCENARIOS, readScenario } from "../merge-review/scenarios.ts";

export function MergeReviewRoute() {
  const navigate = useNavigate();
  const { number: numberParam } = useParams();
  const number = Number(numberParam);
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
  if (scenario !== "default") return <MergeReview base={REVIEW_SCENARIOS[scenario]} />;

  const { data, loading, error, reload } = useResource(
    () => source.getMergeReview(number),
    [number],
  );

  if (!Number.isInteger(number) || number < 1) {
    return <MergeReviewError message="That is not a merge request number." onRetry={() => navigate("/merges")} />;
  }
  if (loading && !data) return <MergeReviewLoading />;
  if (error || !data) {
    return (
      <MergeReviewError
        message={error?.message ?? "The merge request could not be loaded."}
        onRetry={reload}
      />
    );
  }
  return <MergeReview base={data} mergeNumber={number} />;
}

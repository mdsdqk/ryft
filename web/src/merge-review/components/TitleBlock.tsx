import type { MergeReview } from "../model.ts";
import { shortDate } from "../format.ts";

/** The drawing's title block: what this sheet is, who opened it, where it stands. */
export function TitleBlock({
  review,
  unresolved,
  rebased,
}: {
  review: MergeReview;
  unresolved: number;
  rebased: number;
}) {
  const rows: Array<[string, string]> = [
    ["Table", `${review.table} schema`],
    ["Merging", `${review.source} → ${review.target}`],
    ["Base", review.base],
    ["Opened", `${review.openedBy.name} · ${shortDate(review.openedAt)}`],
    ["Revisions", `${review.revisions.length} · ${unresolved} unresolved`],
    ["Auto-adjusted", `${rebased}`],
    ["Review", review.status === "released" ? "complete" : unresolved > 0 ? "awaiting" : "ready"],
  ];
  return (
    <dl className="mr-titleblock">
      {rows.map(([k, v]) => (
        <div key={k} className="mr-titleblock__row">
          <dt>{k}</dt>
          <dd data-warn={k === "Review" && unresolved > 0 ? "" : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

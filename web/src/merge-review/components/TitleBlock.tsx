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
    ["Drawing", `${review.table} schema`],
    ["Merge", `${review.source} → ${review.target}`],
    ["Base", review.base],
    ["Opened", `${review.openedBy.name} · ${shortDate(review.openedAt)}`],
    ["Revisions", `${review.revisions.length} · ${unresolved} unresolved`],
    ["Rebased", `${rebased} · auto`],
    ["Checker", unresolved > 0 ? "— awaiting" : "ready to sign"],
  ];
  return (
    <dl className="mr-titleblock">
      {rows.map(([k, v]) => (
        <div key={k} className="mr-titleblock__row">
          <dt>{k}</dt>
          <dd data-warn={k === "Checker" && unresolved > 0 ? "" : undefined}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

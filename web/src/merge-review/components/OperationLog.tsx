import { useMemo, useState } from "react";

import type { MergeReview } from "../model.ts";
import { clock } from "../format.ts";

type AuthorFilter = "all" | string;

/**
 * Zone C — the operation log. Chronological by default, its own bounded scroll,
 * one node per entry coloured by the side it came from. Filterable by author.
 */
export function OperationLog({ review }: { review: MergeReview }) {
  const [author, setAuthor] = useState<AuthorFilter>("all");

  const authors = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of review.revisions) seen.set(r.author.userId, r.author.name);
    return [...seen.entries()];
  }, [review.revisions]);

  const entries = useMemo(() => {
    const list = [...review.revisions].sort((a, b) => a.n - b.n);
    return author === "all" ? list : list.filter((r) => r.author.userId === author);
  }, [review.revisions, author]);

  const onBranch = review.revisions.filter((r) => r.side === "ours").length;
  const onTarget = review.revisions.length - onBranch;
  const multiTable = review.tables.length > 1;

  return (
    <section className="mr-zone" aria-labelledby="mr-log-h">
      <h2 className="mr-zone__k" id="mr-log-h">
        <span className="mr-zone__n">C</span> Operation log — {review.revisions.length}
      </h2>

      <div className="mr-log">
        <header className="mr-log__head">
          <span>
            {onBranch} on this branch · {onTarget} on {review.target}
          </span>
          <label className="mr-log__filter">
            <span className="mr-vh">Filter by author</span>
            <select value={author} onChange={(e) => setAuthor(e.target.value)}>
              <option value="all">everyone</option>
              {authors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </header>

        <ol className="mr-log__list" data-empty={entries.length === 0}>
          {entries.length === 0 && (
            <li className="mr-log__empty">
              {review.revisions.length === 0
                ? "No edits on this branch yet."
                : "No edits by this author."}
            </li>
          )}
          {entries.map((r) => (
            <li key={r.n} className="mr-log__entry" data-side={r.side}>
              <span className="mr-log__node" aria-hidden="true" />
              <span className="mr-log__meta">
                <span className="mr-log__tag">△{r.n}</span>
                <span className="mr-log__who">
                  {r.author.name} · {r.side === "ours" ? clock(r.at) : review.target}
                </span>
              </span>
              <span className="mr-log__desc">
                {multiTable && <code className="mr-log__tbl">{r.table}</code>}
                {multiTable ? " " : ""}
                {r.summary}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

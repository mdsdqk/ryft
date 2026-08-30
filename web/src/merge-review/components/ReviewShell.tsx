/**
 * The loading and error shells for the merge-review surface. Both keep the
 * drafting-room frame (bordered sheet, title strip) so the surface never blinks
 * between a blank page and a full one.
 */

export function MergeReviewLoading() {
  return (
    <article className="mr-sheet" aria-busy="true">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <div className="mr-skel mr-skel--h1" />
          <div className="mr-skel mr-skel--line" style={{ maxWidth: "22rem" }} />
        </div>
      </header>
      <div className="mr-shell" role="status">
        <p className="mr-shell__msg">Loading the merge review…</p>
        <div className="mr-skel-grid" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="mr-skel mr-skel--row" />
          ))}
        </div>
      </div>
    </article>
  );
}

export function MergeReviewError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <article className="mr-sheet">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">Merge review</h1>
        </div>
      </header>
      <div className="mr-shell mr-shell--error" role="alert">
        <p className="mr-shell__title">This merge review could not be loaded</p>
        <p className="mr-shell__msg">{message}</p>
        <button className="mr-btn mr-btn--primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    </article>
  );
}

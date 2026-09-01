/**
 * The `△N` mark on a changed schema row — an authored outline delta with the
 * operation's `seq` beside it, in the `--ours` role (a branch's own edits).
 * Reuses the global `.mr-tri` styling from `styles/app.css`; E3 folds this into
 * the shared kit alongside the extracted comparison grid.
 */

export function RevTriangle({ n }: { n: number }) {
  return (
    <span
      className="mr-tri mr-tri--ours"
      role="img"
      aria-label={`changed — operation ${n}`}
    >
      <svg viewBox="0 0 12 11" width="11" height="10" aria-hidden="true">
        <path
          d="M6 0.5 L11.5 10.5 L0.5 10.5 Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
      <span className="mr-tri__n" aria-hidden="true">
        {n}
      </span>
    </span>
  );
}

import type { Side } from "../model.ts";

/**
 * A numbered revision mark — the drafting-room "this changed, entry N in the
 * log". An outline delta (authored SVG, not an icon font) with the number set
 * plainly beside it in the mono face, both in the side's colour. `conflict`
 * swaps the colour and shows a bang instead of a number.
 */
export function RevisionTriangle({
  n,
  side,
  conflict = false,
}: {
  n: number | "!";
  side?: Side;
  conflict?: boolean;
}) {
  const tone = conflict ? "conflict" : (side ?? "neutral");
  const label = conflict ? "conflict" : `revision ${n}`;
  return (
    <span className={`mr-tri mr-tri--${tone}`} role="img" aria-label={label}>
      <svg viewBox="0 0 12 11" width="11" height="10" aria-hidden="true">
        <path d="M6 0.5 L11.5 10.5 L0.5 10.5 Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
      <span className="mr-tri__n" aria-hidden="true">
        {n}
      </span>
    </span>
  );
}

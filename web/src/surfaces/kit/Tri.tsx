/**
 * The revision marker for list rows — `△ N` when a branch has diverged, a quiet
 * label when it has not. The glyph is decorative; the accessible text spells out
 * what the number means. The full numbered/coloured revision triangle lives in
 * the merge-review surface; this is the list-density version.
 */

export function Tri({
  n,
  noun = "change",
  zeroLabel = "no changes",
}: {
  n: number;
  /** singular noun the count refers to; pluralised with a trailing "s" */
  noun?: string;
  zeroLabel?: string;
}) {
  if (n > 0) {
    return (
      <span className="kit-tri">
        <span aria-hidden="true">△ {n.toLocaleString()}</span>
        <span className="mr-vh">
          {n.toLocaleString()} {noun}
          {n === 1 ? "" : "s"}
        </span>
      </span>
    );
  }
  return <span className="kit-tri kit-tri--none">{zeroLabel}</span>;
}

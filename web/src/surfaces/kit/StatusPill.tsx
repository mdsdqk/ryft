/**
 * A status marker: a coloured dot plus the word. The word is always present, so
 * the state never rests on colour alone (DESIGN.md — the no-colour-alone rule).
 *
 *   ok       cleared / mergeable      (verdigris dot)
 *   held     blocked on a conflict    (oxblood dot)
 *   neutral  everything else          (faint dot)
 */

import type { ReactNode } from "react";

export type StatusTone = "ok" | "held" | "neutral";

export function StatusPill({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  return (
    <span className={`kit-pill kit-pill--${tone}`}>
      <span className="kit-pill__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

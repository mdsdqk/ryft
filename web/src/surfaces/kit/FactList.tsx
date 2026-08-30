/**
 * A drafting title-block style fact list — a two-column grid of label / value
 * pairs, framed in ink. Renders nothing when there are no facts.
 */

import type { ReactNode } from "react";

export type Fact = { label: ReactNode; value: ReactNode };

export function FactList({ facts }: { facts: readonly Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="kit-facts">
      {facts.map((f, i) => (
        <div key={i}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

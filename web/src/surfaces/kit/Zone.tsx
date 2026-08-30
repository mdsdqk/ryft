/**
 * A titled section inside a surface body — a tracked heading (an `<h2>`, so
 * screen-reader users can jump between zones) with an optional count, then its
 * content. The surface's own title is the `<h1>` on the sheet.
 */

import type { ReactNode } from "react";

export function Zone({
  title,
  count,
  children,
}: {
  title: ReactNode;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="kit-zone">
      <h2 className="kit-zone__k">
        {title}
        {count != null && (
          <span className="kit-zone__ct">{count.toLocaleString()}</span>
        )}
      </h2>
      {children}
    </section>
  );
}

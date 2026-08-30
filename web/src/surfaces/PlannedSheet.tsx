/**
 * On-world placeholder for a surface that is routed but not yet built. Keeps the
 * drafting-room frame (bordered sheet + title strip) so navigating to it never
 * shows a blank page, and says plainly what is planned and where.
 */

import type { ReactNode } from "react";

export function PlannedSheet({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <article className="mr-sheet">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">{title}</h1>
        </div>
      </header>
      <div className="shl-planned">
        <p className="shl-planned__msg">{children}</p>
      </div>
    </article>
  );
}

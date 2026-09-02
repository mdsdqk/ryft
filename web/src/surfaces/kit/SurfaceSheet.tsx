/**
 * The drafting-room sheet every surface sits on: a bordered sheet with a title
 * strip. `subtitle` renders as the mono path line, `action` fills the strip's
 * right cell with the surface's one primary action.
 */

import type { ReactNode } from "react";

export function SurfaceSheet({
  title,
  subtitle,
  action,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="mr-sheet">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">{title}</h1>
          {subtitle != null && (
            <p className="mr-titlestrip__path">{subtitle}</p>
          )}
        </div>
        {action != null && <div className="kit-sheet__action">{action}</div>}
      </header>
      {children}
    </article>
  );
}

/** The padded region below the title strip. */
export function SurfaceBody({ children }: { children: ReactNode }) {
  return <div className="kit-sheet__body">{children}</div>;
}

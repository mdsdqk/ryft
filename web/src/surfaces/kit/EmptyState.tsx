/**
 * The notice that fills a sheet body when there is no content to show — a zero
 * state, a load failure, or a surface that is routed but not yet built. Keeps
 * the sheet frame; never a blank page. Shares the `.mr-shell` styling with the
 * merge-review loading and error shells.
 *
 *   <EmptyState title="No branches yet" action={<button…>New branch</button>}>
 *     Cut one from main to start a schema change.
 *   </EmptyState>
 */

import type { ReactNode } from "react";

export function EmptyState({
  tone = "empty",
  title,
  action,
  children,
}: {
  tone?: "empty" | "error";
  /** optional — omit for a plain one-line notice */
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={tone === "error" ? "mr-shell mr-shell--error" : "mr-shell"}
      role={tone === "error" ? "alert" : undefined}
    >
      {title != null && <p className="mr-shell__title">{title}</p>}
      {children != null && <p className="mr-shell__msg">{children}</p>}
      {action}
    </div>
  );
}

/** The loading counterpart — announced to assistive tech, no skeleton in V0. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="mr-shell" role="status">
      <p className="mr-shell__msg">{label}</p>
    </div>
  );
}

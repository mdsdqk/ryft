/**
 * The notice that fills a sheet, a list, or a card group when there is nothing
 * to show. Keeps the surrounding frame; never a blank page, never an
 * illustration. Copy is the first-run table (`docs/first-run.md` §2): one
 * headline, an optional sentence, the one action that changes the state.
 *
 *   layout="sheet"   — the whole sheet body (default). Loading / error / a
 *                      list with no rows. Merge-review `.mr-shell`.
 *   layout="row"     — one item inside a SheetList. Trunk row and zone
 *                      headings stay. Renders as <li>.
 *   layout="inline"  — a group inside a table card (no indexes / no
 *                      constraints). The card's own + control is the action.
 *
 *   <EmptyState title="No branches yet" action={<button…>Create branch</button>}>
 *     Every branch starts from <code>main</code>.
 *   </EmptyState>
 */

import type { ReactNode } from "react";

export type EmptyLayout = "sheet" | "row" | "inline";

export function EmptyState({
  tone = "empty",
  layout = "sheet",
  title,
  action,
  children,
}: {
  tone?: "empty" | "error";
  layout?: EmptyLayout;
  /** optional — omit for a plain one-line notice */
  title?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const Comp = layout === "row" ? "li" : "div";
  const className =
    layout === "sheet"
      ? tone === "error"
        ? "mr-shell mr-shell--error"
        : "mr-shell"
      : layout === "row"
        ? "kit-row kit-empty kit-empty--row"
        : "kit-empty kit-empty--inline";
  const titleClass =
    layout === "sheet" && tone === "error"
      ? "mr-shell__title"
      : "kit-empty__title";
  const msgClass = layout === "sheet" ? "mr-shell__msg" : "kit-empty__msg";

  const copy = (
    <>
      {title != null && <p className={titleClass}>{title}</p>}
      {children ? <p className={msgClass}>{children}</p> : null}
    </>
  );

  return (
    <Comp
      className={className}
      role={tone === "error" ? "alert" : "status"}
    >
      {layout === "row" ? (
        <div className="kit-row__main kit-empty__copy">{copy}</div>
      ) : (
        copy
      )}
      {action != null && <div className="kit-empty__action">{action}</div>}
    </Comp>
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

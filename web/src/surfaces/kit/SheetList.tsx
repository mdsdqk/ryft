/**
 * A framed list of rows. Each `Row` has a primary line (a link when `to` is
 * set), an optional meta line under it, and optional trailing content pinned
 * right. `MoreRow` is the "N more →" link that caps a preview list.
 *
 * Real list semantics: `<ul role="list">` + `<li>` so assistive tech announces
 * the count. `role="list"` is kept explicit — Safari drops the role once
 * `list-style: none` is applied.
 */

import type { ReactNode } from "react";

import { Link } from "../../router/router.tsx";

export function SheetList({
  children,
  label,
}: {
  children: ReactNode;
  /** accessible name for the list, e.g. "Open merges" */
  label?: string;
}) {
  return (
    <ul className="kit-list" role="list" aria-label={label}>
      {children}
    </ul>
  );
}

export function Row({
  primary,
  meta,
  trailing,
  to,
}: {
  primary: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  /** when set, the primary line is a router Link to this path */
  to?: string;
}) {
  return (
    <li className="kit-row">
      <div className="kit-row__main">
        {to != null ? (
          <Link to={to} className="kit-row__link">
            {primary}
          </Link>
        ) : (
          <span className="kit-row__link">{primary}</span>
        )}
        {meta != null && <span className="kit-row__meta">{meta}</span>}
      </div>
      {trailing != null && trailing}
    </li>
  );
}

export function MoreRow({ to, children }: { to: string; children: ReactNode }) {
  return (
    <li className="kit-row kit-row--more">
      <Link to={to}>{children}</Link>
    </li>
  );
}

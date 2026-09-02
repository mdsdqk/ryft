/**
 * Shared collapse primitive for the schema tables — the branch Schema cards and
 * their object groups, the branch Divergence grid, and the merge-review
 * three-way comparison all expand and collapse the same way (usability review
 * theme B).
 *
 * `useCollapse` tracks a set of collapsed keys against a known key universe so a
 * single "Collapse all / Expand all" control can drive every group at once.
 * `Chevron` and `CollapseAll` are the shared bits of chrome; the chevron reuses
 * the `.mr-chevron` styling the merge-review grid already defined.
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`mr-chevron${open ? " mr-chevron--open" : ""}`}
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <path
        d="M3 1.5 L7 5 L3 8.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
    </svg>
  );
}

export interface CollapseApi {
  isCollapsed: (key: string) => boolean;
  toggle: (key: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
  /** true when every known key is collapsed — for the control's pressed state */
  allCollapsed: boolean;
  /** true when nothing is collapsed */
  allExpanded: boolean;
}

/**
 * @param keys       every collapsible key currently on screen — the universe
 *                   "Collapse all" acts on.
 * @param initialCollapsed  keys collapsed on first render (e.g. unchanged
 *                   tables). Re-seeded only when its identity changes.
 */
export function useCollapse(
  keys: readonly string[],
  initialCollapsed: readonly string[] = [],
): CollapseApi {
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(initialCollapsed),
  );

  const keySet = useMemo(() => new Set(keys), [keys]);

  const isCollapsed = useCallback((k: string) => collapsed.has(k), [collapsed]);

  const toggle = useCallback((k: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => setCollapsed(new Set(keys)), [keys]);
  const expandAll = useCallback(() => setCollapsed(new Set()), []);

  const known = [...keySet];
  const allCollapsed = known.length > 0 && known.every((k) => collapsed.has(k));
  const allExpanded = known.every((k) => !collapsed.has(k));

  return { isCollapsed, toggle, collapseAll, expandAll, allCollapsed, allExpanded };
}

/** The "Collapse all / Expand all" pair. Sits in a section or filter header. */
export function CollapseAll({
  api,
  label = "sections",
}: {
  api: Pick<CollapseApi, "collapseAll" | "expandAll" | "allCollapsed" | "allExpanded">;
  /** what the buttons act on, for the accessible name — e.g. "tables" */
  label?: string;
}): ReactNode {
  return (
    <span className="kit-collapseall" role="group" aria-label={`Collapse or expand all ${label}`}>
      <button
        type="button"
        className="kit-collapseall__btn"
        onClick={api.collapseAll}
        disabled={api.allCollapsed}
      >
        Collapse all
      </button>
      <button
        type="button"
        className="kit-collapseall__btn"
        onClick={api.expandAll}
        disabled={api.allExpanded}
      >
        Expand all
      </button>
    </span>
  );
}

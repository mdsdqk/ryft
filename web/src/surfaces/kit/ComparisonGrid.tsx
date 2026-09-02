/**
 * ComparisonGrid — the framed object-comparison table shared by the merge-review
 * three-way screen and the branch-workspace Divergence sub-sheet (grill Q4/Q12).
 *
 * It is deliberately dumb: it owns the frame, the column headers, the base note,
 * the bounded scroll, the collapsible groups (and an optional outer section
 * level), and the filter chips. It knows nothing about conflicts, revisions, or
 * merges — the caller pre-renders every cell and passes any per-row adornment
 * (a conflict badge, a queue link) through `row.extra`.
 *
 * Visual tokens live in `styles/app.css` under the `.mr-cmp*` / `.mr-row*` /
 * `.mr-filters` families (this is where the merge-review screen already defined
 * them); the two new section-level classes are in `kit.css`. Reproducing that
 * markup exactly is what keeps `/merge/:id` pixel-identical after the
 * extraction.
 */

import { useMemo, type ReactNode } from "react";

import { Chevron, CollapseAll, useCollapse } from "./collapse.tsx";

type Tone = "ours" | "theirs" | "neutral";

export type GridColHead = {
  label: ReactNode;
  tone?: Tone;
  /** shown as a per-cell prefix once the grid stacks to one column */
  shortLabel?: ReactNode;
};

/** A value cell. `null` renders the muted em-dash "not present" cell. */
export type GridCell =
  | null
  | { label?: ReactNode; labelTone?: Tone; detail?: ReactNode };

export type GridRow = {
  key: string;
  objectLabel: ReactNode;
  objectId: ReactNode;
  /** extra class(es) on the row — e.g. `mr-row--conflict` */
  rowClass?: string;
  left: GridCell;
  right: GridCell;
  leader?: { text: ReactNode; tone: "ok" | "muted" };
  /** advisory destructive / risk notices for this object (ADR 0008 §6) — one
   *  line each, rendered under the row in a muted caution style */
  warnings?: ReactNode[];
  /** appended inside the row, spanning the two value columns */
  extra?: ReactNode;
};

export type GridGroup = { key: string; title: ReactNode; rows: GridRow[] };
export type GridSection = { key: string; title?: ReactNode; groups: GridGroup[] };

export type GridFilter = { key: string; label: ReactNode; id?: string };

function toneClass(tone: Tone | undefined): string | undefined {
  if (tone === "ours") return "mr-cmp__o";
  if (tone === "theirs") return "mr-cmp__t";
  return undefined;
}

function Cell({
  cell,
  defaultTone,
  colLabel,
}: {
  cell: GridCell;
  defaultTone: Tone;
  colLabel?: ReactNode;
}) {
  const prefix = colLabel != null && (
    <span className="mr-cell__col" aria-hidden="true">
      {colLabel}
    </span>
  );
  if (cell === null) {
    return (
      <div className="mr-cell mr-cell--empty">
        {prefix}—
      </div>
    );
  }
  return (
    <div className="mr-cell">
      {prefix}
      {cell.label != null && (
        <span className={`mr-rl mr-rl--${cell.labelTone ?? defaultTone}`}>{cell.label}</span>
      )}
      {cell.detail != null && <span className="mr-cell__detail">{cell.detail}</span>}
    </div>
  );
}

function Row({ row, leftCol, rightCol }: { row: GridRow; leftCol?: ReactNode; rightCol?: ReactNode }) {
  return (
    <div className={["mr-row", row.rowClass].filter(Boolean).join(" ")}>
      <div className="mr-row__obj">
        <span className="mr-row__nm">{row.objectLabel}</span>
        <span className="mr-row__id">{row.objectId}</span>
      </div>
      <Cell cell={row.left} defaultTone="ours" colLabel={leftCol} />
      <Cell cell={row.right} defaultTone="theirs" colLabel={rightCol} />
      {row.leader && (
        <p className={`mr-row__leader mr-row__leader--${row.leader.tone}`}>↳ {row.leader.text}</p>
      )}
      {row.warnings?.map((w, i) => (
        <p key={i} className="mr-row__warn">
          {w}
        </p>
      ))}
      {row.extra}
    </div>
  );
}

export function ComparisonGrid({
  filters = [],
  activeFilter = "",
  onFilter,
  filterLabel,
  countText,
  gutterLabel,
  left,
  right,
  baseNote,
  sections,
  emptyText,
}: {
  /** omit for a diff view that has no filter (Divergence) — the count still shows */
  filters?: GridFilter[];
  activeFilter?: string;
  onFilter?: (key: string) => void;
  filterLabel: string;
  countText: ReactNode;
  gutterLabel: ReactNode;
  left: GridColHead;
  right: GridColHead;
  baseNote: ReactNode;
  sections: GridSection[];
  emptyText: ReactNode;
}) {
  // every collapsible key on screen: titled sections, plus each non-empty group
  const allKeys = useMemo(() => {
    const ks: string[] = [];
    for (const s of sections) {
      if (s.title != null) ks.push(s.key);
      for (const g of s.groups) {
        if (g.rows.length > 0) ks.push(`${s.key}/${g.key}`);
      }
    }
    return ks;
  }, [sections]);

  const collapse = useCollapse(allKeys);
  const { isCollapsed, toggle } = collapse;

  const total = sections.reduce(
    (n, s) => n + s.groups.reduce((m, g) => m + g.rows.length, 0),
    0,
  );

  const renderGroup = (sectionKey: string, g: GridGroup) => {
    if (g.rows.length === 0) return null;
    const k = `${sectionKey}/${g.key}`;
    const groupCollapsed = isCollapsed(k);
    return (
      <div key={g.key} className="mr-cmp__group">
        <button
          className="mr-cmp__grouphd"
          aria-expanded={!groupCollapsed}
          onClick={() => toggle(k)}
        >
          <Chevron open={!groupCollapsed} />
          <span>{g.title}</span>
        </button>
        {!groupCollapsed &&
          g.rows.map((r) => (
            <Row
              key={r.key}
              row={r}
              leftCol={left.shortLabel}
              rightCol={right.shortLabel}
            />
          ))}
      </div>
    );
  };

  return (
    <>
      <div className="mr-filters" role="group" aria-label={filterLabel}>
        {filters.map((f) => (
          <button
            key={f.key}
            id={f.id}
            className="mr-chip"
            aria-pressed={activeFilter === f.key}
            onClick={() => onFilter?.(f.key)}
          >
            {f.label}
          </button>
        ))}
        {allKeys.length > 0 && <CollapseAll api={collapse} label="groups" />}
        <span className="mr-filters__count">{countText}</span>
      </div>

      <div className="mr-cmp">
        <div className="mr-cmp__colhd" role="presentation">
          <span>{gutterLabel}</span>
          <span className={toneClass(left.tone)}>{left.label}</span>
          <span className={toneClass(right.tone)}>{right.label}</span>
        </div>
        <p className="mr-cmp__base">{baseNote}</p>

        <div className="mr-cmp__scroll">
          {total === 0 && <p className="mr-cmp__empty">{emptyText}</p>}
          {sections.map((s) =>
            s.title == null ? (
              s.groups.map((g) => renderGroup(s.key, g))
            ) : (
              <SectionBlock
                key={s.key}
                section={s}
                collapsed={isCollapsed(s.key)}
                onToggle={() => toggle(s.key)}
                renderGroup={renderGroup}
              />
            ),
          )}
        </div>
      </div>
    </>
  );
}

function SectionBlock({
  section,
  collapsed,
  onToggle,
  renderGroup,
}: {
  section: GridSection;
  collapsed: boolean;
  onToggle: () => void;
  renderGroup: (sectionKey: string, g: GridGroup) => ReactNode;
}) {
  return (
    <div className="cmpgrid-section">
      <button className="cmpgrid-section__hd" aria-expanded={!collapsed} onClick={onToggle}>
        <Chevron open={!collapsed} />
        <span>{section.title}</span>
      </button>
      {!collapsed && section.groups.map((g) => renderGroup(section.key, g))}
    </div>
  );
}

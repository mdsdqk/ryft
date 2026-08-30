import { useMemo, useState } from "react";

import type { ComparisonRow, MergeReview, ObjectGroup, SideChange } from "../model.ts";
import { changeLabel } from "../format.ts";
import { RevisionTriangle } from "./RevisionTriangle.tsx";

type Filter = "changes" | "conflicts" | "all";

const GROUP_TITLE: Record<ObjectGroup, string> = {
  columns: "Columns",
  indexes: "Indexes",
  constraints: "Constraints / FK",
};
const GROUP_ORDER: ObjectGroup[] = ["columns", "indexes", "constraints"];

function isChanged(r: ComparisonRow): boolean {
  return r.ours !== null || r.theirs !== null;
}

/**
 * Zone A — the three-way comparison. Object + stable id in the gutter, one
 * column for what each branch drew against the base, the base stated plainly
 * between them. No spine. Its own bounded scroll so Zones B–D stay in view.
 */
export function ComparisonTable({
  review,
  filterId,
  onOpenConflict,
}: {
  review: MergeReview;
  filterId: string;
  onOpenConflict: (conflictId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("changes");
  const [collapsed, setCollapsed] = useState<Set<ObjectGroup>>(new Set());

  const shown = useMemo(() => {
    return review.rows.filter((r) => {
      if (filter === "all") return true;
      if (filter === "changes") return isChanged(r);
      return r.resolution.state === "conflict";
    });
  }, [review.rows, filter]);

  const byGroup = useMemo(() => {
    const m = new Map<ObjectGroup, ComparisonRow[]>();
    for (const g of GROUP_ORDER) m.set(g, []);
    for (const r of shown) m.get(r.group)!.push(r);
    return m;
  }, [shown]);

  const changedCount = review.rows.filter(isChanged).length;
  const conflictCount = review.rows.filter((r) => r.resolution.state === "conflict").length;

  return (
    <section className="mr-zone" aria-labelledby="mr-cmp-h">
      <h2 className="mr-zone__k" id="mr-cmp-h">
        <span className="mr-zone__n">A</span> Three-way comparison — table <code>{review.table}</code>
      </h2>

      <div className="mr-filters" role="group" aria-label="Filter comparison">
        {(
          [
            ["changes", "Changes only"],
            ["conflicts", `Conflicts only (${conflictCount})`],
            ["all", `All ${review.rows.length} objects`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            id={id === "changes" ? filterId : undefined}
            className="mr-chip"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {label}
          </button>
        ))}
        <span className="mr-filters__count">
          showing {shown.length} of {review.rows.length} · {changedCount} changed
        </span>
      </div>

      <div className="mr-cmp">
        <div className="mr-cmp__colhd" role="presentation">
          <span>Object · stable id</span>
          <span className="mr-cmp__o">On {review.source} — ours</span>
          <span className="mr-cmp__t">On {review.target} — theirs</span>
        </div>
        <p className="mr-cmp__base">
          common ancestor <code>{review.base}</code> — every row below is measured against it
        </p>

        <div className="mr-cmp__scroll">
          {shown.length === 0 && (
            <p className="mr-cmp__empty">
              {filter === "changes"
                ? `${review.source} has not diverged from ${review.target} — every object matches the common ancestor.`
                : filter === "conflicts"
                  ? "No conflicts on this merge."
                  : "This table has no objects."}
            </p>
          )}
          {GROUP_ORDER.map((g) => {
            const rows = byGroup.get(g)!;
            if (rows.length === 0) return null;
            const isCollapsed = collapsed.has(g);
            const nConflict = rows.filter((r) => r.resolution.state === "conflict").length;
            return (
              <div key={g} className="mr-cmp__group">
                <button
                  className="mr-cmp__grouphd"
                  aria-expanded={!isCollapsed}
                  onClick={() =>
                    setCollapsed((prev) => {
                      const next = new Set(prev);
                      if (next.has(g)) next.delete(g);
                      else next.add(g);
                      return next;
                    })
                  }
                >
                  <Chevron open={!isCollapsed} />
                  <span>
                    {GROUP_TITLE[g]} — {rows.length} shown
                    {nConflict > 0 ? ` · ${nConflict} in conflict` : ""}
                  </span>
                </button>
                {!isCollapsed &&
                  rows.map((r) => (
                    <ComparisonRowView key={r.objectId} row={r} onOpenConflict={onOpenConflict} />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/** Authored disclosure chevron — same stroke language as the revision triangle. */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`mr-chevron${open ? " mr-chevron--open" : ""}`}
      viewBox="0 0 10 10"
      width="10"
      height="10"
      aria-hidden="true"
    >
      <path d="M3 1.5 L7 5 L3 8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function ComparisonRowView({
  row,
  onOpenConflict,
}: {
  row: ComparisonRow;
  onOpenConflict: (id: string) => void;
}) {
  const res = row.resolution;
  const cls = [
    "mr-row",
    res.state === "conflict" && "mr-row--conflict",
    res.state === "auto-merged" && "mr-row--auto",
    res.state === "gated" && "mr-row--gated",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className="mr-row__obj">
        <span className="mr-row__nm">{row.objectLabel}</span>
        <span className="mr-row__id">{row.objectId}</span>
      </div>
      <Cell change={row.ours} side="ours" />
      <Cell change={row.theirs} side="theirs" />

      {row.leader && (
        <p className={`mr-row__leader mr-row__leader--${row.leader.tone}`}>↳ {row.leader.text}</p>
      )}

      {res.state === "conflict" && (
        <p className="mr-row__badge">
          <RevisionTriangle n="!" conflict />
          conflict —{" "}
          <button className="mr-linkbtn" onClick={() => onOpenConflict(res.conflictId)}>
            resolve in Zone B
          </button>
        </p>
      )}
      {res.state === "auto-merged" && <p className="mr-row__badge mr-row__badge--ok">↳ {res.note}</p>}
      {res.state === "gated" && (
        <p className="mr-row__badge mr-row__badge--gated">
          held — {res.note} (
          <button className="mr-linkbtn" onClick={() => onOpenConflict(res.byConflictId)}>
            go to conflict
          </button>
          )
        </p>
      )}
    </div>
  );
}

function Cell({ change, side }: { change: SideChange | null; side: "ours" | "theirs" }) {
  if (!change) return <div className="mr-cell mr-cell--empty">—</div>;
  return (
    <div className="mr-cell">
      <span className={`mr-rl mr-rl--${side}`}>
        <RevisionTriangle n={change.revision} side={side} />
        {changeLabel(change.kind)}
      </span>
      <span className="mr-cell__detail">
        {change.wasName ? (
          <>
            <s>{change.wasName}</s> → <b>{change.newName}</b>
          </>
        ) : (
          change.detail
        )}
      </span>
    </div>
  );
}

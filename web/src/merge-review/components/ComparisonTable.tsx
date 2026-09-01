import { useMemo, useState } from "react";

import {
  ComparisonGrid,
  type GridCell,
  type GridRow,
  type GridSection,
} from "../../surfaces/kit/index.ts";
import type { ComparisonRow, ObjectGroup, MergeReview, SideChange } from "../model.ts";
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

function cellFrom(change: SideChange | null, side: "ours" | "theirs"): GridCell {
  if (!change) return null;
  return {
    labelTone: side,
    label: (
      <>
        <RevisionTriangle n={change.revision} side={side} />
        {changeLabel(change.kind)}
      </>
    ),
    detail: change.wasName ? (
      <>
        <s>{change.wasName}</s> → <b>{change.newName}</b>
      </>
    ) : (
      change.detail
    ),
  };
}

function rowExtra(
  row: ComparisonRow,
  onOpenConflict: (id: string) => void,
): GridRow["extra"] {
  const res = row.resolution;
  if (res.state === "conflict") {
    return (
      <p className="mr-row__badge">
        <RevisionTriangle n="!" conflict />
        conflict —{" "}
        <button className="mr-linkbtn" onClick={() => onOpenConflict(res.conflictId)}>
          resolve in Zone B
        </button>
      </p>
    );
  }
  if (res.state === "auto-merged") {
    return <p className="mr-row__badge mr-row__badge--ok">↳ {res.note}</p>;
  }
  if (res.state === "gated") {
    return (
      <p className="mr-row__badge mr-row__badge--gated">
        held — {res.note} (
        <button className="mr-linkbtn" onClick={() => onOpenConflict(res.byConflictId)}>
          go to conflict
        </button>
        )
      </p>
    );
  }
  return undefined;
}

const ROW_CLASS: Partial<Record<ComparisonRow["resolution"]["state"], string>> = {
  conflict: "mr-row--conflict",
  "auto-merged": "mr-row--auto",
  gated: "mr-row--gated",
};

/**
 * Zone A — the three-way comparison. A thin adapter over the shared
 * `ComparisonGrid` (grill Q4/Q12): it holds the filter state and the zone
 * heading, maps `MergeReview` rows to grid rows, and composes the conflict /
 * gated / auto badges into each row's slot. The grid owns the frame, headers,
 * scroll, and collapsible groups.
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
  const changedCount = review.rows.filter(isChanged).length;
  const conflictCount = review.rows.filter((r) => r.resolution.state === "conflict").length;

  // The primary action on a held merge is resolving the active conflict
  // (index.html), so open on the conflicts — Zone A is evidence, Zone B is the
  // decision. Fall back to "changes" when nothing conflicts.
  const [filter, setFilter] = useState<Filter>(
    conflictCount > 0 ? "conflicts" : "changes",
  );

  const shown = useMemo(
    () =>
      review.rows.filter((r) => {
        if (filter === "all") return true;
        if (filter === "changes") return isChanged(r);
        return r.resolution.state === "conflict";
      }),
    [review.rows, filter],
  );

  const sections: GridSection[] = useMemo(() => {
    const groups = GROUP_ORDER.map((g) => {
      const rows = shown.filter((r) => r.group === g);
      const nConflict = rows.filter((r) => r.resolution.state === "conflict").length;
      return {
        key: g,
        title: (
          <>
            {GROUP_TITLE[g]} — {rows.length} shown
            {nConflict > 0 ? ` · ${nConflict} in conflict` : ""}
          </>
        ),
        rows: rows.map<GridRow>((r) => ({
          key: r.objectId,
          objectLabel: r.objectLabel,
          objectId: r.objectId,
          rowClass: ROW_CLASS[r.resolution.state],
          left: cellFrom(r.ours, "ours"),
          right: cellFrom(r.theirs, "theirs"),
          leader: r.leader ? { text: r.leader.text, tone: r.leader.tone } : undefined,
          extra: rowExtra(r, onOpenConflict),
        })),
      };
    }).filter((g) => g.rows.length > 0);
    return [{ key: review.table, groups }];
  }, [shown, onOpenConflict, review.table]);

  const emptyText =
    filter === "changes"
      ? `${review.source} has not diverged from ${review.target} — every object matches the common ancestor.`
      : filter === "conflicts"
        ? "No conflicts on this merge."
        : "This table has no objects.";

  return (
    <section className="mr-zone" aria-labelledby="mr-cmp-h">
      <h2 className="mr-zone__k" id="mr-cmp-h">
        <span className="mr-zone__n">A</span> Three-way comparison — table <code>{review.table}</code>
      </h2>

      <ComparisonGrid
        filters={[
          { key: "changes", label: "Changes only", id: filterId },
          { key: "conflicts", label: `Conflicts only (${conflictCount})` },
          { key: "all", label: `All ${review.rows.length} objects` },
        ]}
        activeFilter={filter}
        onFilter={(k) => setFilter(k as Filter)}
        filterLabel="Filter comparison"
        countText={
          <>
            showing {shown.length} of {review.rows.length} · {changedCount} changed
          </>
        }
        gutterLabel="Object · stable id"
        left={{ label: `On ${review.source} — ours`, shortLabel: "on ours", tone: "ours" }}
        right={{ label: `On ${review.target} — theirs`, shortLabel: "on theirs", tone: "theirs" }}
        baseNote={
          <>
            common ancestor <code>{review.base}</code> — every row below is measured against it
          </>
        }
        sections={sections}
        emptyText={emptyText}
      />
    </section>
  );
}

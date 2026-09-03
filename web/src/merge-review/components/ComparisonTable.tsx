import { useMemo, useState } from "react";

import {
  ComparisonGrid,
  type GridCell,
  type GridGroup,
  type GridRow,
  type GridSection,
} from "../../surfaces/kit/index.ts";
import type {
  ComparisonRow,
  ObjectGroup,
  MergeReview,
  SideChange,
  TableChange,
} from "../model.ts";
import { changeLabel } from "../format.ts";
import { RevisionTriangle } from "./RevisionTriangle.tsx";

type Filter = "changes" | "conflicts" | "all";

const GROUP_TITLE: Record<ObjectGroup, string> = {
  columns: "Columns",
  indexes: "Indexes",
  constraints: "Constraints / FK",
};
const GROUP_ORDER: ObjectGroup[] = ["columns", "indexes", "constraints"];

const TABLE_CHANGE_LABEL: Record<TableChange["kind"], string> = {
  "create-table": "create table",
  "drop-table": "drop table",
  "rename-table": "rename table",
};

/** A `TableChange` as the ours- or theirs-side cell of its banner row. */
function tableChangeCell(tc: TableChange): GridCell {
  return {
    labelTone: tc.side,
    label: (
      <>
        <RevisionTriangle n={tc.revision} side={tc.side} />
        {TABLE_CHANGE_LABEL[tc.kind]}
      </>
    ),
    detail: tc.detail || undefined,
  };
}

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

  const multiTable = review.tables.length > 1;

  const sections: GridSection[] = useMemo(() => {
    // one section per table; `null` is the single-table / no-divergence case,
    // which renders sectionless exactly as before
    const scopes: Array<string | null> = review.tables.length > 0 ? review.tables : [null];

    const buildSection = (table: string | null): GridSection => {
      const inScope = table == null ? shown : shown.filter((r) => r.table === table);

      const objectGroups: GridGroup[] = GROUP_ORDER.map((g) => {
        const rows = inScope.filter((r) => r.group === g);
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
            warnings: r.warnings?.map((w) => (
              <>
                <b>{w.kind}</b> — {w.message}
              </>
            )),
            extra: rowExtra(r, onOpenConflict),
          })),
        };
      }).filter((g) => g.rows.length > 0);

      // create / drop / rename of the table itself — a banner group above its
      // object rows, never an object row (ADR: `TableChange`)
      const changes = table == null ? [] : review.tableChanges.filter((tc) => tc.table === table);
      const changeGroup: GridGroup[] =
        changes.length === 0
          ? []
          : [
              {
                key: "table",
                title: (
                  <>
                    Table — {changes.length} change{changes.length === 1 ? "" : "s"}
                  </>
                ),
                rows: changes.map<GridRow>((tc) => ({
                  key: `tc-${tc.revision}`,
                  objectLabel: tc.table,
                  objectId: "table",
                  left: tc.side === "ours" ? tableChangeCell(tc) : null,
                  right: tc.side === "theirs" ? tableChangeCell(tc) : null,
                })),
              },
            ];

      return {
        key: table ?? "all",
        title: multiTable ? <code>{table}</code> : undefined,
        groups: [...changeGroup, ...objectGroups],
      };
    };

    return scopes.map(buildSection);
  }, [shown, onOpenConflict, review.tables, review.tableChanges, multiTable]);

  const emptyText =
    filter === "changes"
      ? `${review.source} has not diverged from ${review.target} — every object matches the common ancestor.`
      : filter === "conflicts"
        ? "No conflicts on this merge."
        : "No objects to compare.";

  const scopeLabel =
    review.tables.length === 1 ? (
      <>
        {" "}
        — table <code>{review.tables[0]}</code>
      </>
    ) : multiTable ? (
      <> — {review.tables.length} tables</>
    ) : null;

  return (
    <section className="mr-zone" aria-labelledby="mr-cmp-h">
      <h2 className="mr-zone__k" id="mr-cmp-h">
        <span className="mr-zone__n">A</span> Three-way comparison{scopeLabel}
      </h2>

      {review.destructiveCount > 0 && (
        <p className="mr-zone__warn" role="note">
          <b>{review.destructiveCount}</b> destructive change
          {review.destructiveCount === 1 ? "" : "s"} in this merge — dropped objects are
          irreversible once merged. Marked on the rows and in the fabrication order.
        </p>
      )}

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
        gutterLabel="Table object"
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

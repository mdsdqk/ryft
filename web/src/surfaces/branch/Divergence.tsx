/**
 * The Divergence sub-sheet — how this branch has grown from `main` (grill
 * Q4/Q10). The merge-review comparison run two-way: `on main` (the base at cut)
 * against `on this branch`, table-grouped, no `theirs` column, no conflict
 * queue, no `△N`. `Open merge request` is the primary action, mirrored from the
 * sheet title strip.
 */

import { useMemo } from "react";

import type { BranchDetail } from "../../data/index.ts";
import { ComparisonGrid, EmptyState } from "../kit/index.ts";
import { toDivergenceSections } from "./divergenceModel.tsx";

export function Divergence({ detail }: { detail: BranchDetail }) {
  const { sections, changeCount } = useMemo(
    () => toDivergenceSections(detail.base, detail.head),
    [detail.base, detail.head],
  );

  if (detail.divergence === 0) {
    return (
      <div className="bw-divergence">
        <EmptyState title="Divergence">
          This branch matches <code>main</code> — nothing to merge. Edit the schema
          to diverge it.
        </EmptyState>
      </div>
    );
  }

  const tables = sections.length;

  return (
    <div className="bw-divergence">
      <h2 className="bw-main__k">
        Divergence
        <span className="bw-main__ct">
          {changeCount} change{changeCount === 1 ? "" : "s"} across {tables} table
          {tables === 1 ? "" : "s"}
        </span>
      </h2>

      <ComparisonGrid
        filterLabel="Divergence summary"
        countText={
          <>
            {changeCount} object{changeCount === 1 ? "" : "s"} diverged from main
          </>
        }
        gutterLabel="Object · stable id"
        left={{ label: "On main", shortLabel: "on main" }}
        right={{ label: "On this branch — ours", shortLabel: "on this branch", tone: "ours" }}
        baseNote={
          <>
            measured against <code>main</code> as it stood when{" "}
            <code>{detail.name}</code> was cut ({detail.cutOn})
          </>
        }
        sections={sections}
        emptyText="No divergence from main."
      />
    </div>
  );
}

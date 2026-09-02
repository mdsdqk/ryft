/**
 * The database resource — the one Postgres namespace this instance manages.
 * There is no database selector; signing in lands here. Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-D). Surfaces read it through
 * `source.getOverview()`, never this file.
 *
 * Counts describe `main`'s current schema. The dashboard is the orientation
 * surface; it does not preview that schema (link out to `/branch/main`).
 */

import type { Database, TrunkRevision } from "./types.ts";

/**
 * V0 exercise: `/db?empty` is a freshly seeded database — no working branches,
 * no open merges. Scoped to the dashboard path so `/merges?empty` and
 * `/branches?empty` (list-only exercises) do not zero the rail.
 */
export function overviewExerciseEmpty(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  if (path !== "/db" && path !== "/") return false;
  return new URLSearchParams(window.location.search).has("empty");
}

/**
 * `main`'s recent revisions — one per merge that has landed, newest first (the
 * API caps this at ten). `database.trunkRevision` is derived from the length of
 * this list, never a standalone number.
 */
export const trunkRevisions: TrunkRevision[] = [
  { n: 4, sourceBranch: "comment-flags-bigint", at: "2026-02-08", summary: "merged by Ravi Menon" },
  { n: 3, sourceBranch: "post-rating-column", at: "2026-02-03", summary: "merged by Mara Lindqvist" },
  { n: 2, sourceBranch: "tag-name-unique", at: "2026-01-27", summary: "merged by Grace Okoro" },
  { n: 1, sourceBranch: "post-view-count", at: "2026-01-20", summary: "merged by Grace Okoro" },
];

export const database: Database = {
  name: "public",
  connection: "postgres",
  tables: 5,
  columns: 34,
  indexes: 6,
  constraints: 9,
  trunk: "main",
  trunkRevision: trunkRevisions.length,
  trunkChangedOn: "2026-02-08",
};

/**
 * The database resource — the one Postgres namespace this instance manages.
 * There is no database selector; signing in lands here. Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-D). Surfaces read it through
 * `source.getOverview()`, never this file.
 *
 * Counts describe `main`'s current schema. The dashboard is the orientation
 * surface; it does not preview that schema (link out to `/branch/main`).
 */

import type { Database } from "./types.ts";

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

export const database: Database = {
  name: "public",
  connection: "postgres",
  tables: 5,
  columns: 34,
  indexes: 6,
  constraints: 9,
  trunk: "main",
  trunkRevision: 41,
  trunkChangedOn: "2026-02-08",
};

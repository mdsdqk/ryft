/**
 * Demonstration data for the shell and the not-yet-built list surfaces.
 *
 * V0 builds the app shell and routing; the dashboard, branch list, and merge
 * list are later steps (docs/design/shape-brief-app-flow.md §5). Until the API
 * exists these constants stand in so the rail counts and the placeholder sheets
 * read as a real product rather than empty scaffolding. Every screen that shows
 * this data also says "Demonstration data" on it. Content matches the worked
 * example under `examples/` — branch `contact-fields` by Grace against `main`.
 */

export const demoDatabase = {
  name: "public",
  connection: "postgres",
  tables: 5,
  columns: 34,
  indexes: 6,
  constraints: 9,
  trunk: "main",
  trunkRevision: 41,
  trunkChangedOn: "2026-02-08",
} as const;

export type DemoBranch = {
  name: string;
  author: string;
  cutOn: string;
  divergence: number;
};

export const demoBranches: readonly DemoBranch[] = [
  { name: "contact-fields", author: "grace", cutOn: "2026-02-10", divergence: 3 },
  { name: "post-metrics", author: "ravi", cutOn: "2026-02-09", divergence: 4 },
  { name: "drop-legacy-tags", author: "mara", cutOn: "2026-02-07", divergence: 2 },
  { name: "audit-timestamps", author: "ravi", cutOn: "2026-02-12", divergence: 0 },
];

export type DemoMerge = {
  id: string;
  source: string;
  target: string;
  author: string;
  openedOn: string;
  operations: number;
  status: "clean" | "held";
  conflicts: number;
};

export const demoMerges: readonly DemoMerge[] = [
  {
    id: "1",
    source: "contact-fields",
    target: "main",
    author: "grace",
    openedOn: "2026-02-11",
    operations: 3,
    status: "held",
    conflicts: 1,
  },
];

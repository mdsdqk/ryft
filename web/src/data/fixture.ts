/**
 * Fixture implementation of the data seam — the V0 stand-in until the Hono API
 * exists. Content matches the worked example under `examples/`: branch
 * `contact-fields` by Grace against `main`. Every surface that renders this data
 * also shows a "Demonstration data" tag.
 *
 * Async on purpose: surfaces are written against a promise-returning seam from
 * the start, so wiring the real API later is a swap in `./index.ts`, not a
 * rewrite of every surface's loading and error handling.
 */

import type { DataSource } from "./source.ts";
import type { BranchSummary, Database, MergeSummary } from "./types.ts";

const database: Database = {
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

const branches: BranchSummary[] = [
  { name: "contact-fields", author: "grace", cutOn: "2026-02-10", divergence: 3 },
  { name: "post-metrics", author: "ravi", cutOn: "2026-02-09", divergence: 4 },
  { name: "drop-legacy-tags", author: "mara", cutOn: "2026-02-07", divergence: 2 },
  { name: "audit-timestamps", author: "ravi", cutOn: "2026-02-12", divergence: 0 },
];

const merges: MergeSummary[] = [
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

// clone on the way out so a caller cannot mutate the fixture
const clone = <T>(v: T): T => structuredClone(v);

export const fixtureSource: DataSource = {
  getOverview: async () => ({
    database: clone(database),
    branches: clone(branches),
    merges: clone(merges),
  }),
};

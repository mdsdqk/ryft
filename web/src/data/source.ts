/**
 * The data seam. Every surface reads through a `DataSource`; nothing imports a
 * concrete implementation except `./index.ts`, which picks one.
 *
 * V0 ships only `getOverview` — the rail and the dashboard both need the same
 * aggregate. The dedicated list pages add their own methods when they are built
 * (WU-A adds `listBranches`, WU-B adds `listMerges`, WU-E adds `getBranchSchema`
 * — docs/design/app-flow-work-breakdown.md).
 */

import type { Overview } from "./types.ts";

export interface DataSource {
  /** database stats + the branches and open merges, in one read */
  getOverview(): Promise<Overview>;
}

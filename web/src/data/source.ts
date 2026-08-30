/**
 * The data seam. Every surface reads through a `DataSource`; nothing imports a
 * concrete implementation except `./index.ts`, which picks one.
 *
 * V0 ships `getOverview` (rail + dashboard) and the branches resource (WU-A).
 * WU-B adds `listMerges`; WU-E adds `getBranchSchema`.
 */

import type { BranchSummary, Overview } from "./types.ts";

export type CreateBranchArgs = {
  name: string;
  author: string;
  /** ISO-8601 date (`2026-02-12`) — the client stamps the cut day */
  cutOn: string;
};

export interface DataSource {
  /** database stats + the branches and open merges, in one read */
  getOverview(): Promise<Overview>;
  /** trunk first, then working branches — the `/branches` list */
  listBranches(): Promise<BranchSummary[]>;
  /** cut a working branch from `main`; throws on a bad or taken name */
  createBranch(args: CreateBranchArgs): Promise<BranchSummary>;
  /** drop a working branch; throws if it is the trunk or held by an open MR */
  deleteBranch(name: string): Promise<void>;
}

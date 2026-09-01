/**
 * The one data source the UI reads. The real backend (`./http.ts`, the Hono API)
 * is the default; set `VITE_DATA_SOURCE=fixture` to fall back to the in-memory
 * `./fixture.ts` (the offline path the `web/scripts/` screenshot runs use).
 *
 * Import from `../data` — never from `./http` or `./fixture` directly.
 */

import type { DataSource } from "./source.ts";
import { fixtureSource } from "./fixture.ts";
import { httpSource } from "./http.ts";

export const source: DataSource =
  import.meta.env.VITE_DATA_SOURCE === "fixture" ? fixtureSource : httpSource;

export type { DataSource } from "./source.ts";
export type {
  Database,
  BranchSummary,
  MergeSummary,
  Overview,
  BranchDetail,
  BranchOperationEntry,
  ApplyOpsResult,
} from "./types.ts";
export type { CreateBranchArgs } from "./source.ts";
export { useResource, type Resource } from "./useResource.ts";
export {
  BRANCH_NAME_MAX,
  BranchHeldError,
  heldByMergeMessage,
} from "./branches.ts";
export { BranchNotFoundError } from "./branchSchema.ts";
export { mergeStatusLabel, mergeStatusTone } from "./merges.ts";

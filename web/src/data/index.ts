/**
 * The one data source the UI reads. Fixture-backed for V0; to wire the real
 * backend, implement `DataSource` against the Hono API and swap it in here —
 * nothing else changes (docs/design/app-flow-work-breakdown.md, decision 5).
 *
 * Import from `../data` — never from `./fixture` directly.
 */

import type { DataSource } from "./source.ts";
import { fixtureSource } from "./fixture.ts";

export const source: DataSource = fixtureSource;

export type { DataSource } from "./source.ts";
export type {
  Database,
  BranchSummary,
  MergeSummary,
  Overview,
} from "./types.ts";
export type { CreateBranchArgs } from "./source.ts";
export { useResource, type Resource } from "./useResource.ts";
export {
  BRANCH_NAME_MAX,
  BranchHeldError,
  heldByMergeMessage,
} from "./branches.ts";

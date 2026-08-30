/**
 * The branches resource — list, create-from-main, delete. Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-A). Surfaces import through
 * `source.listBranches` / `createBranch` / `deleteBranch`, never this file.
 *
 * `main` is the trunk: it appears on the list, it cannot be deleted, and it is
 * not a working branch. Working-branch counts (the rail, the dashboard preview)
 * omit it.
 */

import type { BranchSummary, Database, MergeSummary } from "./types.ts";
import { invalidateData } from "./watch.ts";

/** one letter + up to 38 more → 39 chars; keep in lockstep with the create field */
export const BRANCH_NAME_MAX = 39;
const BRANCH_NAME = new RegExp(`^[a-z][a-z0-9_-]{0,${BRANCH_NAME_MAX - 1}}$`);

export function heldByMergeMessage(name: string, trunk: string): string {
  return `An open merge request (${name} → ${trunk}) holds this branch. Resolve or close it first.`;
}

export class BranchHeldError extends Error {
  override name = "BranchHeldError";
  constructor(message: string) {
    super(message);
  }
}

let working: BranchSummary[] = [
  { name: "contact-fields", author: "grace", cutOn: "2026-02-10", divergence: 3 },
  { name: "post-metrics", author: "ravi", cutOn: "2026-02-09", divergence: 4 },
  { name: "drop-legacy-tags", author: "mara", cutOn: "2026-02-07", divergence: 2 },
  { name: "audit-timestamps", author: "ravi", cutOn: "2026-02-12", divergence: 0 },
];

const clone = <T>(v: T): T => structuredClone(v);

function mergeIdFor(
  name: string,
  merges: readonly MergeSummary[],
): string | undefined {
  return merges.find((m) => m.source === name)?.id;
}

function withOpenMerge(
  branch: BranchSummary,
  merges: readonly MergeSummary[],
): BranchSummary {
  const openMergeId = mergeIdFor(branch.name, merges);
  return openMergeId ? { ...branch, openMergeId } : { ...branch };
}

/** Working branches only — what the rail count and the dashboard preview show. */
export function listWorking(merges: readonly MergeSummary[]): BranchSummary[] {
  return working.map((b) => clone(withOpenMerge(b, merges)));
}

/** Trunk first, then working branches. The `/branches` list. */
export function listAll(
  database: Database,
  merges: readonly MergeSummary[],
): BranchSummary[] {
  const trunk: BranchSummary = {
    name: database.trunk,
    author: "",
    cutOn: database.trunkChangedOn,
    divergence: 0,
    trunk: true,
  };
  return [clone(trunk), ...listWorking(merges)];
}

export function normalizeBranchName(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateBranchName(
  raw: string,
  database: Database,
  merges: readonly MergeSummary[],
): string | null {
  const name = normalizeBranchName(raw);
  if (!name) return "Name the branch.";
  if (name === database.trunk) {
    return `${database.trunk} is the trunk. Name a working branch.`;
  }
  if (!BRANCH_NAME.test(name)) {
    return "Use a lowercase name: start with a letter, then letters, digits, hyphens, or underscores.";
  }
  const taken = [database.trunk, ...working.map((b) => b.name)];
  if (taken.includes(name)) return `${name} already exists.`;
  if (merges.some((m) => m.source === name)) {
    return `${name} already exists.`;
  }
  return null;
}

export function createBranch(
  args: { name: string; author: string; cutOn: string },
  database: Database,
  merges: readonly MergeSummary[],
): BranchSummary {
  const name = normalizeBranchName(args.name);
  const error = validateBranchName(name, database, merges);
  if (error) throw new Error(error);
  const author = args.author.trim();
  if (!author) throw new Error("A branch needs an author.");
  const created: BranchSummary = {
    name,
    author,
    cutOn: args.cutOn,
    divergence: 0,
  };
  working = [created, ...working];
  invalidateData();
  return clone(created);
}

export function deleteBranch(
  name: string,
  database: Database,
  merges: readonly MergeSummary[],
): void {
  if (name === database.trunk) {
    throw new Error(`${database.trunk} cannot be deleted.`);
  }
  const existing = working.find((b) => b.name === name);
  if (!existing) throw new Error(`No branch named ${name}.`);
  const heldBy = mergeIdFor(name, merges);
  if (heldBy) {
    throw new BranchHeldError(heldByMergeMessage(name, database.trunk));
  }
  working = working.filter((b) => b.name !== name);
  invalidateData();
}

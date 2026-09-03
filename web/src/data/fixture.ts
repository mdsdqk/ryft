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

import type { CreateBranchArgs, DataSource } from "./source.ts";
import * as branches from "./branches.ts";
import * as branchSchema from "./branchSchema.ts";
import { database, overviewExerciseEmpty, trunkRevisions } from "./database.ts";
import * as merges from "./merges.ts";
import * as mergeReview from "./mergeReview.ts";

const clone = <T>(v: T): T => structuredClone(v);

export const fixtureSource: DataSource = {
  getOverview: async () => {
    if (overviewExerciseEmpty()) {
      // `/db?empty` is a freshly seeded database — nothing has merged into main.
      return {
        database: { ...clone(database), trunkRevision: 0 },
        branches: [],
        merges: [],
        revisions: [],
      };
    }
    const open = merges.listOpen();
    return {
      database: clone(database),
      branches: branches.listWorking(open),
      merges: open,
      revisions: clone(trunkRevisions),
    };
  },
  listBranches: async () => branches.listAll(database, merges.listOpen()),
  listMerges: async (state) => (state === "closed" ? merges.listClosed() : merges.listOpen()),
  createBranch: async (args: CreateBranchArgs) =>
    branches.createBranch(args, database, merges.listOpen()),
  deleteBranch: async (name: string) => {
    branches.deleteBranch(name, database, merges.listOpen());
  },
  listDeletedBranches: async () => branches.listDeleted(),
  getBranchDetail: (name: string) => branchSchema.getBranchDetail(name),
  listBranchOperations: (name: string) => branchSchema.listBranchOperations(name),
  applyOperations: (name, ops) => branchSchema.applyOperations(name, ops),
  undoAfter: (name, seq) => branchSchema.undoAfter(name, seq),
  createMergeRequest: (name) => branchSchema.createMergeRequest(name),
  getMergeReview: (number) => mergeReview.getByNumber(number),
  postResolution: (number, conflictId, choice, type) =>
    mergeReview.postResolution(number, conflictId, choice, type),
  deleteResolution: (number, conflictId) => mergeReview.deleteResolution(number, conflictId),
  mergeMergeRequest: (number) => mergeReview.mergeMergeRequest(number),
  closeMergeRequest: (number) => mergeReview.closeMergeRequest(number),
};

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
import type { Database } from "./types.ts";
import * as branches from "./branches.ts";
import * as merges from "./merges.ts";

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

const clone = <T>(v: T): T => structuredClone(v);

export const fixtureSource: DataSource = {
  getOverview: async () => {
    const open = merges.listOpen();
    return {
      database: clone(database),
      branches: branches.listWorking(open),
      merges: open,
    };
  },
  listBranches: async () => branches.listAll(database, merges.listOpen()),
  listMerges: async () => merges.listOpen(),
  createBranch: async (args: CreateBranchArgs) =>
    branches.createBranch(args, database, merges.listOpen()),
  deleteBranch: async (name: string) => {
    branches.deleteBranch(name, database, merges.listOpen());
  },
};

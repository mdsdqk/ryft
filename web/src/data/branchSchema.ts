/**
 * The branch-schema resource — one branch's `head` + `base` documents, its
 * operation log, and the structured-editor writes. Fixture-backed for V0
 * (docs/design/app-flow-work-breakdown.md, WU-E). Surfaces read and write it
 * through the `source` seam, never this file.
 *
 * Content starts from the canonical worked example under `examples/`: branch
 * `contact-fields` by Grace — rename `users.email` → `email_address`, add
 * `users.phone`, add a unique index on the renamed column (seqs 1–3). Further
 * edits append to that log. `head` is always `base` with the log replayed on it
 * (`applyOne`), so undo is a truncation. `main` is the seed, unchanged. Any
 * other name is a miss (`BranchNotFoundError`).
 *
 * The mutable log lives at module scope, like `branches.ts`'s working list — a
 * reload resets it. `applyOperations` mirrors the API's one transaction: it
 * builds the new head in a local, and only commits the log if every op applied.
 *
 * URL exercise flags (`/branch/:name?…`) shape reads only; the editor operates
 * on the real log regardless:
 *   ?empty   the branch matches `main` — no divergence, no `△`
 *   ?wide    `users` padded wide, base and head alike, layout stress only
 *   ?error / ?loading  handled by the surface — the resource is not consulted
 */

import type { Operation } from "@engine/operations.js";
import type { SchemaDocument } from "@engine/schema.js";
import { applyOne } from "@engine/apply.js";
import { applyOperation } from "@engine/apply-operation.js";
import { seedSchema, seedIds } from "@examples/seed.schema.js";
import { branchedLog } from "@examples/branched.log.js";

import type {
  ApplyOpsResult,
  BranchDetail,
  BranchOperationEntry,
} from "./types.ts";
import { createFor, listOpen } from "./merges.ts";
import { invalidateData } from "./watch.ts";

/** A branch name the workspace was asked for that does not exist. */
export class BranchNotFoundError extends Error {
  override name = "BranchNotFoundError";
  constructor(name: string) {
    super(`No branch named ${name}.`);
  }
}

const clone = <T>(v: T): T => structuredClone(v);
const BASE: SchemaDocument = clone(seedSchema);

// ── the mutable operation log for `contact-fields` ──────────────────────────

type Meta = { seq: number; at: string; author: string };

let log: { op: Operation; meta: Meta }[] = branchedLog.map((e) => ({
  op: e.op as Operation,
  meta: { seq: e.seq, at: e.at, author: "grace" },
}));
let headVersion = 1;

/** `base` with the whole log replayed — the branch's current schema. */
function computeHead(): SchemaDocument {
  const head = clone(BASE);
  for (const { op } of log) applyOne(head, op);
  return head;
}

// ── URL exercises (reads only) ─────────────────────────────────────────────

type Exercise = "empty" | "wide" | null;

function readExercise(): Exercise {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.has("empty")) return "empty";
  if (q.has("wide")) return "wide";
  return null;
}

/** `?nomr` — a diverged branch with no open merge request, so the title strip
 *  shows the "Open merge request" action (E4) instead of "View". */
function noMergeRequest(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("nomr");
}

/** Pad `users` with filler columns and indexes — applied to `base` and `head`
 *  identically so it never introduces divergence, only width. */
function widen(doc: SchemaDocument): SchemaDocument {
  const out = clone(doc);
  const users = out.tables.find((t) => t.id === seedIds.users.table);
  if (!users) return out;
  for (let i = 0; i < 26; i++) {
    const n = String(i + 1).padStart(2, "0");
    users.columns.push({
      id: `col_users_fill_${n}`,
      name: `attribute_${n}`,
      type: i % 3 === 0 ? { kind: "text" } : { kind: "varchar", n: 64 },
      nullable: i % 2 === 0,
      default: null,
    });
  }
  for (let i = 0; i < 11; i++) {
    const n = String(i + 1).padStart(2, "0");
    users.indexes.push({
      id: `idx_users_fill_${n}`,
      name: `users_attribute_${n}_idx`,
      columnIds: [`col_users_fill_${n}`],
      unique: false,
    });
  }
  return out;
}

// ── reads ─────────────────────────────────────────────────────────────────

export async function getBranchDetail(name: string): Promise<BranchDetail> {
  if (name === "main") {
    return {
      name: "main",
      author: "grace",
      cutOn: "2026-02-08",
      head: clone(BASE),
      base: clone(BASE),
      divergence: 0,
    };
  }
  if (name !== "contact-fields") throw new BranchNotFoundError(name);

  const exercise = readExercise();
  if (exercise === "empty") {
    return {
      name: "contact-fields",
      author: "grace",
      cutOn: "2026-02-10",
      head: clone(BASE),
      base: clone(BASE),
      divergence: 0,
    };
  }

  const head = computeHead();
  const base = clone(BASE);
  const divergence = log.length;
  const openMergeId =
    divergence === 0 || noMergeRequest()
      ? undefined
      : listOpen().find((m) => m.source === "contact-fields")?.id;
  return {
    name: "contact-fields",
    author: "grace",
    cutOn: "2026-02-10",
    head: exercise === "wide" ? widen(head) : head,
    base: exercise === "wide" ? widen(base) : base,
    divergence,
    ...(openMergeId ? { openMergeId } : {}),
  };
}

export async function listBranchOperations(
  name: string,
): Promise<BranchOperationEntry[]> {
  if (name === "main") return [];
  if (name !== "contact-fields") throw new BranchNotFoundError(name);
  if (readExercise() === "empty") return [];
  return log.map(({ op, meta }) => ({ ...meta, op }));
}

// ── writes ────────────────────────────────────────────────────────────────

export async function applyOperations(
  name: string,
  ops: Operation[],
): Promise<ApplyOpsResult> {
  if (name !== "contact-fields") throw new BranchNotFoundError(name);

  // build the new head in a local; commit the log only if every op applies
  let working = computeHead();
  for (const op of ops) {
    working = applyOperation(working, op).head; // throws OperationBlockedError
  }

  const startSeq = log.length + 1;
  const at = new Date().toISOString();
  const appliedSeqs: number[] = [];
  ops.forEach((op, i) => {
    const seq = startSeq + i;
    log.push({ op, meta: { seq, at, author: "grace" } });
    appliedSeqs.push(seq);
  });
  headVersion += 1;
  invalidateData();
  return { head: working, appliedSeqs, headVersion };
}

export async function undoAfter(
  name: string,
  seq: number,
): Promise<{ head: SchemaDocument; headVersion: number }> {
  if (name !== "contact-fields") throw new BranchNotFoundError(name);
  log = log.filter((e) => e.meta.seq <= seq);
  headVersion += 1;
  invalidateData();
  return { head: computeHead(), headVersion };
}

export async function createMergeRequest(
  name: string,
): Promise<{ id: string; status: "open" | "queued" | "held" | "merged" }> {
  if (name !== "contact-fields") throw new BranchNotFoundError(name);
  // the fixture queue always has room, so a new request opens active
  return { id: createFor(name, log.length).id, status: "open" };
}

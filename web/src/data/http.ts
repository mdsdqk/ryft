/**
 * The real data source: `DataSource` over the Hono API (`docs/backend-contract.md`).
 * Swapped in by `./index.ts`. Surfaces never import this directly.
 *
 * Every call is a relative `/api/...` path — same-origin in production via the
 * `vercel.json` rewrite, bridged to `:8787` in dev by the Vite proxy
 * (`web/vite.config.ts`). Identity is the bare `x-ryft-user` header, read from
 * the session store; there is no token and no cookie.
 */

import type { SchemaDocument } from "@engine/schema.js";
import type { Operation } from "@engine/operations.js";
import { OperationBlockedError } from "@engine/apply-operation.js";
import type { OpError } from "@engine/validate.js";

import { currentUsername } from "../session/session.ts";
import { BranchHeldError, heldByMergeMessage } from "./branches.ts";
import { BranchNotFoundError } from "./branchSchema.ts";
import type { DataSource } from "./source.ts";
import type { BranchSummary, MergeSummary, Overview } from "./types.ts";
import { invalidateData } from "./watch.ts";

/** A non-2xx response, carrying the parsed `{ error }` body for callers to map. */
export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  readonly body: { error?: string } & Record<string, unknown>;

  constructor(status: number, body: ApiError["body"]) {
    super(body.error ?? `request failed (${status})`);
    this.status = status;
    this.body = body;
  }
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-ryft-user": currentUsername() ?? "",
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res
      .json()
      .catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(res.status, body as ApiError["body"]);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * In-flight GETs are shared: two components mounting on the same screen (the
 * rail and a surface both read `/overview`), or React re-invoking an effect,
 * collapse to one network call. Cleared on settle, so a failure is retried and
 * the next call is fresh. Only GET — mutations must never share.
 */
const inflight = new Map<string, Promise<unknown>>();

function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return send<T>(path, init);

  const key = `${currentUsername() ?? ""} ${path}`;
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const pending = send<T>(path, init).finally(() => inflight.delete(key));
  inflight.set(key, pending);
  return pending;
}

/** `POST /api/branches` / `GET /api/branches/:name` — the fields we project from. */
type BranchDetail = {
  name: string;
  author: string;
  cutOn: string;
  divergence: number;
  openMergeRequestId: string | null;
};

function toBranchSummary(detail: BranchDetail): BranchSummary {
  return {
    name: detail.name,
    author: detail.author,
    cutOn: detail.cutOn,
    divergence: detail.divergence,
    openMergeId: detail.openMergeRequestId ?? undefined,
  };
}

export const httpSource: DataSource = {
  getOverview: () => request<Overview>("/overview"),

  listBranches: () => request<BranchSummary[]>("/branches"),

  listMerges: () => request<MergeSummary[]>("/merge-requests"),

  async createBranch(args) {
    let detail: BranchDetail;
    try {
      detail = await request<BranchDetail>("/branches", {
        method: "POST",
        body: JSON.stringify({ name: args.name }),
      });
    } catch (err) {
      // The create plate renders `err.message` verbatim; the API's messages
      // ('branch "x" already exists', 'main is the trunk', the identifier rule)
      // are already written for that slot.
      if (err instanceof ApiError) throw new Error(err.message);
      throw err;
    }
    invalidateData();
    return toBranchSummary(detail);
  },

  async deleteBranch(name) {
    try {
      await request<{ ok: true }>(`/branches/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.body.error === "blocked-by-merge-request") {
          throw new BranchHeldError(heldByMergeMessage(name, "main"));
        }
        throw new Error(err.message);
      }
      throw err;
    }
    invalidateData();
  },

  async getBranchDetail(name) {
    let detail: BranchDetailBody;
    try {
      detail = await request<BranchDetailBody>(
        `/branches/${encodeURIComponent(name)}`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new BranchNotFoundError(name);
      }
      if (err instanceof ApiError) throw new Error(err.message);
      throw err;
    }
    return {
      name: detail.name,
      author: detail.author,
      cutOn: detail.cutOn,
      head: detail.head,
      base: detail.base,
      divergence: detail.divergence,
      ...(detail.openMergeRequestId
        ? { openMergeId: detail.openMergeRequestId }
        : {}),
    };
  },

  async listBranchOperations(name) {
    let log: LogEntryBody[];
    try {
      log = await request<LogEntryBody[]>(
        `/branches/${encodeURIComponent(name)}/operations`,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new BranchNotFoundError(name);
      }
      if (err instanceof ApiError) throw new Error(err.message);
      throw err;
    }
    // The endpoint returns raw `LogEntry` with a bare `authorId`; a display
    // name resolver is not on the seam yet (E2). Until it is, surface the id —
    // the fixture path, which dev and screenshots use, resolves it properly.
    return log
      .filter((e): e is LogEntryBody & { op: Operation } => e.op.type !== "merge")
      .map((e) => ({ seq: e.seq, at: e.at, author: e.authorId, op: e.op }));
  },

  async applyOperations(name, ops) {
    try {
      return await request<{
        head: SchemaDocument;
        appliedSeqs: number[];
        headVersion: number;
      }>(`/branches/${encodeURIComponent(name)}/operations`, {
        method: "POST",
        body: JSON.stringify({ ops }),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new BranchNotFoundError(name);
      }
      if (err instanceof ApiError && err.status === 422) {
        // ADR 0004 §8 body — a precondition failure. Rebuild the engine's error
        // so the editor's `OperationBlockedError` handling is source-agnostic.
        const body = err.body as { error?: string; dependents?: OpError["dependents"] };
        const opError: OpError = {
          reason: body.dependents ? "drop-blocked" : "target-not-found",
          message: body.error ?? "The edit was refused.",
          ...(body.dependents ? { dependents: body.dependents } : {}),
        };
        throw new OperationBlockedError(opError, ops[0]!);
      }
      if (err instanceof ApiError) throw new Error(err.message);
      throw err;
    } finally {
      invalidateData();
    }
  },

  async undoAfter(name, seq) {
    try {
      return await request<{ head: SchemaDocument; headVersion: number }>(
        `/branches/${encodeURIComponent(name)}/operations?after=${seq}`,
        { method: "DELETE" },
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new BranchNotFoundError(name);
      }
      if (err instanceof ApiError) throw new Error(err.message);
      throw err;
    } finally {
      invalidateData();
    }
  },

  async createMergeRequest(source) {
    try {
      const res = await request<{ id: string; queue: { status: "open" | "queued" | "held" | "merged" } }>(
        "/merge-requests",
        { method: "POST", body: JSON.stringify({ source }) },
      );
      invalidateData();
      return { id: res.id, status: res.queue.status };
    } catch (err) {
      // 409 — a non-terminal request already has this source. Recover its id
      // from the body so the caller can navigate to it rather than surface an
      // error the UI is designed never to show.
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { id?: string; mergeRequestId?: string };
        const id = body.id ?? body.mergeRequestId;
        if (id) {
          invalidateData();
          return { id, status: "open" as const };
        }
      }
      if (err instanceof ApiError) throw new Error(err.message);
      throw err;
    }
  },
};

/** `GET /branches/:name` — the two raw documents plus resolved domain facts. */
type BranchDetailBody = {
  name: string;
  author: string;
  cutOn: string;
  head: SchemaDocument;
  base: SchemaDocument;
  divergence: number;
  openMergeRequestId: string | null;
};

/** `GET /branches/:name/operations` — one row of the branch log. */
type LogEntryBody = {
  seq: number;
  at: string;
  authorId: string;
  op: Operation | { type: "merge" };
};

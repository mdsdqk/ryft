/**
 * The real data source: `DataSource` over the Hono API (`docs/backend-contract.md`).
 * Swapped in by `./index.ts`. Surfaces never import this directly.
 *
 * Every call is a relative `/api/...` path — same-origin in production via the
 * `vercel.json` rewrite, bridged to `:8787` in dev by the Vite proxy
 * (`web/vite.config.ts`). Identity is the bare `x-ryft-user` header, read from
 * the session store; there is no token and no cookie.
 */

import { currentUsername } from "../session/session.ts";
import { BranchHeldError, heldByMergeMessage } from "./branches.ts";
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
};

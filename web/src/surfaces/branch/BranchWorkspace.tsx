/**
 * Branch workspace — `/branch/:name`.
 *
 * THESIS: a branch is a live schema document you read the way you read code —
 * table cards, three object groups each, the branch's edits marked in place and
 * logged beside them. Not a migration file, not a form. E1 is the read-only
 * Schema sub-sheet and the operation list; the in-card structured editor (E2)
 * and the Divergence sub-sheet (E3) build on this.
 *
 * OWN-WORLD: the drafting-room sheet. Cards are `1.5px --ink` frames, square,
 * with a title strip carrying the stable id. Rows are hairline-divided mono
 * with tnum; a changed row carries the `△N` revision mark in `--ours` and a
 * faint wash, never colour alone. Two-column body — cards, then the operation
 * timeline on a `--sheet-2` rail — collapses to one column below 1100px.
 *
 * STATES: loading · error · a branch that does not exist (`BranchNotFoundError`
 * → a way back to /branches, not a retry) · an unchanged branch (`?empty`) · a
 * wide table (`?wide`). The contextual merge-request action reads "View merge
 * request" when one is open; the "open" path is E4.
 *
 * FORM: revision sheet, established world, code-led V0 (no motion).
 */

import { useState } from "react";

import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import {
  BranchNotFoundError,
  source,
  useResource,
  type BranchDetail,
} from "../../data/index.ts";
import {
  EmptyState,
  Loading,
  SurfaceSheet,
} from "../kit/index.ts";
import { formatDate } from "../../dates.ts";
import { Divergence } from "./Divergence.tsx";
import { SchemaView } from "./SchemaView.tsx";

import "./branch.css";

/** URL-driven exercises the surface owns; `?empty` / `?wide` live in the seam. */
function readExercise(): "error" | "loading" | null {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  if (q.has("error")) return "error";
  if (q.has("loading")) return "loading";
  return null;
}

export function BranchWorkspace() {
  const { name = "" } = useParams();
  const [params] = useSearchParams();
  const sheet = params.get("sheet") ?? "schema";
  const exercise = readExercise();

  const { data, loading, error, reload } = useResource(
    () =>
      Promise.all([
        source.getBranchDetail(name),
        source.listBranchOperations(name),
      ]).then(([detail, operations]) => ({ detail, operations })),
    [name],
  );

  if (exercise === "loading" || (loading && !data)) {
    return (
      <SurfaceSheet title={name || "Branch"}>
        <Loading label={`Loading ${name}…`} />
      </SurfaceSheet>
    );
  }

  if (exercise === "error" || error || !data) {
    const missing = error instanceof BranchNotFoundError;
    return (
      <SurfaceSheet title={name || "Branch"}>
        <EmptyState
          tone="error"
          title={missing ? "No such branch" : "Could not load this branch"}
          action={
            missing ? (
              <Link className="mr-btn" to="/branches">
                All branches
              </Link>
            ) : (
              <button className="mr-btn mr-btn--primary" onClick={reload}>
                Try again
              </button>
            )
          }
        >
          {missing
            ? `No branch named ${name}. It may have been deleted or merged.`
            : "The branch did not load. Try again."}
        </EmptyState>
      </SurfaceSheet>
    );
  }

  const { detail, operations } = data;
  const isTrunk = detail.name === "main";
  const changes =
    detail.divergence === 0
      ? "no changes"
      : `${detail.divergence.toLocaleString()} operation${detail.divergence === 1 ? "" : "s"}`;
  const subtitle = isTrunk
    ? `the trunk · schema of record · last changed ${formatDate(detail.cutOn)}`
    : `branched from main · ${detail.author} · ${formatDate(detail.cutOn)} · ${changes}`;

  const showAction = !isTrunk && detail.divergence > 0;

  return (
    <SurfaceSheet
      title={detail.name}
      subtitle={subtitle}
      action={showAction ? <MergeRequestAction detail={detail} /> : undefined}
    >
      {sheet === "divergence" ? (
        <Divergence detail={detail} />
      ) : (
        <SchemaView
          name={detail.name}
          head={detail.head}
          operations={operations}
          reload={reload}
        />
      )}
    </SurfaceSheet>
  );
}

/**
 * The contextual merge-request action for the title strip (grill Q16). Three
 * states, driven by data already fetched: absent when the branch has no
 * divergence; "View merge request" when one is open; "Open merge request" — a
 * `POST` then a jump to the review — otherwise. The `POST` is idempotent, so a
 * `409` is never surfaced.
 */
function MergeRequestAction({ detail }: { detail: BranchDetail }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (detail.name === "main" || detail.divergence === 0) return null;

  if (detail.openMergeId) {
    return (
      <Link
        className="mr-btn"
        to={`/merge/${detail.openMergeId}`}
      >
        View merge request
      </Link>
    );
  }

  const open = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { number } = await source.createMergeRequest(detail.name);
      navigate(`/merge/${number}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not open the merge request.");
      setBusy(false);
    }
  };

  return (
    <div className="bw-mraction">
      <button
        className="mr-btn mr-btn--primary"
        type="button"
        disabled={busy}
        onClick={() => void open()}
      >
        {busy ? "Opening…" : "Open merge request"}
      </button>
      {err && (
        <p className="bw-mraction__err" role="alert">
          {err}
        </p>
      )}
    </div>
  );
}

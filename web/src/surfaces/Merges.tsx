/**
 * Merge requests list — `/merges`.
 *
 * THESIS: a merge queue of open requests, oldest first — not a GitHub PR
 * list, not an activity feed. Refuses badges, avatars, relative time, a
 * create action, and any commit spine.
 *
 * OWN-WORLD: the drafting-room sheet. Hairline rows, dashed --line, mono data
 * with tnum. `source → main` is plain text. Status is a 9px dot plus the word
 * (Clean / Held · N / Stale base / Queued · #N), never colour alone.
 *
 * STORY: see every open request; enter one to review it. Opening a request
 * lives on the branch workspace. Empty keeps the sheet and points at
 * /branches with the first-run copy. A second view — Closed — is the record of
 * requests withdrawn without merging (ADR 0012 §3); the queue stays the default.
 *
 * FIRST VIEWPORT: title strip "Merge requests" + queue count + an Open / Closed
 * pair. No right-cell action. Body: oldest row first, source → main opens
 * /merge/:id, author · opened date, StatusPill. Primary action is the row itself.
 *
 * FORM: revision sheet, established world, code-led V0 (no motion). Consumes
 * the list pattern from /branches; does not define one.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, DESIGN.md, and every shipping raster carrying its
 * provenance.
 */

import {
  mergeStatusLabel,
  mergeStatusTone,
  source,
  useResource,
  type MergeSummary,
} from "../data/index.ts";
import { Link, useSearchParams } from "react-router";
import {
  EmptyState,
  Loading,
  Row,
  SheetList,
  StatusPill,
  SurfaceBody,
  SurfaceSheet,
} from "./kit/index.ts";

import "./Merges.css";

/** V0 exercise: a name longer than the create-field max, as a real API might return. */
const LONG_SOURCE =
  "contact-fields-and-then-a-very-long-working-branch-name-that-must-wrap";

const QUEUE_ERROR =
  "The server returned 503 while fetching the merge queue. This is usually transient.";

type ListState = "open" | "closed";

function countLine(n: number, state: ListState): string {
  if (state === "closed") {
    if (n === 0) return "no closed merge requests";
    if (n === 1) return "1 closed · most recently closed first";
    return `${n.toLocaleString()} closed · most recently closed first`;
  }
  if (n === 0) return "no open merge requests";
  if (n === 1) return "1 in the queue · oldest first";
  return `${n.toLocaleString()} in the queue · oldest first`;
}

/**
 * Open / Closed. Two links, not two buttons: the view is in the URL
 * (`/merges?state=closed`), so it is shareable and the back button works.
 */
function StateTabs({ state }: { state: ListState }) {
  return (
    <div className="mg-tabs" role="group" aria-label="Which merge requests">
      <Link className="mr-chip" to="/merges" aria-current={state === "open" ? "page" : undefined}>
        Open
      </Link>
      <Link
        className="mr-chip"
        to="/merges?state=closed"
        aria-current={state === "closed" ? "page" : undefined}
      >
        Closed
      </Link>
    </div>
  );
}

function arrowLabel(merge: MergeSummary): string {
  const from = merge.source.trim() || "unnamed";
  const to = merge.target.trim() || "main";
  return `${from} → ${to}`;
}

function metaLine(merge: MergeSummary): string {
  const author = merge.author.trim();
  const opened = merge.openedOn.trim();
  // a closed row is read for its outcome, so the closing date leads the meta
  const closed = merge.closedOn?.trim();
  if (closed) {
    return author ? `${author} · closed ${closed} · opened ${opened || "unknown"}` : `closed ${closed}`;
  }
  if (author && opened) return `${author} · opened ${opened}`;
  if (author) return author;
  if (opened) return `opened ${opened}`;
  return "opened date unknown";
}

function withLongName(rows: readonly MergeSummary[]): MergeSummary[] {
  const first = rows[0];
  if (!first) return [...rows];
  return [{ ...first, source: LONG_SOURCE }, ...rows.slice(1)];
}

export function Merges() {
  const [params] = useSearchParams();
  const forceEmpty = params.has("empty");
  const forceError = params.has("error");
  const forceLoading = params.has("loading");
  const forceLong = params.has("long");
  const state: ListState = params.get("state") === "closed" ? "closed" : "open";

  const { data, loading, error, reload } = useResource(
    () =>
      forceError
        ? Promise.reject(new Error(QUEUE_ERROR))
        : source.listMerges(state),
    [forceError, state],
  );

  if (forceLoading || (loading && !data)) {
    return (
      <div className="mg" aria-busy="true">
        <SurfaceSheet title="Merge requests" action={<StateTabs state={state} />}>
          <Loading label="Loading merge requests…" />
        </SurfaceSheet>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mg">
        <SurfaceSheet title="Merge requests" action={<StateTabs state={state} />}>
          <EmptyState
            tone="error"
            title="Could not load merge requests"
            action={
              <button className="mr-btn mr-btn--primary" onClick={reload}>
                Try again
              </button>
            }
          >
            {error?.message ?? "The merge queue request returned nothing."}
          </EmptyState>
        </SurfaceSheet>
      </div>
    );
  }

  const rows = forceEmpty ? [] : forceLong ? withLongName(data) : data;
  const empty = rows.length === 0;

  return (
    <div className="mg">
      <SurfaceSheet
        title="Merge requests"
        subtitle={countLine(rows.length, state)}
        action={<StateTabs state={state} />}
      >
        {empty ? (
          state === "closed" ? (
            <EmptyState
              title="No closed merge requests."
              action={
                <Link className="mr-btn" to="/merges">
                  View the queue
                </Link>
              }
            >
              A request closed without merging is kept here.
            </EmptyState>
          ) : (
            <EmptyState
              title="No open merge requests."
              action={
                <Link className="mr-btn" to="/branches">
                  View branches
                </Link>
              }
            >
              Open one from a branch that has diverged from <code>main</code>.
            </EmptyState>
          )
        ) : (
          <SurfaceBody>
            <SheetList label={state === "closed" ? "Closed merge requests" : "Open merge requests"}>
              {rows.map((merge) => (
                <Row
                  key={merge.id}
                  to={`/merge/${encodeURIComponent(merge.id)}`}
                  primary={arrowLabel(merge)}
                  meta={metaLine(merge)}
                  trailing={
                    <StatusPill tone={mergeStatusTone(merge)}>
                      {mergeStatusLabel(merge)}
                    </StatusPill>
                  }
                />
              ))}
            </SheetList>
          </SurfaceBody>
        )}
      </SurfaceSheet>
    </div>
  );
}

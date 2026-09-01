/**
 * Merge requests list — `/merges`.
 *
 * THESIS: a merge queue of open requests, oldest first — not a GitHub PR
 * list, not an activity feed. Refuses badges, avatars, relative time, a
 * create action, and any commit spine.
 *
 * OWN-WORLD: the drafting-room sheet. Hairline rows, dashed --line, mono data
 * with tnum. `source → main` is plain text. Status is a 9px dot plus the word
 * (Clean / Held · N / Stale base), never colour alone.
 *
 * STORY: see every open request; enter one to review it. Opening a request
 * lives on the branch workspace. Empty keeps the sheet and points at
 * /branches with the first-run copy.
 *
 * FIRST VIEWPORT: title strip "Merges" + demonstration tag + queue count.
 * No right-cell action. Body: oldest row first, source → main opens
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

function countLine(n: number): string {
  if (n === 0) return "no open merge requests";
  if (n === 1) return "1 in the queue · oldest first";
  return `${n.toLocaleString()} in the queue · oldest first`;
}

function arrowLabel(merge: MergeSummary): string {
  const from = merge.source.trim() || "unnamed";
  const to = merge.target.trim() || "main";
  return `${from} → ${to}`;
}

function metaLine(merge: MergeSummary): string {
  const author = merge.author.trim();
  const opened = merge.openedOn.trim();
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

  const { data, loading, error, reload } = useResource(
    () =>
      forceError
        ? Promise.reject(new Error(QUEUE_ERROR))
        : source.listMerges(),
    [forceError],
  );

  if (forceLoading || (loading && !data)) {
    return (
      <div className="mg" aria-busy="true">
        <SurfaceSheet title="Merges">
          <Loading label="Loading merge requests…" />
        </SurfaceSheet>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mg">
        <SurfaceSheet title="Merges">
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
      <SurfaceSheet title="Merges" demo subtitle={countLine(rows.length)}>
        {empty ? (
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
        ) : (
          <SurfaceBody>
            <p className="mg-demo-note">
              Demonstration queue — every row opens the same worked sample review
              until fetch-by-id lands with the API.
            </p>
            <SheetList label="Open merge requests">
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

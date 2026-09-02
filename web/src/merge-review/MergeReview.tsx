import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ColumnType } from "@engine/schema.js";

import { MergeRevalidationError, source } from "../data/index.ts";
import type { MergeReview as MergeReviewModel } from "./model.ts";
import { effectiveStatus, isMergeable, openConflicts } from "./model.ts";
import { statusLabel } from "./format.ts";

import { ComparisonTable } from "./components/ComparisonTable.tsx";
import { ConflictQueue } from "./components/ConflictQueue.tsx";
import { FabricationOrder } from "./components/FabricationOrder.tsx";
import { OperationLog } from "./components/OperationLog.tsx";
import { RevisionDial } from "./components/RevisionDial.tsx";
import { TitleBlock } from "./components/TitleBlock.tsx";

const FILTER_ID = "mr-filter-changes";
const ZONE_IDS = { a: "mr-zone-a", b: "mr-zone-b", c: "mr-zone-c", d: "mr-zone-d" } as const;

function seedResolutions(review: MergeReviewModel): Record<string, string> {
  return Object.fromEntries(
    review.conflicts
      .filter((c) => c.resolvedWith !== null)
      .map((c) => [c.id, c.resolvedWith as string]),
  );
}

/** A queue option id → the API's resolution `choice`. `"custom"` needs a type. */
function choiceFor(optionId: string, type?: ColumnType): "ours" | "theirs" | "type" | null {
  if (optionId === "ours") return "ours";
  if (optionId === "theirs") return "theirs";
  if (optionId === "custom" && type) return "type";
  return null;
}

export function MergeReview({ base, mergeId }: { base: MergeReviewModel; mergeId?: string }) {
  // the last server-backed review; `base` is the route's fetch, mutations
  // replace this immediately so Zone D's DDL updates without a full remount
  const [live, setLive] = useState(base);
  const [resolutions, setResolutions] = useState(() => seedResolutions(base));
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);
  const [pickingTypeFor, setPickingTypeFor] = useState<string | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);

  useEffect(() => {
    setLive(base);
    setResolutions(seedResolutions(base));
    setPickingTypeFor(null);
    setReleaseError(null);
  }, [base]);

  // fold the working resolutions back into the model the whole screen renders from
  const review = useMemo<MergeReviewModel>(() => {
    const conflicts = live.conflicts.map((c) => ({
      ...c,
      resolvedWith: resolutions[c.id] ?? null,
    }));
    const rows = live.rows.map((r) => {
      const res = r.resolution;
      if (res.state !== "conflict") return r;
      const pick = resolutions[res.conflictId];
      if (!pick) return r;
      const opt = live.conflicts
        .find((c) => c.id === res.conflictId)
        ?.options.find((o) => o.id === pick);
      return {
        ...r,
        resolution: {
          state: "auto-merged" as const,
          note: `resolved — ${opt?.label ?? pick}`,
        },
      };
    });
    const allResolved = conflicts.every((c) => c.resolvedWith !== null);
    const commutativity: MergeReviewModel["commutativity"] =
      live.commutativity === "failed" && allResolved
        ? "failed"
        : allResolved
          ? "passed"
          : "pending";
    return { ...live, conflicts, rows, commutativity };
  }, [live, resolutions]);

  const open = openConflicts(review);
  const rebased = review.rows.filter((r) => r.leader?.tone === "ok").length;
  const released = review.status === "released";
  // Release is gated on the *server* review, not the optimistic overlay — a
  // local pick that hasn't landed yet would 409 the merge transaction. Only the
  // MR at the front of the queue is mergeable: `fromResponse` maps `open`/`held`
  // → "in-check", `queued` → "received", `merged` → "released".
  const canRelease = Boolean(mergeId) && live.status === "in-check" && isMergeable(live);

  const activeConflictId = useMemo(() => {
    const picked = review.conflicts.find((c) => c.id === selectedConflictId);
    if (picked && picked.resolvedWith === null) return picked.id;
    const firstOpen = review.conflicts.find((c) => c.resolvedWith === null);
    return firstOpen?.id ?? picked?.id ?? review.conflicts[0]?.id ?? "";
  }, [review.conflicts, selectedConflictId]);

  const adopt = useCallback((next: MergeReviewModel) => {
    setLive(next);
    setResolutions(seedResolutions(next));
  }, []);

  const resolve = useCallback(
    (conflictId: string, optionId: string, type?: ColumnType) => {
      if (released) return;
      if (optionId === "custom" && !type) {
        setPickingTypeFor(conflictId);
        setSelectedConflictId(conflictId);
        return;
      }
      setPickingTypeFor(null);
      setResolutions((prev) => ({ ...prev, [conflictId]: optionId }));
      setSelectedConflictId(null);
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".mr-queue__list")?.focus(),
      );

      const choice = mergeId ? choiceFor(optionId, type) : null;
      if (!choice || !mergeId) return;
      source.postResolution(mergeId, conflictId, choice, type).then(adopt, () => {
        setResolutions((prev) => {
          const next = { ...prev };
          delete next[conflictId];
          return next;
        });
      });
    },
    [adopt, mergeId, released],
  );

  const reopen = useCallback(
    (conflictId: string) => {
      if (released) return;
      setResolutions((prev) => {
        const next = { ...prev };
        delete next[conflictId];
        return next;
      });
      setSelectedConflictId(conflictId);
      setPickingTypeFor(null);

      if (!mergeId) return;
      source.deleteResolution(mergeId, conflictId).then(adopt, () => {
        /* best-effort — the next full reload reconciles either way */
      });
    },
    [adopt, mergeId, released],
  );

  const release = useCallback(async () => {
    if (!mergeId || releasing) return;
    setReleasing(true);
    setReleaseError(null);
    try {
      await source.mergeMergeRequest(mergeId);
      adopt(await source.getMergeReview(mergeId));
    } catch (err) {
      if (err instanceof MergeRevalidationError) {
        setReleaseError(err.message);
        try {
          adopt(await source.getMergeReview(mergeId));
        } catch {
          /* the error line is enough */
        }
      } else {
        setReleaseError(err instanceof Error ? err.message : "The merge could not be released.");
      }
    } finally {
      setReleasing(false);
    }
  }, [adopt, mergeId, releasing]);

  const move = useCallback(
    (delta: number) => {
      const ids = live.conflicts.map((c) => c.id);
      const i = Math.max(0, ids.indexOf(activeConflictId));
      setSelectedConflictId(ids[(i + delta + ids.length) % ids.length]!);
      requestAnimationFrame(() =>
        document
          .getElementById(ZONE_IDS.b)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    },
    [live.conflicts, activeConflictId],
  );

  const openConflictFromRow = useCallback((conflictId: string) => {
    setSelectedConflictId(conflictId);
    document.getElementById(ZONE_IDS.b)?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById(`mr-cf-${conflictId}`)?.closest<HTMLElement>(".mr-queue__list")?.focus();
  }, []);

  const gPending = useRef(false);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }

      if (gPending.current && /^[abcd]$/i.test(e.key)) {
        gPending.current = false;
        const el = document.getElementById(ZONE_IDS[e.key.toLowerCase() as "a" | "b" | "c" | "d"]);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
        el?.focus();
        e.preventDefault();
        return;
      }
      gPending.current = false;

      if (e.key === "/") {
        document.getElementById(FILTER_ID)?.focus();
        e.preventDefault();
      } else if (e.key === "g" || e.key === "G") {
        gPending.current = true;
        window.setTimeout(() => (gPending.current = false), 900);
      } else if (e.key === "j" || e.key === "J") {
        move(1);
      } else if (e.key === "k" || e.key === "K") {
        move(-1);
      } else if (["1", "2", "3"].includes(e.key) && !released) {
        const c = review.conflicts.find((x) => x.id === activeConflictId);
        if (c && c.resolvedWith === null) {
          const opt = c.options.find((o) => o.hint === e.key);
          if (opt) {
            resolve(c.id, opt.id);
            e.preventDefault();
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, resolve, review.conflicts, activeConflictId, released]);

  const status = effectiveStatus(review);
  const dialDetail = `${review.revisions.length} revisions · ${open.length} ${
    open.length === 1 ? "conflict" : "conflicts"
  } open · ${review.autoMergedCount} auto-merged · commutativity ${review.commutativity}`;

  return (
    <article className="mr-sheet">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">{review.table} — schema merge</h1>
          <p className="mr-titlestrip__path">
            <b className="mr-o">{review.source}</b> → <b className="mr-t">{review.target}</b> · common
            base <code>{review.base}</code>
          </p>
          {!mergeId && (
            <p className="mr-titlestrip__demo">
              Demonstration review — a worked sample, not this merge request's own data
            </p>
          )}
          {review.refreshNote && (
            // The source branch moved after this request opened, and re-running
            // the three-way against its new head un-chose these conflicts
            // (ADR 0012 §2). Advisory: the screen stays usable, the choices are
            // simply open again.
            <div className="mr-titlestrip__refresh" role="status">
              <p className="mr-titlestrip__refresh-k">
                {review.source} moved since this request opened —{" "}
                {review.refreshNote.droppedResolutions.length}{" "}
                {review.refreshNote.droppedResolutions.length === 1
                  ? "resolution no longer applies"
                  : "resolutions no longer apply"}
              </p>
              <ul className="mr-titlestrip__refresh-l">
                {review.refreshNote.droppedResolutions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <RevisionDial status={status} detail={dialDetail} />
      </header>

      <div className="mr-grid">
        <div className="mr-main">
          <div id={ZONE_IDS.a} tabIndex={-1} className="mr-zone-anchor">
            <ComparisonTable review={review} filterId={FILTER_ID} onOpenConflict={openConflictFromRow} />
          </div>
          <div id={ZONE_IDS.b} tabIndex={-1} className="mr-zone-anchor">
            <ConflictQueue
              conflicts={review.conflicts}
              activeId={activeConflictId}
              pickingTypeFor={pickingTypeFor}
              readOnly={released}
              onActivate={setSelectedConflictId}
              onResolve={resolve}
              onReopen={reopen}
            />
          </div>
        </div>

        <aside className="mr-rail">
          <div id={ZONE_IDS.c} tabIndex={-1} className="mr-zone-anchor">
            <OperationLog review={review} />
          </div>
          <TitleBlock review={review} unresolved={open.length} rebased={rebased} />
        </aside>
      </div>

      <div id={ZONE_IDS.d} tabIndex={-1} className="mr-zone-anchor">
        <FabricationOrder
          review={review}
          canRelease={canRelease}
          releasing={releasing}
          releaseError={releaseError}
          onRelease={() => void release()}
        />
      </div>

      <p className="mr-vh" aria-live="polite">
        Status: {statusLabel(status)}.
      </p>
    </article>
  );
}

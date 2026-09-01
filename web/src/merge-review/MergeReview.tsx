import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { MergeReview as MergeReviewModel } from "./model.ts";
import { effectiveStatus, openConflicts } from "./model.ts";
import { statusLabel } from "./format.ts";
import { source } from "../data/index.ts";

import { ComparisonTable } from "./components/ComparisonTable.tsx";
import { ConflictQueue } from "./components/ConflictQueue.tsx";
import { FabricationOrder } from "./components/FabricationOrder.tsx";
import { OperationLog } from "./components/OperationLog.tsx";
import { RevisionDial } from "./components/RevisionDial.tsx";
import { TitleBlock } from "./components/TitleBlock.tsx";

const FILTER_ID = "mr-filter-changes";
const ZONE_IDS = { a: "mr-zone-a", b: "mr-zone-b", c: "mr-zone-c", d: "mr-zone-d" } as const;

/** A queue option id → the API's resolution `choice`. `"custom"` has no
 * type-picker UI yet, so it stays a client-only pick — see `resolve()`. */
function choiceFor(optionId: string): "ours" | "theirs" | null {
  if (optionId === "ours") return "ours";
  if (optionId === "theirs") return "theirs";
  return null;
}

export function MergeReview({ base, mergeId }: { base: MergeReviewModel; mergeId?: string }) {
  // seed the working resolutions from any the incoming review already carries
  const [resolutions, setResolutions] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      base.conflicts
        .filter((c) => c.resolvedWith !== null)
        .map((c) => [c.id, c.resolvedWith as string]),
    ),
  );
  // an explicit selection; when it resolves or is empty, the derived active
  // below falls through to the first still-open conflict.
  const [selectedConflictId, setSelectedConflictId] = useState<string | null>(null);

  // fold the working resolutions back into the model the whole screen renders from
  const review = useMemo<MergeReviewModel>(() => {
    const conflicts = base.conflicts.map((c) => ({
      ...c,
      resolvedWith: resolutions[c.id] ?? null,
    }));
    // Zone A rows stop pointing at Zone B once their conflict is settled
    const rows = base.rows.map((r) => {
      const res = r.resolution;
      if (res.state !== "conflict") return r;
      const pick = resolutions[res.conflictId];
      if (!pick) return r;
      const opt = base.conflicts
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
    // a review that arrives already failing keeps failing until its resolutions
    // change; otherwise the check only "passes" once the queue is empty.
    const commutativity: MergeReviewModel["commutativity"] =
      base.commutativity === "failed" && allResolved
        ? "failed"
        : allResolved
          ? "passed"
          : "pending";
    return { ...base, conflicts, rows, commutativity };
  }, [base, resolutions]);

  const open = openConflicts(review);
  const rebased = review.rows.filter((r) => r.leader?.tone === "ok").length;

  // the active conflict: an explicit pick if it is still open, otherwise the
  // first open one, otherwise the explicit pick (all resolved), otherwise the first.
  const activeConflictId = useMemo(() => {
    const picked = review.conflicts.find((c) => c.id === selectedConflictId);
    if (picked && picked.resolvedWith === null) return picked.id;
    const firstOpen = review.conflicts.find((c) => c.resolvedWith === null);
    return firstOpen?.id ?? picked?.id ?? review.conflicts[0]?.id ?? "";
  }, [review.conflicts, selectedConflictId]);

  const resolve = useCallback(
    (conflictId: string, optionId: string) => {
      setResolutions((prev) => ({ ...prev, [conflictId]: optionId }));
      setSelectedConflictId(null); // let the derived active advance to the next open one
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(".mr-queue__list")?.focus(),
      );

      // Persist when this review is backed by a real merge request. `choiceFor`
      // is null for "custom" (no type-picker UI yet) — that pick stays local.
      const choice = mergeId ? choiceFor(optionId) : null;
      if (!choice) return;
      source.postResolution(mergeId!, conflictId, choice).catch(() => {
        // revert the optimistic pick so the screen doesn't claim a resolution
        // the server never recorded
        setResolutions((prev) => {
          const next = { ...prev };
          delete next[conflictId];
          return next;
        });
      });
    },
    [mergeId],
  );

  const reopen = useCallback(
    (conflictId: string) => {
      setResolutions((prev) => {
        const next = { ...prev };
        delete next[conflictId];
        return next;
      });
      setSelectedConflictId(conflictId);

      if (!mergeId) return;
      source.deleteResolution(mergeId, conflictId).catch(() => {
        /* best-effort — the next full reload reconciles either way */
      });
    },
    [mergeId],
  );

  const move = useCallback(
    (delta: number) => {
      const ids = base.conflicts.map((c) => c.id);
      const i = Math.max(0, ids.indexOf(activeConflictId));
      setSelectedConflictId(ids[(i + delta + ids.length) % ids.length]!);
      // bring the queue into view if it isn't — J/K from the top of the sheet
      // should not move an active card the reader cannot see
      requestAnimationFrame(() =>
        document
          .getElementById(ZONE_IDS.b)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" }),
      );
    },
    [base.conflicts, activeConflictId],
  );

  const openConflictFromRow = useCallback((conflictId: string) => {
    setSelectedConflictId(conflictId);
    document.getElementById(ZONE_IDS.b)?.scrollIntoView({ behavior: "smooth", block: "start" });
    document.getElementById(`mr-cf-${conflictId}`)?.closest<HTMLElement>(".mr-queue__list")?.focus();
  }, []);

  // global keyboard: J/K move · 1/2/3 resolve active · / filter · g-then-letter jump
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
      } else if (["1", "2", "3"].includes(e.key)) {
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
  }, [move, resolve, review.conflicts, activeConflictId]);

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
        <FabricationOrder review={review} />
      </div>

      <p className="mr-vh" aria-live="polite">
        Revision status: {statusLabel(status)}.
      </p>
    </article>
  );
}

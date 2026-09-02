import { useEffect, useRef, useState } from "react";

import type { MergeReview } from "../model.ts";
import { effectiveStatus, isMergeable, openConflicts } from "../model.ts";
import { statusLabel } from "../format.ts";

/**
 * Irreversible merge into main — hold 2s on a pointer, or Enter then Enter on
 * the keyboard. A slip click must not fire. The fill lives in CSS (clip-path on
 * ::before; background-color under reduced motion).
 */
function MergeIntoMainButton({
  releasing,
  onRelease,
}: {
  releasing: boolean;
  onRelease: () => void;
}) {
  const [holding, setHolding] = useState(false);
  const [keyed, setKeyed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);

  const stopHold = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setHolding(false);
  };

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (releasing) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setHolding(false);
      setKeyed(false);
    } else {
      firedRef.current = false;
    }
  }, [releasing]);

  const fire = () => {
    if (firedRef.current || releasing) return;
    firedRef.current = true;
    stopHold();
    setKeyed(false);
    onRelease();
  };

  return (
    <button
      className="mr-btn mr-btn--primary mr-fab__release"
      type="button"
      disabled={releasing}
      data-holding={holding ? "true" : undefined}
      data-keyed={keyed ? "true" : undefined}
      aria-label={
        releasing
          ? "Merging"
          : keyed
            ? "Press Enter again to merge into main"
            : "Merge into main. Hold for two seconds, or press Enter twice."
      }
      onPointerDown={(e) => {
        if (e.button !== 0 || releasing) return;
        firedRef.current = false;
        setHolding(true);
        timerRef.current = setTimeout(fire, 2000);
      }}
      onPointerUp={stopHold}
      onPointerLeave={stopHold}
      onPointerCancel={stopHold}
      onClick={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setKeyed(false);
          return;
        }
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        if (releasing) return;
        if (!keyed) {
          setKeyed(true);
          return;
        }
        fire();
      }}
      onBlur={() => setKeyed(false)}
    >
      <span className="mr-fab__release-label">
        {releasing ? "Merging…" : keyed ? "Confirm merge" : "Merge into main"}
      </span>
    </button>
  );
}

/**
 * Zone D — the fabrication order. The ordered, forward-only DDL that comes out of
 * a clean merge, each statement tagged to the revision that produced it. Blocked
 * groups are listed with the reason, including any downstream objects a conflict
 * gates. A status line — not a stamp — says what advances the dial to Reviewed,
 * and the one primary action that turns it to Merged.
 *
 * The zone also carries the way *out*: "Close request" withdraws the request
 * without merging (ADR 0012 §3). It sits next to the merge button as a secondary
 * action because the two are the same decision — this request either lands or it
 * does not — and it is absent once either has happened.
 */
export function FabricationOrder({
  review,
  canRelease = false,
  releasing = false,
  releaseError = null,
  onRelease,
  canClose = false,
  closing = false,
  onClose,
}: {
  review: MergeReview;
  canRelease?: boolean;
  releasing?: boolean;
  releaseError?: string | null;
  onRelease?: () => void;
  canClose?: boolean;
  closing?: boolean;
  onClose?: () => void;
}) {
  const fo = review.fabricationOrder;
  const open = openConflicts(review);
  const mergeable = isMergeable(review);
  const status = effectiveStatus(review);
  const released = status === "released";
  const closed = status === "closed";
  // this request is behind others in the merge queue — it is not reviewed here
  // and cannot merge until it reaches the front, where it is re-checked against
  // main (ADR 0004 §3).
  const queued = review.status === "received";
  const ahead = review.queue?.ahead ?? 0;
  // commutativity failed while nothing is left in the queue — an order-dependent
  // divergence that is not one of the named conflict classes.
  const unclassified = open.length === 0 && review.commutativity === "failed";
  const destructive = fo.statements.filter((s) => s.destructive).length;

  return (
    <section className="mr-zone mr-fab" aria-labelledby="mr-fab-h">
      <header className="mr-fab__head">
        <h2 className="mr-zone__k" id="mr-fab-h">
          <span className="mr-zone__n">D</span> Fabrication order — DDL
        </h2>
        <span className="mr-fab__meta">
          {fo.statements.length} statements · {mergeable ? 0 : fo.blocked.length} blocked ·{" "}
          {destructive > 0 && <span className="mr-fab__meta-warn">{destructive} destructive · </span>}
          forward-only · one transaction
        </span>
      </header>

      <pre className="mr-fab__sql" tabIndex={0} aria-label="Generated DDL, scrollable">
        <code>
          <span className="mr-sql-ok">BEGIN;</span>
          {"\n"}
          {fo.statements.map((s, i) => (
            <span key={i} className={s.destructive ? "mr-sql-destructive" : undefined}>
              {s.sql}
              {(s.revision !== null || s.destructive) && (
                <span className={`mr-sql-tag mr-sql-tag--${s.side ?? "none"}`}>
                  {"  "}--
                  {s.revision !== null ? ` △${s.revision}` : ""}
                  {s.rebased ? ", rebased" : ""}
                  {s.destructive ? `${s.revision !== null || s.rebased ? "," : ""} destructive` : ""}
                </span>
              )}
              {"\n"}
            </span>
          ))}
          {!mergeable &&
            !unclassified &&
            fo.blocked.map((b) => (
              <span key={b.conflictId} className="mr-sql-blocked">
                -- {b.reason}
                {"\n"}
              </span>
            ))}
          {unclassified && (
            <span className="mr-sql-blocked">
              -- blocked: the two application orders disagree (unclassified divergence)
              {"\n"}
            </span>
          )}
          {mergeable && fo.statements.length === 0 && (
            <span className="mr-sql-ok">
              -- this branch has not diverged; the migration is empty
              {"\n"}
            </span>
          )}
          {mergeable && fo.statements.length > 0 && review.conflicts.length > 0 && (
            <span className="mr-sql-ok">
              -- {review.conflicts.length} {review.conflicts.length === 1 ? "conflict" : "conflicts"}{" "}
              resolved; the chosen statements fold in here
              {"\n"}
            </span>
          )}
          <span className="mr-sql-ok">COMMIT;</span>
        </code>
      </pre>

      <div className="mr-fab__foot">
        <p
          className="mr-fab__status"
          data-mergeable={mergeable}
          data-unclassified={unclassified}
          data-released={released}
          data-queued={queued}
          data-closed={closed}
        >
          <span className="mr-fab__dot" aria-hidden="true" />
          {closed ? (
            <>
              <b>Closed</b> — this request was withdrawn without merging.{" "}
              <code>{review.target}</code> is unchanged, and the branch is still there to
              open a new request from.
            </>
          ) : released ? (
            <>
              <b>Merged</b> — <code>main</code> now holds this schema.
            </>
          ) : queued ? (
            <>
              <b>Queued</b> —{" "}
              {ahead > 0
                ? `${ahead} request${ahead === 1 ? "" : "s"} ahead in the merge queue`
                : "waiting for the merge queue"}
              . It is re-checked against <code>main</code> and reviewed here once it
              reaches the front.
            </>
          ) : mergeable ? (
            <>
              <b>Reviewed</b> — the queue is empty and applying each side's delta to base in either
              order agrees. Ready to merge into <code>main</code>.
            </>
          ) : unclassified ? (
            <>
              <b>Held — unclassified divergence.</b> Every conflict is resolved, but replaying the two
              deltas against base in the two orders produces different schemas. The engine will not
              merge a result it cannot prove stable.
              <span className="mr-fab__adv"> Re-open the resolutions and adjust, or escalate.</span>
            </>
          ) : (
            <>
              <b>Held</b> — {open.length} unresolved {open.length === 1 ? "conflict" : "conflicts"},{" "}
              {fo.statements.length} {fo.statements.length === 1 ? "statement" : "statements"} staged.
              <span className="mr-fab__adv">
                {" "}
                Advances to <b>Reviewed</b> when the queue is empty and the commutativity check
                passes. Currently: {review.commutativity}.
              </span>
            </>
          )}
          <span className="mr-vh"> Current status: {statusLabel(status)}.</span>
        </p>
        {(queued || canRelease || canClose) && (
          <div className="mr-fab__actions">
            {queued && (
              <p className="mr-fab__queued">
                Queued · position #{review.queue?.position ?? "—"}
                {ahead > 0 && (
                  <>
                    {" "}
                    · blocked by {ahead} ahead
                  </>
                )}
              </p>
            )}
            {/* the way out, offered wherever the request is still live — a
             * queued request is exactly the one you most want to withdraw */}
            {canClose && onClose && (
              <button className="mr-btn mr-fab__close" type="button" disabled={closing} onClick={onClose}>
                {closing ? "Closing…" : "Close request"}
              </button>
            )}
            {!queued && canRelease && onRelease && (
              <MergeIntoMainButton releasing={releasing} onRelease={onRelease} />
            )}
          </div>
        )}
      </div>
      {releaseError && (
        <p className="mr-fab__err" role="alert">
          {releaseError}
        </p>
      )}
    </section>
  );
}

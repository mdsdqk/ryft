import type { MergeReview } from "../model.ts";
import { effectiveStatus, isMergeable, openConflicts } from "../model.ts";

/**
 * Zone D — the fabrication order. The ordered, forward-only DDL that comes out of
 * a clean merge, each statement tagged to the revision that produced it. Blocked
 * groups are listed with the reason, including any downstream objects a conflict
 * gates. A status line — not a stamp — says what advances the dial to Cleared,
 * and the one primary action that turns it to Released.
 */
export function FabricationOrder({
  review,
  canRelease = false,
  releasing = false,
  releaseError = null,
  onRelease,
}: {
  review: MergeReview;
  canRelease?: boolean;
  releasing?: boolean;
  releaseError?: string | null;
  onRelease?: () => void;
}) {
  const fo = review.fabricationOrder;
  const open = openConflicts(review);
  const mergeable = isMergeable(review);
  const status = effectiveStatus(review);
  const released = status === "released";
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
        >
          <span className="mr-fab__dot" aria-hidden="true" />
          {released ? (
            <>
              <b>Released</b> — signed off. <code>main</code> now holds this schema.
            </>
          ) : mergeable ? (
            <>
              <b>Cleared</b> — the queue is empty and applying each side's delta to base in either
              order agrees. Ready for the checker to sign off and release.
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
                Advances to <b>Cleared</b> when the queue is empty and the commutativity check passes.
                Currently: {review.commutativity}.
              </span>
            </>
          )}
          <span className="mr-vh"> Current status: {status}.</span>
        </p>
        {canRelease && onRelease && (
          <button
            className="mr-btn mr-btn--primary mr-fab__release"
            type="button"
            disabled={releasing}
            onClick={onRelease}
          >
            {releasing ? "Releasing…" : "Release to main"}
          </button>
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

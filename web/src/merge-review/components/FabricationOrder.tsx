import type { MergeReview } from "../model.ts";
import { effectiveStatus, isMergeable, openConflicts } from "../model.ts";

/**
 * Zone D — the fabrication order. The ordered, forward-only DDL that comes out of
 * a clean merge, each statement tagged to the revision that produced it. Blocked
 * groups are listed with the reason, including any downstream objects a conflict
 * gates. A status line — not a stamp — says what advances the dial to Cleared.
 */
export function FabricationOrder({ review }: { review: MergeReview }) {
  const fo = review.fabricationOrder;
  const open = openConflicts(review);
  const mergeable = isMergeable(review);
  const status = effectiveStatus(review);

  return (
    <section className="mr-zone mr-fab" aria-labelledby="mr-fab-h">
      <header className="mr-fab__head">
        <h2 className="mr-zone__k" id="mr-fab-h">
          <span className="mr-zone__n">D</span> Fabrication order — DDL
        </h2>
        <span className="mr-fab__meta">
          {fo.statements.length} statements · {mergeable ? 0 : fo.blocked.length} blocked ·
          forward-only · one transaction
        </span>
      </header>

      <pre className="mr-fab__sql" tabIndex={0} aria-label="Generated DDL, scrollable">
        <code>
          <span className="mr-sql-ok">BEGIN;</span>
          {"\n"}
          {fo.statements.map((s, i) => (
            <span key={i}>
              {s.sql}
              {s.revision !== null && (
                <span className={`mr-sql-tag mr-sql-tag--${s.side ?? "none"}`}>
                  {"  "}-- △{s.revision}
                  {s.rebased ? ", rebased" : ""}
                </span>
              )}
              {"\n"}
            </span>
          ))}
          {!mergeable &&
            fo.blocked.map((b) => (
              <span key={b.conflictId} className="mr-sql-blocked">
                -- {b.reason}
                {"\n"}
              </span>
            ))}
          {mergeable && (
            <span className="mr-sql-ok">
              -- all four conflicts resolved; their statements fold in here
              {"\n"}
            </span>
          )}
          <span className="mr-sql-ok">COMMIT;</span>
        </code>
      </pre>

      <p className="mr-fab__status" data-mergeable={mergeable}>
        <span className="mr-fab__dot" aria-hidden="true" />
        {mergeable ? (
          <>
            <b>Cleared</b> — the queue is empty and applying each side's delta to base in either
            order agrees. Ready for the checker to sign off and release.
          </>
        ) : (
          <>
            <b>Held</b> — {open.length} unresolved {open.length === 1 ? "conflict" : "conflicts"},{" "}
            {fo.statements.length} statements staged.
            <span className="mr-fab__adv">
              {" "}
              Advances to <b>Cleared</b> when the queue is empty and the commutativity check passes.
              Currently: {review.commutativity}.
            </span>
          </>
        )}
        <span className="mr-vh"> Current status: {status}.</span>
      </p>
    </section>
  );
}

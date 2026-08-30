import type { RevisionStatus } from "../model.ts";
import { STATUS_SEQUENCE, statusLabel } from "../format.ts";

/**
 * The revision-status dial. A drawing's issue/approval plate, and — the point of
 * the design — a dial that *turns*: the whole sequence stays visible and the
 * boxed marker advances along it when the status changes (an authored move,
 * neutralised under prefers-reduced-motion). It never reads as a stamp.
 */
export function RevisionDial({
  status,
  detail,
}: {
  status: RevisionStatus;
  detail: string;
}) {
  const current = STATUS_SEQUENCE.indexOf(status);
  return (
    <div className="mr-dial" role="group" aria-label="Revision status">
      <span className="mr-dial__label">Revision status</span>
      <strong className="mr-dial__now" data-status={status}>
        {statusLabel(status)}
      </strong>
      <ol className="mr-dial__seq">
        {STATUS_SEQUENCE.map((s, i) => {
          const state = i === current ? "current" : i < current ? "done" : "ahead";
          return (
            <li
              // remount the marker when it moves so the advance animation replays
              key={state === "current" ? `cur-${status}` : s}
              className="mr-dial__step"
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              {statusLabel(s)}
            </li>
          );
        })}
      </ol>
      <p className="mr-dial__detail">{detail}</p>
    </div>
  );
}

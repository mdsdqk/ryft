import { useEffect, useRef, useState } from "react";

import type { ColumnType } from "@engine/schema.js";

import { TYPE_PRESETS, typeForValue } from "../../surfaces/branch/format.ts";
import type { Conflict } from "../model.ts";
import { conflictLabel } from "../format.ts";
import { RevisionTriangle } from "./RevisionTriangle.tsx";

export interface ConflictQueueProps {
  conflicts: Conflict[];
  /** id of the conflict currently expanded / focused. */
  activeId: string;
  /** conflict whose "specify type" picker is open */
  pickingTypeFor: string | null;
  /** a released merge is a record, not a working queue */
  readOnly?: boolean;
  onActivate: (id: string) => void;
  onResolve: (conflictId: string, optionId: string, type?: ColumnType) => void;
  onReopen: (conflictId: string) => void;
}

/**
 * Zone B — the conflict queue. A single roving-tabindex listbox: one option is
 * tabbable, arrows / J / K move between them, and the active option is announced.
 * The active conflict is expanded with its ours / theirs facts and resolution
 * controls (1 / 2 / 3); resolved conflicts collapse to a one-line record with an
 * undo. Nothing here relies on colour alone — every conflict carries the △!
 * mark, a class badge, and the word "conflict".
 */
export function ConflictQueue({
  conflicts,
  activeId,
  pickingTypeFor,
  readOnly = false,
  onActivate,
  onResolve,
  onReopen,
}: ConflictQueueProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);

  const activeIndex = Math.max(
    0,
    conflicts.findIndex((c) => c.id === activeId),
  );
  const resolvedCount = conflicts.filter((c) => c.resolvedWith !== null).length;
  const active = conflicts[activeIndex];
  const allResolved = conflicts.length > 0 && resolvedCount === conflicts.length;

  function move(delta: number) {
    const next = conflicts[(activeIndex + delta + conflicts.length) % conflicts.length];
    if (next) onActivate(next.id);
  }

  useEffect(() => {
    if (!liveRef.current) return;
    if (conflicts.length === 0) {
      liveRef.current.textContent = "No conflicts on this merge.";
      return;
    }
    if (!active) return;
    liveRef.current.textContent =
      active.resolvedWith !== null
        ? `Conflict ${activeIndex + 1} of ${conflicts.length}, ${conflictLabel(active.cls)}, resolved.`
        : `Conflict ${activeIndex + 1} of ${conflicts.length}, ${conflictLabel(active.cls)}.`;
  }, [active, activeIndex, conflicts.length]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
      e.preventDefault();
      move(-1);
    } else if (!readOnly && active && active.resolvedWith === null && ["1", "2", "3"].includes(e.key)) {
      const opt = active.options.find((o) => o.hint === e.key);
      if (opt) {
        e.preventDefault();
        onResolve(active.id, opt.id);
      }
    }
  }

  return (
    <section className="mr-zone" aria-labelledby="mr-q-h">
      <h2 className="mr-zone__k" id="mr-q-h">
        <span className="mr-zone__n">B</span> Conflict queue
      </h2>

      {conflicts.length === 0 ? (
        <div className="mr-queue mr-queue--empty">
          <p className="mr-shell__title">No conflicts</p>
          <p className="mr-shell__msg">
            The two sides changed different things. Nothing needs a decision here — the merge clears
            once the commutativity check agrees.
          </p>
        </div>
      ) : (
      <div className="mr-queue">
        <header className="mr-queue__head">
          <span className="mr-queue__pos">
            {allResolved ? `All ${conflicts.length} resolved` : `Conflict ${activeIndex + 1} of ${conflicts.length}`}
          </span>
          <span className="mr-queue__prog">
            {readOnly
              ? "Merged — this queue is a record of the choices that landed."
              : `${resolvedCount} of ${conflicts.length} resolved · merge holds until the queue is empty and the commutativity check agrees`}
          </span>
          <span className="mr-queue__nav">
            <button className="mr-btn mr-btn--ghost" onClick={() => move(-1)}>
              <kbd>K</kbd> prev
            </button>
            <button className="mr-btn mr-btn--ghost" onClick={() => move(1)}>
              next <kbd>J</kbd>
            </button>
          </span>
        </header>

        <ul
          className="mr-queue__list"
          ref={listRef}
          role="listbox"
          aria-label="Conflicts"
          aria-activedescendant={active ? `mr-cf-${active.id}` : undefined}
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          {conflicts.map((c, i) => {
            const isActive = i === activeIndex;
            const resolved = c.resolvedWith !== null;
            const chosen = resolved ? c.options.find((o) => o.id === c.resolvedWith) : null;
            const picking = pickingTypeFor === c.id;
            return (
              <li
                key={c.id}
                id={`mr-cf-${c.id}`}
                role="option"
                aria-selected={isActive}
                className={[
                  "mr-cf",
                  isActive && "mr-cf--active",
                  resolved && "mr-cf--resolved",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => onActivate(c.id)}
              >
                <p className={`mr-cf__cls mr-cf__cls--${c.severity}`}>
                  <RevisionTriangle n="!" conflict />
                  {c.severity} · {conflictLabel(c.cls)}
                </p>
                <p className="mr-cf__title">
                  {c.objectLabel} <span className="mr-cf__oid">({c.objectId})</span> — {c.title}
                </p>

                {c.gates.length > 0 && !resolved && (
                  <p className="mr-cf__gates">
                    holds {c.gates.join(", ")} until resolved
                  </p>
                )}

                {isActive && !resolved && !readOnly && (
                  <>
                    <div className="mr-cf__grid">
                      <div className="mr-side mr-side--ours">
                        <span className="mr-side__who">ours · {c.ours.author.name}</span>
                        {c.ours.detail}
                      </div>
                      <div className="mr-side mr-side--theirs">
                        <span className="mr-side__who">theirs · {c.theirs.author.name}</span>
                        {c.theirs.detail}
                      </div>
                    </div>
                    <div className="mr-cf__actions">
                      {c.options.map((o) => (
                        <button
                          key={o.id}
                          className={`mr-btn ${o.kind === "ours" ? "mr-btn--primary" : ""}`}
                          aria-expanded={o.kind === "custom" ? picking : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            onResolve(c.id, o.id);
                          }}
                        >
                          {o.label}
                          {o.hint && <kbd>{o.hint}</kbd>}
                        </button>
                      ))}
                    </div>
                    {picking && <TypePick onApply={(type) => onResolve(c.id, "custom", type)} />}
                  </>
                )}

                {resolved && (
                  <p className="mr-cf__done">
                    resolved — {chosen?.label ?? c.resolvedWith}
                    {!readOnly && (
                      <button className="mr-linkbtn" onClick={() => onReopen(c.id)}>
                        undo
                      </button>
                    )}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      )}

      <p ref={liveRef} className="mr-vh" aria-live="polite" />
    </section>
  );
}

function TypePick({ onApply }: { onApply: (type: ColumnType) => void }) {
  const [value, setValue] = useState(TYPE_PRESETS[0]!.value);
  return (
    <form
      className="mr-cf__type"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => {
        e.preventDefault();
        onApply(typeForValue(value));
      }}
    >
      <label className="mr-cf__type-lab">
        <span>target type</span>
        <select
          className="mr-cf__type-sel"
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
        >
          {TYPE_PRESETS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button className="mr-btn mr-btn--primary" type="submit">
        Apply
      </button>
    </form>
  );
}

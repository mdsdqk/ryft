/**
 * Branches list — `/branches`.
 *
 * THESIS: a revision-set index of named cuts from main, not a GitHub branch
 * list. Refuses badges, avatars, relative time, rounded chips, and any modal
 * for create or delete.
 *
 * OWN-WORLD: the drafting-room sheet. Title-strip create plate (a title-block
 * field, always on the sheet). Hairline rows, dashed --line, mono data with
 * tnum. Trunk is a labelled row; working rows carry △N / "no changes" in
 * --ink-soft (neutral), never colour alone.
 *
 * STORY: see every cut, name a new one from main, delete one that is not held.
 * An open merge request names why delete is refused. Empty keeps the sheet and
 * the trunk row.
 *
 * FIRST VIEWPORT: title strip "Branches" + demonstration tag; right cell is
 * the create plate (label, name field, Cut). Body: trunk first, then working
 * rows (name → /branch/:name, author · cut date, marker, Delete). Primary
 * action is Cut from main.
 *
 * FORM: revision sheet, established world, code-led V0 (no motion).
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, DESIGN.md, and every shipping raster carrying
 * its provenance.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";

import {
  BRANCH_NAME_MAX,
  BranchHeldError,
  heldByMergeMessage,
  source,
  useResource,
  type BranchSummary,
} from "../data/index.ts";
import { Link } from "react-router";
import { useSession } from "../session/session.ts";
import {
  EmptyState,
  Loading,
  SheetList,
  SurfaceBody,
  SurfaceSheet,
  Tri,
} from "./kit/index.ts";

import "./Branches.css";

type Pending =
  | { name: string; kind: "confirm" }
  | { name: string; kind: "held"; reason: string }
  | { name: string; kind: "error"; reason: string };

function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function lossCopy(branch: BranchSummary, trunk: string): string {
  const irreversible = "This cannot be undone.";
  if (branch.divergence === 0) {
    return `Delete ${branch.name}? This drops the branch. It has no operations. ${trunk} is unchanged. ${irreversible}`;
  }
  const n = branch.divergence.toLocaleString();
  const ops = branch.divergence === 1 ? "operation" : "operations";
  return `Delete ${branch.name}? This drops the branch and its ${n} ${ops}. ${trunk} is unchanged. ${irreversible}`;
}

function neighborAfterDelete(
  workingNames: readonly string[],
  removed: string,
): string | null {
  const i = workingNames.indexOf(removed);
  if (i < 0) return workingNames[0] ?? null;
  return workingNames[i - 1] ?? workingNames[i + 1] ?? null;
}

function focusSoon(getEl: () => HTMLElement | null | undefined): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      getEl()?.focus();
    });
  });
}

export function Branches() {
  const { username } = useSession();
  const { data, loading, error, reload } = useResource(() =>
    source.listBranches(),
  );
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const createRef = useRef<HTMLInputElement>(null);
  const deleteBtns = useRef(new Map<string, HTMLButtonElement>());

  const setDeleteBtn = useCallback((name: string, el: HTMLButtonElement | null) => {
    if (el) deleteBtns.current.set(name, el);
    else deleteBtns.current.delete(name);
  }, []);

  const onArm = useCallback((next: Pending | null) => {
    setNotice(null);
    setPending(next);
  }, []);

  const onDisarm = useCallback((restoreName: string) => {
    setPending(null);
    focusSoon(
      () => deleteBtns.current.get(restoreName) ?? createRef.current,
    );
  }, []);

  if (loading && !data) {
    return (
      <SurfaceSheet title="Branches">
        <Loading label="Loading branches…" />
      </SurfaceSheet>
    );
  }

  if (error || !data) {
    return (
      <SurfaceSheet title="Branches">
        <EmptyState
          tone="error"
          title="Could not load branches"
          action={
            <button className="mr-btn mr-btn--primary" onClick={reload}>
              Try again
            </button>
          }
        >
          The list did not load. Try again.
        </EmptyState>
      </SurfaceSheet>
    );
  }

  const working = data.filter((b) => !b.trunk);
  const trunk = data.find((b) => b.trunk);
  const trunkName = trunk?.name ?? "main";
  const workingNames = working.map((b) => b.name);
  const countLine =
    working.length === 0
      ? `no working branches · trunk ${trunkName}`
      : `${working.length.toLocaleString()} working branch${working.length === 1 ? "" : "es"} · cut from ${trunkName}`;

  const onCreated = (name: string) => {
    setNotice(`Branch ${name} cut from ${trunkName}.`);
    setPending(null);
    focusSoon(() => createRef.current);
  };

  const onDeleted = (name: string) => {
    const neighbor = neighborAfterDelete(workingNames, name);
    setNotice(`Deleted ${name}. ${trunkName} is unchanged.`);
    setPending(null);
    focusSoon(
      () =>
        (neighbor ? deleteBtns.current.get(neighbor) : undefined) ??
        createRef.current,
    );
  };

  return (
    <div className="br">
      <SurfaceSheet
        title="Branches"
        demo
        subtitle={countLine}
        action={
          <CreatePlate
            author={username ?? ""}
            disabled={busy}
            inputRef={createRef}
            onBusy={setBusy}
            onCreated={onCreated}
          />
        }
      >
        <SurfaceBody>
          <p
            className="br-live"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {notice ?? "\u00a0"}
          </p>

          <SheetList label="Branches">
            {data.map((branch) => (
              <BranchRow
                key={branch.name}
                branch={branch}
                trunk={trunkName}
                pending={pending?.name === branch.name ? pending : null}
                busy={busy}
                onArm={onArm}
                onDisarm={onDisarm}
                onBusy={setBusy}
                onDeleted={onDeleted}
                setDeleteBtn={setDeleteBtn}
              />
            ))}
          </SheetList>
        </SurfaceBody>
      </SurfaceSheet>
    </div>
  );
}

function CreatePlate({
  author,
  disabled,
  inputRef,
  onBusy,
  onCreated,
}: {
  author: string;
  disabled: boolean;
  inputRef: Ref<HTMLInputElement>;
  onBusy: (v: boolean) => void;
  onCreated: (name: string) => void;
}) {
  const id = useId();
  const errId = useId();
  const [name, setName] = useState("");
  const [cutting, setCutting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clean = name.trim();
  const blocked = disabled || cutting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean || blocked || !author) return;
    setCutting(true);
    onBusy(true);
    setError(null);
    try {
      const created = await source.createBranch({
        name: clean,
        author,
        cutOn: todayStamp(),
      });
      setName("");
      onCreated(created.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cut the branch.");
    } finally {
      setCutting(false);
      onBusy(false);
    }
  };

  return (
    <form className="br-create" onSubmit={(e) => void submit(e)}>
      <label className="br-create__label" htmlFor={id}>
        Cut from main
      </label>
      <div className="br-create__row">
        <input
          id={id}
          ref={inputRef}
          className="br-create__input"
          name="branch"
          type="text"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="done"
          maxLength={BRANCH_NAME_MAX}
          placeholder="branch-name"
          value={name}
          aria-invalid={error != null}
          aria-describedby={error ? errId : undefined}
          disabled={blocked}
          onChange={(e) => {
            setName(e.target.value.toLowerCase());
            setError(null);
          }}
        />
        <button
          className="mr-btn mr-btn--primary"
          type="submit"
          disabled={!clean || blocked || !author}
        >
          {cutting ? "Cutting…" : "Cut"}
        </button>
      </div>
      {error && (
        <p id={errId} className="br-create__err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function BranchRow({
  branch,
  trunk,
  pending,
  busy,
  onArm,
  onDisarm,
  onBusy,
  onDeleted,
  setDeleteBtn,
}: {
  branch: BranchSummary;
  trunk: string;
  pending: Pending | null;
  busy: boolean;
  onArm: (next: Pending | null) => void;
  onDisarm: (restoreName: string) => void;
  onBusy: (v: boolean) => void;
  onDeleted: (name: string) => void;
  setDeleteBtn: (name: string, el: HTMLButtonElement | null) => void;
}) {
  const msgId = useId();
  const safeBtnRef = useRef<HTMLButtonElement>(null);
  const path = `/branch/${encodeURIComponent(branch.name)}`;
  const armed = pending != null;

  useEffect(() => {
    if (!armed) return;
    safeBtnRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (busy) return;
      onDisarm(branch.name);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, busy, branch.name, onDisarm, pending?.kind]);

  const requestDelete = () => {
    if (branch.openMergeId) {
      onArm({
        name: branch.name,
        kind: "held",
        reason: heldByMergeMessage(branch.name, trunk),
      });
      return;
    }
    onArm({ name: branch.name, kind: "confirm" });
  };

  const confirmDelete = async () => {
    if (pending?.kind !== "confirm" && pending?.kind !== "error") return;
    onBusy(true);
    try {
      await source.deleteBranch(branch.name);
      onDeleted(branch.name);
    } catch (err) {
      if (err instanceof BranchHeldError) {
        onArm({ name: branch.name, kind: "held", reason: err.message });
      } else {
        onArm({
          name: branch.name,
          kind: "error",
          reason: `Couldn't delete ${branch.name}. Try again.`,
        });
      }
    } finally {
      onBusy(false);
    }
  };

  const rowClass = [
    "kit-row",
    "br-row",
    pending?.kind === "confirm" || pending?.kind === "error"
      ? "br-row--armed"
      : "",
    pending?.kind === "held" ? "br-row--held" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const meta = branch.trunk
    ? `trunk · last changed ${branch.cutOn}`
    : `${branch.author} · cut ${branch.cutOn}`;

  const message =
    pending?.kind === "confirm"
      ? lossCopy(branch, trunk)
      : pending?.reason ?? "";

  return (
    <li className={rowClass}>
      <div className="kit-row__main">
        {armed ? (
          <span className="kit-row__link">{branch.name}</span>
        ) : (
          <Link to={path} className="kit-row__link">
            {branch.name}
          </Link>
        )}
        <span className="kit-row__meta">{meta}</span>
      </div>

      {armed ? (
        <div
          className="br-row__plate"
          role="group"
          aria-label={
            pending.kind === "confirm"
              ? `Confirm delete ${branch.name}`
              : pending.kind === "held"
                ? `Cannot delete ${branch.name}`
                : `Could not delete ${branch.name}`
          }
        >
          <p id={msgId} className="br-row__msg">
            {message}
          </p>
          <div className="br-row__actions">
            {pending.kind === "held" ? (
              <button
                ref={safeBtnRef}
                className="mr-btn"
                type="button"
                aria-describedby={msgId}
                onClick={() => onDisarm(branch.name)}
              >
                Understood
              </button>
            ) : pending.kind === "error" ? (
              <>
                <button
                  ref={safeBtnRef}
                  className="mr-btn"
                  type="button"
                  disabled={busy}
                  onClick={() => onDisarm(branch.name)}
                >
                  Keep
                </button>
                <button
                  className="mr-btn mr-btn--primary"
                  type="button"
                  disabled={busy}
                  aria-describedby={msgId}
                  onClick={() => void confirmDelete()}
                >
                  {busy ? "Deleting…" : "Retry"}
                </button>
              </>
            ) : (
              <>
                <button
                  ref={safeBtnRef}
                  className="mr-btn mr-btn--ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => onDisarm(branch.name)}
                >
                  Keep
                </button>
                <button
                  className="mr-btn"
                  type="button"
                  disabled={busy}
                  aria-describedby={msgId}
                  onClick={() => void confirmDelete()}
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="br-row__trail">
          {branch.trunk ? (
            <span className="br-trunk">Trunk</span>
          ) : (
            <Tri n={branch.divergence} noun="operation" />
          )}
          {!branch.trunk && (
            <button
              ref={(el) => setDeleteBtn(branch.name, el)}
              className="mr-btn"
              type="button"
              disabled={busy}
              aria-label={`Delete ${branch.name}`}
              onClick={requestDelete}
            >
              Delete
            </button>
          )}
        </div>
      )}
    </li>
  );
}

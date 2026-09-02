/**
 * Database overview — `/db`. The landing sheet after sign-in: there is no
 * database to choose.
 *
 * THESIS: a drawing title-block of this namespace plus two in-flight lists,
 * not a GitHub repo homepage and not a metrics dashboard. Refuses charts,
 * activity graphs, a schema preview of main, and dumping the full branch list.
 *
 * OWN-WORLD: the drafting-room sheet. Title-strip create plate (mirrors
 * /branches). Framed title-block facts. Hairline rows, dashed --line, mono
 * data with tnum. Status is a 9px lamp plus the word, never colour alone.
 * Trunk name links out to the branch workspace.
 *
 * STORY: orient. What is this database, what is main's shape, what is in
 * flight. Create a branch from here. Empty lists keep their zone headings:
 * merge requests name the zero, branches offer Create branch into the title
 * plate.
 *
 * FIRST VIEWPORT: title strip names the database; right cell is the create
 * plate ("New branch from main"). Body: Overview facts, Open merge requests,
 * recent Branches capped at 6 with more →. Primary action is creating a branch.
 *
 * FORM: revision sheet, established world, code-led V0 (no motion). Consumes
 * the list pattern from /branches; does not define one.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, DESIGN.md, and every shipping raster carrying
 * its provenance.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from "react";
import {
  BRANCH_NAME_MAX,
  mergeStatusLabel,
  mergeStatusTone,
  source,
  type BranchSummary,
  type MergeSummary,
} from "../data/index.ts";
import { invalidateData } from "../data/watch.ts";
import { useOverview } from "../shell/overview.tsx";
import { Link, useSearchParams } from "react-router";
import { useSession } from "../session/session.ts";
import {
  EmptyState,
  FactList,
  Loading,
  MoreRow,
  Row,
  SheetList,
  StatusPill,
  SurfaceBody,
  SurfaceSheet,
  Tri,
  Zone,
} from "./kit/index.ts";

import "./Dashboard.css";

/** the dashboard summarises; the full list lives on /branches */
const BRANCH_PREVIEW = 6;

const LOAD_ERROR =
  "The server returned 503 while fetching the database overview. This is usually transient.";

/** V0 exercise: a name longer than the create-field max, as a real API might return. */
const LONG_BRANCH =
  "contact-fields-and-then-a-very-long-working-branch-name-that-must-wrap";

function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function byRecent(a: BranchSummary, b: BranchSummary): number {
  return b.cutOn.localeCompare(a.cutOn) || a.name.localeCompare(b.name);
}

function withLongName(rows: readonly BranchSummary[]): BranchSummary[] {
  const first = rows[0];
  if (!first) return [...rows];
  return [{ ...first, name: LONG_BRANCH }, ...rows.slice(1)];
}

function padBusy(rows: readonly BranchSummary[]): BranchSummary[] {
  const extra: BranchSummary[] = [];
  for (let i = 1; extra.length + rows.length < BRANCH_PREVIEW + 3; i++) {
    extra.push({
      name: `busy-preview-${i}`,
      author: "preview",
      cutOn: "2025-12-01",
      divergence: 0,
    });
  }
  return [...rows, ...extra];
}

function arrowLabel(merge: MergeSummary): string {
  const from = merge.source.trim() || "unnamed";
  const to = merge.target.trim() || "main";
  return `${from} → ${to}`;
}

function mergeMeta(merge: MergeSummary): string {
  const author = merge.author.trim();
  const opened = merge.openedOn.trim();
  if (author && opened) return `${author} · opened ${opened}`;
  if (author) return author;
  if (opened) return `opened ${opened}`;
  return "opened date unknown";
}

function branchMeta(branch: BranchSummary): string {
  const author = branch.author.trim();
  const cut = branch.cutOn.trim();
  if (author && cut) return `${author} · branched ${cut}`;
  if (author) return author;
  if (cut) return `branched ${cut}`;
  return "branch date unknown";
}

export function Dashboard() {
  const { username } = useSession();
  const [params, setSearchParams] = useSearchParams();
  const forceEmpty = params.has("empty");
  const forceError = params.has("error");
  const forceLoading = params.has("loading");
  const forceLong = params.has("long");
  const forceBusy = params.has("busy");

  // The overview read is shared with the rail (`OverviewProvider`). `?error` is
  // a local exercise override — no refetch, just synthesize the failed state.
  const shared = useOverview();
  const data = forceError ? null : shared.data;
  const error = forceError ? new Error(LOAD_ERROR) : shared.error;
  const loading = !forceError && shared.loading;
  const reload = shared.reload;

  // Fixture `getOverview` reads `?empty` from the URL; when that flag actually
  // toggles, bump the epoch so the rail re-reads too. Guarded against firing on
  // mount — an unconditional invalidate there made every overview subscriber
  // (this sheet + the rail) refetch right after their first load.
  const prevEmpty = useRef(forceEmpty);
  useEffect(() => {
    if (prevEmpty.current === forceEmpty) return;
    prevEmpty.current = forceEmpty;
    invalidateData();
  }, [forceEmpty]);

  const createRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (forceLoading || (loading && !data)) {
    return (
      <div className="db" aria-busy="true">
        <SurfaceSheet title="Database">
          <Loading label="Loading the database…" />
        </SurfaceSheet>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="db">
        <SurfaceSheet title="Database">
          <EmptyState
            tone="error"
            title="Could not load the database"
            action={
              <button className="mr-btn mr-btn--primary" onClick={reload}>
                Try again
              </button>
            }
          >
            {error?.message ?? "The overview request returned nothing."}
          </EmptyState>
        </SurfaceSheet>
      </div>
    );
  }

  const { database: db } = data;
  // `?empty` is deterministic here, not just through the data seam (parity with
  // /merges, which filters locally)
  const merges = forceEmpty ? [] : data.merges;
  let branches = forceEmpty ? [] : [...data.branches].sort(byRecent);
  if (forceBusy) branches = padBusy(branches);
  if (forceLong) branches = withLongName(branches);

  const preview = branches.slice(0, BRANCH_PREVIEW);
  const overflow = branches.length - preview.length;
  const trunkPath = `/branch/${encodeURIComponent(db.trunk)}`;

  const onCreated = (name: string) => {
    if (forceEmpty) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("empty");
          return next;
        },
        { replace: true },
      );
    }
    setNotice(`Branch ${name} branched from ${db.trunk}.`);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        createRef.current?.focus();
        createRef.current?.scrollIntoView({ block: "nearest" });
      });
    });
  };

  const focusCreate = () => {
    createRef.current?.focus();
    createRef.current?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div className="db">
      <SurfaceSheet
        title={db.name}
        subtitle={
          <>
            {db.connection} · schema <b>{db.name}</b> · trunk{" "}
            <Link className="mr-linkbtn" to={trunkPath}>
              {db.trunk}
            </Link>{" "}
            · updated {db.trunkChangedOn}
          </>
        }
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
            className="db-live"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {notice ?? "\u00a0"}
          </p>

          <Zone title="Overview">
            <FactList
              facts={[
                { label: "Tables", value: db.tables.toLocaleString() },
                { label: "Columns", value: db.columns.toLocaleString() },
                { label: "Indexes", value: db.indexes.toLocaleString() },
                {
                  label: "Constraints",
                  value: db.constraints.toLocaleString(),
                },
                { label: "main last updated", value: db.trunkChangedOn },
                {
                  label: "Working branches",
                  value: branches.length.toLocaleString(),
                },
              ]}
            />
          </Zone>

          <Zone title="Open merge requests" count={merges.length}>
            <SheetList label="Open merge requests">
              {merges.length === 0 ? (
                <EmptyState layout="row" title="Nothing waiting to merge." />
              ) : (
                merges.map((m) => (
                  <Row
                    key={m.id}
                    to={`/merge/${encodeURIComponent(m.id)}`}
                    primary={arrowLabel(m)}
                    meta={mergeMeta(m)}
                    trailing={
                      <StatusPill tone={mergeStatusTone(m)}>
                        {mergeStatusLabel(m)}
                      </StatusPill>
                    }
                  />
                ))
              )}
            </SheetList>
          </Zone>

          <Zone title="Branches" count={branches.length}>
            <SheetList label="Recent branches">
              {preview.length === 0 ? (
                <EmptyState
                  layout="row"
                  title="No branches yet."
                  action={
                    <button
                      className="mr-btn"
                      type="button"
                      onClick={focusCreate}
                    >
                      Create branch
                    </button>
                  }
                />
              ) : (
                <>
                  {preview.map((b) => (
                    <Row
                      key={b.name}
                      to={`/branch/${encodeURIComponent(b.name)}`}
                      primary={b.name}
                      meta={branchMeta(b)}
                      trailing={<Tri n={b.divergence} noun="operation" />}
                    />
                  ))}
                  {overflow > 0 && (
                    <MoreRow to="/branches">
                      {overflow.toLocaleString()} more branch
                      {overflow === 1 ? "" : "es"} →
                    </MoreRow>
                  )}
                </>
              )}
            </SheetList>
          </Zone>
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
      setError(err instanceof Error ? err.message : "Could not create the branch.");
    } finally {
      setCutting(false);
      onBusy(false);
    }
  };

  return (
    <form className="db-create" onSubmit={(e) => void submit(e)}>
      <label className="db-create__label" htmlFor={id}>
        New branch from main
      </label>
      <div className="db-create__row">
        <input
          id={id}
          ref={inputRef}
          className="db-create__input"
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
          {cutting ? "Creating…" : "Create"}
        </button>
      </div>
      {error && (
        <p id={errId} className="db-create__err" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

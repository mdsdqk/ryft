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
 * flight. Cut a branch from here. Empty lists keep their zone headings and
 * name the one action that changes them.
 *
 * FIRST VIEWPORT: title strip names the database + demonstration tag; right
 * cell is Cut from main. Body: Overview facts, Open merges, recent Branches
 * capped at 6 with more →. Primary action is Cut.
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
  type ReactNode,
  type Ref,
} from "react";
import {
  BRANCH_NAME_MAX,
  mergeStatusLabel,
  mergeStatusTone,
  source,
  useResource,
  type BranchSummary,
  type MergeSummary,
} from "../data/index.ts";
import { invalidateData } from "../data/watch.ts";
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
  if (author && cut) return `${author} · cut ${cut}`;
  if (author) return author;
  if (cut) return `cut ${cut}`;
  return "cut date unknown";
}

export function Dashboard() {
  const { username } = useSession();
  const [params] = useSearchParams();
  const forceEmpty = params.has("empty");
  const forceError = params.has("error");
  const forceLoading = params.has("loading");
  const forceLong = params.has("long");
  const forceBusy = params.has("busy");

  const { data, loading, error, reload } = useResource(
    () =>
      forceError
        ? Promise.reject(new Error(LOAD_ERROR))
        : source.getOverview(),
    [forceError, forceEmpty],
  );

  // the rail also reads getOverview; bump the epoch when ?empty toggles so
  // both surfaces agree without editing Rail.tsx (WU-E owns that file).
  useEffect(() => {
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
  const merges = data.merges;
  let branches = [...data.branches].sort(byRecent);
  if (forceBusy) branches = padBusy(branches);
  if (forceLong) branches = withLongName(branches);

  const preview = branches.slice(0, BRANCH_PREVIEW);
  const overflow = branches.length - preview.length;
  const trunkPath = `/branch/${encodeURIComponent(db.trunk)}`;

  const onCreated = (name: string) => {
    setNotice(`Branch ${name} cut from ${db.trunk}.`);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => createRef.current?.focus());
    });
  };

  const focusCreate = () => {
    createRef.current?.focus();
  };

  return (
    <div className="db">
      <SurfaceSheet
        title={db.name}
        demo
        subtitle={
          <>
            {db.connection} · schema <b>{db.name}</b> · trunk{" "}
            <Link className="mr-linkbtn" to={trunkPath}>
              {db.trunk}
            </Link>{" "}
            at revision {db.trunkRevision.toLocaleString()}
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
                { label: "Main changed", value: db.trunkChangedOn },
                {
                  label: "Working branches",
                  value: branches.length.toLocaleString(),
                },
              ]}
            />
          </Zone>

          <Zone title="Open merges" count={merges.length}>
            <SheetList label="Open merges">
              {merges.length === 0 ? (
                <ZoneEmpty
                  action={
                    <Link className="mr-btn" to="/branches">
                      To the branches
                    </Link>
                  }
                >
                  No open merge requests.
                </ZoneEmpty>
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
                <ZoneEmpty
                  action={
                    <button
                      className="mr-btn mr-btn--ghost"
                      type="button"
                      onClick={focusCreate}
                    >
                      Cut from main
                    </button>
                  }
                >
                  No working branches.
                </ZoneEmpty>
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

function ZoneEmpty({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="kit-row db-empty">
      <p className="db-empty__msg">{children}</p>
      {action}
    </li>
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
    <form className="db-create" onSubmit={(e) => void submit(e)}>
      <label className="db-create__label" htmlFor={id}>
        Cut from main
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
          {cutting ? "Cutting…" : "Cut"}
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

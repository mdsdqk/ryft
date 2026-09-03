/**
 * The username gate — `/`, signed out. The app's front door.
 *
 * THESIS: the sign-in is where the product's one idea is stated plainly, over a
 * live drawing of it — two provenance fronts (`ours`, `theirs`) drifting into a
 * single woven band. Not a bare login form: a bordered sheet with the marketing
 * nameplate, the one-line pitch, the three facts that matter, and the
 * create-or-resume model in plain mono. Refuses a password field, a "forgot?"
 * link, social buttons, and any confirm step for an unknown name.
 *
 * OWN-WORLD: the drafting-room sheet on the left over a full-bleed generative
 * field. Serif nameplate (`--ff-mark`, front-door only) against the app's
 * condensed display face and mono body. Diazo / Cyanotype aware through tokens;
 * the field re-reads the palette on theme change.
 *
 * STATES: empty (button held) · typing (button live) · submitting (field +
 * button locked, label ticks to "Signing in…") · error (a `SignInError`
 * message in an alert, focus back on the field for a name problem, a plain
 * retry for a transport one). The create-or-resume note is always on the sheet
 * — it is the "unknown name" affordance, not an error.
 *
 * MOTION: the field drifts continuously (see SignInField — bounded, paused when
 * hidden, static under reduced motion). The one in-sheet moment is the error
 * row wiping in left to right (`ryft-rule-in` in theme.css).
 *
 * AUTH PATTERN: `authenticate()` (session/session.ts) is the single async seam;
 * V1 swaps its body for `POST /session` and this surface does not change.
 */

import { useId, useRef, useState, type FormEvent } from "react";

import { useNavigate } from "react-router";

import { SignInError, useSession } from "../session/session.ts";
import { SignInField } from "./SignInField.tsx";

import "./SignIn.css";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string; field: boolean };

/**
 * The workspace-reset utility at the foot of the sheet. A fresh database has no
 * organisation row, so `POST /session` 409s until someone seeds it — this is
 * that seed, plus the escape hatch when the seeded fixture drifts. `confirm` is
 * the in-sheet warning step; `running` locks the sign-in field too.
 */
type Reset =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "error"; message: string };

/**
 * A hard ceiling on what the field will hold — a paste guard, not the logical
 * limit. `authenticate` still reports anything over `USERNAME_MAX` (64) as an
 * error the person can read and correct; this only stops a multi-KB paste from
 * ever landing in React state.
 */
const INPUT_MAXLENGTH = 4096;

export function SignIn() {
  const { authenticate } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [reset, setReset] = useState<Reset>({ kind: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const noteId = useId();
  const errId = useId();

  const clean = name.trim();
  const busy = status.kind === "submitting";
  const errored = status.kind === "error";
  const resetting = reset.kind === "running";
  // sign-in and reset lock each other out — one database mutation at a time
  const locked = busy || resetting;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean || locked) return;
    setStatus({ kind: "submitting" });
    try {
      await authenticate(clean);
      navigate("/db", { replace: true });
    } catch (err) {
      const known = err instanceof SignInError;
      setStatus({
        kind: "error",
        message: known
          ? err.message
          : "Could not sign in. Check your connection and try again.",
        field: known ? err.field : false,
      });
      if (!known || err.field) {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
  };

  const runReset = async () => {
    setReset({ kind: "running" });
    try {
      const res = await fetch("/api/workspace/reset", { method: "POST" });
      if (!res.ok) {
        const message = await res
          .json()
          .then((body: { error?: string }) => body?.error ?? null)
          .catch(() => null);
        throw new Error(message ?? `Reset failed (${res.status}).`);
      }
      // The seeded organisation, users, and main now exist — reload so the whole
      // app re-reads from a clean slate rather than a half-updated screen.
      setReset({ kind: "done" });
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      setReset({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Reset failed. Check your connection and try again.",
      });
    }
  };

  return (
    <>
      <SignInField />
      <span className="si-flabel si-flabel--ours" aria-hidden="true">
        ours
      </span>
      <span className="si-flabel si-flabel--theirs" aria-hidden="true">
        theirs
      </span>

      <article className="si">
        <header className="si__plate">
          <div className="si__mark">ryft</div>
          <p className="si__tag">A schema version control system</p>
        </header>

        <form className="si__body" onSubmit={submit} noValidate>
          <p className="si__lede">
            Branch a Postgres schema, edit it in a structured editor, and merge
            it back into main.
          </p>

          <ul className="si__facts">
            <li>A rename keeps the column.</li>
            <li>A merge is a typed report.</li>
            <li>main is the schema of record.</li>
          </ul>

          <section className="si__how">
            <h2>How it works</h2>
            <ol className="si__steps">
              <li className="si__step">
                <b>1</b>
                <span>Give a username</span>
              </li>
              <li className="si__step">
                <b>2</b>
                <span>Land in the seeded database</span>
              </li>
              <li className="si__step">
                <b>3</b>
                <span>Create a branch, edit, open a merge request</span>
              </li>
            </ol>
          </section>

          <div className="si__field">
            <label className="si__label" htmlFor={inputId}>
              Username
            </label>
            <input
              id={inputId}
              ref={inputRef}
              className="si__input"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              maxLength={INPUT_MAXLENGTH}
              autoFocus
              value={name}
              disabled={locked}
              aria-describedby={errored ? `${errId} ${noteId}` : noteId}
              aria-invalid={errored && status.field}
              onChange={(e) => {
                setName(e.target.value);
                if (errored) setStatus({ kind: "idle" });
              }}
              placeholder="grace"
            />
          </div>

          <button
            className="si__go"
            type="submit"
            disabled={!clean || locked}
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

          {errored && (
            <p id={errId} className="si__error" role="alert">
              {status.message}
            </p>
          )}

          <p id={noteId} className="si__note">
            A name this workspace has seen resumes that user. A new name creates
            one. There is no separate sign up. No password.
          </p>

          <div className="si__reset-zone">
            {reset.kind === "idle" && (
              <button
                type="button"
                className="si__reset"
                disabled={locked}
                onClick={() => setReset({ kind: "confirm" })}
              >
                Reset workspace
              </button>
            )}

            {reset.kind === "confirm" && (
              <div
                className="si__reset-confirm"
                role="group"
                aria-label="Confirm workspace reset"
              >
                <p className="si__reset-warn">
                  Wipes every branch, merge request, and edit on this database
                  and restores the seeded workspace.
                </p>
                <div className="si__reset-actions">
                  <button
                    type="button"
                    className="si__reset si__reset--go"
                    onClick={() => void runReset()}
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    className="si__reset"
                    onClick={() => setReset({ kind: "idle" })}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {resetting && (
              <p className="si__reset-warn">Resetting…</p>
            )}

            {reset.kind === "done" && (
              <p className="si__reset-warn si__reset-warn--ok">Workspace reset.</p>
            )}

            {reset.kind === "error" && (
              <p className="si__reset-warn si__reset-warn--err" role="alert">
                {reset.message}
              </p>
            )}
          </div>
        </form>
      </article>
    </>
  );
}

/**
 * The username gate — `/`, signed out.
 *
 * THESIS: a drawing's title block being filled in, not a login form. One ruled
 * entry, one plate-stamp action, and the create-or-resume model stated in plain
 * mono rather than hidden behind a signup flow. Refuses a password field, a
 * "forgot?" link, social buttons, a modal, and any confirm step for an unknown
 * name (work-breakdown WU-C: proceed with an inline note, never a dialog).
 *
 * OWN-WORLD: the drafting-room sheet, smaller than the app sheets and centred on
 * the solo stage. Title strip reads `ryft`; mono field label; square input on a
 * `1px --line-strong` rule; `--ink` primary button. Diazo / Cyanotype aware
 * through tokens only.
 *
 * STATES: empty (button held) · typing (button live) · submitting (field +
 * button locked, label ticks to "Signing in…") · error (a `SignInError`
 * message in an alert, focus back on the field for a name problem, a plain
 * retry for a transport one). The create-or-resume note is always on the sheet
 * — it is the "unknown name" affordance, not an error.
 *
 * MOTION: one mechanical moment — the error row (a `1px --conflict-edge` rule
 * across the sheet, plus the message) wipes in left to right via
 * `clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)`. Honours
 * `prefers-reduced-motion` through the global reset.
 *
 * AUTH PATTERN: `authenticate()` (session/session.ts) is the single async seam;
 * V1 swaps its body for `POST /session` and this surface does not change. See
 * docs/design/drafts/wu-c-auth-pattern.md.
 */

import { useId, useRef, useState, type FormEvent } from "react";

import { useNavigate } from "react-router";

import { SignInError, useSession } from "../session/session.ts";

import "./SignIn.css";

type Status =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "error"; message: string; field: boolean };

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
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const noteId = useId();
  const errId = useId();

  const clean = name.trim();
  const busy = status.kind === "submitting";
  const errored = status.kind === "error";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!clean || busy) return;
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

  return (
    <article className="mr-sheet si">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">ryft</h1>
          <p className="mr-titlestrip__path">schema under version control</p>
        </div>
      </header>

      <form className="si__body" onSubmit={submit} noValidate>
        <p className="si__lede">
          A seeded demonstration workspace: one organisation, a few users, one
          database under version control.
        </p>

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
            disabled={busy}
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
          className="mr-btn mr-btn--primary si__go"
          type="submit"
          disabled={!clean || busy}
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
          one — there is no separate sign-up. No password; impersonation is a
          documented non-goal, not a guarded one.
        </p>
      </form>
    </article>
  );
}

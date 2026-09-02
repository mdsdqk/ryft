/**
 * The username gate — `/`, signed out.
 *
 * THESIS: walking up to the drawing, then filling in its title block. One
 * viewport, one field, one plate-stamp action. Refuses a marketing page, a
 * second CTA, a password, a "forgot?" link, social buttons, and any confirm
 * step for an unknown name (proceed with an inline note, never a dialog).
 *
 * OWN-WORLD: the drafting-room sheet filling the solo stage. Claim in Saira
 * Condensed (uppercase, letter-spaced); data in Spline Sans Mono. Square
 * corners, Diazo / Cyanotype tokens, inset drawing border. Gate is a title
 * block: Drawing / Sheet / Entered as.
 *
 * STORY: the visitor sees the one claim no other schema tool can make — a
 * rename followed across a merge — then types a username into a seeded
 * demonstration workspace.
 *
 * FIRST VIEWPORT: two-column sheet. Left: two-line claim, one clarifying
 * sentence, miniature Zone A of `users.email` (contact-fields against main),
 * three tracked benefit lines. Right: title-block gate. Foot: risk reversal.
 * Primary action is Sign in.
 *
 * FORM: revision sheet, established world, code-led with one GSAP arrival
 * (the drawing being inked). authenticate() is the single async seam.
 *
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the
 * finish review, the verdict, DESIGN.md, and every shipping raster carrying
 * its provenance.
 */

import { useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";

import { useNavigate } from "react-router";

import { RevisionTriangle } from "../merge-review/components/RevisionTriangle.tsx";
import { SignInError, useSession } from "../session/session.ts";
import { playSignInArrival } from "./signinArrival.ts";

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

const CLAIM_LINE_1 = ["A", "schema", "merge"] as const;
const CLAIM_LINE_2 = ["that", "follows", "a", "rename"] as const;

const BENEFITS: ReadonlyArray<{ lead: string; rest: string }> = [
  {
    lead: "Follows a rename",
    rest: "Identity lives in an id, never a name.",
  },
  {
    lead: "Merge is a typed report",
    rest: "Usable from an API, not only a screen.",
  },
  {
    lead: "The schema is the artifact",
    rest: "Not the migration files that describe it.",
  },
];

export function SignIn() {
  const { authenticate } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const sheetRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const noteId = useId();
  const errId = useId();
  const proofId = useId();

  const clean = name.trim();
  const busy = status.kind === "submitting";
  const errored = status.kind === "error";

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    return playSignInArrival(sheet, () => {
      inputRef.current?.focus();
    });
  }, []);

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
    <article className="mr-sheet si" ref={sheetRef}>
      <svg
        className="si__draw"
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        <rect
          data-si-draw
          pathLength={1}
          x="0.5"
          y="0.5"
          width="99"
          height="99"
          vectorEffect="nonScalingStroke"
        />
      </svg>

      <div className="si__cols">
        <section className="si__claim" aria-describedby={proofId}>
          <h1 className="si__h1">
            <span className="si__line">
              {CLAIM_LINE_1.map((w) => (
                <span key={w} className="si__w" data-si-word>
                  {w}
                </span>
              ))}
            </span>
            <span className="si__line">
              {CLAIM_LINE_2.map((w) => (
                <span key={w} className="si__w" data-si-word>
                  {w}
                </span>
              ))}
            </span>
          </h1>
          <p className="si__sub">
            Objects keep a stable id. A rename on one branch and an index on
            the other become an index on the new name, not a drop and an add.
          </p>

          <div className="si__proof" id={proofId}>
            <p className="si__proof-k">contact-fields against main</p>
            <div className="mr-cmp si__cmp">
              <div className="mr-cmp__colhd">
                <span>Object</span>
                <span className="mr-cmp__o">on ours</span>
                <span className="mr-cmp__t">on theirs</span>
              </div>
              <div className="mr-row si__proof-row">
                <div className="mr-row__obj">
                  <span className="mr-row__nm">users.email</span>
                  <span className="mr-row__id">col_users_email_9f31</span>
                </div>
                <div className="mr-cell" data-si-ours>
                  <span className="mr-cell__col" aria-hidden="true">
                    on ours
                  </span>
                  <span className="mr-rl mr-rl--ours">
                    <RevisionTriangle n={1} side="ours" />
                    rename
                  </span>
                  <span className="mr-cell__detail">
                    <s>email</s> → <b>email_address</b>
                  </span>
                </div>
                <div className="mr-cell" data-si-theirs>
                  <span className="mr-cell__col" aria-hidden="true">
                    on theirs
                  </span>
                  <span className="mr-rl mr-rl--theirs">
                    <RevisionTriangle n={1} side="theirs" />
                    add unique
                  </span>
                  <span className="mr-cell__detail">unique index on email</span>
                </div>
                <p
                  className="mr-row__leader mr-row__leader--ok"
                  data-si-leader
                >
                  ↳ index follows to email_address
                </p>
              </div>
            </div>
          </div>

          <ul className="si__benefits">
            {BENEFITS.map((b) => (
              <li key={b.lead}>
                <b>{b.lead}</b>
                <span>{b.rest}</span>
              </li>
            ))}
          </ul>
        </section>

        <form className="si__gate" onSubmit={submit} noValidate>
          <dl className="mr-titleblock si__plate">
            <div className="mr-titleblock__row">
              <dt>Drawing</dt>
              <dd>ryft</dd>
            </div>
            <div className="mr-titleblock__row">
              <dt>Sheet</dt>
              <dd>demonstration</dd>
            </div>
          </dl>

          <div className="si__field">
            <label className="si__label" htmlFor={inputId}>
              Entered as
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
            A name this workspace has seen resumes that user. A new name
            creates one. There is no separate sign up. No password.
            Impersonation is a documented non-goal.
          </p>
        </form>
      </div>

      <footer className="si__foot">
        A seeded demonstration workspace. One organisation, a few users, one
        database under version control. Leave by signing out.
      </footer>
    </article>
  );
}

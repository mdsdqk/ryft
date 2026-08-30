/**
 * The username gate. One field, no password — PRODUCT.md: a known username
 * resumes that user, an unknown one creates a new user and proceeds. There is no
 * server check in V0; the name is taken as truth and kept in localStorage.
 *
 * This is a lean V0 rendering: the sheet frame, one labelled input, one primary
 * action, and a line stating the no-password model rather than hiding it.
 */

import { useId, useState, type FormEvent } from "react";

import { useNavigate } from "react-router";

import { useSession } from "../session/session.ts";

const MAX_USERNAME = 64;

export function SignIn() {
  const { signIn } = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const inputId = useId();

  const clean = name.trim();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!clean) return;
    signIn(clean);
    navigate("/db", { replace: true });
  };

  return (
    <article className="mr-sheet shl-signin">
      <header className="mr-titlestrip">
        <div className="mr-titlestrip__id">
          <h1 className="mr-titlestrip__h1">ryft</h1>
          <p className="mr-titlestrip__path">schema under version control</p>
        </div>
      </header>

      <form className="shl-signin__body" onSubmit={submit}>
        <label className="shl-signin__label" htmlFor={inputId}>
          Username
        </label>
        <input
          id={inputId}
          className="shl-signin__input"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={MAX_USERNAME}
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="grace"
        />
        <button className="mr-btn mr-btn--primary" type="submit" disabled={!clean}>
          Enter
        </button>
        <p className="shl-signin__note">
          No password. A name you have used before resumes that user; a new name
          creates one. Impersonation is a documented non-goal, not a guarded one.
        </p>
      </form>
    </article>
  );
}

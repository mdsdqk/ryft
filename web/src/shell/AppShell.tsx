/**
 * The app frame: a sticky app bar over a two-column shell — the sheet-index rail
 * and the stage that renders the active surface. The rail appears once there is a
 * session; the signed-out username gate stands alone.
 */

import { useEffect, useRef, useState } from "react";

import { useTheme } from "../theme/useTheme.ts";
import { useSession } from "../session/session.ts";
import { useRouter } from "../router/router.tsx";
import { Rail } from "./Rail.tsx";
import { Routes } from "./routes.tsx";

const KEYS: Array<[string, string]> = [
  ["J / K", "next / previous conflict — on the merge-review screen"],
  ["1 / 2 / 3", "take ours / take theirs / specify — on the active conflict"],
  ["/", "jump to the comparison filter"],
  ["G then A–D", "jump to a zone"],
  ["Tab", "every control, in reading order"],
];

export function AppShell() {
  const { resolved, choice, setChoice } = useTheme();
  const { username, signOut } = useSession();
  const { path, navigate } = useRouter();
  const [keysOpen, setKeysOpen] = useState(false);

  // move focus to the content region on each route change so keyboard and
  // screen-reader users are not stranded on the link they just followed. Skip
  // the first render — the page load already places focus sensibly.
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [path]);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="app-bar">
        <span className="app-bar__brand">ryft</span>

        <div className="app-bar__spacer" />

        <details
          className="app-bar__keys"
          open={keysOpen}
          onToggle={(e) => setKeysOpen((e.target as HTMLDetailsElement).open)}
        >
          <summary>Keyboard</summary>
          <dl className="keymap">
            {KEYS.map(([k, v]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>

        <div className="app-bar__theme" role="group" aria-label="Colour theme">
          {(
            [
              ["light", "Light"],
              ["dark", "Dark"],
              ["system", "System"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              aria-pressed={choice === value}
              onClick={() => setChoice(value)}
            >
              {label}
            </button>
          ))}
        </div>

        {username && (
          <div className="app-bar__session">
            <span className="app-bar__user mono" title={username}>
              {username}
            </span>
            <button
              className="app-bar__signout"
              onClick={() => {
                signOut();
                navigate("/", { replace: true });
              }}
            >
              Sign out
            </button>
          </div>
        )}

        <span className="app-bar__resolved mr-vh">Active theme: {resolved}</span>
      </header>

      {username ? (
        <div className="shl-shell">
          <Rail />
          <main id="main" className="shl-stage" tabIndex={-1} ref={mainRef}>
            <Routes />
          </main>
        </div>
      ) : (
        <main
          id="main"
          className="shl-stage shl-stage--solo"
          tabIndex={-1}
          ref={mainRef}
        >
          <Routes />
        </main>
      )}
    </>
  );
}

import { useState, type ReactNode } from "react";

import { useTheme } from "./theme/useTheme.ts";
import { MergeReview } from "./merge-review/MergeReview.tsx";
import {
  MergeReviewError,
  MergeReviewLoading,
} from "./merge-review/components/ReviewShell.tsx";
import { REVIEW_SCENARIOS, readScenario } from "./merge-review/scenarios.ts";

const KEYS: Array<[string, string]> = [
  ["J / K", "next / previous conflict"],
  ["1 / 2 / 3", "take ours / take theirs / specify — on the active conflict"],
  ["/", "jump to the comparison filter"],
  ["G then A–D", "jump to a zone"],
  ["Tab", "every control, in reading order"],
];

export function App() {
  const { resolved, choice, setChoice } = useTheme();
  const [keysOpen, setKeysOpen] = useState(false);

  // In production this is a data fetch keyed by the merge-request id; here the
  // ?scenario= param selects a shape so every state can be exercised.
  const scenario = readScenario();

  let body: ReactNode;
  if (scenario === "loading") {
    body = <MergeReviewLoading />;
  } else if (scenario === "error") {
    body = (
      <MergeReviewError
        message="The server returned 503 while fetching the three snapshots. This is usually transient."
        onRetry={() => {
          location.search = "";
        }}
      />
    );
  } else {
    body = <MergeReview base={REVIEW_SCENARIOS[scenario]} />;
  }

  return (
    <>
      <a className="skip-link" href="#mr-zone-a">
        Skip to schema comparison
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
        <span className="app-bar__resolved mr-vh">Active theme: {resolved}</span>
      </header>

      <main className="app-main">{body}</main>
    </>
  );
}

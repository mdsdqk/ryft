import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "ryft.theme";

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* private mode / disabled storage — fall through */
  }
  return "system";
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
}

/** Persisted light / dark / system choice. System follows `prefers-color-scheme`. */
export function useTheme(): {
  choice: ThemeChoice;
  resolved: "light" | "dark";
  setChoice: (c: ThemeChoice) => void;
  toggle: () => void;
} {
  const [choice, setChoiceState] = useState<ThemeChoice>(read);
  const [systemDark, setSystemDark] = useState(
    () => typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    apply(choice);
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      /* ignore */
    }
  }, [choice]);

  const setChoice = useCallback((c: ThemeChoice) => setChoiceState(c), []);
  const resolved: "light" | "dark" =
    choice === "system" ? (systemDark ? "dark" : "light") : choice;
  const toggle = useCallback(
    () => setChoiceState(resolved === "dark" ? "light" : "dark"),
    [resolved],
  );

  return { choice, resolved, setChoice, toggle };
}

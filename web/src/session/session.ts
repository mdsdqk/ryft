/**
 * The session is a username and nothing else — PRODUCT.md: "identity is a
 * username, no authentication". A known name resumes, an unknown one is created
 * on the spot. It lives in localStorage so a reload keeps you signed in; there is
 * no token, no expiry, no server check.
 *
 * State is a single module-level store read through `useSyncExternalStore`, so
 * every `useSession()` caller — the shell, the route table, the gate — sees the
 * same value in the same render. A per-hook `useState` would let the shell still
 * read "signed out" right after the gate signed in, and the route guard would
 * bounce straight back to the gate.
 */

import { useSyncExternalStore } from "react";

const KEY = "ryft.user";

function readStorage(): string | null {
  try {
    const v = localStorage.getItem(KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

let current: string | null = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // another tab signing in or out
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) {
      current = readStorage();
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string | null {
  return current;
}

export function signIn(name: string): void {
  const clean = name.trim();
  if (!clean || clean === current) return;
  current = clean;
  try {
    localStorage.setItem(KEY, clean);
  } catch {
    /* private mode — the session lasts for this page only */
  }
  emit();
}

export function signOut(): void {
  if (current === null) return;
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
}

export function useSession(): {
  username: string | null;
  signIn: (name: string) => void;
  signOut: () => void;
} {
  const username = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { username, signIn, signOut };
}

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

/**
 * A client-side sanity bound on the username, counted in Unicode code points.
 * The backend column is `text` (docs/backend-contract.md) and stays
 * authoritative; this only keeps a pathological paste out of React state and the
 * store, and gives the gate a concrete number to report.
 */
export const USERNAME_MAX = 64;

/**
 * Fold a raw typed or stored name to the one form the app keys on: NFC so
 * "é" composed and decomposed compare equal, control and format characters
 * removed (zero-width spaces, BOM, and the bidi overrides that let one name
 * render as another), internal whitespace collapsed, ends trimmed. Idempotent —
 * safe to run on an already-clean value. A username built from a ZWJ emoji
 * sequence loses its joiners; that trade is accepted for the spoofing guard.
 */
export function normalizeUsername(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A rejection from {@link authenticate} carrying a message already written for
 * the person at the gate — `<SignIn>` renders `.message` verbatim in its error
 * slot. `field` is `true` when the name itself is the problem (keep focus on the
 * input), `false` for a transport failure (offer a plain retry).
 */
export class SignInError extends Error {
  readonly field: boolean;
  constructor(message: string, opts: { field: boolean }) {
    super(message);
    this.name = "SignInError";
    this.field = opts.field;
  }
}

function readStorage(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    // a value written by an older build or hand-edited into devtools is folded
    // to the same shape `authenticate` writes, so it resolves and compares.
    return normalizeUsername(raw) || null;
  } catch {
    return null;
  }
}

let current: string | null = readStorage();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

// another tab signing in or out. Bound once for the whole module while anything
// is subscribed, not once per `useSession()` caller.
function onStorage(e: StorageEvent): void {
  if (e.key === KEY || e.key === null) {
    current = readStorage();
    emit();
  }
}
let storageBound = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageBound && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
    storageBound = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageBound) {
      window.removeEventListener("storage", onStorage);
      storageBound = false;
    }
  };
}

function getSnapshot(): string | null {
  return current;
}

function signIn(name: string): void {
  const clean = normalizeUsername(name);
  if (!clean || clean === current) return;
  current = clean;
  try {
    localStorage.setItem(KEY, clean);
  } catch {
    /* private mode — the session lasts for this page only */
  }
  emit();
}

/**
 * The one async seam for taking identity. V0 resolves against local truth only:
 * a username is taken as given (PRODUCT.md — "identity is a username, no
 * authentication"), validated for shape, written to the store, and we are in.
 *
 * V1 swaps the body for `POST /session` (`{ username }` → `{ user, organization }`,
 * docs/backend-contract.md): create-or-resume, no password, no token. Every
 * caller and every state in `<SignIn>` already handles the promise, a
 * `SignInError` rejection, and the retry — nothing else on the surface changes.
 */
export async function authenticate(name: string): Promise<void> {
  const clean = normalizeUsername(name);
  if (!clean) {
    throw new SignInError("Enter a username to continue.", { field: true });
  }
  if ([...clean].length > USERNAME_MAX) {
    throw new SignInError(
      `A username is ${USERNAME_MAX} characters or fewer.`,
      { field: true },
    );
  }
  signIn(clean);
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
  authenticate: (name: string) => Promise<void>;
  signOut: () => void;
} {
  const username = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return { username, authenticate, signOut };
}

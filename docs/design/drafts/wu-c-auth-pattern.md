# DESIGN.md draft — Auth pattern

> Drafted by **WU-C** from the built username gate (`web/src/surfaces/SignIn.tsx`
> + `SignIn.css`, `web/src/session/session.ts`, the guard in
> `web/src/shell/routes.tsx`, the sign-out control in `web/src/shell/AppShell.tsx`).
> WU-G consolidates this into `DESIGN.md` §"Auth pattern". Product rules live in
> `PRODUCT.md` ("Identity is a username, no authentication") and the wire in
> `docs/backend-contract.md` (`POST /session`, the `x-ryft-user` header).

## The model

ryft takes a username as truth. A known name resumes that user; an unknown name
creates one; there is no password, no token, no session store, and no sign-up
step. Impersonation is a documented non-goal, not a guarded one. Every surface
past the gate requires a name and bounces to `/` without one.

This is one screen, one field, one action — the front door, and the reviewer's
first contact from a cold clone. It carries first-impression weight, so it gets a
little more composition than a bare form, but it stays an Operate surface: the
job is to get through it.

## The seam

`authenticate(name): Promise<void>` in `session/session.ts` is the **single async
boundary** for taking identity. V0 resolves it against local truth only —
validate the shape, write the name to `localStorage`, done. V1 swaps the body for
`POST /session` (`{ username }` → `{ user, organization }`); the surface, its
state machine, its error slot, and its retry are already built for the promise
and do not change.

- Rejections are a typed `SignInError { message, field }`. `message` is written
  for the person at the gate and rendered verbatim. `field: true` means the name
  is the problem — keep focus on the input; `field: false` is a transport
  failure — offer a plain retry.
- The store is a module-level value behind `useSyncExternalStore`, so the shell,
  the route table, and the gate all read the same identity in the same render. A
  cross-tab `storage` event re-reads it.

## States

The gate is a five-state machine; the surface owns it, `session.ts` owns the
seam.

| State | Field | Button | Notes |
|---|---|---|---|
| **empty** | placeholder (`grace`, a seed user) | held (`disabled`) | autofocused on load |
| **typing** | value in `--ink` | live | trims before enabling |
| **submitting** | locked | `Signing in…` | guards double-submit |
| **error** | `aria-invalid` when `field`, border → `--conflict-edge` | live again | `role="alert"`; a `1px --conflict-edge` rule across the sheet wipes in with the message; focus returns to the field for a name problem. The HTML field is not capped — `authenticate()` rejects at 64 so this state can fire. |
| _(standing)_ **create-or-resume note** | — | — | always on the sheet; the "unknown name" affordance, never an error or a modal |

## Route guard

`Routes` (`shell/routes.tsx`) is the guard. `/` renders the gate when signed
out and redirects to `/db` when signed in; every other path returns
`<Redirect to="/" />` when there is no name. Redirect is a render-time
`navigate(..., { replace: true })` — no guard flash, no back-button trap. New
surfaces add one line to the flat ladder; they never re-implement the check.

## Sign-out

Lives in the app bar (`AppShell`), shown only with a session: the username in
mono (`title` for the full value, truncated at `20ch`) and a bordered
`Sign out` control that clears the store and `navigate("/", { replace: true })`.

## Visual spec

- **Sheet.** The drafting-room `mr-sheet` (2px `--ink` border, 7px inset rule,
  the one ambient `--shadow-sheet`), `max-width: 420px` — narrower than the app
  sheets — centred on the rail-less **solo stage** (`.shl-stage--solo`).
- **Title strip.** The shared `mr-titlestrip`: `ryft` in the condensed display
  face, uppercase, letter-spaced; `schema under version control` in mono below.
  No dial, no demo tag — the demo context is a mono lede in the body instead.
- **Field.** Mono `Username` caption (10px/600/`0.2em`/uppercase). Square input,
  `1px solid --line-strong`, `--panel` ground, `--ink` text and caret, **16px
  font floor** (iOS focus-zoom). Hover → `--ink` border; invalid →
  `--conflict-edge` border. Focus ring is the global off-palette `--focus`.
- **Action.** `mr-btn mr-btn--primary` — `--ink` ground, `--sheet` text, square,
  uppercase mono. Disabled → `--sheet-2` ground, `--line-strong` border,
  `--ink-faint` text.
- **Copy blocks.** Lede and standing note in mono `--ink-soft`; the note is set
  off by a `1px dashed --line` top rule. Error text in `--conflict`, ≥ 4.5:1 in
  both palettes, under a full-width `1px --conflict-edge` rule across the sheet.
- **Motion.** Exactly one authored moment: that error rule (and its message)
  wipes in left to right (`clip-path: inset(0 100% 0 0)` → `inset(0 0 0 0)`,
  260ms ease-out) — a line drawn across the sheet, not a box that pops. The
  global `prefers-reduced-motion` reset collapses it.

### Named rules

**The One-Seam Rule.** Identity is taken in exactly one place —
`authenticate()`. `useSession()` exposes `username`, `authenticate`, and
`signOut` — not a sync `signIn`. Surfaces never touch storage or the header.

**The Guard-Is-The-Table Rule.** The signed-out redirect lives in `Routes`, once.
A surface unit adds a route line and inherits the guard; it does not gate itself.

**The Note-Not-Dialog Rule.** The consequence of an unknown name (a new user is
created) is stated as standing copy on the sheet. It is never a confirm step, a
modal, or an error.

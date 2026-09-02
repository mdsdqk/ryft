# 002 — Hold-to-confirm on Release to main

- **Status**: DONE
- **Commit**: 4954731
- **Severity**: HIGH
- **Category**: Missed opportunity — feedback
- **Estimated scope**: 2 files

## Problem

Once mergeable, **Release to main** is a plain click. Label ticks to `Releasing…`. The dial and `mr-clear-sweep` (520ms) already fire after success. The irreversible act of the product is easier to fire than a drop.

```tsx
/* web/src/merge-review/components/FabricationOrder.tsx:133 — current */
<button
  className="mr-btn mr-btn--primary mr-fab__release"
  type="button"
  disabled={releasing}
  onClick={onRelease}
>
  {releasing ? "Releasing…" : "Release to main"}
</button>
```

## Target

Hold-to-confirm fill on the primary plate. Overlay `clip-path: inset(0 100% 0 0) → inset(0 0 0 0)`, **2s linear** while pressed, **200ms** `cubic-bezier(0.16, 1, 0.3, 1)` snap-back on release.

The primary button is `--ink` filled; `--ok-wash` (8% green) would not read. Fill with `--ok` so the plate fills in the ok role — same "plate filling" grammar as the clear-sweep.

Pointer: hold 2s then fire. Release / leave / cancel before 2s snaps back and does not fire.
Keyboard: first Enter/Space arms (label → `Confirm release`); second Enter/Space fires; Escape or blur disarms. Do not start the pointer hold from the keyboard.
After fire, leave the existing 520ms `mr-clear-sweep` alone.

```css
.mr-fab__release {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}
.mr-fab__release::before {
  content: "";
  position: absolute;
  inset: 0;
  background: var(--ok);
  clip-path: inset(0 100% 0 0);
  transition: clip-path 200ms var(--ease-mark);
  pointer-events: none;
  z-index: 0;
}
.mr-fab__release[data-holding="true"]::before {
  clip-path: inset(0 0 0 0);
  transition: clip-path 2s linear;
}
.mr-fab__release > .mr-fab__release-label {
  position: relative;
  z-index: 1;
}
@media (prefers-reduced-motion: reduce) {
  .mr-fab__release::before {
    content: none;
  }
  .mr-fab__release[data-holding="true"] {
    background-color: var(--ok);
    transition: background-color 2s linear !important;
  }
  .mr-fab__release:not([data-holding="true"]) {
    transition: background-color 200ms var(--ease-mark) !important;
  }
}
```

The `!important` durations are required to beat `theme.css`'s global `transition-duration: 90ms !important` under reduced motion. The hold must stay 2s.

## Repo conventions to follow

- Curve: `--ease-mark` / `cubic-bezier(0.16, 1, 0.3, 1)` as in `SignIn.css` and `mr-clear-sweep`.
- Clip-path wipe already exists for sign-in errors; this is the same tool used as a fill, not a second motion language.

## Steps

1. Replace the plain `onClick` button in `FabricationOrder.tsx` with a hold/double-enter control. Keep the same classes so layout does not shift.
2. Add the CSS next to `.mr-fab__release` in `web/src/styles/app.css`.
3. Do not change `onRelease` / `releasing` / the sweep.

## Boundaries

- Do NOT add hold-to-confirm on branch delete (Keep / Delete is already the second click).
- Do NOT add `:active { scale }` on `.mr-btn`.
- Do NOT touch `mr-clear-sweep` or the dial.

## Verification

- **Mechanical**: `pnpm --filter @ryft/web typecheck`
- **Feel check**: on a mergeable review, click-and-release immediately — fill snaps back, no release. Hold 2s — plate fills left to right, then `Releasing…`. Keyboard: first Enter changes label, second fires, Escape cancels. DevTools 10%: clip-path inset right edge travels. Reduced motion: background-color fill over 2s, no clip; hold duration still 2s (not 90ms).
- **Done when**: a slip click cannot release; a 2s hold or two Enters can.

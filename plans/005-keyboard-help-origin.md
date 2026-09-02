# 005 — Keyboard-help panel scales from its summary

- **Status**: DONE
- **Commit**: 4954731
- **Severity**: LOW
- **Category**: Missed opportunity — spatial consistency
- **Estimated scope**: 1 file

## Problem

The keyboard-help `<details>` pops the keymap with no origin and no exit.

```css
/* web/src/styles/app.css:65 — current */
.app-bar__keys .keymap {
  position: absolute;
  inset-inline-end: clamp(16px, 4vw, 40px);
  margin-top: 10px;
  background: var(--panel);
  border: 1px solid var(--ink);
  box-shadow: var(--shadow-sheet);
  padding: 14px 16px;
  display: grid;
  gap: 8px;
  min-width: 320px;
}
```

```tsx
/* web/src/shell/AppShell.tsx:82 — current */
<details className="app-bar__keys" open={keysOpen} ...>
```

## Target

Enter: `@starting-style { opacity: 0; transform: scale(0.97) }`, `transform-origin: top right` (the summary), **180ms** `var(--ease-mark)` on `opacity` and `transform`.

Exit faster: **140ms** `ease` (chevron budget already used at `app.css:517`).

`--shadow-sheet` stays; do not add a second shadow. Never `scale(0)`.

```css
.app-bar__keys .keymap {
  transform-origin: top right;
  opacity: 0;
  transform: scale(0.97);
  transition: opacity 140ms ease, transform 140ms ease;
}
.app-bar__keys[open] .keymap {
  opacity: 1;
  transform: scale(1);
  transition:
    opacity 180ms var(--ease-mark),
    transform 180ms var(--ease-mark);
}
@starting-style {
  .app-bar__keys[open] .keymap {
    opacity: 0;
    transform: scale(0.97);
  }
}
.app-bar__keys::details-content {
  transition: content-visibility 140ms allow-discrete, display 140ms allow-discrete;
}
.app-bar__keys[open]::details-content {
  transition: content-visibility 180ms allow-discrete, display 180ms allow-discrete;
}
@media (prefers-reduced-motion: reduce) {
  .app-bar__keys .keymap,
  .app-bar__keys[open] .keymap {
    transform: none;
  }
  @starting-style {
    .app-bar__keys[open] .keymap {
      transform: none;
    }
  }
}
```

`::details-content` + `allow-discrete` is progressive enhancement so exit can run before `display: none`. Enter via `@starting-style` is the required path.

## Repo conventions to follow

- `--shadow-sheet` token already on the panel.
- 140ms ease is the chevron duration in `app.css`.
- `scale(0.97)` not `scale(0)` — AUDIT.md physicality.

## Steps

1. Add the rules to `.app-bar__keys .keymap` in `web/src/styles/app.css`. Do not change `AppShell.tsx` markup.

## Boundaries

- Do NOT animate rail / route swaps.
- Do NOT add a second shadow or a bounce.
- Do NOT change the KEYS content.

## Verification

- **Mechanical**: `pnpm --filter @ryft/web typecheck`
- **Feel check**: on a merge review, open Keyboard — panel scales from the top-right, 180ms. Close — faster 140ms ease. DevTools 10%: origin is the summary corner, never center, never scale(0). Reduced motion: opacity only.
- **Done when**: the panel is spatially attached to Keyboard; reduced motion drops the scale.

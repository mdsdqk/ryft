# 004 — Armed delete and drop-confirm come forward as a surface

- **Status**: DONE
- **Commit**: 4954731
- **Severity**: MEDIUM
- **Category**: Missed opportunity — state indication + preventing a jarring change
- **Estimated scope**: 2 files

## Problem

Arming Delete snaps the branch row to a confirm plate. Drop swaps the in-row editor for the warn strip in one frame.

```css
/* web/src/surfaces/Branches.css:130 — current */
.br-row--armed,
.br-row--held {
  grid-template-columns: 1fr;
  gap: 10px;
  align-items: start;
  outline: 1.5px solid var(--ink);
  outline-offset: -1.5px;
  background: var(--panel);
  padding: 14px 13px;
}
```

```tsx
/* web/src/surfaces/branch/fields.tsx:90 — DropConfirm mounts instantly */
<div className="bw-ed bw-ed--warn" role="group" aria-label={`Drop ${what}`}>
```

## Target

Reuse the queue's surface idea (color/outline, not a new overlay). Do not animate layout (`padding`, `grid-template-columns`).

Armed row — **200ms** `var(--ease-mark)` on `outline-color` and `background-color` into `--panel` + 1.5px ink ring. Held: same, into `--conflict-edge` / `--conflict-wash`.

Confirm strip — same **260ms** `ryft-rule-in` clip-path wipe as errors (a rule drawn across the card). Apply to `.br-row__plate` and `.bw-ed--warn` (DropConfirm and table-drop strip).

No hold-to-confirm here — Keep / Delete is already the second click.

```css
.br-row {
  outline: 1.5px solid transparent;
  outline-offset: -1.5px;
  transition:
    outline-color 200ms var(--ease-mark),
    background-color 200ms var(--ease-mark);
}
.br-row--armed {
  outline-color: var(--ink);
  background: var(--panel);
  /* existing padding / grid snap stays */
}
.br-row--held {
  outline-color: var(--conflict-edge);
  background: var(--conflict-wash);
}
.br-row__plate,
.bw-ed--warn {
  animation: ryft-rule-in 260ms var(--ease-mark) both;
}
```

Reduced motion: global 90ms color; 1ms one-shot on the wipe.

## Repo conventions to follow

- Queue surface: `web/src/styles/app.css` `.mr-cf` `background 160ms ease, border-color 160ms ease` — color/outline, never layout.
- Wipe: `ryft-rule-in` from plan 003 (depends on that keyframe existing).

## Steps

1. Split `.br-row--armed, .br-row--held` so outline-color differs; add the 200ms transition on `.br-row`.
2. Animate `.br-row__plate` with `ryft-rule-in`.
3. Animate `.bw-ed--warn` with `ryft-rule-in`. Do not animate `.bw-ed` (row editors).

## Boundaries

- Do NOT hold-to-confirm delete.
- Do NOT animate `.bw-ed` open (WU-E locked row expand as a visibility toggle).
- Do NOT animate padding or grid.

## Verification

- **Mechanical**: `pnpm --filter @ryft/web typecheck`
- **Feel check**: arm Delete on a branch — ink ring eases in 200ms, plate wipes 260ms. Held-by-merge: conflict wash, same wipe. Open a column drop confirm: warn strip wipes, editor open still instant. Reduced motion: color in 90ms, wipe present not animated.
- **Done when**: arming is a surface change, not a teleport; row expand is still instant.

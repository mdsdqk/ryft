# 001 — Stamp the just-applied schema row and log line

- **Status**: DONE
- **Commit**: 4954731
- **Severity**: HIGH
- **Category**: Missed opportunity — state indication + spatial consistency
- **Estimated scope**: 4 files

## Problem

On apply, `bw-row--changed` and a new `△N` operations line appear in one frame. There is no bridge between the card and the timeline. This is the product's claim — a rename is recorded as a rename — and it currently happens in a blink.

```css
/* web/src/surfaces/branch/branch.css:137 — current */
.bw-row--changed {
  background: var(--ours-wash);
  outline: 1.5px solid var(--ours);
  outline-offset: -1.5px;
}
```

```tsx
/* web/src/surfaces/branch/TableCard.tsx:61 — current */
<div className={`bw-row${seq !== undefined ? " bw-row--changed" : ""}`}>
```

```tsx
/* web/src/surfaces/branch/OperationList.tsx:41 — current */
<li key={e.seq} className="bw-ops__entry">
```

Must not run on first paint of an already-marked schema (Divergence and merge-review tables stay still). Only the row/entry whose `seq` just landed.

## Target

Shared curve already in the repo (dial, sweep, sign-in): `--ease-mark: cubic-bezier(0.16, 1, 0.3, 1)` in `web/src/styles/theme.css`.

Just-applied row (class `bw-row--landing`, only when `seq` equals the seq that appeared this session):

```css
.bw-row {
  outline: 1.5px solid transparent;
  outline-offset: -1.5px;
}
.bw-row--changed {
  background: var(--ours-wash);
  outline-color: var(--ours);
}
.bw-row--landing {
  transition:
    outline-color 220ms var(--ease-mark),
    background-color 220ms var(--ease-mark);
}
@starting-style {
  .bw-row--landing.bw-row--changed {
    outline-color: transparent;
    background-color: transparent;
  }
}
.bw-row--landing .mr-tri {
  opacity: 1;
  transition: opacity 220ms var(--ease-mark);
}
@starting-style {
  .bw-row--landing .mr-tri {
    opacity: 0;
  }
}
```

Just-applied log line (`bw-ops__entry--landing`):

```css
.bw-ops__entry--landing {
  transition:
    opacity 220ms var(--ease-mark),
    transform 220ms var(--ease-mark);
}
@starting-style {
  .bw-ops__entry--landing {
    opacity: 0;
    transform: translateX(-6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .bw-ops__entry--landing {
    transform: none;
  }
  @starting-style {
    .bw-ops__entry--landing {
      transform: none;
    }
  }
}
```

Track `landedSeq` in `SchemaView`: on `operations` update, if max `seq` increased vs the previous value for this branch, that seq just landed. Reset the previous max when `name` changes. First paint (`prev === null`) must not set `landedSeq`.

## Repo conventions to follow

- Curve: `cubic-bezier(0.16, 1, 0.3, 1)` — `web/src/styles/app.css` dial advance and `web/src/surfaces/SignIn.css` rule-in.
- Reduced motion: global `theme.css` already forces `transition-duration: 90ms` and `animation-duration: 1ms`. Extra rule only to drop `translateX`.
- Animate `transform` / `opacity` plus the two properties this world already uses as marks: outline-color and wash. No new shadows, no bounce.

## Steps

1. Add `--ease-mark: cubic-bezier(0.16, 1, 0.3, 1);` to `:root` in `web/src/styles/theme.css`.
2. In `SchemaView.tsx`, keep `prevMaxSeq` in a ref, `landedSeq` in state; pass `landedSeq` to `TableCard` and `OperationList`.
3. In `TableCard.tsx`, add `bw-row--landing` when `seq === landedSeq`.
4. In `OperationList.tsx`, add `bw-ops__entry--landing` when `e.seq === landedSeq`.
5. Add the CSS in `branch.css` as specified.

## Boundaries

- Do NOT animate Divergence / ComparisonTable / merge-review rings.
- Do NOT animate row expand or the hover `edit` hint.
- Do NOT add Framer Motion or new dependencies.
- Do NOT animate first paint of an already-marked schema.

## Verification

- **Mechanical**: `pnpm --filter @ryft/web typecheck`
- **Feel check**: apply a rename on a branch with existing marks. Only the touched row's ring/wash and the new log line should move; already-marked rows stay still. Reload the page: no stamp replay. Undo: no reverse stamp (seq decreased). DevTools 10% playback: ring fills, triangle fades, log line slides 6px. Toggle `prefers-reduced-motion`: opacity/color only, no translateX.
- **Done when**: a just-applied row stamps; first paint of a marked schema does not.

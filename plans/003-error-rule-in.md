# 003 — One ruled-line wipe on every alert

- **Status**: DONE
- **Commit**: 4954731
- **Severity**: MEDIUM
- **Category**: Missed opportunity — preventing a jarring change + feedback
- **Estimated scope**: 6 files

## Problem

Sign-in errors wipe in as a ruled line. Editor refusals, merge kick-backs, create-form errors, and delete-held messages pop.

```css
/* web/src/surfaces/SignIn.css:104 — current (the grammar to extract) */
.si__error {
  animation: si-rule-in 260ms cubic-bezier(0.16, 1, 0.3, 1) both;
}
@keyframes si-rule-in {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
```

Missing the same motion: `.bw-ed__err`, `.mr-fab__err`, `.br-create__err`, `.db-create__err`, `.bw-mraction__err`. Do not invent a second error motion.

## Target

Move the keyframes to `theme.css` as `ryft-rule-in`, duration **260ms**, timing `var(--ease-mark)`. Point every alert rule at that animation. Sign-in keeps its class and border; only the `@keyframes` name is shared.

```css
/* theme.css */
@keyframes ryft-rule-in {
  from { clip-path: inset(0 100% 0 0); }
  to { clip-path: inset(0 0 0 0); }
}
```

```css
/* each consumer */
.si__error,
.bw-ed__err,
.mr-fab__err,
.br-create__err,
.db-create__err,
.bw-mraction__err {
  animation: ryft-rule-in 260ms var(--ease-mark) both;
}
```

Reduced motion: existing global `animation-duration: 1ms` so the rule is present, not animated.

## Repo conventions to follow

- Sign-in is the exemplar: `web/src/surfaces/SignIn.css:95–113` and the MOTION comment in `SignIn.tsx`.
- Keyframes live once; surfaces only attach the animation.

## Steps

1. Add `@keyframes ryft-rule-in` to `web/src/styles/theme.css`.
2. Switch `.si__error` to `animation: ryft-rule-in 260ms var(--ease-mark) both;` and delete local `@keyframes si-rule-in`.
3. Attach the same animation to `.bw-ed__err` (`branch.css`), `.mr-fab__err` (`app.css`), `.br-create__err` (`Branches.css`), `.db-create__err` (`Dashboard.css`), `.bw-mraction__err` (`branch.css`).

## Boundaries

- Do NOT restyle error copy, add shadows, or change markup.
- Do NOT animate `ReviewShell` full-page error (not a ruled alert line).
- Do NOT give warnings (`.bw-ed__note`) this motion.

## Verification

- **Mechanical**: `pnpm --filter @ryft/web typecheck`
- **Feel check**: trigger sign-in error, a column-editor refusal, a merge release error, and a create-branch error. Each should wipe left to right in 260ms like sign-in. Reduced motion: the message is there in one frame.
- **Done when**: every `role="alert"` ruled error uses `ryft-rule-in`; no second error animation exists.

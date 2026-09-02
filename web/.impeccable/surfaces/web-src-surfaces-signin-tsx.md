---
version: 1
slug: "web-src-surfaces-signin-tsx"
primary_target: "web/src/surfaces/SignIn.tsx"
related_targets:
  - "web/src/surfaces/signinArrival.ts"
  - "web/src/surfaces/SignIn.css"
---

# Surface brief: / (username gate)

- **Scope / mode:** Operate with a Persuade opening — the signed-out gate at `/`; also the reviewer's first screen from a cold clone.
- **Audience / job:** One person per device, first thing. See the product's claim (a schema merge that follows a rename), type a username, get in. A known name resumes that user; a new name creates one; there is no sign-up step and no password.
- **Action:** One text input (the only text input in the app besides the branch-create field) and one primary "Sign in". Enter submits. `authenticate()` in `session/session.ts` is the single async seam — V1 swaps its body for `POST /session` and the surface does not change. Focus waits until the arrival timeline completes (or is skipped).
- **Proof / content:** A miniature Zone A of the seed story (`users.email` / `col_users_email_9f31`, contact-fields against main): ours renames `email` to `email_address`, theirs adds a unique index on `email`, leader `index follows to email_address`. Placeholder `grace`. Standing note states create-or-resume and the impersonation non-goal — inline, never a modal or an error. No invented customers, testimonials, or metrics.
- **Constraints:** Established world (The Revised Drawing). Full-stage sheet, `max-width: 1080px`, two columns (claim | title-block gate), centred on the rail-less solo stage. V1 states only: empty · typing · submitting · error. Error wipe stays CSS (`ryft-rule-in`). Arrival is GSAP CustomEase `ryftMark` matching `--ease-mark`; skipped under `prefers-reduced-motion`. No second CTA, no marketing sections, no new typeface.
- **Direction / memorable moment:** Walking up to the drawing. Two-line claim inks word by word; the inset border draws; the proof fragment stamps ours, then theirs, then the ok leader. The gate is a title block (Drawing / Sheet / Entered as) with a plate-stamp Sign in. The error is a rule drawn across the gate, not a red box.
- **Unresolved:** `POST /session` wiring and a created-vs-resumed confirmation on the response are V1 backend work (WU outside this unit). Distinct username format rules (the backend `422` case) are deferred to `/impeccable clarify`.

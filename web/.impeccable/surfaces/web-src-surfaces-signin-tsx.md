---
version: 1
slug: "web-src-surfaces-signin-tsx"
primary_target: "web/src/surfaces/SignIn.tsx"
related_targets: []
---

# Surface brief: / (username gate)

- **Scope / mode:** Operate — the signed-out gate at `/`; also the reviewer's first screen from a cold clone.
- **Audience / job:** One person per device, first thing. Type a username and get in. A known name resumes that user; a new name creates one; there is no sign-up step and no password.
- **Action:** One text input (the only text input in the app besides the branch-create field) and one primary "Sign in". Enter submits. `authenticate()` in `session/session.ts` is the single async seam — V1 swaps its body for `POST /session` and the surface does not change.
- **Proof / content:** Placeholder `grace` (a seed user). A mono lede naming the seeded demonstration workspace. A standing note stating create-or-resume and the impersonation non-goal — inline, never a modal or an error.
- **Constraints:** Established world (The Revised Drawing). Sheet is `max-width: 420px`, centred on the rail-less solo stage. V1 states only: empty · typing · submitting · error. One motion moment: the error line wipes in left-to-right (`clip-path` inset), killed by `prefers-reduced-motion`. Code-led.
- **Direction / memorable moment:** A drawing's title block being filled in — mono field caption, a ruled square entry, a plate-stamp action. The error is a rule drawn across the sheet, not a red box.
- **Unresolved:** `POST /session` wiring and a created-vs-resumed confirmation on the response are V1 backend work (WU outside this unit). Distinct username format rules (the backend `422` case) are deferred to `/impeccable clarify`.

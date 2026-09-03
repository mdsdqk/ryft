---
version: 1
slug: "web-src-surfaces-signin-tsx"
primary_target: "web/src/surfaces/SignIn.tsx"
related_targets: ["web/src/surfaces/SignIn.css","web/src/surfaces/SignInField.tsx"]
---

# Surface brief: / (username gate — the front door)

- **Scope / mode:** Persuade — the signed-out gate at `/`, treated as the product's front door; also the reviewer's first screen from a cold clone. The rest of the app stays Operate; this is the one surface that opens loud.
- **Audience / job:** One person per device, first thing. Read what ryft is in a few seconds, then type a username and get in. A known name resumes that user; a new name creates one; there is no sign-up step and no password.
- **Action:** One text input and one primary "Sign in". Enter submits. `authenticate()` in `session/session.ts` is the single async seam — V1 swaps its body for `POST /session` and the surface does not change.
- **Proof / content:** The nameplate, a one-line pitch ("A schema version control system"), the one-line description, the three facts that carry the product (rename keeps the column / merge is a typed report / main is the schema of record), a 1-2-3 "How it works", placeholder `grace`, and a standing create-or-resume + no-password note — inline, never a modal or an error.
- **Constraints:** Inherits The Revised Drawing palette, tokens, border ladder, and square corners. Additions this surface introduces: a serif nameplate face (`--ff-mark`, Fraunces 700) used **only** here, and a full-bleed generative field. Sheet is `min(430px, 100%)`, left-aligned over the field on the solo stage. States: empty · typing · submitting · error.
- **Direction / memorable moment:** The generative field — two provenance fronts, `ours` (prussian) in the upper half and `theirs` (oxide) in the lower, woven into one drifting band with a turbulence swell through the centre where they cross; that weave is the merge. `ours` / `theirs` labels sit at diagonally opposite corners. `SignInField.tsx` (canvas): DPR capped at 2, ~40fps, paused while hidden, one static frame under `prefers-reduced-motion`, re-reads the palette on theme change. The in-sheet error still wipes in left-to-right (`ryft-rule-in`).
- **Unresolved:** `POST /session` wiring and a created-vs-resumed confirmation are V1 backend work. Distinct username format rules (the backend `422` case) are deferred to `/impeccable clarify`. Whether the field should also carry a one-time draw-in on load (vs. drift-only) is still open — drift-only ships now.

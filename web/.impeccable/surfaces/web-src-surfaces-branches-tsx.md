---
version: 1
slug: "web-src-surfaces-branches-tsx"
primary_target: "web/src/surfaces/Branches.tsx"
related_targets: []
---

# Surface brief: /branches

- **Scope / mode:** Operate — the branches list at `/branches`.
- **Audience / job:** An engineer on the database, starting a schema change or cleaning up after a merge. See every branch, cut one from `main`, delete one that is not held.
- **Action:** Cut from main (title-strip field). Open is the branch name. Delete confirms on the row and names what is lost. An open merge request blocks delete and says why. Empty working list: trunk row stays; first-run notice + **Create branch** focuses the plate.
- **Proof / content:** Fixture data matching the worked example (`contact-fields` by grace, held by MR 1). `main` is listed as a non-deletable trunk row. Demonstration-data tag on the strip. V0 exercise: `?empty` hides working rows.
- **Constraints:** Established world (The Revised Drawing). V0: no motion, no sort/filter, no modal. Create is an always-visible title-block field, not a popover. Code-led.
- **Direction / memorable moment:** The title strip's right cell is the create plate; arming Delete brings that row forward on the sheet the way the conflict queue brings one card forward.
- **Unresolved:** Production fetch-by-id; sort/filter (decision 8, V1). Rail count is working branches only (omits `main`). Name-rule gloss and a signed-out Cut explanation are `/impeccable clarify`.

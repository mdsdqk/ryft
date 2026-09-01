---
version: 1
slug: "web-src-surfaces-merges-tsx"
primary_target: "web/src/surfaces/Merges.tsx"
related_targets: ["web/src/surfaces/Merges.css","web/src/data/merges.ts"]
---

# Surface brief: /merges

- **Scope / mode:** Operate — the merge-requests list at `/merges`.
- **Audience / job:** An engineer checking the merge queue, or responding to a merge notification. See every open request; enter one to review it.
- **Action:** The row is the action — `source → main` opens `/merge/:id`. There is no create on this surface (that lives on the branch workspace). Empty: “No open merge requests.” + **View branches**.
- **Proof / content:** Fixture queue, oldest first: drop-legacy-tags (stale base), contact-fields (held · 1 conflict, the worked example), post-metrics (clean). Demonstration-data tag on the strip. V0 exercise params: `?empty`, `?error`, `?loading`, `?long`.
- **Constraints:** Established world (The Revised Drawing). Consumes the WU-A list pattern; does not define one. V0: no motion, no sort/filter, no create, no delete. Code-led.
- **Direction / memorable moment:** Oldest-first queue on a drafting sheet. Status is a 9px lamp plus the word. The empty sheet still has a way out — to the branches.
- **Unresolved:** Production fetch-by-id; sort/filter (decision 8, V1). Dashboard (WU-D) now shares `mergeStatusLabel` / `mergeStatusTone` so a stale row is not labelled Clean.

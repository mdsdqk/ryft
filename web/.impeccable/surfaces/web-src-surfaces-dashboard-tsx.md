---
version: 1
slug: "web-src-surfaces-dashboard-tsx"
primary_target: "web/src/surfaces/Dashboard.tsx"
related_targets: ["web/src/surfaces/Dashboard.css","web/src/data/database.ts"]
---

# Surface brief: /db

- **Scope / mode:** Operate — the database overview at `/db`, the landing sheet after sign-in.
- **Audience / job:** An engineer returning to the database. Orient: what this namespace is, what `main`'s shape is, what is in flight. Cut a branch from here without going to `/branches` first.
- **Action:** Cut from main (title-strip field, mirrors `/branches`). Trunk name opens `/branch/main`. Open-merge rows open `/merge/:id`. Branch rows open `/branch/:name`. Overflow is "N more branches →" to `/branches`. Empty merges: “Nothing waiting to merge.” (no action). Empty branches: “No branches yet.” + **Create branch** focusing the plate.
- **Proof / content:** Fixture overview (`public`, 5 tables). Working branches newest-first, capped at 6. Open merges oldest-first, all of them. Demonstration-data tag on the strip. V0 exercise params: `?empty` (also zeros the rail via `getOverview`), `?error`, `?loading`, `?long`, `?busy`.
- **Constraints:** Established world (The Revised Drawing). Consumes the WU-A list pattern; does not define one. V0: no motion, no charts, no activity graph, no schema preview of `main`, no delete. Code-led.
- **Direction / memorable moment:** Title-strip Cut plate. Overview is a drawing title-block (ink-soft keys, `1px --line` dt rule), not a stat grid. Two in-flight lists keep their headings when empty.
- **Unresolved:** Production fetch-by-id (API exists, seam still fixture). Sort/filter never on this surface.

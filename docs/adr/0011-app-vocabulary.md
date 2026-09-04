# ADR 0011 — App vocabulary: adopt SQL / VCS terms, retire the drafting metaphor's coined words

Status: accepted. Prompted by a usability review with a real user (`docs/usability-review-triage.md`,
theme A). No engine or API change — this is a naming call for the web UI, plus the small
visual tweaks the same review named. `decisions.log.md` carries the running narrative
(`decisions.md` is the curated record).

## Context

The web surfaces were built around DESIGN.md's "The Revised Drawing" north star — a
mechanical-drafting revision sheet. That metaphor is load-bearing for the *visual* language
(bone ground, hatch, square corners, one shadow, the small mono plate type) and it stays.
But it also put invented words in front of the user: *cut* a branch, *sheets* for
navigation, *drawing*, *fabrication order*, and a merge lifecycle of *received / in-check /
cleared / released*. The reviewer — the intended user, a DBA / application engineer who
already speaks SQL and Git — repeatedly could not tell what these meant.

## Decision

**User-facing text uses the term a Postgres DBA or a Git user already knows.** A coined term
is used only where the concept is genuinely novel and nothing existing fits.

Concrete renames landed in this pass:

| Was | Now | Where |
|---|---|---|
| "Cut" / "Cut from main" / "Cutting…" | "Create" / "New branch from main" / "Creating…" | branch create plate (`/db`, `/branches`) |
| "cut from" / "· cut `<date>`" | "branched from" / "· branched `<date>`" | list subtitles, row meta, branch workspace subtitle |
| "Merges" | "Merge requests" | rail nav, `/merges` sheet title, `/db` zone |
| "sheets" (rail aria-labels, hint paragraph, "No such sheet") | "views" / removed / "Page not found" | `Rail.tsx`, `routes.tsx` |
| "Demonstration data" tag on every sheet | removed (`demo` prop deleted from `SurfaceSheet`) | all four list/detail sheets — the seeded workspace is explained once at sign-in |
| "Main changed" | "main last updated" | `/db` overview facts |
| "`main` @ rev N" / "at revision N" | "updated `<date>`" | rail database line, `/db` subtitle — `trunkRevision` was a non-functional fixture number; a real revision counter is a stretch item (triage theme H) |
| "Object · stable id" (comparison gutter header) | "Table object" | merge review Zone A, branch Divergence |
| Merge lifecycle: Received / In check / Cleared / Released | **Queued / Under review / Reviewed / Merged** | `STATUS_LABEL` in `merge-review/format.ts`, dial, Zone D prose, conflict-queue record line |
| "Revision status" (dial label) | "Status" | `RevisionDial` |
| TitleBlock rows: Drawing / Merge / Rebased / Checker | Table (→ "Tables" when the merge spans several) / Merging / Auto-adjusted / Review | `merge-review/components/TitleBlock.tsx` |
| "Release to main" / "Releasing…" | "Merge into main" / "Merging…" | Zone D primary action |

The internal identifiers are **unchanged**: the `RevisionStatus` union keys
(`received | in-check | cleared | released`), the `merge_request_status` pg enum, the
`cutOn` field name, CSS class names (`br-create`, `mr-fab__release`), and route paths
(`/merges`, `/branch/:name`). Only what the screen shows changed, so tests that assert on
status *keys* still hold.

### Visual tweaks carried in the same pass (review theme A / E / G)

- Column specs render SQL keywords cased as DDL writes them — `uuid · NOT NULL · DEFAULT 'x'`
  — so a constraint reads as a constraint, not as part of the type (`columnSpec`).
- The app-bar session cluster (username + Sign out) is set off from the theme group by a
  divider, and a brightness glyph labels the theme group, so the username no longer floats
  between two bordered controls.
- The rail names the open branch / merge request in a heading row above its nested views,
  and the permanently-disabled "History" link is gone (the declarative model has no history).

## What did not change

The drafting *visual* system stays exactly as DESIGN.md specifies. The △N "revision" marks,
the `RevisionTriangle`, the "Revisions" count, and the Zone A/B/C/D structure of the merge
review are unchanged — those are internally consistent and the reviewer did not flag them.
"On ours" / "On theirs" stays: standard three-way-merge vocabulary, and the reviewer
explicitly said to leave it.

## Consequences

- CONTEXT.md keeps "branch is *cut* from main" in the model glossary — that is prose about
  the branching model, not UI copy — but the app no longer surfaces the verb "cut".
- A future revision-highlighting feature (triage theme H) would reintroduce a "revision N"
  label on `main`, backed by a real counter, not the fixture number removed here.

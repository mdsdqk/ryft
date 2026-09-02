# Motion plans

From the gated opportunities in [animation opportunities](4438af28-8af8-4b43-96d4-077cb4e2f4d4). V0 “no motion” was a delivery cut; these five extend the existing mark-advancing grammar (`cubic-bezier(0.16, 1, 0.3, 1)`). They are not a motion system.

Rejected on purpose (do not implement): rail/route swaps, conflict-queue expand, row-expand / hover `edit`, Divergence ring draw-in, empty-state delight, `.mr-btn` press scale, comparison accordion height.

| # | Title | Severity | Status |
| --- | --- | --- | --- |
| 001 | Stamp the just-applied schema row and log line | HIGH | DONE |
| 002 | Hold-to-confirm on Release to main | HIGH | DONE |
| 003 | One ruled-line wipe on every alert | MEDIUM | DONE |
| 004 | Armed delete and drop-confirm come forward as a surface | MEDIUM | DONE |
| 005 | Keyboard-help panel scales from its summary | LOW | DONE |

## Execution order

1. **003** first — extracts `ryft-rule-in` and `--ease-mark` that 001/004/005 reuse.
2. **001** — apply stamp (highest leverage).
3. **002** — release hold (independent).
4. **004** — depends on 003’s keyframes.
5. **005** — independent; uses `--ease-mark`.

## Dependencies

- 001, 002, 004, 005 need `--ease-mark` in `theme.css` (introduced with 003).
- 004 needs `@keyframes ryft-rule-in` from 003.

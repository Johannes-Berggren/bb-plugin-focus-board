# UAT report

_Generated 2026-10-15T03:39:43.893Z by `npm run uat`._

## pane-reference-chips

Source: `tests/manual/uat-pane-reference-chips.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| Agent-written reference tokens paint as labeled chips, not dead text | pass | ✓ text hidden: "@project:proj_api"; ✓ text hidden: "@thread:thr_glyph_glue#msg=12" |
| Clicking a thread chip opens that thread in the board's pane | pass | ✓ pane shows thr_glyph_glue; ✓ url ends with /board/t/thr_glyph_glue |

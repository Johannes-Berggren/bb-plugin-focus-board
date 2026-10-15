# UAT report

_Generated 2026-10-15T04:25:06.090Z by `npm run uat`._

## group-zoom

Source: `tests/manual/uat-group-zoom.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| The board opens unfiltered — the boxed members and an ungrouped thread all visible | pass | ✓ text visible: "Refactor grouping.ts column sort keys"; ✓ text visible: "Write E2E test for drag-to-done"; ✓ text visible: "Research: bb plugin RPC auth tokens"; ✓ text visible: "chat-imagegent" |
| Right-clicking the box and choosing Zoom to group restricts the board to that group | pass | ✓ text visible: "Refactor grouping.ts column sort keys"; ✓ text visible: "Write E2E test for drag-to-done"; ✓ text hidden: "Research: bb plugin RPC auth tokens" |
| The stored group restrict re-opens the board filtered (the refresh-restore path) | pass | ✓ text visible: "Refactor grouping.ts column sort keys"; ✓ text visible: "Write E2E test for drag-to-done"; ✓ text hidden: "Research: bb plugin RPC auth tokens" |

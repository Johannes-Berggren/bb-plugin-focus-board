## Environment

- Focus Board 1.1.1-dev (branch `bb/fix-view-switching-bugs-thr_cte95vu8xb`, fix landed in the same session)
- macOS (Darwin), headless Chrome via the repo's screenshot harness (`scripts/screenshot/`)
- Repro evidence: `docs/screenshots/repro-pinned-viewswitch/` (pre-fix probe: `pre-fix-probe.txt`, before/after column snapshots: `evidence.json`)

## Reproduction steps (headless, no bb server)

1. Start the harness: `npm run build` once, then `npx vite --config scripts/screenshot/vite.config.ts --port 5199`.
2. Open `http://localhost:5199/?groupBy=parent&demo=1` (Parent view).
3. Right-click a child card (e.g. `thr_demo_work_c0` of the working demo family) → **Pin**. The card shows its pin badge in its row cell — the pin is applied.
4. Open the toolbar **View** menu → **Attention**.

The scripted repro (`node scripts/screenshot/repro-pinned-viewswitch.mjs`) drives exactly this flow; runs A/B round-trip views without pinning as controls, run D pins from inside the Attention view as a control.

## Expected result

The pinned child renders in the Attention view's far-left **Pinned** column, wearing its pin badge — the pin applied in the Parent view survives the view switch (pins are bb thread state, not per-view state).

## Actual result

The pin silently vanishes from the board: the card nests back under its unpinned parent (`Working` column) as a nested row, and nested rows do not render the pin badge. The card's context menu still offers **Unpin** — the data is pinned — so the pin is state-present but board-invisible. Same loss occurs pinning a child directly and then leaving/re-entering the Attention view (the pinned child is drained out of Pinned by the family-nesting pass under **any** grouping that nests it, project/provider/machine included).

## Workarounds

None. Unpinning/re-pinning from the Attention view does not survive a round-trip either while the child nests.

## Recommendation (fix + regression tests)

`childPlacement` (components/nesting.ts) treats a live pinned child like an ordinary quiet child → `"nest"`. A pinned child should stand alone the way attention children already do (pin is an operator-intent state; `buildColumns` leads every grouping with the Pinned lane). The fix adds a pinned check ahead of the grouping rules (after the done check — Done precedes the pin, mirroring `buildColumns`' own split), and two failing-first regression tests in `tests/nesting.test.ts` cover both the solo flatten and sibling-keeps-nesting cases. The end-to-end harness probe (`scripts/screenshot/probe-pinned-child.mjs`) verified the card lands in `pinned` with its badge after the switch post-fix.
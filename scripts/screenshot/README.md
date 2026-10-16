# Screenshot harness

Renders the real plugin app (app.tsx + components/) against a mocked
`@get-bb/plugin-sdk/app` with simulated threads, then captures the README
screenshots in `docs/screenshots/` with headless Chrome. No bb server or
host app involved.

- `data.ts` — simulated projects, providers, and threads (shapes mirror the
  SDK's `PluginSidebarThread`), plus `SIM_DEMO_THREADS`: three fresh demo
  families (Working/expanded, Needs-you/collapsed, Unread/expanded) appended
  in demo mode so shots show nested child threads both folded and unfolded
  in the attention lanes — the base fixture's families are deliberately old
  (parent-lane UAT stability) and never surface there.
- `mock-sdk.tsx` — SDK stand-in: hooks return the simulated state,
  `ThreadChat` renders a canned conversation, and `useBbNavigate` drives a
  minimal real-history router (hash-based) so UAT suites can exercise the
  app's pane-history behavior with genuine browser back/forward. Its `useSdk`
  returns one stable object across renders — a per-render object loops the
  app (effect deps + setState). Vite aliases the SDK specifier
  here, so the app code runs unmodified. `?demo=1` switches the simulated
  sidebar to the base fixture plus the demo families; suites never set it.
- `main.tsx` — seeds localStorage from the query string (`?groupBy=…`,
  `?collapsed=` folds family cards by seeding the persisted
  collapsed-families list) and mounts the registered panel component through
  the mock router.
- `index.html` — defines bb's built-in theme tokens (extracted from the bb
  app bundle): the dark set on `html.dark`, a light set on `html:not(.dark)`,
  plus a minimal preflight (the plugin's compiled CSS ships without one
  because the host app provides it) and the `data-bb-plugin="focus-board"`
  attribute so the compiled utilities' scoping matches.
- `shoot.mjs` — the capture driver. Captures three shots in both themes,
  toggling the `dark` class per pass: board with the thread pane open
  (1920x1080), plus board and thread pane at phone size (390x844) —
  `name-dark.png` / `name-light.png` files.
- `repro-markread-mobile.mjs` — one-shot headless repro for the mobile
  thread-actions bug (#14): opens a thread pane at phone size (390x844),
  dumps the pane header's control list to
  `docs/screenshots/repro-markread-mobile/evidence.json`, and captures
  `phone-thread-pane.png`. Run the vite harness first (same as above),
  then `node scripts/screenshot/repro-markread-mobile.mjs`; honors the
  same `CHROME_PATH` and `HARNESS_URL` overrides.
- `repro-child-row-chips.mjs` — one-shot headless repro/verification for the
  nested-row ticket chips fix (#191): loads the demo Working family — whose
  child `thr_demo_work_c3` carries a `#16` text ref — and exits non-zero
  unless the nested row renders its condensed chip and no anchor nests inside
  the row's own link. Artifacts land in `docs/screenshots/repro-child-row-chips/`
  (two screenshots plus `evidence.json`; the pre-fix run's failing evidence
  was captured into `docs/screenshots/repro-child-row-chips-prefix/` by
  running the script with `OUT_DIR` pointed there before the fix). Run the
  vite harness first (same as above), then `node
  scripts/screenshot/repro-child-row-chips.mjs`; honors the same `CHROME_PATH`
  and `HARNESS_URL` overrides, plus `OUT_DIR`.
- `repro-done-scroll-yank.mjs` — one-shot headless regression driver for the
  post-done re-scroll yank (#119): opens a pane on the Unread card
  (`thr_uat_queue`) at 1280x800, marks it done via the on-card checkbox,
  closes the pane, jumps the board to `scrollLeft` 0, forces hover/refresh
  re-renders, and exits non-zero unless the board rests at 0. Artifacts land
  in `docs/screenshots/repro-done-scroll-yank/` (five stage screenshots plus
  `evidence.json`). Run the vite harness first (same as above), then
  `node scripts/screenshot/repro-done-scroll-yank.mjs`; honors the same
  `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR` overrides.
- `capture-toolbar-tint.mjs` — one-shot header capture for the toolbar's
  band tint: shots the toolbar in dark then light, desktop (1920x1080) and
  phone (390x844), and exits non-zero unless all four states resolve the
  band's computed `bg-muted/50` background. Artifacts land in
  `docs/screenshots/repro-toolbar-tint/` (four clips plus `evidence.json`).
  Run the vite harness first (same as above), then
  `HARNESS_URL=... node scripts/screenshot/capture-toolbar-tint.mjs`;
  honors the same `CHROME_PATH` and `HARNESS_URL` overrides.

- `repro-right-gutter.mjs` — one-shot headless repro for the family card's
  right gutter (#192): measures a demo family card with a ticket chip and
  expanded nested children (`thr_demo_gutter`, `?demo=1`) on the columns
  board — card box vs the lane's right edge, and the anchor, title, chip
  rows, nested rows, and sub-rows vs the card's right edge — then measures
  the parent-lanes board's lane cells (`?groupBy=parent`, the parent renders
  as a lane there). Exits non-zero when any content surface sits closer than
  CELL_PAD (4px) to the card's right edge or a lane boundary is crossed.
  Artifacts land in `docs/screenshots/repro-right-gutter/` (`evidence.json`,
  `evidence-before-fix.json`, two card clips). Run the vite harness first
  (same as above); honors the same `CHROME_PATH`, `HARNESS_URL`, and
  `OUT_DIR` overrides.

- `repro-clipped-selector.mjs` — one-shot headless probe for the family card's
  child-row list rest state (the "Fix clipped selector" report): loads the
  ten-child demo family `thr_demo_big`, measures the card's child-thread
  section geometry at four panel widths, then gives the capped rows list a
  9px wheel-sized scroll and reads the rest position. Exits non-zero unless
  the rest lands snapped on a row boundary and no measured surface sits past
  the card's edges (pre-fix code rests at 9px and
  slices the first row mid-glyph at the cap's edge). Artifacts land in
  `docs/screenshots/repro-clipped-selector/` (card clips per width plus
  `evidence.json`; the pre-fix run is preserved in
  `docs/screenshots/repro-clipped-selector-prefix/` via `OUT_DIR`). Run the
  vite harness first; honors the same `CHROME_PATH`, `HARNESS_URL`, and
  `OUT_DIR` overrides.

- `repro-ghost-gutter-strip.mjs` — one-shot headless repro/verification for
  the parent view's ghost duplicate card strip (#227): loads the parent board
  (`?groupBy=parent&demo=1`), opens a lane pane, hovers that lane's first
  card with real mouse moves, and exits non-zero unless no card ids duplicate,
  the card count never grows, nothing renders in the gutter band (board right
  edge → pane left edge), and no cell keeps a stuck FLIP transform. Artifacts
  land in `docs/screenshots/repro-ghost-gutter-strip/` (a pane-open rest
  shot, a hover shot, plus `evidence.json`; the pre-fix run is preserved in
  `docs/screenshots/repro-ghost-gutter-strip-prefix/` via `OUT_DIR`). Run the
  vite harness first (same as above); honors the same `CHROME_PATH`,
  `HARNESS_URL`, and `OUT_DIR` overrides.

Regenerate the screenshots:

```sh
npm i --no-save puppeteer-core   # uses the system Chrome, no download
npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
node scripts/screenshot/shoot.mjs                     # terminal 2
```

`CHROME_PATH` and `HARNESS_URL` override the Chrome binary and harness URL.
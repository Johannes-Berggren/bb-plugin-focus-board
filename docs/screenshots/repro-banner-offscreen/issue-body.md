## Environment

- Host: macOS (darwin), Google Chrome 155, board rendered at 1280×800 desktop viewport
- Focus Board dev lineage (`0.6.x/1.1.1-dev`); headless evidence captured through the screenshot harness (`scripts/screenshot/`, mocked SDK, no bb server needed)

## Reproduction steps

1. Open the board with a fixture that overflows horizontally — the screenshot harness base board at 1280×800 already does (`clientWidth` 1280 vs `scrollWidth` 2444).
2. Let any of the four alert banners surface: the rank refusal (`rank-error-banner`), a sweep notice, a browser-reveal notice, or a sweep refusal. A standalone repro is at `scripts/screenshot/repro-banner-offscreen.mjs` (run the vite harness, then the script).
3. Scroll the board horizontally to its right edge.
4. Read `docs/screenshots/repro-banner-offscreen/evidence.json`: after the full-right scroll the banner's message text sits at `textRight: −288.5` — fully off the viewport's left edge.

Root cause: all four banners are rendered as in-flow children of the board's own `overflow-x-auto` scroll container (`[data-columns-board]` in `components/board.tsx`). They therefore live in the scrollable coordinate space instead of being bound to the viewport: the scroll gesture carries the banner — message and dismiss control included — offscreen, and nothing scrolls it back.

## Expected result

Alert banners are viewport furniture: they stay fixed relative to the visible viewport regardless of the board's horizontal scroll position, with message and dismiss controls always reachable.

## Actual result

The banner scrolls with the columns. Once the board is scrolled right, the message (and with a long message, even the dismiss button's lane) ends up horizontally offscreen; the operator cannot read or dismiss the banner without first scrolling the board back to its start.

## Workarounds

Scroll the board back toward its left edge so the banner re-enters the viewport. No other workaround; the banner cannot be dismissed while offscreen.

## Recommendation

Render the banner row above the horizontal scroll surface (a wrapper outside `[data-columns-board]`, keeping the existing `role="status"` markup and dismiss behaviors). A regression test already fails on the unfixed tree and pins the invariant: a visible banner must never be a descendant of the scroll container (`tests/board-banner-viewport.test.tsx`).

Pre-commit evidence (synthetic banner injected exactly where the production banners render, real app layout, Chrome 155):

| State | Banner rect (viewport coords) | Text right edge | Offscreen? |
|---|---|---|---|
| At scroll origin | 24 … 1256 | 875.5 | no |
| Board scrolled fully right (scrollLeft 1164) | −1140 … 92 | −288.5 | **yes, entirely** |
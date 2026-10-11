# Tech debt — bb-plugin-focus-board

Each entry: what breaks or smells, where, why it is not fixed inline, and how
to verify it is still there.

## Nested `<a>` elements in thread cards (Invalid DOM)

Card anchors (`<a href="/projects/…/threads/<id>"`, `data-thread-card`) wrap
the whole card, and anything clickable inside renders another `<a>`: the
ticket chips' provider mark and every ticket id (`components/thread-card.tsx`,
`ProviderTicketChip` and the old `TicketChip` before it), plus menu items.
React logs `In HTML, <a> cannot be a descendant of <a>` on every render of a
card with chips; in the screenshot harness (vite client console) it fires on
every chip-bearing card, both themes. Browsers cope by reparenting, so clicks
and hovers behave, but the DOM is invalid, screen readers can nest
interactive contexts, and hydration would flag it.

Where: any card with ticket chips; also `ThreadCardMenu` items rendered
inside the card anchor.

Why not fixed inline: reparenting the chips out of the card anchor is a
structural change to the card's click and drag surfaces (the anchor is the
open-thread target and the drag source), touching
`components/thread-card.tsx`, the menu composition, and the drag-hit rules in
`components/board.tsx`; the same invalid nesting exists pane-side where cards
are not anchors, so the fix should define one interactive-element policy for
both surfaces rather than a spot patch.

Discovered: 2026-10-10, screenshot harness client console while probing the
provider chips (`scripts/screenshot/probe-chips.mjs`).

Verify still present: `node scripts/screenshot/probe-chips.mjs` against a
running vite harness; the "cannot contain a nested `<a>`" React console.error
fires per chip-bearing card.

## Nested `<a>` elements in thread cards (Invalid DOM)
// The card spotlight's hand-written rule (issue #123 and its follow-ups).
//
// The compiled app.css is Tailwind over class tokens spelled out in the plugin
// source, and the old spotlight was three hand-copied arbitrary-variant class
// strings on the board roots (the arm, the 300ms delay, and the 300ms
// duration — same exemption chain repeated three times). One injected
// <style> element keeps the rule stated ONCE: the arm (`:has` a hovered card
// div), the recede target (card divs that are neither hovered nor immune),
// and the debounce live in a single block with a single exemption list.
//
// The recede never stacks on an existing dim: cards carrying
// `data-spotlight-immune` (components/card-status.ts — pane-open, sweep
// -highlighted, attention, or already-faded) are exempt, and the hovered card
// itself is exempt through `:hover`. Sweep-highlighted cards match the marker
// too, so the recede no longer names `data-sweep-highlighted` itself.

import { useEffect } from "react";

export const CARD_SPOTLIGHT_STYLE_ID = "focus-board-card-spotlight";

export const CARD_SPOTLIGHT_RULE = `/* The card spotlight (issue #123): while ONE card is under the pointer, every
   other card recedes a step. Arms on a hovered card div; recedes only card
   divs that are NOT hovered and NOT immune (data-spotlight-immune, computed
   by components/card-status.ts). Debounce: a 300ms rest before the dim, then
   a 300ms ease in; the un-dim rides the card's own persistent 150ms
   zero-delay transition, so releasing the spotlight stays snappy. */
[data-columns-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover):not([data-spotlight-immune]),
[data-parent-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover):not([data-spotlight-immune]) {
  opacity: 0.7;
  transition-delay: 300ms;
  transition-duration: 300ms;
}`;

export function ensureCardSpotlightStyles(): void {
  if (document.getElementById(CARD_SPOTLIGHT_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = CARD_SPOTLIGHT_STYLE_ID;
  style.textContent = CARD_SPOTLIGHT_RULE;
  document.head.append(style);
}

/**
 * Mount the spotlight rule once, idempotently — both board renderers call
 * this, however many boards the app shows.
 */
export function useCardSpotlightStyles(): void {
  useEffect(() => {
    ensureCardSpotlightStyles();
  }, []);
}
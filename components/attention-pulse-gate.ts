// The attention pulse's visible-only gate (issue #260).
//
// The board's attention treatment is an infinite `animate-pulse` on the card
// overlay and on the collapsed strip's child-dot glyph. A board full of
// attention cards runs one animation per card, and past ~100 simultaneous
// animations Chromium's main thread cannot keep up: a 478-card board with 204
// pulsing cards idles at ~28 fps and drops two thirds of its frames, while the
// same board with the animations killed holds 60 fps (the numbers live in
// docs/screenshot evidence for #260). Almost all of those animations are on
// cards the operator cannot see — a phone viewport shows ~11 of 204.
//
// So the pulse animates only while it is actually on screen: one shared
// IntersectionObserver parks every pulse element that leaves the viewport
// (`data-pulse-parked`, which the injected rule turns into `animation: none`),
// and unparks it the moment it scrolls back in. An off-screen card keeps the
// full attention treatment — the amber overlay border, the solid amber dot —
// it just holds still, and the operator never sees the difference. Only the
// handful of pulses on screen ever animate, which lands far under the cliff at
// every width (phone and 1920-wide alike).
//
// The gate is deliberately framework-free and touches no React state: the ref
// observes an element the card already renders, so parking a pulse re-renders
// nothing (the property that kept hover off the render path in #261) and adds
// no fiber per pulse. jsdom has no IntersectionObserver, so tests and any
// non-browser environment leave every pulse exactly as it renders today.

import { useEffect } from "react";

/**
 * DOM id of the injected pulse-gate `<style>` element. Doubles as the
 * idempotency key for `ensurePulseGateStyles` and the lookup handle for tests;
 * only one element with this id ever exists per document.
 */
export const PULSE_GATE_STYLE_ID = "focus-board-pulse-gate";

/**
 * The attribute a parked (off-screen) pulse element carries. `registerPulseGate`
 * sets it when the element leaves the viewport and removes it when the element
 * returns; the rule below is what stops the animation.
 */
export const PULSE_PARKED_ATTR = "data-pulse-parked";

/**
 * The gate rule: a parked pulse holds its static treatment instead of
 * animating. `!important` is needed because the compiled `motion-safe:
 * animate-pulse` utility sets the animation through a shorthand of equal
 * specificity, and the parked state must win wherever both apply.
 */
export const PULSE_GATE_RULE = `[${PULSE_PARKED_ATTR}] { animation: none !important; }`;

/** One shared observer for every pulse element on the page; lazy, so jsdom
 *  (no IntersectionObserver) never constructs one and never parks anything.
 *  Recreated if the global constructor's identity changes (a test stub, or a
 *  page whose IO implementation was swapped), so the singleton never observes
 *  through a stale implementation. */
let observer: IntersectionObserver | null = null;
let observerCtor: typeof IntersectionObserver | null = null;

function ensurePulseGateStyles(): void {
  if (document.getElementById(PULSE_GATE_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = PULSE_GATE_STYLE_ID;
  style.textContent = PULSE_GATE_RULE;
  document.head.append(style);
}

function ensurePulseObserver(): IntersectionObserver {
  ensurePulseGateStyles();
  const current = IntersectionObserver;
  if (observer !== null && observerCtor === current) return observer;
  observer = new current(
    (entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting) element.removeAttribute(PULSE_PARKED_ATTR);
        else element.setAttribute(PULSE_PARKED_ATTR, "");
      }
    },
    // No root and no margin: the pulse runs whenever any part of it is in the
    // viewport, exactly the "visible dots pulse, the rest hold still" rule.
    {},
  );
  observerCtor = current;
  return observer;
}

/**
 * Ref callback for a pulsing element. A stable module-level function, so React
 * never tears the observation down and re-adds it on an unchanged node; the
 * returned cleanup (React 19 ref cleanup) unobserves on unmount. An element
 * starts unparked — the observer's first callback, which fires on the next
 * frame, parks it if it is off screen.
 */
export function attentionPulseRef(element: HTMLElement | null): (() => void) | void {
  if (element === null) return;
  if (typeof IntersectionObserver !== "function") return;
  element.removeAttribute(PULSE_PARKED_ATTR);
  const shared = ensurePulseObserver();
  shared.observe(element);
  return () => shared.unobserve(element);
}

/**
 * Mount the gate's stylesheet once, idempotently — both board renderers call
 * this, so the parked rule exists however many boards the app shows.
 */
export function useAttentionPulseGate(): void {
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    ensurePulseGateStyles();
  }, []);
}

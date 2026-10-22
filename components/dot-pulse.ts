// The working dot's rate pulse (issue #279).
//
// A collapsed child tree paints each member as a status dot. A `working` dot is
// flat blue today, so a thread streaming tokens and a thread that has been quiet
// for a minute look identical. This module gives the dot a breathing period
// derived from the thread's measured token burn (lib/pulse-rate.ts): fast
// thread, fast breath.
//
// Two cost rules, both reasons this is CSS instead of a render loop:
//
// - the animation is opacity-only and lives in ONE injected stylesheet keyed by
//   the `data-dot-pulse` attribute, with the period passed as a custom
//   property. React never re-renders a dot to animate it, and the browser never
//   re-lays-out one: opacity is a compositor-only change.
// - the animated glyph rides the existing visible-only gate
//   (components/attention-pulse-gate), so an off-screen dot parks through the
//   same `[data-pulse-parked] { animation: none !important; }` rule the
//   attention treatment already uses. Only the handful of dots on screen ever
//   animate, which is what keeps a board full of working threads off the
//   animation cliff the gate was built for.
//
// The `prefers-reduced-motion: no-preference` wrapper is the stylesheet's
// `motion-safe:`: with motion reduced, `data-dot-pulse` renders a plain dot.

import { useEffect, type CSSProperties } from "react";

/** DOM id of the injected stylesheet; the idempotency key and the test handle.
 *  Only one element with this id ever exists per document. */
export const DOT_PULSE_STYLE_ID = "focus-board-dot-pulse";

/** The `@keyframes` name the injected rule animates. */
export const DOT_PULSE_ANIMATION_NAME = "focus-board-dot-pulse";

/** The attribute a rate-pulsing dot carries. Its VALUE is the period in
 *  milliseconds, which is what the browser tests and the probes read. */
export const DOT_PULSE_ATTR = "data-dot-pulse";

/** The custom property carrying the period into the injected rule, so the
 *  animation duration never needs its own per-dot rule. */
export const DOT_PULSE_PERIOD_VAR = "--dot-pulse-period";

/** The injected stylesheet. Exported so tests assert the exact text rather than
 *  a paraphrase of it. */
export const DOT_PULSE_STYLE_TEXT =
  `@media (prefers-reduced-motion: no-preference) { [${DOT_PULSE_ATTR}] { ` +
  `animation: ${DOT_PULSE_ANIMATION_NAME} var(${DOT_PULSE_PERIOD_VAR}) ease-in-out infinite; } } ` +
  `@keyframes ${DOT_PULSE_ANIMATION_NAME} { 50% { opacity: 0.55; } }`;

function ensureDotPulseStyles(): void {
  if (document.getElementById(DOT_PULSE_STYLE_ID) !== null) return;
  const style = document.createElement("style");
  style.id = DOT_PULSE_STYLE_ID;
  style.textContent = DOT_PULSE_STYLE_TEXT;
  document.head.append(style);
}

/**
 * Mount the dot-pulse stylesheet once, idempotently. Both board renderers call
 * this beside `useAttentionPulseGate`, so the rule exists however many boards
 * the app shows.
 */
export function useDotPulseStyles(): void {
  useEffect(() => {
    ensureDotPulseStyles();
  }, []);
}

/**
 * The inline style a pulsing dot carries: just the period. The animation itself
 * comes from the injected rule, so swapping the period on a re-render is a
 * single custom-property write with no stylesheet churn.
 */
export function dotPulseStyle(periodMs: number): CSSProperties {
  return { [DOT_PULSE_PERIOD_VAR]: `${periodMs}ms` } as CSSProperties;
}

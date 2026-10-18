/**
 * Probe-only wrapper around the real ThreadCard: counts renders into
 * `globalThis.__cardRenders` so a probe can measure how many cards a single
 * interaction re-renders. The production card is untouched; vite.probe.config
 * aliases the real module to this one for performance probes only (the dev
 * harness and the shipped bundle never see it), which is what makes
 * scripts/screenshot/probe-rerenders.mjs reproducible without a temporary
 * edit to components/thread-card.tsx.
 *
 * The wrapper is deliberately NOT memoized, so it runs whenever the board
 * re-renders a card — the count is board-driven renders, which is what the
 * probes measure. It renders the real card as an ELEMENT rather than calling
 * it, because the card is itself a memo component since issue #186: a memo
 * object is not callable as a function component.
 */
import { createElement, type ComponentProps } from "react";
import { ThreadCard as RealThreadCard } from "@/components/thread-card";

export * from "@/components/thread-card";

export function ThreadCard(props: ComponentProps<typeof RealThreadCard>) {
  const g = globalThis as unknown as { __cardRenders?: number };
  g.__cardRenders = (g.__cardRenders ?? 0) + 1;
  return createElement(RealThreadCard, props);
}

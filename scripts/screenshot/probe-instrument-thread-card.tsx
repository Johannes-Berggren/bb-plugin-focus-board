/**
 * Probe-only wrapper around the real ThreadCard: counts renders into
 * `globalThis.__cardRenders` so a probe can measure how many cards a single
 * interaction re-renders. The production card is untouched; vite.probe.config
 * aliases the real module to this one for performance probes only (the dev
 * harness and the shipped bundle never see it), which is what makes
 * scripts/screenshot/probe-rerenders.mjs reproducible without a temporary
 * edit to components/thread-card.tsx.
 */
import type { ComponentProps } from "react";
import { ThreadCard as RealThreadCard } from "@/components/thread-card";

export * from "@/components/thread-card";

export function ThreadCard(props: ComponentProps<typeof RealThreadCard>) {
  const g = globalThis as unknown as { __cardRenders?: number };
  g.__cardRenders = (g.__cardRenders ?? 0) + 1;
  return RealThreadCard(props);
}

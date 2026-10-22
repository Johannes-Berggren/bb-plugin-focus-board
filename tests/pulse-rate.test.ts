// The pulse-rate math behind the working dot's breathing (issue #279): the
// period mapping and the burn-rate derivation are pure functions with no bb
// and no DOM, so the whole band is pinned here instead of in a board test.
//
// The band copies the Activity Overview reference (thread thr_s5vbtjtgwe) so
// the two plugins read alike: a rate of 1 token/s is the base period, a 10x
// rate is exactly 10x faster, and the band spans exactly 10x. The unmeasured
// state is the honest null, and it holds the slow end — never a freeze, never
// a strobe.
import { describe, expect, it } from "vitest";
import {
  PULSE_BASE_PERIOD_MS,
  PULSE_MAX_PERIOD_MS,
  PULSE_MIN_PERIOD_MS,
  PULSE_REFERENCE_RATE,
  burnRate,
  clampPulsePeriodMs,
  pulsePeriodMs,
  type PulseSample,
} from "../lib/pulse-rate";

describe("pulsePeriodMs", () => {
  it("paces the band so a 10x rate is exactly 10x faster", () => {
    // The band is built from PULSE_REFERENCE_RATE and the two ends, so the
    // ratio assertion is the invariant: whatever the constants become, a 10x
    // rate must be a 10x shorter period.
    const slow = pulsePeriodMs(PULSE_REFERENCE_RATE);
    const fast = pulsePeriodMs(PULSE_REFERENCE_RATE * 10);
    expect(fast).toBeCloseTo(slow / 10, 9);
  });

  it("holds the band's slow end for the reference rate", () => {
    expect(pulsePeriodMs(PULSE_REFERENCE_RATE)).toBe(PULSE_MAX_PERIOD_MS);
  });

  it("the base period IS the slow end, so the unmeasured pulse is the slowest", () => {
    expect(PULSE_BASE_PERIOD_MS).toBe(PULSE_MAX_PERIOD_MS);
    expect(pulsePeriodMs(null)).toBe(PULSE_BASE_PERIOD_MS);
  });

  it("the band spans exactly the documented width", () => {
    expect(PULSE_MAX_PERIOD_MS / PULSE_MIN_PERIOD_MS).toBe(10);
  });

  it("clamps a measured zero at the slow end instead of freezing or strobing", () => {
    expect(pulsePeriodMs(0)).toBe(PULSE_MAX_PERIOD_MS);
    expect(pulsePeriodMs(-5)).toBe(PULSE_MAX_PERIOD_MS);
  });

  it("clamps both ends across the whole band", () => {
    for (const rate of [1e-9, 0.0001, 0.5, 2, 20, 1e6, 1e9]) {
      const period = pulsePeriodMs(rate);
      expect(Number.isFinite(period)).toBe(true);
      expect(period).toBeGreaterThanOrEqual(PULSE_MIN_PERIOD_MS);
      expect(period).toBeLessThanOrEqual(PULSE_MAX_PERIOD_MS);
    }
    // Far below the reference: pinned to the slow end. Far above: the fast end.
    expect(pulsePeriodMs(1e-9)).toBe(PULSE_MAX_PERIOD_MS);
    expect(pulsePeriodMs(1e9)).toBe(PULSE_MIN_PERIOD_MS);
  });

  it("is monotonic: a faster rate is never a slower period", () => {
    let previous = Number.POSITIVE_INFINITY;
    for (const rate of [0.01, 0.1, 0.5, 1, 2, 5, 10, 100, 1000]) {
      const period = pulsePeriodMs(rate);
      expect(period).toBeLessThanOrEqual(previous);
      previous = period;
    }
  });

  it("fails loud on a non-finite rate instead of silently breathing at base", () => {
    expect(() => pulsePeriodMs(Number.NaN)).toThrow(/finite/);
    expect(() => pulsePeriodMs(Number.POSITIVE_INFINITY)).toThrow(/finite/);
    expect(() => pulsePeriodMs(Number.NEGATIVE_INFINITY)).toThrow(/finite/);
  });

  it("clampPulsePeriodMs exposes the same clamp the mapping relies on", () => {
    expect(clampPulsePeriodMs(-1)).toBe(PULSE_MIN_PERIOD_MS);
    expect(clampPulsePeriodMs(1e9)).toBe(PULSE_MAX_PERIOD_MS);
    expect(clampPulsePeriodMs(1234)).toBe(1234);
  });
});

describe("burnRate", () => {
  const NOW = 1_000_000;
  const WINDOW = 60_000;
  const sample = (at: number, used: number): PulseSample => ({ at, used });

  it("returns null until two readings are in the window", () => {
    expect(burnRate([], NOW, WINDOW)).toBeNull();
    expect(burnRate([sample(NOW - 1000, 500)], NOW, WINDOW)).toBeNull();
  });

  it("reads tokens per second from the window's growth", () => {
    // 6000 tokens across 60s is 100 tokens/s.
    const samples = [
      sample(NOW - 60_000, 0),
      sample(NOW - 30_000, 3000),
      sample(NOW, 6000),
    ];
    expect(burnRate(samples, NOW, WINDOW)).toBeCloseTo(100, 9);
  });

  it("ignores readings older than the window", () => {
    const samples = [
      sample(NOW - 120_000, 0),
      sample(NOW - 90_000, 100_000),
      sample(NOW - 10_000, 100_050),
      sample(NOW, 100_100),
    ];
    // Only the last two are inside the window: 50 tokens over 10s.
    expect(burnRate(samples, NOW, WINDOW)).toBeCloseTo(5, 9);
  });

  it("counts a compaction as zero growth, never negative burn", () => {
    const samples = [
      sample(NOW - 20_000, 100_000),
      sample(NOW - 10_000, 40_000), // context shrank: compaction, not burn
      sample(NOW, 40_500),
    ];
    // 500 tokens over the window's 20s: the shrink contributes nothing, the
    // growth that follows it does.
    expect(burnRate(samples, NOW, WINDOW)).toBeCloseTo(25, 9);
  });

  it("a flat ring is a measured zero, not an absence", () => {
    const samples = [sample(NOW - 10_000, 700), sample(NOW, 700)];
    expect(burnRate(samples, NOW, WINDOW)).toBe(0);
  });

  it("is order-independent (the ring is append-ordered but never trusted for it)", () => {
    const samples = [sample(NOW, 6000), sample(NOW - 60_000, 0), sample(NOW - 30_000, 3000)];
    expect(burnRate(samples, NOW, WINDOW)).toBeCloseTo(100, 9);
  });

  it("returns null when the window cannot span time", () => {
    // Two readings at the same instant: no span, so no honest rate.
    expect(burnRate([sample(NOW, 10), sample(NOW, 20)], NOW, WINDOW)).toBeNull();
  });

  it("keeps the whole window even when many readings are inside it", () => {
    const samples: PulseSample[] = [];
    for (let i = 0; i <= 60; i++) samples.push(sample(NOW - (60 - i) * 1000, i * 10));
    // 600 tokens over 60s.
    expect(burnRate(samples, NOW, WINDOW)).toBeCloseTo(10, 9);
  });
});

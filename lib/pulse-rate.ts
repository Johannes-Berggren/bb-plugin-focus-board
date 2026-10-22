// The pulse-rate math behind a working dot's breathing (issue #279): how fast
// a thread is spending tokens becomes how fast its dot pulses.
//
// The band is copied from the Activity Overview plugin's burn-rate pulse
// (thread thr_s5vbtjtgwe) so the two boards read alike. It spans exactly 10x,
// the reference rate sits at the slow end, and the unmeasured state holds that
// same slow end. Nothing here touches bb or the DOM: the sampler
// (lib/thread-pulse.ts) owns the reading, this module owns the arithmetic.

/**
 * Tokens per second that maps to {@link PULSE_MAX_PERIOD_MS}. A thread burning
 * the reference rate breathes at the slow end; ten times that rate breathes
 * ten times faster.
 */
export const PULSE_REFERENCE_RATE = 1;

/** The slowest period in the band (ms): the reference rate, and also the
 *  unmeasured state, so a thread that cannot be measured is indistinguishable
 *  from a thread that is barely moving. */
export const PULSE_MAX_PERIOD_MS = 2200;

/** The fastest period in the band (ms): reached at 10x the reference rate and
 *  held for anything faster, so a runaway rate can never strobe. */
export const PULSE_MIN_PERIOD_MS = 220;

/** The period a dot pulses at when no rate is known. Equal to
 *  {@link PULSE_MAX_PERIOD_MS} by construction: "unmeasured" and "measured at
 *  the reference rate" must look the same, because a slower-than-that pulse
 *  would claim a measurement the sampler does not have. */
export const PULSE_BASE_PERIOD_MS = PULSE_MAX_PERIOD_MS;

/** Clamp a raw period into the band. Exported so a caller that already has a
 *  period (a stored preference, a test double) lands on the same numbers the
 *  rate mapping produces. */
export function clampPulsePeriodMs(periodMs: number): number {
  if (!Number.isFinite(periodMs)) {
    throw new RangeError(`clampPulsePeriodMs: period must be finite, got ${periodMs}`);
  }
  if (periodMs < PULSE_MIN_PERIOD_MS) return PULSE_MIN_PERIOD_MS;
  if (periodMs > PULSE_MAX_PERIOD_MS) return PULSE_MAX_PERIOD_MS;
  return periodMs;
}

/**
 * The period (ms) a working dot pulses at for a token burn rate in tokens per
 * second.
 *
 * - `null` is the honest unmeasured state and holds the base period.
 * - a measured `<= 0` (a flat context, or a compacted one) also holds the slow
 *   end: zero burn means "not moving", and mapping it to an infinite period
 *   would freeze the dot into looking idle.
 * - a non-finite rate throws. A `NaN` that silently became "base period" would
 *   hide a broken producer behind a plausible-looking animation.
 */
export function pulsePeriodMs(rate: number | null): number {
  if (rate === null) return PULSE_BASE_PERIOD_MS;
  if (!Number.isFinite(rate)) {
    throw new RangeError(`pulsePeriodMs: rate must be finite, got ${rate}`);
  }
  if (rate <= 0) return PULSE_MAX_PERIOD_MS;
  return clampPulsePeriodMs((PULSE_MAX_PERIOD_MS * PULSE_REFERENCE_RATE) / rate);
}

/** One context-usage reading: the thread's used-token count at a moment. */
export interface PulseSample {
  at: number;
  used: number;
}

/**
 * Tokens per second a thread burned across the readings inside
 * `[nowMs - windowMs, nowMs]`, or `null` when the whole ring cannot answer.
 *
 * The rules exist so the number is never a lie:
 * - fewer than two readings in the window is `null`, not zero, because one
 *   reading carries no interval to divide by;
 * - only POSITIVE deltas count: a shrink is a compaction (the context was
 *   rewritten), which is not a negative burn and must not cancel real work
 *   measured beside it;
 * - the denominator is the readings' own span, so the answer stays honest when
 *   the ring is short or the events were sparse.
 */
export function burnRate(
  samples: readonly PulseSample[],
  nowMs: number,
  windowMs: number,
): number | null {
  const floor = nowMs - windowMs;
  const fresh = samples.filter((sample) => sample.at >= floor && sample.at <= nowMs);
  if (fresh.length < 2) return null;
  const ordered = [...fresh].sort((a, b) => a.at - b.at);
  const first = ordered[0] as PulseSample;
  const last = ordered[ordered.length - 1] as PulseSample;
  const spanMs = last.at - first.at;
  if (spanMs <= 0) return null;
  let growth = 0;
  for (let index = 1; index < ordered.length; index++) {
    const delta = (ordered[index] as PulseSample).used - (ordered[index - 1] as PulseSample).used;
    if (delta > 0) growth += delta;
  }
  return (growth * 1000) / spanMs;
}

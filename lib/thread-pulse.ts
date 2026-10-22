// The server-side sampler behind the working dot's pulse (issue #279).
//
// The board cannot read a thread's token burn from the sidebar payload: bb's
// `PluginSidebarThread` carries status and unread state but no usage numbers,
// and the only honest source is `bb.sdk.threads.context`, one call per thread.
// Polling that for every thread on the board would be the latency the operator
// forbade, so the sampler is event-driven and demand-gated instead:
//
// - a reading is taken only when a thread emits a token-usage event
//   (`thread/tokenUsage/updated` or `thread/contextWindowUsage/updated`), which
//   is exactly when its used-token count can have moved;
// - one thread is read at most once per `SAMPLE_MIN_GAP_MS`, so a burst of
//   usage events costs one call, not one call per event;
// - nothing at all is read until a client asks for rates
//   (`beginDemand`), and sampling stops again `DEMAND_TTL_MS` after the last
//   ask. No board open means no board polling means zero reads.
//
// The arithmetic (window filtering, compaction handling, the period band) lives
// in lib/pulse-rate.ts; this module only owns when to read and what to keep.

import { burnRate, type PulseSample } from "./pulse-rate";

/** How long a ring is kept (and how far back a rate looks), one hour. Long
 *  enough that a thread which paused for a few minutes still has an interval to
 *  measure, short enough that an abandoned ring ages out. */
export const SAMPLE_SPAN_MS = 60 * 60_000;

/** The floor on how often one thread is read. Token usage arrives in bursts
 *  (every streamed delta can carry one), and one reading every three seconds
 *  resolves the same burn curve for a fraction of the calls. */
export const SAMPLE_MIN_GAP_MS = 3_000;

/** Hard cap on readings held per thread, independent of the window, so a
 *  pathological event stream cannot grow a ring without bound. */
export const SAMPLE_RING_CAP = 600;

/** How long a client's ask keeps the sampler alive. Longer than the client's
 *  poll interval, so an open board never lets the lease lapse between polls. */
export const DEMAND_TTL_MS = 60_000;

/** The thread-event types whose arrival means the used-token count may have
 *  changed. Anything else costs one array lookup and no read. */
export const TOKEN_EVENT_TYPES: readonly string[] = [
  "thread/tokenUsage/updated",
  "thread/contextWindowUsage/updated",
];

export interface ThreadPulseTrackerOptions {
  /** Tests freeze the clock; production leaves it to `Date.now`. */
  now?: () => number;
  /** Read a thread's used-token count. `null` means "no reading", which is not
   *  the same as a zero and must never be recorded as one. */
  readUsedTokens: (threadId: string) => Promise<number | null>;
  /** A failed read is surfaced here and nowhere else: one unreadable thread
   *  must not stop the sampler for the rest. */
  onSampleError?: (threadId: string, error: unknown) => void;
  windowMs?: number;
  minGapMs?: number;
  ringCap?: number;
  demandTtlMs?: number;
}

export interface ThreadPulseTracker {
  /**
   * Offer a thread-changed event to the sampler. Reads only when the event
   * carries a token-usage type, the demand lease is fresh, and the thread's
   * minimum gap has passed. Never rejects.
   */
  noteEvent: (threadId: string, eventTypes: readonly string[] | undefined) => Promise<void>;
  /** Rate in tokens per second per measurable thread. A thread absent from the
   *  answer has no measurable rate yet: absence is the honest "unknown". */
  rates: () => Record<string, number>;
  /** Record that a client wants rates, extending the lease. */
  beginDemand: () => void;
  /** Readings currently held for a thread (tests, and the sampler's own
   *  pruning assertions). */
  sampleCount: (threadId: string) => number;
}

export function createThreadPulseTracker(
  options: ThreadPulseTrackerOptions,
): ThreadPulseTracker {
  const now = options.now ?? (() => Date.now());
  const windowMs = options.windowMs ?? SAMPLE_SPAN_MS;
  const minGapMs = options.minGapMs ?? SAMPLE_MIN_GAP_MS;
  const ringCap = options.ringCap ?? SAMPLE_RING_CAP;
  const demandTtlMs = options.demandTtlMs ?? DEMAND_TTL_MS;

  const rings = new Map<string, PulseSample[]>();
  /** Per thread, the clock at its last read ATTEMPT (not last success), so a
   *  failing thread is throttled exactly like a working one. */
  const lastAttemptAt = new Map<string, number>();
  let demandUntil = Number.NEGATIVE_INFINITY;

  const inWindow = (sample: PulseSample, floor: number, ceiling: number): boolean =>
    sample.at >= floor && sample.at <= ceiling;

  /** Drop readings that have aged out of the window, and rings that empty as a
   *  result, so a long-lived plugin does not accumulate dead arrays. */
  const prune = (at: number): void => {
    const floor = at - windowMs;
    for (const [threadId, ring] of rings) {
      const kept = ring.filter((sample) => inWindow(sample, floor, at));
      if (kept.length === 0) rings.delete(threadId);
      else if (kept.length !== ring.length) rings.set(threadId, kept);
    }
  };

  const isTokenEvent = (eventTypes: readonly string[] | undefined): boolean => {
    if (eventTypes === undefined) return false;
    for (const type of eventTypes) {
      if (TOKEN_EVENT_TYPES.includes(type)) return true;
    }
    return false;
  };

  return {
    async noteEvent(threadId, eventTypes) {
      const at = now();
      if (at > demandUntil) return;
      if (!isTokenEvent(eventTypes)) return;
      const last = lastAttemptAt.get(threadId);
      if (last !== undefined && at - last < minGapMs) return;
      lastAttemptAt.set(threadId, at);
      let used: number | null;
      try {
        used = await options.readUsedTokens(threadId);
      } catch (error) {
        options.onSampleError?.(threadId, error);
        return;
      }
      // A null reading is "no record", never a zero: recording it would claim
      // the thread used nothing, and the next real reading would then read as a
      // huge burst.
      if (used === null || !Number.isFinite(used)) return;
      // The reading is stamped when it is TAKEN, not when its trigger arrived:
      // the read is the moment the number was true.
      const takenAt = now();
      const ring = rings.get(threadId) ?? [];
      ring.push({ at: takenAt, used });
      const floor = takenAt - windowMs;
      const trimmed = ring.filter((sample) => inWindow(sample, floor, takenAt));
      if (trimmed.length > ringCap) trimmed.splice(0, trimmed.length - ringCap);
      rings.set(threadId, trimmed);
    },

    rates() {
      const at = now();
      const rates: Record<string, number> = {};
      for (const [threadId, ring] of rings) {
        const rate = burnRate(ring, at, windowMs);
        if (rate !== null) rates[threadId] = rate;
      }
      return rates;
    },

    beginDemand() {
      const at = now();
      demandUntil = at + demandTtlMs;
      // A poll is the one moment the sampler is certainly being watched, so it
      // is also the right moment to shed rings nothing has touched in a window.
      prune(at);
    },

    sampleCount(threadId) {
      return rings.get(threadId)?.length ?? 0;
    },
  };
}

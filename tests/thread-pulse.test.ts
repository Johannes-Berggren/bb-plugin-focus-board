// The server-side sampler behind the working dot's pulse (issue #279). It is
// the only part of the feature that costs anything while the board is open, so
// its bounds are pinned here: what triggers a read, how often one thread can be
// read, how long a ring lives, and what happens when nobody is watching.
import { describe, expect, it, vi } from "vitest";
import {
  DEMAND_TTL_MS,
  SAMPLE_MIN_GAP_MS,
  SAMPLE_RING_CAP,
  SAMPLE_SPAN_MS,
  createThreadPulseTracker,
} from "../lib/thread-pulse";

const TOKEN_EVENT = "thread/tokenUsage/updated";
const CONTEXT_EVENT = "thread/contextWindowUsage/updated";
const NOISE_EVENT = "item/agentMessage/delta";

interface Harness {
  tracker: ReturnType<typeof createThreadPulseTracker>;
  /** Every thread id the tracker asked to read, in order. */
  reads: string[];
  errors: Array<{ threadId: string; error: unknown }>;
  /** Feed this thread's reads a fixed sequence; the last value repeats. */
  script: (threadId: string, values: Array<number | null | Error>) => void;
  advance: (ms: number) => void;
}

function harness(gapMs?: number): Harness {
  let now = 1_000_000;
  const reads: string[] = [];
  const errors: Array<{ threadId: string; error: unknown }> = [];
  const scripts = new Map<string, Array<number | null | Error>>();
  const tracker = createThreadPulseTracker({
    now: () => now,
    minGapMs: gapMs ?? SAMPLE_MIN_GAP_MS,
    readUsedTokens: async (threadId) => {
      reads.push(threadId);
      const values = scripts.get(threadId) ?? [];
      const next = values.length > 1 ? values.shift() : values[0];
      if (next instanceof Error) throw next;
      return next === undefined ? 100 : next;
    },
    onSampleError: (threadId, error) => errors.push({ threadId, error }),
  });
  return {
    tracker,
    reads,
    errors,
    script: (threadId, values) => scripts.set(threadId, [...values]),
    advance: (ms) => {
      now += ms;
    },
  };
}

describe("createThreadPulseTracker", () => {
  it("samples only on the two token-usage event types", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [NOISE_EVENT, "item/completed"]);
    expect(h.reads).toEqual([]);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a"]);
    await h.tracker.noteEvent("thr_b", [CONTEXT_EVENT]);
    expect(h.reads).toEqual(["thr_a", "thr_b"]);
  });

  it("an event with no eventTypes at all is not a token signal", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", undefined);
    expect(h.reads).toEqual([]);
  });

  it("does nothing while nobody is watching (the demand lease)", async () => {
    const h = harness();
    // No beginDemand yet: no board has ever polled.
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual([]);
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a"]);
  });

  it("stops sampling once the lease expires, and resumes after another poll", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    h.advance(DEMAND_TTL_MS + 1);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a"]);
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a", "thr_a"]);
  });

  it("a read does not refresh the lease; only a poll does", async () => {
    const h = harness();
    h.tracker.beginDemand();
    h.advance(DEMAND_TTL_MS - 1);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toHaveLength(1);
    h.advance(2);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toHaveLength(1);
  });

  it("throttles one thread to the minimum gap, and the gap is per thread", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    h.advance(SAMPLE_MIN_GAP_MS - 1);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a"]);
    // Another thread is not throttled by thr_a's clock.
    await h.tracker.noteEvent("thr_b", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a", "thr_b"]);
    h.advance(1);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a", "thr_b", "thr_a"]);
  });

  it("throttles on the attempt, so a failing read still costs one read per gap", async () => {
    const h = harness();
    h.script("thr_a", [new Error("nope"), new Error("nope")]);
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.reads).toEqual(["thr_a"]);
    expect(h.errors).toHaveLength(1);
  });

  it("answers tokens per second once two readings are in the window", async () => {
    const h = harness();
    h.script("thr_a", [1000, 2000, 2000]);
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    h.advance(10_000);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    h.advance(10_000);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    // 1000 then 2000 then 2000: growth 1000 across a 20s span = 50 tok/s.
    expect(h.tracker.rates().thr_a).toBeCloseTo(50, 9);
  });

  it("omits a thread it cannot measure, and never pads with a zero", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.tracker.rates()).toEqual({});
  });

  it("ignores a read that answers null (a thread with no usage record)", async () => {
    const h = harness();
    h.script("thr_a", [null, null]);
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    h.advance(SAMPLE_MIN_GAP_MS);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.tracker.sampleCount("thr_a")).toBe(0);
    expect(h.tracker.rates()).toEqual({});
  });

  it("surfaces a failed read through onSampleError instead of throwing", async () => {
    const h = harness();
    const failure = new Error("context read exploded");
    h.script("thr_a", [failure]);
    h.tracker.beginDemand();
    await expect(h.tracker.noteEvent("thr_a", [TOKEN_EVENT])).resolves.toBeUndefined();
    expect(h.errors).toEqual([{ threadId: "thr_a", error: failure }]);
    expect(h.tracker.rates()).toEqual({});
  });

  it("drops readings that fall out of the window", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.tracker.sampleCount("thr_a")).toBe(1);
    h.advance(SAMPLE_SPAN_MS + SAMPLE_MIN_GAP_MS);
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    // The first reading has aged out, so one reading is left and no rate is
    // computable from it.
    expect(h.tracker.sampleCount("thr_a")).toBe(1);
    expect(h.tracker.rates()).toEqual({});
  });

  it("beginDemand prunes rings nothing has touched recently", async () => {
    const h = harness();
    h.tracker.beginDemand();
    await h.tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    expect(h.tracker.sampleCount("thr_a")).toBe(1);
    h.advance(SAMPLE_SPAN_MS * 3);
    h.tracker.beginDemand();
    expect(h.tracker.sampleCount("thr_a")).toBe(0);
  });

  it("bounds each ring at the cap", async () => {
    const NOW = 1_000_000;
    let used = 100;
    const tracker = createThreadPulseTracker({
      now: () => NOW,
      minGapMs: 0,
      readUsedTokens: async () => used++,
    });
    tracker.beginDemand();
    for (let index = 0; index < SAMPLE_RING_CAP + 50; index++) {
      await tracker.noteEvent("thr_a", [TOKEN_EVENT]);
    }
    expect(tracker.sampleCount("thr_a")).toBe(SAMPLE_RING_CAP);
  });

  it("keeps the clock injectable so tests never sleep", () => {
    const spy = vi.fn(() => 42);
    const tracker = createThreadPulseTracker({ now: spy, readUsedTokens: async () => 1 });
    tracker.beginDemand();
    expect(spy).toHaveBeenCalled();
  });
});

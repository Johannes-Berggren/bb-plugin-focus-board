// The gesture-settle clock's contract (issue #266, fixed after #265). The
// clock measures a gesture's own round trip: dispatch to the DOM being quiet.
//
// The bug this suite pins: the clock used to require a frame gap of at least
// 30ms before it read quiet. A healthy board renders at 60fps (~17ms between
// frames), so the condition never fired and `read()` returned null on exactly
// the machines it should have measured — the number it produced was an
// artifact of contention, not the gesture. The fix is the documented intent:
// TWO CONSECUTIVE animation frames with no mutation between them, with no
// millisecond threshold, and no settling before the gesture has mutated.
//
// The clock lives in `scripts/uat/settle-clock.mjs` (extracted from run.mjs)
// so it can be driven here with a controllable clock, animation-frame queue,
// and mutation stream, instead of a real browser.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { installSettleInstrument } from "../scripts/uat/settle-clock.mjs";

/**
 * A fake page: a clock we advance, a queue of animation-frame callbacks we
 * drain per frame, a MutationObserver we fire on demand, and the globals
 * `installSettleInstrument` reads. Frames default to 16.7ms — 60fps, the
 * cadence a healthy board actually runs at (NOT the 30ms+ the old clock
 * demanded).
 */
function createClockEnv() {
  let now = 1000;
  let queued = [];
  let observerCallback = null;
  let observerDisconnected = false;
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", {});
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (cb) => {
    queued.push(cb);
    return queued.length;
  });
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {}
      disconnect() {
        observerDisconnected = true;
      }
    },
  );
  installSettleInstrument();
  return {
    instrument: () => globalThis.window.__uatSettle,
    /**
     * Fire a mutation. Advances the clock 1ms first so it lands strictly
     * BETWEEN frames (the real ordering), never sharing a frame's timestamp.
     */
    mutate: () => {
      now += 1;
      observerCallback?.();
    },
    /** Drain `count` frames, advancing the clock ~16.7ms each. */
    frames: (count) => {
      for (let i = 0; i < count; i++) {
        now += 16.7;
        const current = queued;
        queued = [];
        for (const cb of current) cb();
      }
    },
    /** The reading the clock MUST produce: last mutation minus arm, rounded. */
    expectedReading: () => {
      const s = globalThis.window.__uatSettle;
      return Math.round(s.lastMutationAt - s.t0);
    },
    observerDisconnected: () => observerDisconnected,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the gesture-settle clock", () => {
  it("settles on a quiet 60fps board instead of returning null", async () => {
    // The red-first case. The gesture commits, then the board is still while
    // framing at 60fps. The old clock demanded a >=30ms frame gap, which never
    // arrives at ~16.7ms per frame, so it returned null ("never settled") on a
    // perfectly healthy machine.
    const env = createClockEnv();
    env.instrument().arm();
    const reading = env.instrument().read(400);
    env.frames(2);
    env.mutate(); // the gesture's commit
    env.frames(6); // quiet 60fps frames: must settle here, not time out
    await expect(reading).resolves.not.toBeNull();
    await expect(reading).resolves.toBeTypeOf("number");
    await expect(reading).resolves.toBe(env.expectedReading());
  });

  it("measures arm-to-last-mutation, ignoring the quiet frames after", async () => {
    const env = createClockEnv();
    env.instrument().arm();
    const reading = env.instrument().read(400);
    env.frames(2);
    env.mutate(); // wave 1
    env.frames(1); // ONE quiet frame — not enough to settle
    env.mutate(); // wave 2 (e.g. a paint-triggered update) resets the quiet count
    const expected = env.expectedReading();
    expect(env.instrument().settled).toBeNull(); // never settled mid-gesture
    env.frames(6); // quiet frames after: must NOT be counted
    const value = await reading;
    expect(value).toBe(expected);
  });

  it("does not settle while mutations keep arriving", async () => {
    const env = createClockEnv();
    env.instrument().arm();
    const starved = env.instrument().read(100);
    // A mutation on every frame: nothing is ever quiet for two frames.
    for (let i = 0; i < 6; i++) {
      env.frames(1);
      env.mutate();
    }
    expect(env.instrument().settled).toBeNull();
    await expect(starved).resolves.toBeNull(); // budget elapsed, still streaming
    // The stream stops; two quiet frames later it settles.
    const later = env.instrument().read(400);
    env.frames(5);
    await expect(later).resolves.not.toBeNull();
  });

  it("does not settle at ~0 before the gesture's commit lands", async () => {
    // A two-quiet-frames rule with no "seen a mutation" guard would settle the
    // instant the board was momentarily still, before the gesture mutated
    // anything — a spurious ~0ms reading for a slow gesture. The clock must
    // wait for the commit.
    const env = createClockEnv();
    env.instrument().arm();
    const reading = env.instrument().read(400);
    env.frames(10); // plenty of idle, quiet frames BEFORE any commit
    expect(env.instrument().settled).toBeNull();
    env.mutate(); // the gesture finally commits
    env.frames(4);
    await expect(reading).resolves.toBeTypeOf("number");
  });

  it("records the reading at settle time, so a late read never inflates it", async () => {
    const env = createClockEnv();
    env.instrument().arm();
    const first = env.instrument().read(400);
    env.frames(1);
    env.mutate();
    env.frames(4);
    const settledValue = await first;
    // The suite then sleeps a long time; the reading must not grow.
    env.frames(60);
    await expect(env.instrument().read(400)).resolves.toBe(settledValue);
  });

  it("returns null when the board never goes quiet inside the budget", async () => {
    const env = createClockEnv();
    env.instrument().arm();
    const reading = env.instrument().read(100);
    for (let i = 0; i < 10; i++) {
      env.frames(1);
      env.mutate();
    }
    await expect(reading).resolves.toBeNull();
    expect(env.observerDisconnected()).toBe(true);
  });

  it("disconnects its observer once it settles", async () => {
    const env = createClockEnv();
    env.instrument().arm();
    const reading = env.instrument().read(400);
    env.frames(1);
    env.mutate();
    env.frames(4);
    await reading;
    expect(env.observerDisconnected()).toBe(true);
  });
});

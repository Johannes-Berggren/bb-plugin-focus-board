/**
 * The gesture-settle clock for `gesture_budget` assertions (issue #266),
 * extracted from scripts/uat/run.mjs so its timing logic can be unit-tested
 * with a controllable clock, animation-frame queue, and mutation stream.
 *
 * Installed into the page before any document script runs
 * (`page.evaluateOnNewDocument`, which stringifies the function), so
 * `installSettleInstrument` must stay self-contained: it may reference only
 * globals the page provides (`window`, `document`, `performance`,
 * `requestAnimationFrame`, `MutationObserver`). Tests import it directly and
 * drive those globals with fakes.
 *
 * CONTRACT
 *
 * `arm()` stamps `t0` and starts a quiet detector. The measurement settles
 * once BOTH hold:
 *
 *  1. at least one DOM mutation has landed since `arm()` — the gesture's
 *     commit has begun; without this, an idle moment between `arm()` and the
 *     gesture could settle the clock at ~0 before the gesture mutated
 *     anything, which is why a pure "two quiet frames" rule is not enough;
 *  2. TWO consecutive animation frames pass with no mutation between them —
 *     the first frame is the commit, the second the paint.
 *
 * It must not require any particular frame duration: a healthy board frames
 * every ~17ms (60fps), and a millisecond threshold only ever fires under
 * contention, which was the bug (the original asked for a >=30ms frame gap,
 * so it returned null on every fast machine).
 *
 * `read(maxMs)` waits for the settle, up to `maxMs`, returning the reading
 * recorded AT settle time. A gesture that never mutates the DOM never
 * settles: `read` then resolves null on timeout, which the `gesture_budget`
 * assertion treats as a failure, never a silent pass. Because the reading is
 * stamped at settle, a suite's own `sleep()` between arm and read never
 * inflates the number.
 */
export function installSettleInstrument() {
  const w = window;
  w.__uatSettle = {
    t0: 0,
    lastMutationAt: 0,
    sawMutation: false,
    settled: null,
    arm() {
      this.t0 = performance.now();
      this.lastMutationAt = this.t0;
      this.sawMutation = false;
      this.settled = null;
      if (this.observer !== undefined) this.observer.disconnect();
      this.observer = new MutationObserver(() => {
        this.lastMutationAt = performance.now();
        this.sawMutation = true;
      });
      this.observer.observe(document, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      let lastFrame = performance.now();
      let quietFrames = 0;
      const tick = () => {
        if (this.settled !== null) return;
        const now = performance.now();
        // Quiet means nothing mutated since the previous frame.
        if (this.sawMutation && this.lastMutationAt <= lastFrame) {
          quietFrames += 1;
          // Two quiet frames: the first frame is the commit, the second the paint.
          if (quietFrames >= 2) {
            this.settled = Math.round(this.lastMutationAt - this.t0);
            this.observer.disconnect();
            return;
          }
        } else {
          quietFrames = 0;
        }
        lastFrame = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    },
    /** Wait for the measurement to settle, up to `maxMs`; null on timeout. */
    read(maxMs) {
      const deadline = performance.now() + (maxMs ?? 8000);
      return new Promise((resolve) => {
        const poll = () => {
          if (this.settled !== null) {
            resolve(this.settled);
            return;
          }
          if (performance.now() > deadline) {
            this.observer?.disconnect();
            resolve(null);
            return;
          }
          requestAnimationFrame(poll);
        };
        poll();
      });
    },
  };
}

// The client half of the working-dot pulse (issue #279): one poll for the whole
// board's token-rate map, then the board reads the numbers synchronously per
// dot.
//
// The cost rules are the operator's: nothing polls while the document is
// hidden, one call is ever in flight, and a failed poll keeps the last good map
// rather than blinking every dot back to the base period. The server side
// (lib/thread-pulse.ts) takes each poll as the demand signal that keeps its
// sampling alive, so a board with no tab open does no sampling at all.

import { useEffect, useState } from "react";

/** Poll cadence. The pulse period only needs to be right to within a few
 *  seconds of feel, and the sample ring behind the RPC is a local read, so a
 *  20s cadence keeps the wire quiet without the dots lagging visibly behind a
 *  thread that starts or stops working. */
export const PULSE_RATE_POLL_MS = 20_000;

/** Minimal shape of the SDK rpc handle this hook needs. */
export type PulseRatesRpc = {
  call: (
    method: "pulse_rates",
    input: null,
  ) => Promise<{ rates: Record<string, number>; generatedAt: number }>;
};

/** The shared empty answer: one immutable map for "no thread has a measurable
 *  rate", so a board with nothing moving keeps one identity. */
const NO_RATES: ReadonlyMap<string, number> = new Map();

/** Content equality against a fresh answer, so an unchanged poll returns the
 *  previous map by identity and re-renders nothing. */
function sameRates(current: ReadonlyMap<string, number>, next: Record<string, number>): boolean {
  const keys = Object.keys(next);
  if (keys.length !== current.size) return false;
  for (const key of keys) {
    if (current.get(key) !== next[key]) return false;
  }
  return true;
}

/**
 * Live token burn rates, keyed by thread id, in tokens per second. A thread
 * absent from the map has no measurable rate yet, which the dot layer reads as
 * the base period rather than as a zero.
 */
export function usePulseRates({ rpc }: { rpc: PulseRatesRpc }): ReadonlyMap<string, number> {
  const [rates, setRates] = useState<ReadonlyMap<string, number>>(NO_RATES);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;

    const fetchNow = () => {
      // A hidden document pays nothing: no read on the server, no render here.
      if (document.hidden) return;
      if (inFlight) return;
      inFlight = true;
      const call = rpc.call("pulse_rates", null);
      call.then(
        (answer) => {
          inFlight = false;
          if (cancelled) return;
          setRates((previous) =>
            sameRates(previous, answer.rates) ? previous : new Map(Object.entries(answer.rates)),
          );
        },
        () => {
          // Rates are decoration: a dropped poll leaves the previous map in
          // place so the dots keep the period they last measured.
          inFlight = false;
        },
      );
    };

    fetchNow();
    const interval = setInterval(fetchNow, PULSE_RATE_POLL_MS);
    const onVisibilityChange = () => {
      if (!document.hidden) fetchNow();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", fetchNow);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", fetchNow);
    };
  }, [rpc]);

  return rates;
}

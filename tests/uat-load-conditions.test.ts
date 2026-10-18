// Unit tests for the UAT load-condition helpers (issue #266). These pin the
// contract the runner applies through CDP and the URL merge the mock SDK reads,
// so a perf suite cannot silently run unthrottled on the wrong fixture — which
// is the exact failure the feature exists to prevent.
//
// The helpers live in scripts/uat/load-conditions.mjs rather than inline in the
// runner so they are testable without launching a browser.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOAD,
  NETWORK_PRESETS,
  parseLoadConditions,
  withLoadQuery,
} from "../scripts/uat/load-conditions.mjs";

describe("parseLoadConditions", () => {
  it("defaults to the unthrottled base fixture when a suite declares nothing", () => {
    expect(parseLoadConditions({})).toEqual(DEFAULT_LOAD);
    expect(parseLoadConditions()).toEqual(DEFAULT_LOAD);
  });

  it("reads the scale, attention, cpu_throttle, and network a suite declares", () => {
    expect(
      parseLoadConditions({ scale: 300, attention: 40, cpu_throttle: 6, network: "slow3g" }),
    ).toEqual({ scale: 300, attention: 40, cpuThrottle: 6, network: "slow3g" });
  });

  it("accepts numeric strings, which YAML and query strings both produce", () => {
    expect(parseLoadConditions({ scale: "478", cpu_throttle: "4" })).toEqual({
      ...DEFAULT_LOAD,
      scale: 478,
      cpuThrottle: 4,
    });
  });

  it("FAILS LOUD on a negative or non-numeric load value rather than degrading to unthrottled", () => {
    // The whole point of the feature: a typo must not turn a perf gate into a
    // suite that passes at full desktop speed.
    expect(() => parseLoadConditions({ cpu_throttle: -1 })).toThrow(/cpu_throttle/);
    expect(() => parseLoadConditions({ scale: "many" })).toThrow(/scale/);
    expect(() => parseLoadConditions({ cpu_throttle: "fast" })).toThrow(/cpu_throttle/);
  });

  it("FAILS LOUD on an unknown network preset, naming the valid ones", () => {
    expect(() => parseLoadConditions({ network: "3g" })).toThrow(/network/);
    expect(() => parseLoadConditions({ network: "3g" })).toThrow(/slow3g/);
    expect(() => parseLoadConditions({ network: 4 })).toThrow(/network/);
  });

  it("carries CDP numeric preset fields (bytes/sec throughputs, latency in ms)", () => {
    for (const [name, preset] of Object.entries(NETWORK_PRESETS)) {
      expect(typeof preset.latency, name).toBe("number");
      expect(typeof preset.downloadThroughput, name).toBe("number");
      expect(typeof preset.uploadThroughput, name).toBe("number");
      expect(preset.offline, name).toBe(false);
    }
    // `none` is "throttling off", expressed as CDP's -1 = unthrottled.
    expect(NETWORK_PRESETS.none.downloadThroughput).toBe(-1);
    expect(NETWORK_PRESETS.none.latency).toBe(0);
  });
});

describe("withLoadQuery", () => {
  const load = { scale: 300, attention: 0, cpuThrottle: 4, network: "none" };

  it("appends the declared scale to a bare goto", () => {
    expect(withLoadQuery("?groupBy=status", load)).toBe("?groupBy=status&scale=300");
  });

  it("works on a goto with no query string at all", () => {
    expect(withLoadQuery("?demo=1", load)).toBe("?demo=1&scale=300");
  });

  it("appends attention too when the suite declares it", () => {
    expect(withLoadQuery("?groupBy=status", { ...load, attention: 40 })).toBe(
      "?groupBy=status&scale=300&attention=40",
    );
  });

  it("lets a step's own value win, so one step can load a different board", () => {
    // A scaled suite that wants one step on the base fixture writes scale=0.
    expect(withLoadQuery("?scale=0", load)).toBe("?scale=0");
    expect(withLoadQuery("?scale=50", load)).toBe("?scale=50");
    expect(withLoadQuery("?attention=10", { ...load, attention: 40 })).toBe(
      "?attention=10&scale=300",
    );
  });

  it("adds nothing when the suite declares no load", () => {
    expect(withLoadQuery("?groupBy=status", DEFAULT_LOAD)).toBe("?groupBy=status");
    expect(withLoadQuery("?demo=1", DEFAULT_LOAD)).toBe("?demo=1");
  });

  it("is a no-op for an undefined goto (a step with only gestures)", () => {
    expect(withLoadQuery(undefined, load)).toBeUndefined();
    expect(withLoadQuery(null, load)).toBeNull();
  });

  it("round-trips through URLSearchParams without double-encoding", () => {
    const merged = withLoadQuery("?ranks=%7B%22a%22%3A%5B%22t%22%5D%7D", load);
    const params = new URLSearchParams(merged.slice(1));
    expect(params.get("ranks")).toBe('{"a":["t"]}');
    expect(params.get("scale")).toBe("300");
  });
});

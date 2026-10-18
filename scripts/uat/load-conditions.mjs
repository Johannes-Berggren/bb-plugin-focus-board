/**
 * Load conditions for UAT suites (issue #266): the board size and the CPU /
 * bandwidth throttling a suite runs under, plus the `gesture_budget`
 * assertion's timing contract.
 *
 * Pure helpers, extracted from scripts/uat/run.mjs so they can be unit-tested
 * without booting a browser: the merge of a suite's conditions into each
 * step's URL, the parse of the suite's `defaults`, and the network presets
 * shared with the standalone performance probes
 * (scripts/screenshot/probe-mobile-tap.mjs). The runner applies the CPU and
 * network halves through CDP per page.
 */

/**
 * CDP `Network.emulateNetworkConditions` payloads. `none` switches throttling
 * off, which measures the CPU alone (not a fast network, which is a different
 * claim). The throughputs are bytes/second, as CDP expects.
 */
export const NETWORK_PRESETS = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  fast3g: {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  slow3g: {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  },
};

/** The default load: the base fixture at full desktop speed, exactly what a
 *  suite that declares nothing has always run at. */
export const DEFAULT_LOAD = { scale: 0, attention: 0, cpuThrottle: 0, network: "none" };

/**
 * Read a suite's `defaults` block into a load condition. Fail loud on a bad
 * value: a typo'd `cpu_throttle` or an unknown network preset silently
 * degrading to "no throttle" would make a perf suite pass for the wrong
 * reason, which is the failure this whole feature exists to prevent.
 */
export function parseLoadConditions(defaults = {}) {
  const readInt = (key) => {
    const raw = defaults[key];
    if (raw === undefined || raw === null) return 0;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`load condition ${key} must be a non-negative number, got ${JSON.stringify(raw)}`);
    }
    return value;
  };
  const network = defaults.network ?? "none";
  if (typeof network !== "string" || NETWORK_PRESETS[network] === undefined) {
    throw new Error(
      `load condition network must be one of ${Object.keys(NETWORK_PRESETS).join(", ")}, got ${JSON.stringify(network)}`,
    );
  }
  return {
    scale: readInt("scale"),
    attention: readInt("attention"),
    cpuThrottle: readInt("cpu_throttle"),
    network,
  };
}

/**
 * Merge a suite's load conditions into a step's `goto` URL. The mock SDK reads
 * `?scale=N` and `?attention=N` off `window.location.search`
 * (scripts/screenshot/mock-sdk.tsx), so a suite declares them once and every
 * `goto` inherits them. A step's own query value wins where the two collide,
 * which lets one step in an otherwise-scaled suite load the base fixture.
 */
export function withLoadQuery(goto, load) {
  if (goto === undefined || goto === null) return goto;
  const [path, query = ""] = String(goto).split("?");
  const params = new URLSearchParams(query);
  if (load.scale > 0 && !params.has("scale")) params.set("scale", String(load.scale));
  if (load.attention > 0 && !params.has("attention")) params.set("attention", String(load.attention));
  const merged = params.toString();
  return merged === "" ? path : `${path}?${merged}`;
}

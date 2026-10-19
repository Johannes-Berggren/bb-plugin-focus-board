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
 * A suite's opt-in flag (top-level `manual: true`): the gate is runnable on
 * demand (`npm run uat -- tests/manual/<file>.yaml`) but skipped by the
 * default sweep, so `npm run uat` (and the `release-safety` gate that calls
 * its bare form) never runs it. This is what keeps a budget that is currently
 * red — issue #265's tap-latency gate, calibrated on the production bundle
 * while the runner serves the slower dev harness — from wedging every release
 * until the underlying fix lands.
 *
 * Fail loud on a non-boolean: a quoted `"true"` or a stray `1` silently
 * staying in (or dropping out of) the sweep changes which gates run.
 */
export function parseManualFlag(suite = {}) {
  const raw = suite.manual;
  if (raw === undefined || raw === null) return false;
  if (typeof raw !== "boolean") {
    throw new Error(`suite manual flag must be a boolean, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

/**
 * Split parsed suites into the ones the default sweep runs and the `manual`
 * ones it skips, preserving input order in both lists. Only the `run` list is
 * ever executed; the skipped list exists so the runner can name what it left
 * out rather than dropping it silently.
 */
export function partitionSuites(entries) {
  const run = [];
  const skipped = [];
  for (const entry of entries) {
    (entry.manual ? skipped : run).push(entry);
  }
  return { run, skipped };
}

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
 *
 * The fragment is preserved verbatim, never folded into the query. A suite
 * deep-links with `?groupBy=status#/plugins/focus-board/board/t/thr_x`, and
 * rebuilding that with URLSearchParams would percent-encode the `#` into the
 * query string — the hash route dies and the pane never opens. Query edits
 * stay before the `#`; a bare fragment (`#/…`) gains the query ahead of it.
 */
export function withLoadQuery(goto, load) {
  if (goto === undefined || goto === null) return goto;
  const text = String(goto);
  const hashAt = text.indexOf("#");
  const fragment = hashAt === -1 ? "" : text.slice(hashAt);
  const beforeHash = hashAt === -1 ? text : text.slice(0, hashAt);
  const qAt = beforeHash.indexOf("?");
  const path = qAt === -1 ? beforeHash : beforeHash.slice(0, qAt);
  const query = qAt === -1 ? "" : beforeHash.slice(qAt + 1);
  const params = new URLSearchParams(query);
  if (load.scale > 0 && !params.has("scale")) params.set("scale", String(load.scale));
  if (load.attention > 0 && !params.has("attention")) params.set("attention", String(load.attention));
  const merged = params.toString();
  return `${merged === "" ? path : `${path}?${merged}`}${fragment}`;
}

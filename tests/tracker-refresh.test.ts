import { describe, expect, it } from "vitest";
import { OPEN_CONFIRM_MS, PROBE_AFTER_MS } from "../lib/tracker-status";
import { createTrackerVerifier } from "../lib/tracker-refresh";
import type { GitHubItemStatus } from "../lib/tracker-status";

/** One entry keyed by its number — the shallow Record shape the RPC returns. */
function record(number: number, status: GitHubItemStatus): Record<number, GitHubItemStatus> {
  return { [number]: status };
}

/** A verifier whose probe is a controllable stub; no gh spawn in tests. */
function stubVerifier(
  probe: (repo: string, number: number) => Promise<GitHubItemStatus | null>,
  now: () => number,
) {
  return createTrackerVerifier({ probe, now });
}

const T0 = 1_800_000_000_000; // an arbitrary "now"
const MINUTE = 60_000;

function openStatus(updatedAtMs: number | null): GitHubItemStatus {
  return { kind: "issue", state: "OPEN", updatedAtMs };
}

function pulledStatus(updatedAtMs: number | null = null): GitHubItemStatus {
  return { kind: "pull", state: "MERGED", updatedAtMs };
}

describe("createTrackerVerifier — decide", () => {
  it("passes terminal cached statuses through and never probes them", () => {
    const verifier = stubVerifier(async () => null, () => T0);
    const decision = verifier.decide("o/r", [42], record(42, pulledStatus()));
    expect(decision.statuses[42]).toEqual({ kind: "pull", state: "MERGED", updatedAtMs: null });
    expect(decision.candidates).toEqual([]);
  });

  it("paints a recently-updated open status and leaves it unprobed", () => {
    const verifier = stubVerifier(async () => null, () => T0);
    const decision = verifier.decide("o/r", [42], record(42, openStatus(T0 - 30_000)));
    expect(decision.statuses[42]).toEqual({ kind: "issue", state: "OPEN", updatedAtMs: T0 - 30_000 });
    expect(decision.candidates).toEqual([]);
  });

  it("drops an open status past the confirm window and offers it as a probe candidate", () => {
    const verifier = stubVerifier(async () => null, () => T0);
    const staleUpdatedAt = T0 - OPEN_CONFIRM_MS - 5 * MINUTE;
    const decision = verifier.decide("o/r", [42], record(42, openStatus(staleUpdatedAt)));
    expect(decision.statuses).toEqual({});
    expect(decision.candidates).toEqual([42]);
  });

  it("drops an open status with an unreadable update time at once", () => {
    const verifier = stubVerifier(async () => null, () => T0);
    const decision = verifier.decide("o/r", [42], record(42, openStatus(null)));
    expect(decision.statuses).toEqual({});
    expect(decision.candidates).toEqual([42]);
  });

  it("keeps terminal statuses whatever their age; only open's clock can lie", () => {
    const verifier = stubVerifier(async () => null, () => T0);
    const decision = verifier.decide(
      "o/r",
      [42, 43],
      {
        42: { kind: "issue", state: "CLOSED", updatedAtMs: null },
        43: pulledStatus(),
      },
    );
    expect(decision.statuses[42]).toEqual({ kind: "issue", state: "CLOSED", updatedAtMs: null });
    expect(decision.statuses[43]).toEqual({ kind: "pull", state: "MERGED", updatedAtMs: null });
    expect(decision.candidates).toEqual([]);
  });

  it("treats numbers with no cache row at all as probe candidates, painting nothing yet", () => {
    const verifier = stubVerifier(async () => null, () => T0);
    const decision = verifier.decide("o/r", [42], {});
    expect(decision.statuses).toEqual({});
    expect(decision.candidates).toEqual([42]);
  });
});

describe("createTrackerVerifier — verify", () => {
  it("a successful probe paints the probe's verdict on the next decide", async () => {
    let now = T0;
    let probeCount = 0;
    const verifier = stubVerifier(
      async () => {
        probeCount += 1;
        return { kind: "pull", state: "MERGED", updatedAtMs: now };
      },
      () => now,
    );
    const cached = record(42, openStatus(T0 - OPEN_CONFIRM_MS));
    expect(verifier.decide("o/r", [42], cached).candidates).toEqual([42]);
    now = T0 + 5 * MINUTE; // the merge lands while the probe is in flight
    await verifier.verify("o/r", [42]);
    expect(probeCount).toBe(1);
    const after = verifier.decide("o/r", [42], cached);
    expect(after.statuses[42]).toEqual({ kind: "pull", state: "MERGED", updatedAtMs: T0 + 5 * MINUTE });
    expect(after.candidates).toEqual([]);
  });

  it("caps one run at the probe batch max and leaves the rest as candidates", async () => {
    let probeCount = 0;
    const verifier = createTrackerVerifier({
      probe: async () => {
        probeCount += 1;
        return { kind: "issue", state: "OPEN", updatedAtMs: T0 };
      },
      now: () => T0,
      probeMax: 2,
    });
    const decision = verifier.decide("o/r", [1, 2, 3, 4, 5], {});
    expect(decision.candidates).toEqual([1, 2, 3, 4, 5]);
    await verifier.verify("o/r", decision.candidates);
    expect(probeCount).toBe(2);
    const next = verifier.decide("o/r", [1, 2, 3, 4, 5], {});
    expect(Object.keys(next.statuses).sort()).toEqual(["1", "2"]);
    expect(next.candidates).toEqual([3, 4, 5]);
  });

  it("waits out the probe cooldown between runs", async () => {
    let now = T0;
    let probeCount = 0;
    const verifier = createTrackerVerifier({
      probe: async () => {
        probeCount += 1;
        return { kind: "issue", state: "OPEN", updatedAtMs: now };
      },
      now: () => now,
    });
    // A verified open verdict inside its own confirm window: it is not a
    // candidate, so only the cooldown gate could start the next run.
    const aged = record(42, openStatus(T0 - OPEN_CONFIRM_MS - MINUTE));
    expect(verifier.decide("o/r", [42], aged).candidates).toEqual([42]);
    await verifier.verify("o/r", [42]);
    expect(probeCount).toBe(1);
    // A different stale item arrives seconds later: the cooldown gate, not
    // the empty batch, is what must block the second spawn.
    const other = record(99, openStatus(T0 - OPEN_CONFIRM_MS - MINUTE));
    expect(verifier.decide("o/r", [99], other).candidates).toEqual([99]);
    await verifier.verify("o/r", [99]); // inside the cooldown: no spawn
    expect(probeCount).toBe(1);
    now = T0 + 2 * MINUTE;
    const later = verifier.decide("o/r", [99], other);
    await verifier.verify("o/r", later.candidates);
    expect(probeCount).toBe(2);
  });

  it("never runs two probes at once; an in-flight run skips the next call", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let probeCount = 0;
    const verifier = stubVerifier(
      async () => {
        probeCount += 1;
        await gate;
        return null;
      },
      () => T0,
    );
    const decision = verifier.decide("o/r", [42], {});
    const inFlight = verifier.verify("o/r", decision.candidates);
    const overlapping = verifier.verify("o/r", decision.candidates);
    release();
    await Promise.all([inFlight, overlapping]);
    expect(probeCount).toBe(1);
  });

  it("a failing probe backs the next run off, then retries after the cooldown", async () => {
    let now = T0;
    let probeCount = 0;
    const verifier = createTrackerVerifier({
      probe: async () => {
        probeCount += 1;
        if (probeCount === 1) return null; // gh missing, offline, rate limit
        return { kind: "issue", state: "CLOSED", updatedAtMs: now };
      },
      now: () => now,
    });
    const decision = verifier.decide("o/r", [42], {});
    await verifier.verify("o/r", decision.candidates);
    expect(probeCount).toBe(1);
    const blocked = verifier.decide("o/r", [42], {});
    await verifier.verify("o/r", blocked.candidates);
    expect(probeCount).toBe(1); // the failure cooldown holds
    now = T0 + 20 * MINUTE; // past the 15-minute failure cooldown
    const later = verifier.decide("o/r", [42], {});
    await verifier.verify("o/r", later.candidates);
    expect(probeCount).toBe(2);
    const painted = verifier.decide("o/r", [42], {});
    expect(painted.statuses[42]).toEqual({ kind: "issue", state: "CLOSED", updatedAtMs: now });
    expect(painted.candidates).toEqual([]);
  });

  it("a verified open verdict ages out of the confirm window and probes again", async () => {
    let now = T0;
    const verifier = createTrackerVerifier({
      probe: async () => ({ kind: "issue", state: "OPEN", updatedAtMs: now }),
      now: () => now,
    });
    const decision = verifier.decide("o/r", [42], {});
    await verifier.verify("o/r", decision.candidates);
    expect(verifier.decide("o/r", [42], {}).statuses[42]).toEqual({
      kind: "issue",
      state: "OPEN",
      updatedAtMs: T0,
    });
    now = T0 + OPEN_CONFIRM_MS + MINUTE;
    const aged = verifier.decide("o/r", [42], {});
    expect(aged.statuses).toEqual({});
    expect(aged.candidates).toEqual([42]);
  });
});
import { describe, expect, it } from "vitest";
import { OPEN_CONFIRM_MS } from "../lib/tracker-status";
import { createTrackerFreshnessJudge } from "../lib/tracker-refresh";
import type { GitHubItemStatus } from "../lib/tracker-status";

/** One entry keyed by its number — the shallow Record shape the RPC returns. */
function record(number: number, status: GitHubItemStatus): Record<number, GitHubItemStatus> {
  return { [number]: status };
}

const T0 = 1_800_000_000_000; // an arbitrary "now"
const MINUTE = 60_000;

function openStatus(updatedAtMs: number | null): GitHubItemStatus {
  return { kind: "issue", state: "OPEN", updatedAtMs };
}

function pulledStatus(updatedAtMs: number | null = null): GitHubItemStatus {
  return { kind: "pull", state: "MERGED", updatedAtMs };
}

describe("createTrackerFreshnessJudge — decide", () => {
  it("passes terminal cached statuses through whatever their age", () => {
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const decisions = judge.decide([42], record(42, pulledStatus()));
    expect(decisions.statuses[42]).toEqual({ kind: "pull", state: "MERGED", updatedAtMs: null });
  });

  it("paints a recently-updated open status", () => {
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const decisions = judge.decide([42], record(42, openStatus(T0 - 30_000)));
    expect(decisions.statuses[42]).toEqual({ kind: "issue", state: "OPEN", updatedAtMs: T0 - 30_000 });
  });

  it("drops an open status past the confirm window", () => {
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const staleUpdatedAt = T0 - OPEN_CONFIRM_MS - 5 * MINUTE;
    const decisions = judge.decide([42], record(42, openStatus(staleUpdatedAt)));
    expect(decisions.statuses).toEqual({});
  });

  it("drops an open status with an unreadable update time at once", () => {
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const decisions = judge.decide([42], record(42, openStatus(null)));
    expect(decisions.statuses).toEqual({});
  });

  it("keeps terminal statuses whatever their age; only open's clock can lie", () => {
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const decisions = judge.decide(
      [42, 43],
      {
        42: { kind: "issue", state: "CLOSED", updatedAtMs: null },
        43: pulledStatus(),
      },
    );
    expect(decisions.statuses[42]).toEqual({ kind: "issue", state: "CLOSED", updatedAtMs: null });
    expect(decisions.statuses[43]).toEqual({ kind: "pull", state: "MERGED", updatedAtMs: null });
  });

  it("paints nothing for numbers with no cache row; the chip reads unsure", () => {
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const decisions = judge.decide([42], {});
    expect(decisions.statuses).toEqual({});
  });

  it("an aged-out open verdict has no re-check to fall back on (issue #236)", () => {
    // Pins the reshaped behavior: the old verifier offered stale numbers as
    // probe candidates and re-checked them through gh; now a stale OPEN is
    // simply absent from the answer, so this shape documents the removal.
    const judge = createTrackerFreshnessJudge({ now: () => T0 });
    const stale = record(42, openStatus(T0 - OPEN_CONFIRM_MS - MINUTE));
    const decisions = judge.decide([42], stale);
    expect(decisions.statuses).toEqual({});
  });
});

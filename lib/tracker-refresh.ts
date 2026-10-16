// Server-only: the freshness layer behind the tracker_status RPC (issue
// #187, reshaped by issue #236). The GitHub plugin's cache that
// lib/tracker-status.ts reads updates on the plugin's own event paths, so
// a row can hold an OPEN verdict hours after the item merged or closed in
// the forge, and the board's chips mirror that stale row forever. The
// fix is trust honesty: an OPEN verdict is paintable only within
// OPEN_CONFIRM_MS of its evidence — the cache row's update time. Terminal
// verdicts never age; a stale OPEN verdict drops out of the board (the
// chip renders unsure-plain) instead of asserting a state it cannot vouch
// for — the dot never paints fresh on data the server cannot vouch for.
//
// The gh CLI re-check that once shared this module (issue #187's "verify"
// half) is gone (issue #236): it executed a process from the shipped
// runtime, which the standing security law forbids
// (docs/security-audit-2026-09-28.md,
// docs/security-audit-2026-10-05-1.0.md), and no bb-native replacement
// can honestly vouch for a row the plugin did not see itself update. So
// the judge answers only from the cache: bb's own event paths keep the
// cache current, and when a row's evidence goes stale, the chip falling
// to unsure-plain is the honest answer, not an old dot re-verified
// nowhere.
import { OPEN_CONFIRM_MS } from "./tracker-status";
import type { GitHubItemStatus } from "./tracker-status";

/** What a decide answers the RPC handler: what the board may paint. */
export interface TrackerDecisions {
	/** Trustworthy statuses the board may paint; stale open verdicts are absent. */
	statuses: Record<number, GitHubItemStatus>;
}

/** The trust-window judge the tracker_status handler wires. */
export interface TrackerFreshnessJudge {
	/** Merge the cache with the trust window, drop stale open verdicts. */
	decide(numbers: readonly number[], cached: Record<number, GitHubItemStatus>): TrackerDecisions;
}

export interface TrackerFreshnessJudgeOptions {
	/** Tests freeze the clock. */
	now?: () => number;
}

export function createTrackerFreshnessJudge(
	options: TrackerFreshnessJudgeOptions = {},
): TrackerFreshnessJudge {
	const now = options.now ?? (() => Date.now());

	return {
		decide(numbers, cached) {
			const at = now();
			const statuses: Record<number, GitHubItemStatus> = {};
			for (const number of numbers) {
				// Same input contract the old judge filtered by: the RPC's
				// shape-talk already rejects garbage, but the judge answers only
				// for real numbers either way.
				if (!Number.isInteger(number)) continue;
				const source = cached[number];
				// A number with no row paints nothing: the chip reads
				// unsure-plain, exactly as before.
				if (source === undefined) continue;
				// A terminal verdict needs no clock (its state cannot age into
				// being false); an open verdict is trusted only through its
				// update time plus the confirm window.
				const trustworthy =
					source.state !== "OPEN" ||
					(source.updatedAtMs !== null && source.updatedAtMs + OPEN_CONFIRM_MS > at);
				if (trustworthy) statuses[number] = source;
			}
			return { statuses };
		},
	};
}

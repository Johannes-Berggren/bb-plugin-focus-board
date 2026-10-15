// Server-only: the freshness layer behind the tracker_status RPC (issue
// #187). The GitHub plugin's cache that lib/tracker-status.ts reads updates
// on the plugin's own event paths, so a row can hold an OPEN verdict hours
// after the item merged or closed in the forge, and the board's chips mirror
// that stale row forever. This module is the two-sided fix:
//
// - Trust honesty ("decide"): an OPEN verdict is paintable only within
//   OPEN_CONFIRM_MS of its evidence — the cache row's update time, or the
//   probe's last verification. Terminal verdicts never age; a stale OPEN
//   verdict drops out of the board (the chip renders unsure-plain) instead
//   of asserting a state it cannot vouch for.
// - The opt-in probe ("verify"): where the gh CLI exists, flagged numbers
//   re-check through `gh api` — batch-capped, cooled-down between runs,
//   fire-and-forget from the RPC handler so the poll never waits on it —
//   and verified verdicts back the board from the next poll onward. A gh
//   that is missing, offline, or rate-limited only ever costs the dot's
//   color, never the board: failures cool down and degrade to the honesty
//   window alone.
//
// Corrections live in memory in this server process; a reload re-probes
// within minutes. Nothing writes into the GitHub plugin's own cache — the
// probe reads the tracker, never the other plugin's data.
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { OPEN_CONFIRM_MS, PROBE_AFTER_MS, updatedAtToMs } from "./tracker-status";
import type { GitHubItemStatus } from "./tracker-status";

/** Between two probe runs: at most one run this often (no spawn bursts). */
const PROBE_COOLDOWN_MS = 60_000;

/** After a failed probe run, wait this long before spending gh calls again. */
const PROBE_FAILURE_COOLDOWN_MS = 15 * 60 * 1000;

/** One probe may not hang longer than this before it counts as failed. */
const PROBE_TIMEOUT_MS = 10_000;

/** At most this many numbers probe in one run (an ordered cap, oldest first). */
export const PROBE_BATCH_MAX = 8;

/** A correction's painted verdict and the time its trust runs out. */
interface Correction {
	status: GitHubItemStatus;
	trustedThroughMs: number;
}

/** What a decide answers the RPC handler: what to paint and what to probe. */
export interface TrackerVerifierDecision {
	/** Trustworthy statuses the board may paint; stale open verdicts are absent. */
	statuses: Record<number, GitHubItemStatus>;
	/** Numbers with no verdict or a soon-expiring one, oldest-stale first. */
	candidates: number[];
}

/** The freshness judge + probe runner the tracker_status handler wires. */
export interface TrackerVerifier {
	/** Merge corrections over the cache, drop stale open verdicts, pick candidates. */
	decide(
		repo: string,
		numbers: readonly number[],
		cached: Record<number, GitHubItemStatus>,
	): TrackerVerifierDecision;
	/** Fire-and-forget: probe `candidates` within the caps and cooldowns. */
	verify(repo: string, candidates: readonly number[]): Promise<void>;
}

export interface TrackerVerifierOptions {
	/** Defaults to the gh CLI probe; tests stub it. */
	probe?: (repo: string, number: number) => Promise<GitHubItemStatus | null>;
	now?: () => number;
	probeMax?: number;
	probeCooldownMs?: number;
	failureCooldownMs?: number;
}

export function createTrackerVerifier(
	options: TrackerVerifierOptions = {},
): TrackerVerifier {
	const probe = options.probe ?? ghItemProbe;
	const now = options.now ?? (() => Date.now());
	const probeMax = options.probeMax ?? PROBE_BATCH_MAX;
	const probeCooldownMs = options.probeCooldownMs ?? PROBE_COOLDOWN_MS;
	const failureCooldownMs = options.failureCooldownMs ?? PROBE_FAILURE_COOLDOWN_MS;

	// One process-wide verdict store, keyed "repo#number".
	const corrections = new Map<string, Correction>();
	let lastRunAt = Number.NEGATIVE_INFINITY;
	let disabledUntil = Number.NEGATIVE_INFINITY;
	let running = false;

	return {
		decide(repo, numbers, cached) {
			const at = now();
			const trusted = (source: GitHubItemStatus | undefined, corrected: Correction | undefined): number => {
				// A fresh correction outranks everything; a terminal cache row
				// needs no clock; an open cache row is trusted only through its
				// update time plus the confirm window.
				if (corrected !== undefined) return corrected.trustedThroughMs;
				if (source === undefined) return Number.NEGATIVE_INFINITY;
				if (source.state !== "OPEN") return Number.POSITIVE_INFINITY;
				return source.updatedAtMs === null ? Number.NEGATIVE_INFINITY : source.updatedAtMs + OPEN_CONFIRM_MS;
			};
			const ranked = [...numbers]
				.filter((number) => Number.isInteger(number))
				.map((number) => {
					const corrected = corrections.get(`${repo}#${number}`);
					const through = trusted(cached[number], corrected);
					return { number, through };
				})
				.sort((a, b) => a.through - b.through);
			const statuses: Record<number, GitHubItemStatus> = {};
			const candidates: number[] = [];
			for (const { number, through } of ranked) {
				const corrected = corrections.get(`${repo}#${number}`);
				if (through > at) {
					statuses[number] = corrected !== undefined && corrected.trustedThroughMs > at ? corrected.status : cached[number]!;
				}
				// Probe material: no verdict, an expired one, or one that would
				// expire inside the probe window — refresh before the dot drops.
				// Terminal verdicts (Infinity) never qualify.
				if (through - at <= PROBE_AFTER_MS) candidates.push(number);
			}
			return { statuses, candidates };
		},
		async verify(repo, candidates) {
			const at = now();
			if (running || at < disabledUntil || at - lastRunAt < probeCooldownMs || candidates.length === 0) return;
			lastRunAt = at;
			running = true;
			try {
				for (const number of candidates.slice(0, probeMax)) {
					const verdict = await probe(repo, number);
					if (verdict === null) {
						// gh missing, offline, or rate-limited: back the whole
						// mechanism off and keep the honesty window as the truth.
						disabledUntil = at + failureCooldownMs;
						break;
					}
					corrections.set(`${repo}#${number}`, {
						status: verdict,
						trustedThroughMs: verdict.state === "OPEN" ? at + OPEN_CONFIRM_MS : Number.POSITIVE_INFINITY,
					});
				}
			} finally {
				running = false;
			}
		},
	};
}

/**
 * The default probe: `gh api repos/{repo}/issues/{number}`, whose issues
 * endpoint covers pull requests too (a `pull_request` object distinguishes
 * the kind, and `merged_at` splits CLOSED from MERGED). Any failure mode —
 * gh absent, nonzero exit, timeout, unparsable body — yields null.
 */
function ghItemProbe(repo: string, number: number): Promise<GitHubItemStatus | null> {
	return new Promise((resolve) => {
		let child: ChildProcess;
		try {
			child = spawn("gh", ["api", `repos/${repo}/issues/${number}`], {
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			resolve(null);
			return;
		}
		let output = "";
		let settled = false;
		const finish = (verdict: GitHubItemStatus | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			child.removeAllListeners("close");
			child.removeAllListeners("error");
			child.kill();
			resolve(verdict);
		};
		const timer = setTimeout(() => finish(null), PROBE_TIMEOUT_MS);
		child.stdout?.on("data", (chunk) => {
			output += String(chunk);
		});
		child.on("error", () => finish(null));
		child.on("close", (code) => {
			finish(code === 0 ? statusFromGhItem(output) : null);
		});
	});
}

/** The gh item body's mapped verdict, or null for anything unparsable. */
export function statusFromGhItem(body: string): GitHubItemStatus | null {
	try {
		const item = JSON.parse(body) as {
			state?: unknown;
			updated_at?: unknown;
			pull_request?: { merged_at?: unknown } | undefined;
		};
		if (typeof item.state !== "string") return null;
		const state =
			item.pull_request?.merged_at != null
				? "MERGED"
				: item.state === "closed"
					? "CLOSED"
					: item.state === "open"
						? "OPEN"
						: null;
		if (state === null) return null;
		return {
			kind: item.pull_request === undefined ? "issue" : "pull",
			state,
			updatedAtMs: typeof item.updated_at === "string" ? updatedAtToMs(item.updated_at) : null,
		};
	} catch {
		return null;
	}
}
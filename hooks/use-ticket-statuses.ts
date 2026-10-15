import { useEffect, useState } from "react";

export type TicketStatus = { kind: string; state: string };

/** Poll cadence for tracker_status: a local SQLite read plus the freshness
 *  layer behind the RPC (lib/tracker-refresh.ts), so the interval is cheap
 *  and the next poll after a probe typically repaints a changed dot well
 *  inside a minute. */
export const TICKET_STATUS_POLL_MS = 30_000;

/** Minimal shape of the SDK rpc handle this hook needs. */
export type TrackerStatusRpc = {
  call: (
    method: "tracker_status",
    input: { repo: string; numbers: number[] },
  ) => Promise<{ statuses: Record<number, TicketStatus> }>;
};

/**
 * Live tracker status for the ticket chips, keyed by repo slug then issue
 * number: Record<repo, Record<number, { kind, state }>>. Fetched via the
 * `tracker_status` RPC (the GitHub plugin's local cache behind it), batched
 * per repo, refetched on a visible-ref key change, a short poll interval,
 * and window focus — a PR merging or an issue closing changes only the
 * cache, not the ref set, so key-change-only fetching would freeze the
 * dot at its first state.
 */
export function useTicketStatuses({
  rpc,
  visibleRefKey,
  refreshSignal,
}: {
  rpc: TrackerStatusRpc;
  /** Sorted, comma-joined visible refs ("owner/repo#42,...") — "" when none. */
  visibleRefKey: string;
  /**
   * The operator-moment bump (issue #205): the caller fingerprints the
   * board's display state (pane open/close, lane transitions, re-sorts).
   * A change refetches immediately with the ref set unchanged; an
   * equal string borrows the in-flight or settled snapshot, so a
   * fingerprint-stable rerender costs nothing.
   */
  refreshSignal?: string;
}): Record<string, Record<number, TicketStatus>> {
  const [ticketStatuses, setTicketStatuses] = useState<
    Record<string, Record<number, TicketStatus>>
  >({});
  useEffect(() => {
    if (visibleRefKey === "") {
      setTicketStatuses({});
      return;
    }
    let cancelled = false;
    let fetching = false;
    const wanted = new Map<string, Set<number>>();
    for (const entry of visibleRefKey.split(",")) {
      const at = entry.lastIndexOf("#");
      const repo = entry.slice(0, at);
      const num = Number(entry.slice(at + 1));
      const set = wanted.get(repo) ?? new Set<number>();
      set.add(num);
      wanted.set(repo, set);
    }
    // Replace the whole map per snapshot (not merge) so statuses mirror the
    // visible ref set exactly — no stale dots, no session-long growth. The
    // ref set is fixed for this effect run (visibleRefKey is the dep), so
    // every re-fetch batch resolves to the same `next` map.
    const fetchAll = () => {
      if (fetching) return;
      fetching = true;
      const next: Record<string, Record<number, TicketStatus>> = {};
      let pending = wanted.size;
      const settle = () => {
        if (!cancelled && pending === 0) {
          setTicketStatuses(next);
          fetching = false;
        }
      };
      for (const [repo, numbers] of wanted) {
        // The RPC caps input at 500 numbers; slice so an overflowing repo
        // degrades to partial dots instead of a rejected call (no dots at
        // all).
        const batch = [...numbers].slice(0, 500);
        rpc.call("tracker_status", { repo, numbers: batch }).then(
          (result) => {
            if (!cancelled) {
              next[repo] = result.statuses;
            }
            pending -= 1;
            settle();
          },
          () => {
            // Status is optional decoration; chips render without it.
            pending -= 1;
            settle();
          },
        );
      }
    };
    fetchAll();
    // 30s poll: the tracker_status read is a local SQLite query, so the
    // cadence costs nothing and bounds staleness between focus events.
    const interval = setInterval(fetchAll, TICKET_STATUS_POLL_MS);
    window.addEventListener("focus", fetchAll);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", fetchAll);
    };
  }, [visibleRefKey, refreshSignal, rpc]);
  return ticketStatuses;
}
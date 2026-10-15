/**
 * Live GitHub status for ticket chips — "mirror, don't integrate" phase 2.
 *
 * The official GitHub plugin publishes no RPC methods (verified 2026-09-25:
 * `bb plugin rpc list github` lists none), but it maintains a local SQLite
 * cache at ~/.bb/plugins/github/data.db whose `items` table is keyed
 * (repo, kind, number) and carries state/title/updated_at. This module
 * reads that cache server-side, per repo + numbers, and returns whatever
 * it finds. Every failure mode degrades to an empty map: the board must
 * never break because the cache is absent, moved, or reshaped.
 *
 * (Client-side helpers live in lib/tickets.ts; this file must stay
 * server-only because better-sqlite3 cannot ship to the frontend.)
 */
import Database from "better-sqlite3";

export interface GitHubItemStatus {
  /** The plugin cache's item type: "issue" or "pull". */
  kind: string;
  /** GitHub's raw state string: OPEN, CLOSED, or MERGED. */
  state: string;
  /**
   * The item's GitHub-side last-update time as the cached row recorded it
   * (epoch ms; null when unreadable). Not a fetch timestamp: the row says
   * "this state held as of this moment on GitHub", so an OPEN verdict with
   * an old update time may already be a lie the cache never refreshed.
   */
  updatedAtMs: number | null;
}

/**
 * How long an OPEN verdict may be painted from its last evidence (the cache
 * row's update time, or a probe verification) before the board stops
 * asserting it and renders the chip unsure. Terminal states (CLOSED,
 * MERGED) never age — there is no lie direction behind them.
 */
export const OPEN_CONFIRM_MS = 60 * 60 * 1000;

/**
 * How stale an OPEN verdict may be before the opt-in probe re-checks the
 * item through gh — far inside the confirm window, so on a machine with gh
 * the dot re-verifies itself instead of ever reaching the demote point.
 */
export const PROBE_AFTER_MS = 5 * 60 * 1000;

/**
 * Look up statuses for `numbers` in `repo` from a GitHub-plugin-shaped
 * cache DB. Missing file/table/rows all yield an empty result — callers
 * treat this as "no status known", never as an error.
 *
 * The optional logger receives warnings for unexpected (non-SQLite) errors.
 */
export function readGitHubStatuses(
  dbPath: string,
  repo: string,
  numbers: readonly number[],
  log?: { warn?: (message: string, error: unknown) => void },
): Record<number, GitHubItemStatus> {
  if (numbers.length === 0) return {};
  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      const rows = db
        .prepare(
          "SELECT number, kind, state, updated_at FROM items WHERE repo = ? AND number IN " +
            `(${numbers.map(() => "?").join(",")})`,
        )
        .all(repo, ...numbers) as Array<{
        number: number;
        kind: string;
        state: string;
        updated_at: string;
      }>;
      const out: Record<number, GitHubItemStatus> = {};
      for (const row of rows) {
        const updatedAtMs = updatedAtToMs(row.updated_at);
        out[row.number] = { kind: row.kind, state: row.state, updatedAtMs };
      }
      return out;
    } finally {
      db.close();
    }
  } catch (error) {
    // Documented degrade paths: no cache file, unreadable file, reshaped
    // schema. Anything else is a bug — surface it, then still degrade so
    // the board never breaks.
    if (!(error instanceof Database.SqliteError)) log?.warn?.("tracker-status: unexpected cache read failure", error);
    return {};
  }
}

/** The ISO instant a cache row recorded, as epoch ms; null when unreadable. */
export function updatedAtToMs(updatedAt: string): number | null {
  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : null;
}

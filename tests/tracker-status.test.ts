import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { readGitHubStatuses, OPEN_CONFIRM_MS, PROBE_AFTER_MS } from "../lib/tracker-status";

const ISO_T = "2026-01-01T00:00:00Z";
const ISO_T_MS = Date.parse(ISO_T);

/** Build a cache DB shaped like the GitHub plugin's `items` table. */
function makeCacheDb(dir: string, rows: Array<[string, string, number, string]>, updatedAt = ISO_T): string {
  const path = join(dir, `cache-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(path);
  db.exec(
    "CREATE TABLE items (repo TEXT NOT NULL, number INTEGER NOT NULL, kind TEXT NOT NULL," +
      " title TEXT NOT NULL, state TEXT NOT NULL, author TEXT NOT NULL, labels TEXT NOT NULL," +
      " url TEXT NOT NULL, body TEXT NOT NULL, updated_at TEXT NOT NULL," +
      " assignees TEXT NOT NULL DEFAULT '[]', PRIMARY KEY (repo, kind, number))",
  );
  const insert = db.prepare(
    "INSERT INTO items (repo, number, kind, title, state, author, labels, url, body, updated_at)" +
      " VALUES (?, ?, ?, 't', ?, 'a', '[]', 'u', '', ?)",
  );
  for (const [repo, kind, number, state] of rows) insert.run(repo, number, kind, state, updatedAt);
  db.close();
  return path;
}

describe("readGitHubStatuses", () => {
  const dir = mkdtempSync(join(tmpdir(), "tracker-status-"));

  it("returns statuses for matching repo+number rows", () => {
    const path = makeCacheDb(dir, [
      ["owner/repo", "issue", 42, "OPEN"],
      ["owner/repo", "pull", 43, "MERGED"],
      ["owner/other", "issue", 42, "OPEN"],
    ]);
    expect(readGitHubStatuses(path, "owner/repo", [42, 43])).toEqual({
      42: { kind: "issue", state: "OPEN", updatedAtMs: ISO_T_MS },
      43: { kind: "pull", state: "MERGED", updatedAtMs: ISO_T_MS },
    });
  });

  it("carries each row's update time so a stale open verdict can be aged", () => {
    const path = makeCacheDb(dir, [["owner/repo", "issue", 42, "OPEN"]], "2026-03-01T12:30:00Z");
    expect(readGitHubStatuses(path, "owner/repo", [42])).toEqual({
      42: { kind: "issue", state: "OPEN", updatedAtMs: Date.parse("2026-03-01T12:30:00Z") },
    });
  });

  it("an unparsable update time reads as null instead of failing the read", () => {
    const path = makeCacheDb(dir, [["owner/repo", "issue", 42, "OPEN"]], "yesterday-ish");
    expect(readGitHubStatuses(path, "owner/repo", [42])).toEqual({
      42: { kind: "issue", state: "OPEN", updatedAtMs: null },
    });
  });

  it("omits numbers with no row (partial match is fine)", () => {
    const path = makeCacheDb(dir, [["owner/repo", "issue", 42, "CLOSED"]]);
    expect(readGitHubStatuses(path, "owner/repo", [42, 999])).toEqual({
      42: { kind: "issue", state: "CLOSED", updatedAtMs: ISO_T_MS },
    });
  });

  it("returns empty for an empty ref list", () => {
    const path = makeCacheDb(dir, [["owner/repo", "issue", 42, "OPEN"]]);
    expect(readGitHubStatuses(path, "owner/repo", [])).toEqual({});
  });

  it("returns empty and does not throw for a missing DB file", () => {
    expect(readGitHubStatuses(join(dir, "nope.db"), "owner/repo", [42])).toEqual({});
  });

  it("returns empty and does not throw for a DB without the items table", () => {
    const path = join(dir, `wrong-${Math.random().toString(36).slice(2)}.db`);
    new Database(path).close();
    expect(readGitHubStatuses(path, "owner/repo", [42])).toEqual({});
  });

  it("matches the real GitHub plugin cache when present", () => {
    // Live-integration probe: the real cache on this machine. Skips when
    // the file does not exist (other machines, CI).
    const real = join(process.env.HOME ?? "~", ".bb/plugins/github/data.db");
    if (!existsSync(real)) return;
    const db = new Database(real, { readonly: true });
    const row = db
      .prepare("SELECT repo, kind, number, state FROM items LIMIT 1")
      .get() as { repo: string; kind: string; number: number; state: string } | undefined;
    db.close();
    if (row === undefined) return;
    const status = readGitHubStatuses(real, row.repo, [row.number])[row.number];
    expect(status).toMatchObject({ kind: row.kind, state: row.state });
  });
});

describe("status freshness thresholds", () => {
  it("an open chip's verdict may age one hour before the board stops painting it", () => {
    expect(OPEN_CONFIRM_MS).toBe(60 * 60 * 1000);
  });

  it("the gh probe rechecks a stale-open chip far sooner than that", () => {
    expect(PROBE_AFTER_MS).toBe(5 * 60 * 1000);
    expect(PROBE_AFTER_MS).toBeLessThan(OPEN_CONFIRM_MS);
  });
});
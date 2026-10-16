// The process-execution backstop, pinned as a vitest test.
//
// The fetch-seam backstop (tests/security-fetch-seams.test.ts) exists
// because the gate alone failed to stop bad merges for a day (incident
// docs/incidents/2026-10-10-red-security-gate-on-dev.md); this is its
// process sibling: scripts/security-gates.mjs's law "no process execution
// in the plugin runtime" (docs/security-audit-2026-09-28.md,
// docs/security-audit-2026-10-05-1.0.md) gets the same suite-level
// backstop, so the issue #236 regression (a gh CLI spawn in
// lib/tracker-refresh.ts that only `npm run gates` saw) can never ship a
// merge unnoticed again.
//
// Unlike the fetch backstop, the shipped-code rule here has NO exceptions
// to share a seam table with: the gate scans raw lines, comments included
// (a comment naming `child_process` still trips the real gate), so this
// test scans the same way — zero `child_process` occurrences across the
// complete shipped file set, backstop code excluded.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      listFiles(path, acc);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".generated.ts")) {
      acc.push(path);
    }
  }
  return acc;
}

const shippedFiles = ["server.ts", "app.tsx", ...listFiles("lib"), ...listFiles("components")];
const CHILD_PROCESS = /child_process/;

describe("process-execution backstop (shipped code, suite-level)", () => {
  it("scanned the expected shipped files", () => {
    expect(shippedFiles).toContain("server.ts");
    expect(shippedFiles).toContain("app.tsx");
    expect(shippedFiles).toContain("lib/tracker-refresh.ts");
    // Broken-scan guard: the fetch backstop pins the walker's lower bound
    // with today's tree; mirror it so a half-walked tree fails here first
    // instead of passing a hollow scan.
    expect(shippedFiles.length).toBeGreaterThan(60);
  });

  it("the matcher itself works (guard against a dead scan)", () => {
    expect(CHILD_PROCESS.test('import { spawn } from "node:child_process";')).toBe(true);
    expect(CHILD_PROCESS.test('import { readFileSync } from "node:fs";')).toBe(false);
  });

  it("shipped code never references child_process (the no-process law)", () => {
    const failures: string[] = [];
    for (const file of shippedFiles) {
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (CHILD_PROCESS.test(line)) {
          failures.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    // Backstop code (this test's own walker) is outside the shipped set:
    // `listFiles` runs from the repo root, so tests/ is never scanned.
    expect(failures).toEqual([]);
  });
});

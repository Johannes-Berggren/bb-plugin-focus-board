// The fetch-seam backstop, pinned as a vitest test.
//
// scripts/security-gates.mjs's `fetch(` allowlist failed to stop any merge
// for a full day (incident docs/incidents/2026-10-10-red-security-gate-on-dev.md),
// because nothing in the suite the wallpaper thread ran (`npm test`,
// 97 files green) knew about the gate. This test is the ONLY backstop that
// fires outside the gates script: it scans shipped code for `fetch(` sites
// and requires each to sit inside an audit-approved seam. It CONSUMES the
// seam table from scripts/security-seams.mjs instead of restating it, so
// the gate and this test can never drift when a dev rename moves a file —
// that drift is what made this test's first two lives stale, and this
// table is now the one place both checks read.
//
// Comment tolerance: code comments containing `fetch(` are skipped here
// (a comment cannot execute). The gates script does not skip comments; a
// fetch( word in a comment of a non-seam file still violates THERE
// (conservative), while in a seam file it passes both — the shipped
// lib/openverse.ts header mentions `fetch(` in prose, which needs the
// file-scoped seam to pass.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APPROVED_FETCH_SEAMS, seamForFetch } from "../scripts/security-seams.mjs";

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

const files = ["server.ts", "app.tsx", ...listFiles("lib"), ...listFiles("components")];
const sources = files.map((file) => ({ file, source: readFileSync(file, "utf8") }));
const FETCH_SITE = /\bfetch\(/;

const fetchSites: Array<{ file: string; line: number; text: string }> = [];
for (const { file, source } of sources) {
  source.split("\n").forEach((text, index) => {
    const code = text.trim();
    if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
    if (FETCH_SITE.test(code)) {
      fetchSites.push({ file, line: index + 1, text: code });
    }
  });
}

function seamOf(site: { file: string; text: string }): string | null {
  const seam = seamForFetch(site.file, site.text);
  return seam === null ? null : seam.reason;
}

describe("fetch seam table (the gate/test single source of truth)", () => {
  it("every seam file exists in the shipped tree (renames and deletions break here first)", () => {
    expect(APPROVED_FETCH_SEAMS.length).toBeGreaterThanOrEqual(3);
    for (const seam of APPROVED_FETCH_SEAMS) {
      expect(existsSync(seam.file), `missing seam file: ${seam.file}`).toBe(true);
    }
  });

  it("each seam carries a reason naming its approving audit", () => {
    for (const seam of APPROVED_FETCH_SEAMS) {
      expect(seam.reason).toContain("docs/security-audit-");
    }
  });
});

describe("fetch-seam backstop (shipped code, suite-level)", () => {
  it("scanned the expected shipped files", () => {
    expect(files).toContain("server.ts");
    expect(files).toContain("app.tsx");
    expect(files).toContain("lib/workspace-open.ts");
    expect(files).toContain("lib/openverse.ts");
    expect(files.some((file) => file.startsWith("components/wallpaper-"))).toBe(true);
    // Broken-scan guard: today's tree reads well over 60 files; a scan
    // suddenly sees fewer, or the directory walker broke.
    expect(files.length).toBeGreaterThan(60);
  });

  it("the site matcher itself works (guard against a dead scan)", () => {
    expect(FETCH_SITE.test("const response = await fetch(url);")).toBe(true);
    expect(FETCH_SITE.test("fetchImpl: fetch,")).toBe(false);
  });

  it("every fetch( site is inside an audit-approved seam", () => {
    const failures: string[] = [];
    for (const site of fetchSites) {
      if (seamOf(site) === null) {
        failures.push(`unseamed fetch: ${site.file}:${site.line} — ${site.text}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("a text-pinned seam refuses other fetch shapes in its file", () => {
    for (const seam of APPROVED_FETCH_SEAMS.filter((entry) => entry.text !== undefined)) {
      for (const site of fetchSites.filter((site) => site.file === seam.file)) {
        expect(site.text.includes(seam.text!), `${site.file}:${site.line}`).toBe(true);
      }
    }
  });
});
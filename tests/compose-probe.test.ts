// Unit: the temporary compose-probe capture append (pane composer-context
// diagnosis). The file lands under `<dataDir>/focus-board-debug/`; the cap
// refuses further appends so a debug stream can never grow unbounded.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendComposeProbeEvent, COMPOSE_PROBE_FILE_CAP_BYTES } from "../lib/compose-probe";

afterEach(() => {
  // Each test brings its own temp data dir; nothing to restore.
});

const rect = { x: 10, y: 20, width: 30, height: 24 };

const event = {
  threadId: "thr_probe",
  at: 1792094638754,
  missing: false,
  composerFound: true,
  composerRect: rect,
  rootRect: rect,
  footerFound: true,
  footerHtml: '<div data-follow-up-composer-footer>…</div>',
  matches: [
    {
      signature: "checkout-chip",
      display: "none",
      rect,
      snippet: '<span data-promptbox-hide-branch-compact="">feat/x</span>',
      ancestors: [["div", rect]],
    },
  ],
};

describe("appendComposeProbeEvent", () => {
  it("appends one JSON line per capture into the debug file", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "compose-probe-"));
    try {
      expect(appendComposeProbeEvent(dataDir, event)).toBe(true);
      expect(appendComposeProbeEvent(dataDir, { ...event, missing: true })).toBe(true);
      const file = join(dataDir, "focus-board-debug", "compose-probe.jsonl");
      const lines = readFileSync(file, "utf8").trim().split("\n");
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toMatchObject({
        threadId: "thr_probe",
        missing: false,
        footerFound: true,
      });
      expect(JSON.parse(lines[1]).missing).toBe(true);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("refuses further appends once the file reaches the cap", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "compose-probe-cap-"));
    try {
      expect(appendComposeProbeEvent(dataDir, event, { fileCapBytes: 1 })).toBe(true);
      expect(
        appendComposeProbeEvent(dataDir, event, { fileCapBytes: 1 }),
      ).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("capture cap constant", () => {
  it("stays bounded so the debug stream cannot grow unbounded", () => {
    expect(COMPOSE_PROBE_FILE_CAP_BYTES).toBeGreaterThan(0);
    expect(COMPOSE_PROBE_FILE_CAP_BYTES).toBeLessThanOrEqual(524_288);
  });
});
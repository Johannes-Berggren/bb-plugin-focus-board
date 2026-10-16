// Temporary compose-probe capture: the thread pane's composer-context
// diagnosis. The pane's probe fires into this module from the frontend
// (thread pane, `usePaneContextRowMissing`), and each capture event becomes
// one JSON line under `<dataDir>/focus-board-debug/compose-probe.jsonl`.
// Diagnostics only: the append is bounded (the cap refuses further lines)
// so a forgotten debug stream can never grow unbounded. The instrument
// goes away with the real fix; keep nothing on it.

import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const COMPOSE_PROBE_FILE_CAP_BYTES = 262_144;

export interface ComposeProbeEvent {
  threadId: string;
  /** Probe time (epoch ms). */
  at: number;
  /** The probe's verdict: true when the fallback row should paint. */
  missing: boolean;
  composerFound: boolean;
  footerFound: boolean;
  /** The host footer's outerHTML, compressed to one line and capped. */
  footerHtml: string | null;
  matches: {
    signature: string;
    display: string;
    width: number;
    height: number;
    snippet: string;
  }[];
}

export function appendComposeProbeEvent(
  dataDir: string,
  event: ComposeProbeEvent,
  {
    fileCapBytes = COMPOSE_PROBE_FILE_CAP_BYTES,
  }: { fileCapBytes?: number } = {},
): boolean {
  const dir = join(dataDir, "focus-board-debug");
  const file = join(dir, "compose-probe.jsonl");
  mkdirSync(dir, { recursive: true });
  try {
    if (statSync(file).size >= fileCapBytes) return false;
  } catch (error) {
    // Absent file is the ordinary first append; anything else is real.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  appendFileSync(file, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  return true;
}
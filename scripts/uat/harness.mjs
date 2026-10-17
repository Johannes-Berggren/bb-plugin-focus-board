/**
 * Shared vite-harness startup for the release gates: the UAT runner
 * (scripts/uat/run.mjs) and the release-safety capture step
 * (scripts/uat/release-shots.mjs) both boot the screenshot harness and wait
 * for it the same way, so that behavior lives here once.
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const HARNESS_CONFIG = "scripts/screenshot/vite.config.ts";

/** Start vite and resolve once the harness is serving. */
export async function startHarness(port) {
  const child = spawn(
    "npx",
    ["vite", "--config", HARNESS_CONFIG, "--port", String(port), "--strictPort"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (/error/i.test(text)) process.stderr.write(`  vite: ${text}`);
  });
  const base = `http://localhost:${port}/`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(base);
      if (response.ok) return { child, base };
    } catch {
      // Not up yet.
    }
    await sleep(200);
  }
  child.kill();
  throw new Error(`harness did not come up on ${base}`);
}
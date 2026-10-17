/**
 * Shared vite-harness startup for the release gates: the UAT runner
 * (scripts/uat/run.mjs) and the release-safety capture step
 * (scripts/uat/release-shots.mjs) both boot the screenshot harness and wait
 * for it the same way, so that behavior lives here once.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

const HARNESS_CONFIG = "scripts/screenshot/vite.config.ts";
// The vite config's middleware serves the per-run token here (issue #116).
const IDENTITY_PATH = "/__focus-board-harness/identity";
const HARNESS_TOKEN_ENV = "FOCUS_BOARD_HARNESS_TOKEN";

/**
 * Start vite and resolve once the server answering the port is THIS run's own
 * harness. The harness identifies itself by echoing back the per-run token
 * the spawner handed it (issue #116): without that handshake, "a fetch
 * answered" is true even when the answering server belongs to another tree,
 * and two gate runs started together (or a stray harness from an earlier
 * session) photograph whichever server got to the port first. Instead of
 * accepting a foreign server, the run fails loudly and captures nothing.
 */
export async function startHarness(port) {
  const token = randomUUID();
  const child = spawn(
    "npx",
    ["vite", "--config", HARNESS_CONFIG, "--port", String(port), "--strictPort"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, [HARNESS_TOKEN_ENV]: token },
    },
  );
  let viteErrors = "";
  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    viteErrors += text;
    if (/error/i.test(text)) process.stderr.write(`  vite: ${text}`);
  });
  let exited = null; // set by the exit listener; code, or signal name
  child.once("exit", (code, signal) => {
    exited = code ?? signal;
  });
  const base = `http://localhost:${port}/`;
  // What the foreign server claimed, when one answered the identity probe
  // with something that is not this run's token.
  let foreignClaim = null;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`${base.slice(0, -1)}${IDENTITY_PATH}`);
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (payload !== null && payload.token === token) {
          return { child, base };
        }
        foreignClaim =
          payload === null
            ? "the port answers, but not this run's identity probe"
            : "the port answers with another harness's identity token";
      }
    } catch {
      // Not up yet.
    }
    // Our own vite has already given up on the port (e.g. strictPort failed
    // because a foreign server holds it): report that immediately instead of
    // polling a port our process abandoned.
    if (exited !== null) break;
    await sleep(200);
  }
  child.kill();
  const tail = viteErrors.trim().split("\n").filter((line) => line.length > 0).slice(-3);
  const detail = tail.length > 0 ? ` vite: ${tail.join(" ⏎ ")}` : "";
  if (foreignClaim !== null || exited !== null) {
    const foreignPart =
      foreignClaim !== null
        ? ` A foreign server was checked against this run's identity and rejected: ${foreignClaim}.`
        : "";
    const exitPart =
      exited !== null ? ` This run's own vite exited (${exited}) rather than binding.` : "";
    throw new Error(
      `port ${base} is not held by this run's own harness — refusing to photograph or drive another tree's server (issue #116). Kill the foreign server or free the port, then rerun.${foreignPart}${exitPart}${detail}`,
    );
  }
  throw new Error(`harness did not come up on ${base}${detail}`);
}
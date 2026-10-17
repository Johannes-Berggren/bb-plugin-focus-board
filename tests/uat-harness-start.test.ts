/**
 * The release-gate harness starter (scripts/uat/harness.mjs): the UAT runner
 * and the release-shots capture step both boot their vite harness through it,
 * so the evidence they produce must come from THIS run's own harness and not
 * from whatever stray server already answers the fixed port (issue #116).
 */
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startHarness } from "../scripts/uat/harness.mjs";

const started: Array<{ child: { kill(): void } }> = [];

function stopEverything() {
  for (const s of started.splice(0)) s.child.kill();
}

/** A HTTP server that has nothing to do with this repo's harness. */
function foreignServer(responder: (req, res) => void): Promise<Server> {
  return new Promise((resolve) => {
    const server = createServer(responder);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** A free port the OS hands out, then releases for our caller to bind. */
function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
  });
}

afterEach(stopEverything);

describe("release-gate harness startup", () => {
  it("aborts loudly when the port is held by a foreign server that is not this run's own harness", { timeout: 120_000 }, async () => {
    const foreign = await foreignServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>another tree's harness</body></html>");
    });
    const port = (foreign.address() as { port: number }).port;
    try {
      const outcome = await startHarness(port).then(
        (value) => ({ resolved: true, value }),
        (error) => ({ resolved: false, error }),
      );
      if (outcome.resolved) {
        started.push(outcome.value);
        throw new Error(
          `startHarness accepted the foreign server on port ${port} as this run's harness (${outcome.value.base}); it must abort loudly instead`,
        );
      }
      expect(outcome.error.message).toMatch(/foreign|not this run('s)? own harness/i);
    } finally {
      foreign.close();
      foreign.closeAllConnections?.();
    }
  });

  it("aborts loudly when a foreign server mimics the identity probe with another run's token", { timeout: 120_000 }, async () => {
    // A second gate run IS a real vite harness with its own token, so from
    // this run's point of view the foreign server answers the identity path —
    // with a token that proves it is someone else's harness.
    const foreign = await foreignServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: "the-other-run's-token" }));
    });
    const port = (foreign.address() as { port: number }).port;
    try {
      const outcome = await startHarness(port).then(
        (value) => ({ resolved: true, value }),
        (error) => ({ resolved: false, error }),
      );
      if (outcome.resolved) {
        started.push(outcome.value);
        throw new Error(
          `startHarness accepted a foreign harness (different identity token) on port ${port} (${outcome.value.base}); it must abort loudly instead`,
        );
      }
      expect(outcome.error.message).toMatch(/foreign|not this run('s)? own harness|identity/i);
    } finally {
      foreign.close();
      foreign.closeAllConnections?.();
    }
  });

  it("resolves once this run's own vite identity has been verified on the port", { timeout: 120_000 }, async () => {
    const port = await freePort();
    const { child, base } = await startHarness(port);
    started.push({ child });
    // The harness answers ITS OWN page — not some other tree's — and the
    // identity endpoint names this run's harness, not a stray server's.
    const home = await fetch(base);
    expect(home.ok).toBe(true);
    const body = await home.text();
    expect(body).toContain("data-bb-plugin");
  });
});
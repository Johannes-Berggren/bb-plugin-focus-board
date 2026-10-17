import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

// Per-run self-identification (issue #116): the shared harness starter
// (scripts/uat/harness.mjs) spawns vite with a FOCUS_BOARD_HARNESS_TOKEN and
// only accepts the answering server once it echoes that exact token back here.
// A second gate run — or any stray server — sharing the fixed port then cannot
// be mistaken for this run's harness, whatever tree it serves.
const IDENTITY_PATH = "/__focus-board-harness/identity";
const harnessToken = process.env.FOCUS_BOARD_HARNESS_TOKEN ?? null;

const harnessIdentity = (): Plugin => ({
  name: "focus-board-harness-identity",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.split("?")[0] !== IDENTITY_PATH) return next();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ token: harnessToken }));
    });
  },
});

export default defineConfig({
  plugins: [harnessIdentity()],
  root: here,
  resolve: {
    alias: [
      // The harness renders the real app against a simulated SDK.
      {
        find: /^@get-bb\/plugin-sdk\/app$/,
        replacement: fileURLToPath(new URL("./mock-sdk.tsx", import.meta.url)),
      },
      { find: "@", replacement: repoRoot },
    ],
  },
  server: {
    port: 5173,
    strictPort: true,
    // The harness imports the plugin's compiled CSS from ../../dist/, which
    // sits outside this config root; without this allowance vite 403s it.
    fs: { allow: [repoRoot] },
  },
});
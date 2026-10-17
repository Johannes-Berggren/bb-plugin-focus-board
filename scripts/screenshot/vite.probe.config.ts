/**
 * Production-mode build of the screenshot harness, for performance probes.
 *
 * The dev harness (vite.config.ts) serves React's DEVELOPMENT build, which
 * makes every render several times more expensive than the plugin's shipped
 * bundle (React production, jsx runtime, minified). A probe that measures the
 * dev build overstates cost and can rank bottlenecks wrongly, so the
 * performance probes build the same app in production mode here and serve it
 * with `vite preview`.
 *
 * `minify: false` and a sourcemap keep the CPU profile readable (function
 * names and file:line survive), and the build is identical to the dev harness
 * otherwise — same SDK alias, same app source, same compiled dist/app.css.
 */
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import base from "./vite.config";

const here = fileURLToPath(new URL(".", import.meta.url));

const root = defineConfig(base);

export default defineConfig({
  ...root,
  root: here,
  resolve: {
    ...root.resolve,
    alias: [
      // Probe-only: count ThreadCard renders (probe-rerenders.mjs) without
      // touching the shipped component. board.tsx and parent-lane-board.tsx
      // are the only importers, and both name it "./thread-card".
      {
        find: /^\.\/thread-card$/,
        replacement: fileURLToPath(new URL("./probe-instrument-thread-card.tsx", import.meta.url)),
      },
      ...(base.resolve?.alias ?? []),
    ],
  },
  // `vite preview` serves this directory; keeping it inside scripts/screenshot
  // keeps the repo root clean and the artifact disposable.
  build: {
    outDir: here + ".probe-dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    cssMinify: false,
    target: "es2022",
  },
  preview: {
    port: Number(process.env.PROBE_PORT ?? "5174"),
    strictPort: true,
  },
});

/**
 * Release-safety screenshots: render the harness across the states a nightly
 * release's judgement gate reviews before tagging — board and open thread
 * pane at desktop 1920x1080, narrow-desktop 1280x800, tablet 768x1024, and
 * phone 390x844; the compact filter ribbon open on phone (below the 767px
 * compact breakpoint the palette collapses into a header toggle);
 * and a light-theme board.
 *
 * Run after `npm run build` (the harness loads dist/app.css), e.g. via
 * `npm run release-shots`. Uses the system Chrome through puppeteer-core
 * (nothing is downloaded); set CHROME_PATH if Chrome is not in the default
 * place. Captures into docs/release-safety/ and exits non-zero if any shot
 * fails.
 */
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const HARNESS_CONFIG = "scripts/screenshot/vite.config.ts";
const OUT_DIR = fileURLToPath(new URL("../../docs/release-safety/", import.meta.url));

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  narrowDesktop: { width: 1280, height: 800, deviceScaleFactor: 2 }, // laptop-ish
  tablet: { width: 768, height: 1024, deviceScaleFactor: 2 }, // iPad-ish
  phone: { width: 390, height: 844, deviceScaleFactor: 2 }, // iPhone 14-ish
};

/** Start vite and resolve once the harness is serving. Same pattern as the
 *  UAT runner (scripts/uat/run.mjs). */
async function startHarness(port) {
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

/** A real mouse click starts an HTML5 drag and swallows the mouseup, so
 *  dispatch the click programmatically instead (same as shoot.mjs). */
async function openPane(target) {
  await target.evaluate(() => {
    const el = document.querySelector('a[href$="thr_permissions"]');
    if (!el) throw new Error("card not found");
    el.click();
  });
  await target.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

/** On a compact viewport (below 767px wide) the filter palette collapses
 *  into a header ribbon toggle (components/board-toolbar.tsx). */
async function openFilterRibbon(target) {
  await target.evaluate(() => {
    const el = document.querySelector('button[title="Show filter palette"]');
    if (!el) throw new Error("filter ribbon toggle not found");
    el.click();
  });
  await target.waitForSelector("#focus-board-filter-ribbon", { timeout: 5_000 });
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const SHOTS = [
  { name: "board-desktop", viewport: "desktop", pane: false },
  { name: "pane-desktop", viewport: "desktop", pane: true },
  { name: "board-narrow-desktop", viewport: "narrowDesktop", pane: false },
  { name: "pane-narrow-desktop", viewport: "narrowDesktop", pane: true },
  { name: "board-tablet", viewport: "tablet", pane: false },
  { name: "pane-tablet", viewport: "tablet", pane: true },
  { name: "board-phone", viewport: "phone", pane: false },
  { name: "pane-phone", viewport: "phone", pane: true },
  { name: "palette-phone", viewport: "phone", palette: true },
  { name: "board-desktop-light", viewport: "desktop", theme: "light" },
];

const harness = await startHarness(5199);
const boardUrl = `${harness.base}?groupBy=status&demo=1&collapsed=thr_demo_needs,thr_demo_work`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const failures = [];
try {
  await mkdir(OUT_DIR, { recursive: true });
  for (const shot of SHOTS) {
    const { name, viewport } = shot;
    const theme = shot.theme ?? "dark";
    console.log(`  ${name}`);
    // One page per shot: flipping one shared page's emulation state wedges
    // Chrome (see shoot.mjs's note), so each shot gets its own page. Media
    // features are set once per page, before navigation.
    const page = await browser.newPage();
    try {
      await page.setViewport(VIEWPORTS[viewport]);
      await page.emulateMediaFeatures([
        { name: "prefers-color-scheme", value: theme },
      ]);
      await page.goto(boardUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
      await page.evaluate((mode) => {
        document.documentElement.classList.toggle("dark", mode === "dark");
      }, theme);
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (shot.pane) await openPane(page);
      if (shot.palette) await openFilterRibbon(page);
      await page.screenshot({
        path: `${OUT_DIR}${name}.png`,
        timeout: 30_000,
      });
    } catch (error) {
      failures.push(`${name}: ${error?.message ?? error}`);
    } finally {
      await page.close().catch(() => {});
    }
  }
} finally {
  await browser.close().catch(() => {});
  harness.child.kill();
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAILED ${f}`);
  throw new Error(`${failures.length} of ${SHOTS.length} release-safety shots failed`);
}
console.log(`${SHOTS.length} shots captured in ${OUT_DIR}`);
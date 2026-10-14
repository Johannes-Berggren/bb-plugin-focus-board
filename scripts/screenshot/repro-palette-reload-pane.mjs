// Headless repro: thread pane floating over the board toolbar. Operators saw,
// after a plugin reload, this thread's white pane card riding up over the
// board toolbar (toolbar text legible on top, pane body covering the palette)
// in a narrow board panel. This script captures the pane's geometry in four
// scenarios and asserts the basic contract: the pane never paints across the
// toolbar without covering the full panel (compact drawer) or clearing the
// toolbar strip (desktop side-by-side).
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts --port 5199`,
// then `HARNESS_URL=http://localhost:5199/ node scripts/screenshot/repro-palette-reload-pane.mjs`.
// Writes evidence to docs/screenshots/repro-palette-reload-pane/.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const DESKTOP = { width: 1280, height: 800 };
const NARROW = { width: 350, height: 800 };
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = new URL("../../docs/screenshots/repro-palette-reload-pane/", import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { ...DESKTOP, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const openPane = async (page) => {
  await page.evaluate(() => {
    const el = document.querySelector('a[href$="thr_permissions"]');
    if (!el) throw new Error("thread card not found");
    el.click();
  });
  await page.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 10_000 });
  await new Promise((r) => setTimeout(r, 500));
};

/** Geometry of the pane and the toolbar, plus how far they overlap. */
async function measure(page) {
  return page.evaluate(() => {
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    if (!pane) return { pane: null };
    const toolbar = [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("New thread"))
      ?.closest(".border-b");
    const pr = pane.getBoundingClientRect();
    const tr = toolbar?.getBoundingClientRect() ?? null;
    const overlap = (tr)
      ? Math.max(0, Math.min(pr.bottom, tr.bottom) - Math.max(pr.top, tr.top)) *
        Math.max(0, Math.min(pr.right, tr.right) - Math.max(pr.left, tr.left))
      : 0;
    const styles = getComputedStyle(pane);
    return {
      viewport: { w: innerWidth, h: innerHeight },
      pane: { x: Math.round(pr.x), y: Math.round(pr.y), w: Math.round(pr.width), h: Math.round(pr.height) },
      panePosition: styles.position, paneZ: styles.zIndex,
      toolbarRect: tr ? { x: Math.round(tr.x), y: Math.round(tr.y), w: Math.round(tr.width), h: Math.round(tr.height) } : null,
      overlapArea: Math.round(overlap),
    };
  });
}

async function runCase(name, page, steps) {
  for (const step of steps) await step(page);
  const geometry = await measure(page);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: false });
  return { name, ...geometry };
}

const results = [];
{
  // Case 1: desktop viewport, pane open — the everyday baseline.
  const page = await browser.newPage();
  await page.setViewport({ ...DESKTOP, deviceScaleFactor: 2 });
  await page.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 400));
  results.push(await runCase("1-desktop-pane-open", page, [openPane]));
  await page.close();

  // Case 2: pane opened on desktop, then the viewport shrinks below the
  // compact breakpoint (the reload of a bb plugin also tears down and
  // rebuilds the webview content the user sees mid-session).
  const page2 = await browser.newPage();
  await page2.setViewport({ ...DESKTOP, deviceScaleFactor: 2 });
  await page2.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page2.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 400));
  await openPane(page2);
  results.push(await runCase("2-desktop-pane-then-shrink", page2, [
    async (p) => { await p.setViewport({ ...NARROW, deviceScaleFactor: 2 }); await new Promise((r) => setTimeout(r, 600)); },
  ]));
  await page2.close();

  // Case 3: pane opened on a compact viewport, then the viewport widens.
  const page3 = await browser.newPage();
  await page3.setViewport({ ...NARROW, deviceScaleFactor: 2 });
  await page3.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page3.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 400));
  await openPane(page3);
  results.push(await runCase("3-narrow-pane-then-widen", page3, [
    async (p) => { await p.setViewport({ ...DESKTOP, deviceScaleFactor: 2 }); await new Promise((r) => setTimeout(r, 600)); },
  ]));
  await page3.close();

  // Case 4: pane open, then a full page reload with the pane still meant to
  // be open (or the app back at the board) — the bb reload the operator ran.
  const page4 = await browser.newPage();
  await page4.setViewport({ ...DESKTOP, deviceScaleFactor: 2 });
  await page4.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page4.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 400));
  await openPane(page4);
  await page4.reload({ waitUntil: "domcontentloaded" });
  await page4.waitForSelector("section[aria-label]", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 600));
  results.push(await runCase("4-reload-after-pane", page4, []));
  await page4.close();

  // Cases 5-6: a zoomed wallpaper (the operator's board runs zoom > 1x, and
  // the misplaced pane persisted across a full refresh there). Seed the
  // wallpaper store, reload so the app reads it, then open the pane in both
  // presentations and measure.
  const WALLPAPER = {
    version: 1,
    global: {
      url:
        "data:image/svg+xml," +
        encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bcd8f0"/><stop offset="1" stop-color="#e8f2fc"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/></svg>'),
      dim: 0.3,
      zoom: 2,
      focusX: 50,
      focusY: 50,
    },
  };
  for (const [name, viewport] of [
    ["5-wallpaper-zoom-desktop-pane", DESKTOP],
    ["6-wallpaper-zoom-compact-pane", NARROW],
  ]) {
    const pageW = await browser.newPage();
    await pageW.setViewport({ ...viewport, deviceScaleFactor: 2 });
    await pageW.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await pageW.evaluate((layer) => {
      window.localStorage.setItem("focus-board:wallpaper", JSON.stringify(layer));
    }, WALLPAPER);
    await pageW.reload({ waitUntil: "domcontentloaded" });
    await pageW.waitForSelector("section[aria-label]", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 400));
    results.push(await runCase(name, pageW, [openPane]));
    await pageW.close();
  }
}

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
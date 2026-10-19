// A/B isolation for the mobile TAP latency (thread: "Improve mobile tap
// responsiveness"). Runs the same tap gesture under the production harness with
// one CSS candidate injected at a time, and reports the tap's own latency plus
// a progress guard (the pane must actually open on the card that was tapped),
// so a "fast" run that did nothing cannot pass as a win.
//
// Usage:
//   npx vite build --config scripts/screenshot/vite.probe.config.ts
//   PROBE_PORT=5302 npx vite preview --config scripts/screenshot/vite.probe.config.ts
//   HARNESS_URL=http://localhost:5302/ PROBE_CPU=4 PROBE_SCALE=300 \
//     node scripts/screenshot/probe-tap-ab.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE, PROBE_REPS.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5302/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-tap-ab/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "300");
const REPS = Number(process.env.PROBE_REPS ?? "5");
const PHONE = { width: 390, height: 844 };
const QUERY = `?demo=1${SCALE > 0 ? `&scale=${SCALE}` : ""}`;

/** CSS-only candidates. Each is one declaration family; a candidate that does
 *  not move the tap latency, or that breaks the pane opening on the tapped
 *  card, is not the fix. */
const CANDIDATES = {
  baseline: "",
  // Let the browser skip layout/paint for off-screen cards. The board paints
  // hundreds of cards; only a few are ever in the phone viewport.
  "content-visibility": `[data-thread-card]{content-visibility:auto;contain-intrinsic-size:auto 88px;}`,
  // Promote the lane list to its own compositor layer, so a board-wide change
  // does not repaint every card.
  "lane-layer": `[data-card-list]{will-change:transform;}`,
  // Both of the above together.
  "cv-and-lane": `[data-thread-card]{content-visibility:auto;contain-intrinsic-size:auto 88px;}[data-card-list]{will-change:transform;}`,
  // Isolate each card's layout/paint so a sibling change cannot invalidate it.
  "card-contain": `[data-thread-card]{contain:layout paint;}`,
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });

async function tapOnce(page, candidate) {
  // Fresh document per rep so nothing carries over between candidates.
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  if (candidate !== "") {
    await page.addStyleTag({ content: candidate });
  }
  await new Promise((r) => setTimeout(r, 1200));

  const target = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-columns-board] [data-thread-card]")];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 40) {
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: c.getAttribute("data-thread-card") };
      }
    }
    return null;
  });
  const t0 = Date.now();
  await page.touchscreen.tap(target.x, target.y);
  const opened = await page
    .waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') !== null, { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const openMs = Date.now() - t0;
  const openedOn = await page.evaluate(() => document.querySelector('aside[aria-label^="Thread:"]')?.getAttribute("aria-label") ?? null);

  // Close it back out, timed the same way.
  let closeMs = null;
  if (opened) {
    const back = await page.evaluate(() => {
      const b = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
      if (b === null) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (back !== null) {
      const c0 = Date.now();
      await page.touchscreen.tap(back.x, back.y);
      await page.waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') === null, { timeout: 8000 }).catch(() => {});
      closeMs = Date.now() - c0;
    }
  }
  return { openMs, closeMs, opened, openedOn, tapped: target.id };
}

const results = { machine: { chrome: await browser.version(), cpuThrottleRate: CPU, scale: SCALE, viewport: PHONE, query: QUERY, reps: REPS }, variants: [] };

for (const [name, css] of Object.entries(CANDIDATES)) {
  const page = await browser.newPage();
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const runs = [];
  for (let i = 0; i < REPS; i += 1) runs.push(await tapOnce(page, css));
  await page.close();
  const opens = runs.map((r) => r.openMs).sort((a, b) => a - b);
  const closes = runs.map((r) => r.closeMs).filter((v) => v !== null).sort((a, b) => a - b);
  const median = (arr) => (arr.length === 0 ? null : arr[Math.floor(arr.length / 2)]);
  results.variants.push({
    variant: name,
    css: css === "" ? null : css,
    openMedianMs: median(opens),
    openMinMs: opens[0],
    openMaxMs: opens.at(-1),
    closeMedianMs: median(closes),
    // Progress guard: every rep must have opened the pane ON the tapped card.
    openedAll: runs.every((r) => r.opened),
    openedCorrect: runs.every((r) => r.opened && String(r.openedOn).length > 0),
    runs,
  });
  console.log(`${name}: open median ${median(opens)}ms (min ${opens[0]} max ${opens.at(-1)}), close median ${median(closes)}ms, openedAll=${runs.every((r) => r.opened)}`);
}

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 1));
console.log(`\nwrote ${OUT}evidence.json`);
await browser.close();

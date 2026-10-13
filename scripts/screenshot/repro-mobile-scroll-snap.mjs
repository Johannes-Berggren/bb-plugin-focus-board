// Headless repro for the mobile horizontal-scroll snap bug: at phone size,
// with NO thread pane open and NO card selected, a horizontal pan of the
// parent lane board should either rest where the operator leaves it (when
// laneOverflowsViewport blocks snap) or re-lock the NEAREST lane — never
// jump all the way to the rightmost (end) lane.
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts`, then
// `node scripts/screenshot/repro-mobile-scroll-snap.mjs`. Writes evidence to
// docs/screenshots/repro-mobile-scroll-snap/ (JSON per run).
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/repro-mobile-scroll-snap/", import.meta.url).pathname;

// Phone sizes spanning the affected band: 390 blocks on the floored locked
// lane, 404/412/424/430 fit one lane but fewer than two context mini columns
// so laneOverflowsViewport still blocks snap (the extended narrow-viewport
// bound).
const SIZES = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "phone-412", width: 412, height: 915 },
  { name: "phone-424", width: 424, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

/** One pan scenario: gesture spec + expected rest behavior. */
async function panScenario(page, { label, fling, startScrollLeft }) {
  if (startScrollLeft > 0) {
    await page.evaluate((sl) => {
      const board = document.querySelector("[data-parent-board]");
      board.scrollLeft = sl;
    }, startScrollLeft);
    await new Promise((r) => setTimeout(r, 300));
  }
  await page.evaluate(() => {
    const board = document.querySelector("[data-parent-board]");
    window.__scrollLog = [];
    board.addEventListener("scroll", () => {
      window.__scrollLog.push({ t: performance.now(), sl: Math.round(board.scrollLeft) });
    });
  });
  const start = await page.evaluate(() => {
    const board = document.querySelector("[data-parent-board]");
    const rail = board.querySelector("[data-rail]");
    return { railRight: rail.getBoundingClientRect().right, y: board.getBoundingClientRect().top + board.clientHeight / 2 };
  });
  const startX = Math.round(start.railRight + 40);
  const startY = Math.round(start.y);
  // Fling: fewer, bigger, faster moves so Chromium fires momentum after
  // touchEnd (velocity from move history). Slow drag: 20px every 30ms.
  const steps = fling ? 5 : 8;
  const stepPx = fling ? 60 : 20;
  const delay = fling ? 10 : 30;
  const ts = page.touchscreen;
  await ts.touchStart(startX, startY);
  for (let i = 1; i <= steps; i++) {
    await ts.touchMove(startX - i * stepPx, startY); // right-to-left drag = pan toward later lanes
    await new Promise((r) => setTimeout(r, delay));
  }
  await ts.touchEnd();
  await new Promise((r) => setTimeout(r, fling ? 4000 : 2500)); // momentum + settle + glide
  return await page.evaluate(() => {
    const board = document.querySelector("[data-parent-board]");
    const locked = document.querySelector("section[data-locked]");
    const lanes = [...document.querySelectorAll("section[data-lane-id]")];
    const squashed = [];
    for (const e of window.__scrollLog) {
      const last = squashed[squashed.length - 1];
      if (last && Math.abs(e.sl - last.sl) <= 1) { last.n++; last.tEnd = e.t; continue; }
      squashed.push({ t: Math.round(e.t), sl: e.sl, n: 1 });
    }
    return {
      finalScrollLeft: Math.round(board.scrollLeft),
      maxScrollLeft: board.scrollWidth - board.clientWidth,
      lockedLaneIndex: locked ? lanes.indexOf(locked) : -1,
      laneLefts: lanes.map((s) => Math.round(s.getBoundingClientRect().left)),
      log: squashed,
    };
  });
}

const results = [];

await mkdir(OUT, { recursive: true });

for (const size of SIZES) {
  const page = await browser.newPage();
  await page.setViewport({
    width: size.width,
    height: size.height,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(`${BASE}?groupBy=parent&demo=1`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("section[data-lane-id]", { timeout: 30_000 });
  await new Promise((r) => setTimeout(r, 600));

  for (const scenario of [
    { label: "slow-drag", fling: false, startScrollLeft: 0 },
    { label: "fling-from-start", fling: true, startScrollLeft: 0 },
    { label: "fling-from-mid", fling: true, startScrollLeft: 200 },
  ]) {
    await page.goto(`${BASE}?groupBy=parent&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("section[data-lane-id]", { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, 600));
    const after = await panScenario(page, scenario);
    results.push({ size: size.name, scenario: scenario.label, after });
    await page.screenshot({ path: `${OUT}${size.name}-${scenario.label}.png` });
  }
  await page.close();
}

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
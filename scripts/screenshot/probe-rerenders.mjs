// Direct measurement of the hover re-render storm (issue #186's frontend half).
// Counts ThreadCard renders per unit of real pointer work, so the ratio
// (renders per hover step) is the number the fix moved: 335 renders per hover
// enter on a 478-card board before, 0 after.
//
// The counter rides scripts/screenshot/probe-instrument-thread-card.tsx, which
// vite.probe.config.ts aliases in place of the real component — the shipped
// card is never instrumented. Run against the production harness:
//
//   npx vite build --config scripts/screenshot/vite.probe.config.ts
//   npx vite preview --config scripts/screenshot/vite.probe.config.ts   # 1
//   HARNESS_URL=http://localhost:5174/ PROBE_CPU=4 PROBE_SCALE=300 \
//     node scripts/screenshot/probe-rerenders.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5174/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-rerenders/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const PHONE = { width: 390, height: 844 };
const QUERY = `?demo=1${process.env.PROBE_SCALE ? `&scale=${process.env.PROBE_SCALE}` : ""}`;
const SEL = "[data-columns-board]";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });

const page = await browser.newPage();
await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const session = await page.createCDPSession();
await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
await new Promise((r) => setTimeout(r, 1500));

const cardCount = await page.evaluate(() => document.querySelectorAll("[data-thread-card]").length);

async function hoverSweep(steps) {
  const points = await page.evaluate(
    (s, n) => {
      const cards = [...document.querySelectorAll(`${s} [data-thread-card]`)].slice(0, n);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    },
    SEL,
    steps,
  );
  await page.evaluate(() => {
    globalThis.__cardRenders = 0;
  });
  const t0 = Date.now();
  for (const p of points) {
    await page.mouse.move(p.x, p.y);
    await new Promise((r) => setTimeout(r, 120));
  }
  const wallMs = Date.now() - t0;
  const renders = await page.evaluate(() => globalThis.__cardRenders ?? 0);
  return { steps: points.length, wallMs, renders };
}

async function idleWindow(ms) {
  await page.mouse.move(5, 5);
  await page.evaluate(() => {
    globalThis.__cardRenders = 0;
  });
  await new Promise((r) => setTimeout(r, ms));
  return { ms, renders: await page.evaluate(() => globalThis.__cardRenders ?? 0) };
}

/** Discrete enter/leave cycles on ONE card, counting renders per half. */
async function hoverCycles(steps) {
  const points = await page.evaluate(
    (s, n) => {
      const cards = [...document.querySelectorAll(`${s} [data-thread-card]`)].slice(0, n);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    },
    SEL,
    steps,
  );
  const cycles = [];
  for (const p of points) {
    await page.mouse.move(5, 5);
    await new Promise((r) => setTimeout(r, 120));
    await page.evaluate(() => {
      globalThis.__cardRenders = 0;
    });
    const t0 = Date.now();
    await page.mouse.move(p.x, p.y);
    await new Promise((r) => setTimeout(r, 160));
    const enterRenders = await page.evaluate(() => globalThis.__cardRenders ?? 0);
    await page.mouse.move(5, 5);
    await new Promise((r) => setTimeout(r, 160));
    const total = await page.evaluate(() => globalThis.__cardRenders ?? 0);
    cycles.push({ kind: "enter-leave", enterRenders, leaveRenders: total - enterRenders, wallMs: Date.now() - t0 });
  }
  return cycles;
}

/** Click something and count the renders the click caused. */
async function clickRenders(selector, settleMs) {
  const target = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, selector);
  if (target === null) return { selector, missing: true };
  await page.evaluate(() => {
    globalThis.__cardRenders = 0;
  });
  const t0 = Date.now();
  await page.mouse.click(target.x, target.y);
  await new Promise((r) => setTimeout(r, settleMs));
  return {
    selector,
    renders: await page.evaluate(() => globalThis.__cardRenders ?? 0),
    wallMs: Date.now() - t0,
  };
}

/** A real card drag across the board, render count for the whole gesture. */
async function dragRenders() {
  const pts = await page.evaluate((s) => {
    const cards = [...document.querySelectorAll(`${s} [data-thread-card]`)];
    const src = cards[0]?.querySelector("a[draggable]") ?? cards[0];
    if (!src) return null;
    const r = src.getBoundingClientRect();
    const board = document.querySelector(s).getBoundingClientRect();
    return {
      from: { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) },
      to: { x: Math.round(board.right - 40), y: Math.round(board.y + board.height / 2) },
    };
  }, SEL);
  if (pts === null) return { missing: true };
  await page.mouse.move(pts.from.x, pts.from.y);
  await page.evaluate(() => {
    globalThis.__cardRenders = 0;
  });
  const t0 = Date.now();
  await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) {
    const x = Math.round(pts.from.x + ((pts.to.x - pts.from.x) * i) / 16);
    const y = Math.round(pts.from.y + ((pts.to.y - pts.from.y) * i) / 16);
    await page.mouse.move(x, y);
    await new Promise((r) => setTimeout(r, 16));
  }
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 300));
  return {
    steps: 16,
    renders: await page.evaluate(() => globalThis.__cardRenders ?? 0),
    wallMs: Date.now() - t0,
  };
}

async function hoverSweepCount(steps) {
  const points = await page.evaluate(
    (s, n) => {
      const cards = [...document.querySelectorAll(`${s} [data-thread-card]`)].slice(0, n);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    },
    SEL,
    steps,
  );
  await page.evaluate(() => {
    globalThis.__cardRenders = 0;
  });
  const t0 = Date.now();
  for (const p of points) {
    await page.mouse.move(p.x, p.y);
    await new Promise((r) => setTimeout(r, 120));
  }
  return {
    steps: points.length,
    renders: await page.evaluate(() => globalThis.__cardRenders ?? 0),
    wallMs: Date.now() - t0,
  };
}

const results = {
  machine: {
    chrome: await browser.version(),
    cpuThrottleRate: CPU,
    viewport: PHONE,
    query: QUERY,
  },
  cardCount,
  idle: await idleWindow(3000),
  hover1: await hoverSweepCount(1),
  hover12: await hoverSweepCount(12),
  familyCollapse: await clickRenders('[aria-label="Collapse subthreads"]', 500),
  familyExpand: await clickRenders('[aria-label="Expand subthreads"]', 500),
  paneOpen: await clickRenders(`${SEL} [data-thread-card] a`, 900),
  drag: await dragRenders(),
};

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();

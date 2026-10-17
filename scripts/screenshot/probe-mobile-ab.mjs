// A/B isolation probe for the mobile performance work (issue: mobile
// performance). Runs the SAME board and gesture under several variants and
// reports the timing window for each, so the difference is attributable to the
// one thing the variant changes.
//
// Gestures (GESTURE=pan|lane|hover|open):
//   pan   — real touch pan of the board horizontally (the board's own scroll)
//   lane  — wheel scroll of the busiest lane's card list (vertical scroll)
//   hover — pointer sweep across the first 12 cards (the React re-render path)
//   open  — one click to open a thread pane (a single state change)
//
// Variants: baseline, and fix candidates injected as CSS so nothing else
// differs. Each variant records the gesture's own progress value (scrollLeft /
// scrollTop / pane opened) so a "fast" result that did nothing cannot pass as
// a win.
//
// Usage:
//   npx vite preview --config scripts/screenshot/vite.probe.config.ts   # 1
//   HARNESS_URL=http://localhost:5174/ PROBE_CPU=4 PROBE_SCALE=300 \
//     GESTURE=pan node scripts/screenshot/probe-mobile-ab.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE, GESTURE.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5174/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-mobile-ab/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const PHONE = { width: 390, height: 844 };
const SPOTLIGHT_ID = "focus-board-card-spotlight";
const SEL = "[data-columns-board]";
const QUERY = `?demo=1${process.env.PROBE_SCALE ? `&scale=${process.env.PROBE_SCALE}` : ""}`;

/** The CSS-only fix candidates. A candidate that does not move the number, or
 *  that stops the gesture working, is not the fix. */
const CANDIDATES = {
  "cand-content-visibility": `[data-thread-card]{content-visibility:auto;contain-intrinsic-size:auto 120px;}`,
  "cand-lane-layer": `[data-card-list]{will-change:transform;}`,
  "cand-board-layer": `[data-columns-board]{will-change:transform;}`,
  "cand-both-layers": `[data-card-list],[data-columns-board]{will-change:transform;}`,
  "cand-contain-paint": `[data-thread-card]{contain:layout paint;}`,
  "cand-card-layer": `[data-thread-card]{will-change:transform;}`,
  // Kill the infinite attention pulse on every card whose state dot pulses.
  "cand-no-pulse": `[class*="animate-pulse"]{animation:none!important;}`,
  // Kill every animation on the board (isolates the animation cost).
  "cand-no-anim": `[data-columns-board] *{animation:none!important;}`,
  // Spotlight variants: the recede applies opacity to every non-hovered card,
  // which is a paint invalidation per card. Test whether promoting cards to
  // their own layer (compositor-only opacity), dropping the transition, or
  // simplifying the selector changes the hover cost.
  "cand-card-opacity-layer": `[data-thread-card]{will-change:opacity;}`,
  "cand-spotlight-no-transition":
    `[data-columns-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover):not([data-spotlight-immune]),` +
    `[data-parent-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover):not([data-spotlight-immune]){opacity:.7!important;transition:none!important;}`,
  "cand-spotlight-simple":
    `[data-columns-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover),` +
    `[data-parent-board]:has(div[data-thread-card]:hover) div[data-thread-card]:not(:hover){opacity:.7!important;transition:none!important;}`,
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });

const results = { machine: {}, gesture: process.env.GESTURE ?? "pan", query: QUERY, variants: [] };
results.machine = { chrome: await browser.version(), cpuThrottleRate: CPU, viewport: PHONE };

async function openBoard() {
  const page = await browser.newPage();
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 900));
  return page;
}

async function installInstrument(page) {
  await page.evaluate(() => {
    const w = window;
    w.__ab = { longTasks: [], frames: [], events: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__ab.longTasks.push({ t: e.startTime, d: e.duration });
      }).observe({ entryTypes: ["longtask"] });
    } catch {}
    const tick = (ts) => {
      w.__ab.frames.push(ts);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__ab.mark = (name) => {
      w.__ab.events.push({ name, t: performance.now() });
      return w.__ab.events.length - 1;
    };
    w.__ab.window = (from, to) => {
      const a = w.__ab.events[from];
      const b = w.__ab.events[to];
      if (!a || !b) return null;
      const [t0, t1] = [a.t, b.t];
      const lt = w.__ab.longTasks.filter((e) => e.t >= t0 && e.t <= t1);
      const frames = w.__ab.frames.filter((f) => f >= t0 && f <= t1);
      let dropped = 0;
      for (let i = 1; i < frames.length; i += 1) if (frames[i] - frames[i - 1] > 33) dropped += 1;
      const span = t1 - t0;
      return {
        wallMs: Math.round(span),
        longTaskCount: lt.length,
        longTaskMs: Math.round(lt.reduce((s, e) => s + e.d, 0)),
        longestTaskMs: Math.round(lt.reduce((m, e) => Math.max(m, e.d), 0)),
        frames: frames.length,
        dropped,
        fps: span > 0 ? Math.round((frames.length / span) * 1000) : null,
      };
    };
  });
}

/** Gesture progress: proves the gesture did real work (a "fast" no-op is not a win). */
async function progress(page, gesture) {
  return page.evaluate((g) => {
    const board = document.querySelector("[data-columns-board]");
    const lists = [...board.querySelectorAll("[data-card-list]")];
    const busiest = lists
      .map((l) => ({ l, n: l.querySelectorAll("[data-thread-card]").length }))
      .sort((a, b) => b.n - a.n)[0]?.l;
    return {
      boardScrollLeft: Math.round(board.scrollLeft),
      busiestLaneScrollTop: busiest ? Math.round(busiest.scrollTop) : null,
      paneOpen: document.querySelector('aside[aria-label^="Thread:"]') !== null,
    };
  }, gesture);
}

async function gestureWork(page, gesture) {
  if (gesture === "pan") {
    const box = await page.evaluate((s) => {
      const el = document.querySelector(s);
      const r = el.getBoundingClientRect();
      return { y: Math.round(r.y + r.height / 2), x: Math.round(r.x + r.width * 0.7) };
    }, SEL);
    const ts = page.touchscreen;
    await ts.touchStart(box.x, box.y);
    for (let i = 1; i <= 12; i += 1) {
      await ts.touchMove(box.x - i * 24, box.y);
      await new Promise((r) => setTimeout(r, 16));
    }
    await ts.touchEnd();
    await new Promise((r) => setTimeout(r, 600));
    return;
  }
  if (gesture === "lane") {
    await page.mouse.move(5, 5);
    const target = await page.evaluate((s) => {
      const board = document.querySelector(s);
      const lists = [...board.querySelectorAll("[data-card-list]")];
      const busiest = lists
        .map((l) => ({ l, n: l.querySelectorAll("[data-thread-card]").length }))
        .sort((a, b) => b.n - a.n)[0]?.l;
      if (!busiest) return null;
      const r = busiest.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, SEL);
    if (target === null) return;
    await page.mouse.move(target.x, target.y);
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel({ deltaY: 140 });
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  if (gesture === "hover") {
    const points = await page.evaluate((s) => {
      const cards = [...document.querySelectorAll(`${s} [data-thread-card]`)].slice(0, 12);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    }, SEL);
    for (const p of points) {
      await page.mouse.move(p.x, p.y);
      await new Promise((r) => setTimeout(r, 120));
    }
    return;
  }
  if (gesture === "open") {
    const p = await page.evaluate((s) => {
      const card = document.querySelector(`${s} [data-thread-card] a`);
      const r = card.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, SEL);
    await page.mouse.click(p.x, p.y);
    await new Promise((r) => setTimeout(r, 900));
    return;
  }
  if (gesture === "drag") {
    // A card drag: the board's dragover path runs per frame while the pointer
    // moves across lanes, which is the heaviest pointer interaction.
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
    if (pts === null) return;
    await page.mouse.move(pts.from.x, pts.from.y);
    await page.mouse.down();
    for (let i = 1; i <= 16; i += 1) {
      const x = Math.round(pts.from.x + ((pts.to.x - pts.from.x) * i) / 16);
      const y = Math.round(pts.from.y + ((pts.to.y - pts.from.y) * i) / 16);
      await page.mouse.move(x, y);
      await new Promise((r) => setTimeout(r, 16));
    }
    await page.mouse.up();
    await new Promise((r) => setTimeout(r, 300));
    return;
  }
  if (gesture === "idle") {
    // No gesture at all: the steady state the operator stares at. A board
    // that cannot hold frame rate while nothing happens is slow for reasons
    // beyond the gesture.
    await page.mouse.move(5, 5);
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function styleBreakdown(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const events = raw.traceEvents ?? raw;
  const wanted = new Set([
    "UpdateLayoutTree",
    "Layout",
    "PrePaint",
    "Paint",
    "HitTest",
    "Commit",
    "Layerize",
    "CompositeLayers",
    "RecalcStyles",
  ]);
  const totals = new Map();
  for (const e of events) {
    if (typeof e.dur !== "number" || !wanted.has(e.name)) continue;
    const s = totals.get(e.name) ?? { name: e.name, us: 0, count: 0 };
    s.us += e.dur;
    s.count += 1;
    totals.set(e.name, s);
  }
  return [...totals.values()].sort((a, b) => b.us - a.us).map((s) => ({ name: s.name, ms: Math.round(s.us / 1000), count: s.count }));
}

async function runVariant(name, { css, removeSpotlight }) {
  const page = await openBoard();
  await installInstrument(page);
  if (css) await page.addStyleTag({ content: css });
  if (removeSpotlight) await page.evaluate((id) => document.getElementById(id)?.remove(), SPOTLIGHT_ID);
  const before = await progress(page, results.gesture);
  // Let the load settle before the window opens, so a slow trace is the
  // steady state and not the tail of the initial render.
  await new Promise((r) => setTimeout(r, 1200));
  await page.tracing.start({
    path: `${OUT}trace-${results.gesture}-${name}.json`,
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"],
  });
  const from = await page.evaluate(() => window.__ab.mark("start"));
  await gestureWork(page, results.gesture);
  const summary = await page.evaluate((f) => window.__ab.window(f, window.__ab.mark("end")), from);
  await page.tracing.stop();
  const after = await progress(page, results.gesture);
  const style = await styleBreakdown(`${OUT}trace-${results.gesture}-${name}.json`);
  await page.close();
  return {
    variant: name,
    summary,
    progress: {
      boardScrollLeftDelta: after.boardScrollLeft - before.boardScrollLeft,
      laneScrollTopDelta:
        after.busiestLaneScrollTop === null || before.busiestLaneScrollTop === null
          ? null
          : after.busiestLaneScrollTop - before.busiestLaneScrollTop,
      paneOpened: after.paneOpen,
    },
    style,
  };
}

results.variants.push(await runVariant("baseline", {}));
results.variants.push(await runVariant("no-spotlight", { removeSpotlight: true }));
for (const [name, css] of Object.entries(CANDIDATES)) {
  results.variants.push(await runVariant(name, { css }));
}

await writeFile(`${OUT}evidence-${results.gesture}.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();

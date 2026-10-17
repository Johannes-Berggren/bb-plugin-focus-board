// Controlled experiment: the cost of N infinite `animate-pulse` animations on
// the board. Injects copies of the real pulsing element (the attention-state
// dot glyph, which carries the compiled `motion-safe:animate-pulse` class) and
// measures idle frame rate for each N. This separates "the board is big" from
// "each running animation costs the compositor a layer commit".
//
//   HARNESS_URL=http://localhost:5174/ PROBE_CPU=4 \
//     node scripts/screenshot/probe-pulse-cost.mjs
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5174/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-pulse-cost/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = process.env.PROBE_SCALE ?? "";
const QUERY = `?demo=1${SCALE ? `&scale=${SCALE}` : ""}`;
// When set, the pulsing elements get their own compositor layer
// (`will-change: opacity`), so animating opacity is a compositor-only change
// instead of a per-frame paint over the whole board. This is the candidate fix.
const PROMOTE = process.env.PROBE_PROMOTE === "1";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
const results = { machine: { chrome: await browser.version(), cpuThrottleRate: CPU }, counts: [] };

async function idleFps(page, ms) {
  return page.evaluate(async (duration) => {
    const frames = [];
    await new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        frames.push(performance.now());
        if (performance.now() - start < duration) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const lt = window.__pulseLt ?? [];
    const span = frames[frames.length - 1] - frames[0];
    let dropped = 0;
    for (let i = 1; i < frames.length; i += 1) if (frames[i] - frames[i - 1] > 33) dropped += 1;
    return {
      fps: span > 0 ? Math.round((frames.length / span) * 1000) : 0,
      dropped,
      longTasks: lt.length,
      longTaskMs: Math.round(lt.reduce((s, e) => s + e.d, 0)),
    };
  }, ms);
}

/** Count the real pulsing elements on the board (class-based, matches the
 *  compiled `motion-safe:animate-pulse` utility under a motion-safe media). */
async function countPulses(page) {
  return page.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll("*")) {
      const a = el.getAnimations?.() ?? [];
      if (a.some((x) => x.playState === "running" && !x.transitionProperty)) n += 1;
    }
    return n;
  });
}

/** Inject `extra` additional pulsing elements, each of the real dot-glyph
 *  shape, spread through the busiest lane's cards. */
async function injectPulses(page, extra) {
  await page.evaluate((n) => {
    const board = document.querySelector("[data-columns-board]");
    const cards = [...board.querySelectorAll("[data-thread-card]")];
    if (cards.length === 0) return;
    for (let i = 0; i < n; i += 1) {
      const host = cards[i % cards.length];
      const anchor = host.querySelector("[data-child-dot]") ?? host;
      const dot = document.createElement("span");
      dot.className = "motion-safe:animate-pulse inline-block size-1.5 shrink-0 rounded-full bg-amber-500/60";
      dot.dataset.injectedPulse = String(i);
      anchor.appendChild(dot);
    }
  }, extra);
}

async function openBoard() {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 800));
  if (PROMOTE) {
    await page.addStyleTag({
      content: `[class*="animate-pulse"]{will-change:opacity;}`,
    });
  }
  await page.evaluate(() => {
    window.__pulseLt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__pulseLt.push({ d: e.duration });
      }).observe({ entryTypes: ["longtask"] });
    } catch {}
  });
  return page;
}

results.machine.query = QUERY;
results.machine.promote = PROMOTE;

for (const extra of [0, 10, 30, 60, 120]) {  const page = await openBoard();
  if (extra > 0) await injectPulses(page, extra);
  await new Promise((r) => setTimeout(r, 800));
  const count = await countPulses(page);
  const idle = await idleFps(page, 2500);
  results.counts.push({ injected: extra, runningAnimations: count, ...idle });
  await page.close();
}

console.log(JSON.stringify(results, null, 2));
await browser.close();

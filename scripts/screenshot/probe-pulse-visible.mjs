// Measurement for issue #260: the visible-only pulse gate. Reports, per
// viewport width, how many attention pulses exist, how many are VISIBLE, how
// many the gate parks (off-screen), and the idle frame rate — with the gate,
// and with every pulse killed (the achievable ceiling).
//
// Opens `?attention=N`, whose threads all render the REAL shipped pulse (the
// amber card overlay + the state-dot glyph), not probe-injected clones.
//
// Usage: serve the probe build first, then
//   HARNESS_URL=http://localhost:5174/ PROBE_ATTENTION=200 PROBE_CPU=4 \
//     node scripts/screenshot/probe-pulse-visible.mjs
//
// Env: CHROME_PATH, HARNESS_URL (default http://localhost:5174/), PROBE_ATTENTION
// (default 200), PROBE_CPU (default 4), PROBE_SCALE, OUT_DIR.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5174/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-pulse-visible/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const ATTENTION = Number(process.env.PROBE_ATTENTION ?? "200");
const SCALE = process.env.PROBE_SCALE ?? "";
const QUERY = `?demo=1${SCALE ? `&scale=${SCALE}` : ""}&attention=${ATTENTION}`;

// The widths to judge: the release harness's phone, the desktop app's window,
// a wide desktop, a very tall window, and a 4K-class window — the last two are
// where the VISIBLE set could grow large enough to approach the cliff.
const VIEWPORTS = [
  { name: "phone-390", width: 390, height: 844, isMobile: true },
  { name: "desktop-1280x800", width: 1280, height: 800, isMobile: false },
  { name: "desktop-1920x1080", width: 1920, height: 1080, isMobile: false },
  { name: "wide-2560x1440", width: 2560, height: 1440, isMobile: false },
  { name: "tall-1280x2160", width: 1280, height: 2160, isMobile: false },
  { name: "uhd-3840x2160", width: 3840, height: 2160, isMobile: false },
];

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });
const results = { machine: {}, query: QUERY, viewports: [] };

/** Idle frame-rate window (long tasks come from window.__pulseLt). */
async function fpsWindow(page, ms) {
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

/** Running non-transition animations (the pulses that actually cost), how many
 *  intersect the viewport, and how many the gate parked. */
async function census(page) {
  return page.evaluate(() => {
    let total = 0;
    let visible = 0;
    let parked = 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    for (const el of document.querySelectorAll("[data-attention-pulse]")) {
      if (el.hasAttribute("data-pulse-parked")) parked += 1;
    }
    for (const el of document.querySelectorAll("*")) {
      const anims = el.getAnimations?.() ?? [];
      if (!anims.some((a) => a.playState === "running" && !a.transitionProperty)) continue;
      total += 1;
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0) {
        visible += 1;
      }
    }
    return { total, visible, parked };
  });
}

results.machine = { chrome: await browser.version(), cpuThrottleRate: CPU, attention: ATTENTION };

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({
    width: vp.width,
    height: vp.height,
    deviceScaleFactor: vp.isMobile ? 2 : 1,
    isMobile: vp.isMobile,
    hasTouch: vp.isMobile,
  });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await page.evaluate(() => {
    window.__pulseLt = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__pulseLt.push({ d: e.duration });
      }).observe({ entryTypes: ["longtask"] });
    } catch {}
  });
  await new Promise((r) => setTimeout(r, 1200));

  // ── 1. Gate state: how many pulses run, how many are visible, fps. ──
  const gateCensus = await census(page);
  const gateIdle = await fpsWindow(page, 2500);

  // ── 2. Scroll a busy lane under the gate: it must toggle (parked count
  //       moves) and stay smooth. ──
  const laneScroll = await page.evaluate(() => {
    const lists = [...document.querySelectorAll("[data-card-list]")];
    const busiest = lists
      .map((l) => ({ l, n: l.querySelectorAll("[data-thread-card]").length }))
      .sort((a, b) => b.n - a.n)[0]?.l;
    if (!busiest) return null;
    const r = busiest.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  let scroll = null;
  if (laneScroll !== null) {
    const parkedBefore = (await census(page)).parked;
    const sampler = page.evaluate(async () => {
      window.__scrollFrames = [];
      await new Promise((resolve) => {
        const start = performance.now();
        const tick = () => {
          window.__scrollFrames.push(performance.now());
          if (performance.now() - start < 1200) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return window.__scrollFrames;
    });
    await page.mouse.move(laneScroll.x, laneScroll.y);
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel({ deltaY: 130 });
      await new Promise((r) => setTimeout(r, 60));
    }
    const frames = await sampler;
    const after = await census(page);
    const span = frames.length > 1 ? frames[frames.length - 1] - frames[0] : 0;
    let dropped = 0;
    for (let i = 1; i < frames.length; i += 1) if (frames[i] - frames[i - 1] > 33) dropped += 1;
    scroll = {
      parkedBefore,
      parkedAfter: after.parked,
      runningAfter: after.total,
      fps: span > 0 ? Math.round((frames.length / span) * 1000) : 0,
      dropped,
    };
  }

  // ── 3. The achievable ceiling: kill every pulse animation on the SAME page,
  //       then scroll again — so the gate's own scroll cost (its
  //       IntersectionObserver churn) is separable from the page's. ──
  await page.addStyleTag({ content: `[class*="animate-pulse"]{animation:none!important;}` });
  await new Promise((r) => setTimeout(r, 400));
  const killedCensus = await census(page);
  const killedIdle = await fpsWindow(page, 2500);

  let scrollKilled = null;
  if (laneScroll !== null) {
    const sampler = page.evaluate(async () => {
      window.__scrollFrames2 = [];
      await new Promise((resolve) => {
        const start = performance.now();
        const tick = () => {
          window.__scrollFrames2.push(performance.now());
          if (performance.now() - start < 1200) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
      return window.__scrollFrames2;
    });
    for (let i = 0; i < 14; i += 1) {
      await page.mouse.wheel({ deltaY: 130 });
      await new Promise((r) => setTimeout(r, 60));
    }
    const f2 = await sampler;
    const span2 = f2.length > 1 ? f2[f2.length - 1] - f2[0] : 0;
    let dropped2 = 0;
    for (let i = 1; i < f2.length; i += 1) if (f2[i] - f2[i - 1] > 33) dropped2 += 1;
    scrollKilled = { fps: span2 > 0 ? Math.round((f2.length / span2) * 1000) : 0, dropped: dropped2 };
  }

  const cards = await page.evaluate(() => document.querySelectorAll("[data-thread-card]").length);
  results.viewports.push({ ...vp, cards, gateCensus, gateIdle, scroll, killedCensus, killedIdle, scrollKilled });
  await page.close();
}

// NOTE on the BEFORE numbers. This probe measures the fixed build; its own
// `killedCensus`/`killedIdle` is the ceiling (every pulse stopped), not the
// pre-fix board. The honest before is captured by running this SAME probe
// against a tree without the gate — `git stash push components/ && npx vite
// build --config scripts/screenshot/vite.probe.config.ts` — whose `gateCensus`
// reports every pulse animating (`parked: 0`). The committed evidence keeps
// both: `evidence-<n>x.json` (after) and `evidence-<n>x-before.json` (before).

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();

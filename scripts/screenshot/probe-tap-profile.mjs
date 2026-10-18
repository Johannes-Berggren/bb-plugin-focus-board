// CPU-profile a single tap-to-open on the phone board, so the mechanism behind
// the tap latency (probe-mobile-tap.mjs) is named rather than guessed.
//
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   HARNESS_URL=http://localhost:5301/ PROBE_CPU=4 PROBE_SCALE=300 \
//     node scripts/screenshot/probe-tap-profile.mjs
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5301/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-mobile-tap/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "300");
const PHONE = { width: 390, height: 844 };

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });
const page = await browser.newPage();
await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const session = await page.createCDPSession();
await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(`${BASE}?demo=1${SCALE > 0 ? `&scale=${SCALE}` : ""}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
await new Promise((r) => setTimeout(r, 1500));

// Frame interval calibration: how long one rAF frame takes at this load, so the
// probe's own two-frame settle can be subtracted from the tap latency.
const frameMs = await page.evaluate(
  () =>
    new Promise((resolve) => {
      const times = [];
      const tick = (t) => {
        times.push(t);
        if (times.length < 12) requestAnimationFrame(tick);
        else {
          const gaps = times.slice(1).map((v, i) => v - times[i]).sort((a, b) => a - b);
          resolve(Math.round(gaps[Math.floor(gaps.length / 2)]));
        }
      };
      requestAnimationFrame(tick);
    }),
);

// Instrument: mark the tap's dispatch, then record every commit until the pane
// exists, so the profile window is exactly the tap's own work.
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

const client = await page.createCDPSession();
await client.send("Profiler.enable");
await client.send("Profiler.setSamplingInterval", { interval: 100 });
await client.send("Profiler.start");
const wallT0 = Date.now();
await page.touchscreen.tap(target.x, target.y);
await page.waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') !== null, { timeout: 8000 });
const openMs = Date.now() - wallT0;
const { profile } = await client.send("Profiler.stop");

function rankProfile(profile) {
  const total = profile.nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
  const byFn = new Map();
  for (const n of profile.nodes) {
    const hits = n.hitCount ?? 0;
    if (hits === 0) continue;
    const fn = n.callFrame.functionName || "(anonymous)";
    if (fn === "(idle)" || fn === "(program)" || fn === "(root)") continue;
    const file = (n.callFrame.url || "").split("/").slice(-1)[0].split("?")[0];
    const key = `${file}:${n.callFrame.lineNumber + 1}:${fn}`;
    byFn.set(key, (byFn.get(key) ?? 0) + hits);
  }
  const totalActive = [...byFn.values()].reduce((a, b) => a + b, 0);
  return {
    totalSamples: total,
    activeSamples: totalActive,
    top: [...byFn.entries()]
      .map(([k, hits]) => {
        const [file, line, ...rest] = k.split(":");
        return { file, line: Number(line), fn: rest.join(":"), selfSamples: hits, pctActive: Math.round((hits / totalActive) * 1000) / 10 };
      })
      .sort((a, b) => b.selfSamples - a.selfSamples)
      .slice(0, 40),
  };
}

// Aggregate by function name alone (across minification-safe file:line), so a
// hot component or hook shows its whole cost.
function rankByFn(profile) {
  const byFn = new Map();
  for (const n of profile.nodes) {
    const hits = n.hitCount ?? 0;
    if (hits === 0) continue;
    const fn = n.callFrame.functionName || "(anonymous)";
    if (fn === "(idle)" || fn === "(program)" || fn === "(root)") continue;
    byFn.set(fn, (byFn.get(fn) ?? 0) + hits);
  }
  const total = [...byFn.values()].reduce((a, b) => a + b, 0);
  return [...byFn.entries()]
    .map(([fn, hits]) => ({ fn, selfSamples: hits, pctActive: Math.round((hits / total) * 1000) / 10 }))
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 40);
}

const result = {
  machine: { chrome: await browser.version(), cpuThrottleRate: CPU, scale: SCALE, viewport: PHONE, query: `?demo=1&scale=${SCALE}` },
  target,
  frameMs,
  openMs,
  byLocation: rankProfile(profile),
  byFunction: rankByFn(profile),
};
await writeFile(`${OUT}profile-tap-open.json`, JSON.stringify({ result, profile }));
await writeFile(`${OUT}profile-tap-open-summary.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify({ ...result, byLocation: result.byLocation.top.slice(0, 15), byFunction: result.byFunction.slice(0, 20) }, null, 1));
await browser.close();

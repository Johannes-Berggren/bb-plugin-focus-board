// Headless repro for the mobile "first-load tap lands on the wrong object"
// complaint (thread: "Improve mobile tap responsiveness").
//
// Hypothesis: on first load the board is still growing/settling, so the
// element under a fixed screen point changes between the paint the operator
// aimed at and the moment their tap is dispatched. A finger that taps where a
// card was a moment ago hits whatever slid into that point.
//
// Method: at phone size and CPU throttle, load the board and, without waiting
// for it to settle, poll a fixed point's `elementFromPoint` every animation
// frame for a window. Record:
//   - the sequence of card ids that occupy the point (how many distinct
//     targets the operator's finger would have hit at that one coordinate)
//   - the largest layout shift any card's top/left moved during the window
//   - the total cumulative layout shift (CLS) the page reports
//   - the moment the board first painted a card, and when it stopped changing
//
// A point that resolves to several different cards during load is the bug:
// the tap's target is decided by WHEN in the load it lands, not where the
// operator aimed.
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   node scripts/screenshot/probe-first-load-tap.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-first-load-tap/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "300");
const PHONE = { width: 390, height: 844 };
const QUERY = `?demo=1${SCALE > 0 ? `&scale=${SCALE}` : ""}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });

const page = await browser.newPage();
await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// The sampler runs in the page from document creation: it watches a fixed
// point and a fixed set of card positions from the first paint on.
await page.evaluateOnNewDocument(() => {
  const w = window;
  w.__load = { samples: [], shifts: [], cls: 0, firstCardAt: null, quietAt: null };
  // Cumulative layout shift, from the browser's own accounting.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput !== true) w.__load.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {
    /* Chrome only */
  }
  const tick = () => {
    const x = Math.round(w.innerWidth / 2);
    const y = Math.round(w.innerHeight * 0.35);
    const el = document.elementFromPoint(x, y);
    const card = el === null ? null : el.closest("[data-thread-card]");
    const id = card === null ? null : card.getAttribute("data-thread-card");
    const t = Math.round(performance.now());
    if (w.__load.firstCardAt === null && id !== null) w.__load.firstCardAt = t;
    const last = w.__load.samples.at(-1);
    const changed = last === undefined || last.id !== id;
    w.__load.samples.push({ t, id, changed });
    // Track the vertical position of the card currently under the point: a
    // card sliding under the finger is exactly the wrong-object mechanism.
    if (card !== null) {
      const r = card.getBoundingClientRect();
      w.__load.shifts.push({ t, id, top: Math.round(r.top), left: Math.round(r.left) });
    }
    if (t < 6000) requestAnimationFrame(tick);
    else {
      // Quiet moment: the last time the sampled id changed.
      let quiet = 0;
      for (const s of w.__load.samples) if (s.changed) quiet = s.t;
      w.__load.quietAt = quiet;
    }
  };
  requestAnimationFrame(tick);
});

await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
// Wait for the page's own 6s sampler to finish, then read it.
await new Promise((r) => setTimeout(r, 7000));

const raw = await page.evaluate(() => {
  const l = window.__load;
  const seq = [];
  for (const s of l.samples) if (s.changed) seq.push({ t: s.t, id: s.id });
  // Largest drift of any single card's top position, per card id.
  const byId = new Map();
  for (const s of l.shifts) {
    if (!byId.has(s.id)) byId.set(s.id, []);
    byId.get(s.id).push(s);
  }
  const drifts = [];
  for (const [id, rows] of byId) {
    const tops = rows.map((r) => r.top);
    const lefts = rows.map((r) => r.left);
    drifts.push({
      id,
      topDrift: Math.max(...tops) - Math.min(...tops),
      leftDrift: Math.max(...lefts) - Math.min(...lefts),
    });
  }
  drifts.sort((a, b) => b.topDrift - a.topDrift);
  return {
    firstCardAt: l.firstCardAt,
    quietAt: l.quietAt,
    sampleCount: l.samples.length,
    distinctTargetsAtPoint: [...new Set(l.samples.map((s) => s.id))].length,
    targetSequence: seq,
    cls: Math.round(l.cls * 1000) / 1000,
    worstDrift: drifts.slice(0, 8),
    cardCount: document.querySelectorAll("[data-thread-card]").length,
  };
});

const result = {
  machine: { chrome: await browser.version(), cpuThrottleRate: CPU, scale: SCALE, viewport: PHONE, query: QUERY },
  ...raw,
};
await writeFile(`${OUT}evidence.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();

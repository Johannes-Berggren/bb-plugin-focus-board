// Headless measurement of mobile TAP responsiveness for the Focus Board
// (thread: "Improve mobile tap responsiveness").
//
// Two complaints drive this probe:
//   1. a tap lands on the WRONG object, especially on first load;
//   2. tapping to CLOSE the thread pane takes so long the operator taps again.
//
// Both are modelled as one latency budget per tap: the time from the tap's
// own dispatch to the moment its RESULT is committed to the DOM and painted.
// A tap whose result lands late is a tap the operator repeats; a tap whose
// target moved between the pointer sample and the dispatch is a tap that
// landed on a neighbour.
//
// Measurements, per load condition (thread count + CPU rate + network):
//   - first-load window: board paint, TBT, long tasks, and the tap test taken
//     WHILE the board is still settling
//   - tap-to-open: tap a card's centre, time until the pane aside exists and
//     the next frame paints
//   - tap-to-close: tap the pane's Back button, time until the aside is gone
//     and the board is interactive again
//   - wrong-object: the element at the sampled coordinates vs. the card the
//     sample named, plus whether any card moved between sample and dispatch
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts    # terminal 1
//   node scripts/screenshot/probe-mobile-tap.mjs           # terminal 2
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE,
// PROBE_NET (a preset: "none" | "fast3g" | "slow3g"), PROBE_TAP_BUDGET_MS.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-mobile-tap/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "0");
const NET = process.env.PROBE_NET ?? "none";
const PHONE = { width: 390, height: 844 };

/** Network presets, as CDP emulateNetworkConditions payloads. Chrome's own
 *  throttling presets; `none` means throttling is switched off, which is NOT
 *  the same as a fast network — it is "measure the CPU alone". */
const NET_PRESETS = {
  none: { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 },
  fast3g: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  slow3g: { offline: false, latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
};

const query = `?demo=1${SCALE > 0 ? `&scale=${SCALE}` : ""}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});
await mkdir(OUT, { recursive: true });

/** An in-page instrument: a long-task observer, a frame clock, and a
 *  paint-settle helper that resolves on the SECOND animation frame after a
 *  mutation — one frame for the commit, one for the paint. */
function installInstrument() {
  const w = window;
  w.__tap = { longTasks: [], frames: [], boardPaintAt: null };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__tap.longTasks.push({ t: e.startTime, d: e.duration });
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* Chrome only */
  }
  const tick = (ts) => {
    w.__tap.frames.push(ts);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    const mo = new MutationObserver(() => {
      if (w.__tap.boardPaintAt === null && document.querySelector("[data-thread-card]") !== null) {
        w.__tap.boardPaintAt = performance.now();
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  } catch {
    /* document exists */
  }
  /** Wait for `predicate` to hold, then settle two frames and return the
   *  elapsed wall time from `t0`. Returns null on timeout. */
  w.__tap.awaitResult = (t0, predicateSrc, timeoutMs) => {
    const predicate = new Function("document", "window", `return (${predicateSrc});`);
    return new Promise((resolve) => {
      const deadline = performance.now() + timeoutMs;
      const poll = () => {
        let ok = false;
        try {
          ok = predicate(document, window) === true;
        } catch {
          ok = false;
        }
        if (ok) {
          // Two frames: the commit frame, then the paint frame.
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(performance.now() - t0))));
          return;
        }
        if (performance.now() > deadline) {
          resolve(null);
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    });
  };
}

async function newPage() {
  const page = await browser.newPage();
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(installInstrument);
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  const net = NET_PRESETS[NET] ?? NET_PRESETS.none;
  await session.send("Network.enable");
  await session.send("Network.emulateNetworkConditions", net);
  return { page, session };
}

/** The card whose centre sits most inside the viewport, plus its identity. */
const pickCard = (sel) => {
  const cards = [...document.querySelectorAll(`${sel} [data-thread-card]`)];
  let best = null;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) continue;
    const visible =
      r.left >= 0 && r.right <= window.innerWidth && r.top >= 0 && r.bottom <= window.innerHeight;
    if (!visible) continue;
    const area = r.width * r.height;
    if (best === null || area > best.area) best = { el: card, rect: r, area, id: card.getAttribute("data-thread-card") };
  }
  if (best === null) return null;
  return {
    id: best.id,
    x: Math.round(best.rect.left + best.rect.width / 2),
    y: Math.round(best.rect.top + best.rect.height / 2),
  };
};

/** What is under a point, by card identity and tag — the wrong-object read. */
const elementAt = (x, y) => {
  const el = document.elementFromPoint(x, y);
  if (el === null) return { tag: null, cardId: null };
  const card = el.closest("[data-thread-card]");
  return {
    tag: el.tagName.toLowerCase(),
    cardId: card === null ? null : card.getAttribute("data-thread-card"),
    ariaLabel: el.getAttribute("aria-label"),
  };
};

const results = {
  machine: {
    chrome: await browser.version(),
    viewport: PHONE,
    cpuThrottleRate: CPU,
    scale: SCALE,
    network: NET,
    netPreset: NET_PRESETS[NET] ?? NET_PRESETS.none,
    query,
  },
  load: {},
  taps: [],
};

// ── Phase 1: first-load window, tap DURING the settle ─────────────────────
{
  const { page } = await newPage();
  const t0 = Date.now();
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  const domReadyMs = Date.now() - t0;

  // Deliberately do NOT wait for the board to settle: the operator's first tap
  // arrives inside this window. Sample a target, then check it again at
  // dispatch time — if the board moved under the finger, that is the bug.
  const sample = await page.evaluate(pickCard, "[data-columns-board]");
  const dispatchAt = await page.evaluate((s) => {
    const before = document.elementFromPoint(s.x, s.y);
    const card = before === null ? null : before.closest("[data-thread-card]");
    return {
      cardIdAtDispatch: card === null ? null : card.getAttribute("data-thread-card"),
      tag: before === null ? null : before.tagName.toLowerCase(),
      boardPaintAt: window.__tap.boardPaintAt === null ? null : Math.round(window.__tap.boardPaintAt),
    };
  }, sample);
  results.load.domReadyMs = domReadyMs;
  results.load.boardPaintAt = dispatchAt.boardPaintAt;
  results.taps.push({
    label: "first-load-target-stability",
    sampledCardId: sample === null ? null : sample.id,
    atDispatchCardId: dispatchAt.cardIdAtDispatch,
    sameTarget: sample !== null && sample.id === dispatchAt.cardIdAtDispatch,
  });
  await page.close();
}

// ── Phase 2: settled board, tap-to-open then tap-to-close ─────────────────
{
  const { page } = await newPage();
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 1500)); // settle

  await page.evaluate(() => {
    window.__tap.longTasks = [];
  });

  const target = await page.evaluate(pickCard, "[data-columns-board]");
  const preTapElement = await page.evaluate(elementAt, target.x, target.y);
  const openT0 = await page.evaluate(() => performance.now());
  await page.touchscreen.tap(target.x, target.y);
  const openMs = await page.evaluate(
    (t0) =>
      window.__tap.awaitResult(
        t0,
        'document.querySelector(\'aside[aria-label^="Thread:"]\') !== null',
        8000,
      ),
    openT0,
  );
  const openedOn = await page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label^="Thread:"]');
    return aside === null ? null : aside.getAttribute("aria-label");
  });
  results.taps.push({
    label: "tap-to-open",
    tapped: preTapElement,
    targetCardId: target.id,
    openedOn,
    ms: openMs,
    wrongObject: openedOn === null || !String(openedOn).includes(target.id),
  });

  if (openedOn !== null) {
    // Tap-to-close: the compact pane's Back button ("Back to board").
    await page.evaluate(() => {
      window.__tap.longTasks = [];
    });
    const back = await page.evaluate(() => {
      const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
      if (btn === null) return null;
      const r = btn.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (back === null) {
      results.taps.push({ label: "tap-to-close", error: "no Back to board button in the pane header" });
    } else {
      const closeT0 = await page.evaluate(() => performance.now());
      await page.touchscreen.tap(back.x, back.y);
      const closeMs = await page.evaluate(
        (t0) =>
          window.__tap.awaitResult(
            t0,
            'document.querySelector(\'aside[aria-label^="Thread:"]\') === null && document.querySelector("[data-thread-card]") !== null',
            8000,
          ),
        closeT0,
      );
      results.taps.push({ label: "tap-to-close", ms: closeMs });
    }
  }
  await page.close();
}

// ── Phase 3: 10 back-to-back taps, the "operator retries" pattern ──────────
{
  const { page } = await newPage();
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 1500));

  const budgetMs = Number(process.env.PROBE_TAP_BUDGET_MS ?? "400");
  const samples = [];
  for (let i = 0; i < 10; i += 1) {
    const target = await page.evaluate(pickCard, "[data-columns-board]");
    if (target === null) break;
    const before = await page.evaluate(elementAt, target.x, target.y);
    const t0 = await page.evaluate(() => performance.now());
    await page.touchscreen.tap(target.x, target.y);
    const openMs = await page.evaluate(
      (t) =>
        window.__tap.awaitResult(
          t,
          'document.querySelector(\'aside[aria-label^="Thread:"]\') !== null',
          8000,
        ),
      t0,
    );
    const openedOn = await page.evaluate(() => {
      const aside = document.querySelector('aside[aria-label^="Thread:"]');
      return aside === null ? null : aside.getAttribute("aria-label");
    });
    samples.push({
      i,
      tapped: before,
      targetCardId: target.id,
      openedOn,
      ms: openMs,
      wrongObject: openedOn === null || !String(openedOn).includes(target.id),
      overBudget: openMs === null || openMs > budgetMs,
    });
    // Close it back out (or the next tap hits the pane).
    if (openedOn !== null) {
      const back = await page.evaluate(() => {
        const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
        if (btn === null) return null;
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      if (back !== null) {
        await page.touchscreen.tap(back.x, back.y);
        await page.waitForFunction(
          () => document.querySelector('aside[aria-label^="Thread:"]') === null,
          { timeout: 8000 },
        ).catch(() => {});
      }
    }
  }
  results.taps.push({ label: "tap-series", budgetMs, samples });
  await page.close();
}

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
await browser.close();

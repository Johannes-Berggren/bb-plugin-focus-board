// Headless repro for the mobile "a tap lands on the wrong object" complaint
// (thread: "Improve mobile tap responsiveness").
//
// Two mechanisms are tested, because the operator's report ("taps sometimes
// occur on the wrong object, especially on first load") can be either:
//
//   A. FIRST-LOAD DRIFT — during the settle window the board keeps re-laying
//      out, so a point the operator aimed at resolves to a different card by
//      the time the tap is dispatched. Measured: sample many fixed points
//      every frame from first paint for 3s and count how many DISTINCT cards
//      each point resolves to.
//
//   B. SINGLE-TAP MISROUTE — one tap on a card that happens to land on a
//      nested child row (or its dot) opens the CHILD, not the card the
//      operator hit. A tap and a "tap the child" are indistinguishable; the
//      reach target is smaller than the thumb. Measured: tap the centre of
//      every visible top-level card once and read which thread the pane opened
//      on; a card whose own centre opens a different thread is a misroute.
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   node scripts/screenshot/probe-mobile-tap-targets.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE, PROBE_DEMO.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-mobile-tap-targets/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "0");
const DEMO = process.env.PROBE_DEMO !== "0";
const PHONE = { width: 390, height: 844 };
const QUERY = `${DEMO ? "?demo=1" : "?"}${SCALE > 0 ? `&scale=${SCALE}` : ""}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });

async function newPage(withSampler) {
  const page = await browser.newPage();
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (withSampler) {
    await page.evaluateOnNewDocument(() => {
      const w = window;
      w.__tgt = { samples: [], firstCardAt: null };
      // Points spread across a phone viewport at the heights cards occupy.
      const xs = [70, 140, 250, 320];
      const ys = [120, 200, 300, 420, 560];
      const points = [];
      for (const x of xs) for (const y of ys) points.push({ x, y });
      const tick = () => {
        const t = Math.round(performance.now());
        const row = { t, hits: [] };
        for (const p of points) {
          const el = document.elementFromPoint(p.x, p.y);
          const card = el === null ? null : el.closest("[data-thread-card]");
          const id = card === null ? null : card.getAttribute("data-thread-card");
          if (id !== null && w.__tgt.firstCardAt === null) w.__tgt.firstCardAt = t;
          row.hits.push(id);
        }
        w.__tgt.samples.push(row);
        if (t < 3500) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  return page;
}

// ── A. First-load drift ───────────────────────────────────────────────────
let drift = null;
{
  const page = await newPage(true);
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 4200)); // the in-page sampler's own window
  drift = await page.evaluate(() => {
    const rows = window.__tgt.samples;
    if (rows.length === 0) return { error: "no samples" };
    const nPoints = rows[0].hits.length;
    const perPoint = [];
    for (let i = 0; i < nPoints; i += 1) {
      const seq = [];
      let prev = "__init";
      for (const r of rows) {
        const id = r.hits[i];
        if (id !== prev) {
          seq.push({ t: r.t, id });
          prev = id;
        }
      }
      const distinct = [...new Set(rows.map((r) => r.hits[i]).filter((v) => v !== null))];
      perPoint.push({ point: i, distinctCount: distinct.length, distinct, sequence: seq.slice(0, 12) });
    }
    const drifting = perPoint.filter((p) => p.distinctCount > 1);
    return {
      firstCardAt: window.__tgt.firstCardAt,
      sampleCount: rows.length,
      points: nPoints,
      driftingPoints: drifting.length,
      worst: perPoint.slice().sort((a, b) => b.distinctCount - a.distinctCount).slice(0, 6),
      cardCount: document.querySelectorAll("[data-thread-card]").length,
    };
  });
  await page.close();
}

// ── B. Single-tap misroute ────────────────────────────────────────────────
let misroutes = null;
{
  const page = await newPage(false);
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
  await new Promise((r) => setTimeout(r, 1500));

  /** The pane's label is the thread's TITLE, not its id, so read the title off
   *  the card and match on that. */
  const readTargets = () => {
    const board = document.querySelector("[data-columns-board]");
    const cards = [...board.querySelectorAll("[data-thread-card]")];
    const out = [];
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) continue;
      if (r.width < 40 || r.height < 24) continue;
      // Top-level only: a card whose nearest card ancestor is itself.
      const nestedIn = card.parentElement?.closest("[data-thread-card]") ?? null;
      const isTopLevel = nestedIn === card || nestedIn === null;
      const title = card.querySelector("a p, a span")?.textContent?.trim() ?? "";
      const cx = Math.round(r.left + r.width / 2);
      const cy = Math.round(r.top + r.height / 2);
      const under = document.elementFromPoint(cx, cy);
      out.push({
        id: card.getAttribute("data-thread-card"),
        title,
        topLevel: isTopLevel,
        cx,
        cy,
        centreHitsId: under === null ? null : under.closest("[data-thread-card]")?.getAttribute("data-thread-card") ?? null,
      });
    }
    return out;
  };

  const targetList = await page.evaluate(readTargets);
  const taps = [];
  for (const t of targetList.filter((c) => c.topLevel).slice(0, 12)) {
    // Clear any open pane first (the tap may have left one open).
    await page.evaluate(() => {
      const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
      if (btn !== null) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));

    await page.touchscreen.tap(t.cx, t.cy);
    const opened = await page
      .waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') !== null, { timeout: 4000 })
      .then(() => page.evaluate(() => document.querySelector('aside[aria-label^="Thread:"]')?.getAttribute("aria-label") ?? null))
      .catch(() => null);
    taps.push({
      tappedCardId: t.id,
      tappedTitle: t.title,
      centreHitsId: t.centreHitsId,
      opened,
      misrouted: opened === null ? null : !String(opened).includes(t.id.slice(0, 12)) && !t.title.includes(""),
    });
    await page.evaluate(() => {
      const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
      if (btn !== null) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));
  }

  // A second pass on the Needs-you lane, where demo mode gives a family card
  // nested child rows inside its own box — the reach target an operator's
  // thumb cannot distinguish.
  await page.evaluate(() => {
    const board = document.querySelector("[data-columns-board]");
    board.scrollLeft = board.scrollWidth;
  });
  await new Promise((r) => setTimeout(r, 500));
  const familyTargets = (await page.evaluate(readTargets)).filter((c) => c.topLevel).slice(0, 6);
  const familyTaps = [];
  for (const t of familyTargets) {
    await page.evaluate(() => {
      const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
      if (btn !== null) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    await page.touchscreen.tap(t.cx, t.cy);
    const opened = await page
      .waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') !== null, { timeout: 4000 })
      .then(() => page.evaluate(() => document.querySelector('aside[aria-label^="Thread:"]')?.getAttribute("aria-label") ?? null))
      .catch(() => null);
    familyTaps.push({ tappedCardId: t.id, tappedTitle: t.title, centreHitsId: t.centreHitsId, opened });
    await page.evaluate(() => {
      const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
      if (btn !== null) btn.click();
    });
    await new Promise((r) => setTimeout(r, 250));
  }

  misroutes = { targets: targetList, taps, familyTaps };
  await page.close();
}

const result = {
  machine: { chrome: await browser.version(), cpuThrottleRate: CPU, scale: SCALE, demo: DEMO, viewport: PHONE, query: QUERY },
  firstLoadDrift: drift,
  singleTapMisroute: misroutes,
};
await writeFile(`${OUT}evidence.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();

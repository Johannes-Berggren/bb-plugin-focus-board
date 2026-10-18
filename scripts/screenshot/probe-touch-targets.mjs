// Measure the phone board's touch-target geometry. A tap lands on the wrong
// object when the target is smaller than the finger: a child dot is ~6px, and
// a thumb's contact patch is ~40px, so a dot sits inside its neighbours'
// reach. This probe records the rendered box of every interactive surface on
// the board and the pane header, and flags the ones under the common minimums
// (WCAG 2.5.8 target size 24px, Apple/Google guidance 44px).
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   node scripts/screenshot/probe-touch-targets.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-touch-targets/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "300");
const PHONE = { width: 390, height: 844 };
const QUERY = `?demo=1&scale=${SCALE}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });
const page = await browser.newPage();
await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const session = await page.createCDPSession();
await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 90_000 });
await new Promise((r) => setTimeout(r, 1500));

/** Every interactive surface, with its box and its spec minimums. */
const measureBoard = () => {
  const surfaces = [];
  const push = (kind, el, label) => {
    if (el === null) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    // The nearest interactive ancestor (the hit surface the browser will route
    // the gesture to) — a small icon inside a big button is a big target.
    let hit = el;
    let hitAncestor = el.parentElement;
    while (hitAncestor !== null && hitAncestor !== document.body) {
      if (
        hitAncestor.matches("a[href], button, [role=button], input, select, textarea") ||
        hitAncestor.hasAttribute("data-thread-card")
      ) {
        hit = hitAncestor;
        break;
      }
      hitAncestor = hitAncestor.parentElement;
    }
    const hr = hit.getBoundingClientRect();
    const box = hr.width >= r.width || hr.height >= r.height ? hr : r;
    surfaces.push({
      kind,
      label,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      // The surface the gesture actually reaches (its own box, or the smallest
      // ancestor that contains it).
      hitW: Math.round(box.width * 10) / 10,
      hitH: Math.round(box.height * 10) / 10,
      x: Math.round(r.left),
      y: Math.round(r.top),
      aria: el.getAttribute("aria-label"),
      // Under the WCAG 2.5.8 24px floor, or the 44px guidance — judged on the
      // reachable surface, not the icon.
      under24: box.width < 24 || box.height < 24,
      under44: box.width < 44 || box.height < 44,
    });
  };
  const root = document.querySelector("[data-columns-board]");
  // A card's own anchor (the tap surface that opens a thread).
  for (const a of root.querySelectorAll("[data-thread-card] a[href]")) push("card-anchor", a, "open thread");
  // Child dots (the collapsed strip) and the sub-dots beneath them.
  for (const b of root.querySelectorAll("button[aria-label^='Open child']")) push("child-dot", b, b.getAttribute("aria-label"));
  for (const b of root.querySelectorAll("button[aria-label^='Open sub']")) push("sub-dot", b, b.getAttribute("aria-label"));
  // Nested child rows (each is its own anchor).
  for (const a of root.querySelectorAll("[data-child-thread-section] a[href]")) push("child-row", a, "open child");
  // The done checkbox and the family section toggles.
  for (const b of root.querySelectorAll("[data-done-checkbox]")) push("done-checkbox", b, b.getAttribute("aria-label"));
  for (const b of root.querySelectorAll("[data-child-threads-toggle]")) push("child-toggle", b, b.getAttribute("aria-label"));
  return {
    surfaces,
    cardCount: root.querySelectorAll("[data-thread-card]").length,
    nodeCount: document.querySelectorAll("*").length,
  };
};

const board = await page.evaluate(measureBoard);

// The pane header controls, once a pane is open.
const pane = await (async () => {
  const target = await page.evaluate(() => {
    const a = document.querySelector("[data-columns-board] [data-thread-card] a");
    const r = a.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await page.touchscreen.tap(target.x, target.y);
  await page.waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') !== null, { timeout: 8000 }).catch(() => {});
  return page.evaluate(() => {
    const aside = document.querySelector('aside[aria-label^="Thread:"]');
    if (aside === null) return { error: "pane did not open" };
    const out = [];
    for (const b of aside.querySelectorAll("header button, header [role=button]")) {
      const r = b.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      out.push({
        aria: b.getAttribute("aria-label"),
        w: Math.round(r.width * 10) / 10,
        h: Math.round(r.height * 10) / 10,
        under24: r.width < 24 || r.height < 24,
        under44: r.width < 44 || r.height < 44,
      });
    }
    // The pane's own edge (the drag handle) is a 6px-wide strip.
    const edge = aside.querySelector("[role=separator][aria-label='Resize thread pane']");
    let edgeBox = null;
    if (edge !== null) {
      const r = edge.getBoundingClientRect();
      edgeBox = { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
    }
    return { headerButtons: out, edge: edgeBox };
  });
})();

function summarize(surfaces) {
  const byKind = {};
  for (const s of surfaces) {
    if (byKind[s.kind] === undefined) byKind[s.kind] = { n: 0, under24: 0, under44: 0, minHitW: Infinity, minHitH: Infinity, maxW: 0, maxH: 0 };
    const k = byKind[s.kind];
    k.n += 1;
    if (s.under24) k.under24 += 1;
    if (s.under44) k.under44 += 1;
    k.minHitW = Math.min(k.minHitW, s.hitW);
    k.minHitH = Math.min(k.minHitH, s.hitH);
    k.maxW = Math.max(k.maxW, s.w);
    k.maxH = Math.max(k.maxH, s.h);
  }
  return byKind;
}

const result = {
  machine: { chrome: await browser.version(), cpuThrottleRate: CPU, scale: SCALE, viewport: PHONE, query: QUERY },
  board: { cardCount: board.cardCount, nodeCount: board.nodeCount, byKind: summarize(board.surfaces), surfaces: board.surfaces },
  pane,
};
await writeFile(`${OUT}evidence.json`, JSON.stringify(result, null, 1));
const tiny = result.board.surfaces.filter((s) => s.under24);
console.log(JSON.stringify({ machine: result.machine, boardByKind: result.board.byKind, pane: result.pane, tinyCount: tiny.length, tinySample: tiny.slice(0, 20) }, null, 1));
await browser.close();

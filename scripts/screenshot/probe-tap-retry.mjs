// Headless repro for the mobile "taps occur on the wrong object / the operator
// taps again" complaint (thread: "Improve mobile tap responsiveness").
//
// Hypothesis: the pane's close (and open) takes a long, uninterruptible
// window — measured at 250-530ms on a 478-card board with a phone CPU. During
// that window the main thread is busy, so a SECOND tap the operator makes
// (because the first felt ignored) is queued and then delivered against
// whatever is under the finger once the pane has unmounted. The second tap
// then opens a DIFFERENT thread than the one the operator aimed at: the tap
// landed on the wrong object.
//
// Method: open a pane, tap Back to close, then tap again at the SAME point
// after a delay that mimics the retry (the operator's second tap inside the
// first's latency window). Read whether a pane reopened, and on which thread.
// A reopen on a thread that is not the one just closed is the bug.
//
// Also measures the "tap queued during the busy window" latency: dispatch the
// retry tap while the first close is still in flight and time when the DOM
// next settles.
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   node scripts/screenshot/probe-tap-retry.mjs
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_CPU, PROBE_SCALE,
// PROBE_RETRY_MS (the delay before the retry tap, default 120).
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-tap-retry/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const SCALE = Number(process.env.PROBE_SCALE ?? "300");
const RETRY_MS = Number(process.env.PROBE_RETRY_MS ?? "120");
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

const paneLabel = () =>
  page.evaluate(() => document.querySelector('aside[aria-label^="Thread:"]')?.getAttribute("aria-label") ?? null);
const backButton = () =>
  page.evaluate(() => {
    const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
    if (btn === null) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
const cardUnder = (x, y) =>
  page.evaluate(
    (pt) => {
      const el = document.elementFromPoint(pt.x, pt.y);
      const card = el === null ? null : el.closest("[data-thread-card]");
      return {
        tag: el === null ? null : el.tagName.toLowerCase(),
        cardId: card === null ? null : card.getAttribute("data-thread-card"),
        inPane: el !== null && el.closest('aside[aria-label^="Thread:"]') !== null,
      };
    },
    { x, y },
  );

const trials = [];
for (let i = 0; i < 8; i += 1) {
  // Ensure the board is showing (close any stray pane).
  await page.evaluate(() => {
    const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
    if (btn !== null) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  // Open a pane on a card the operator aims at.
  const aim = await page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-columns-board] [data-thread-card]")];
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      if (r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && r.width > 40) {
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), id: c.getAttribute("data-thread-card") };
      }
    }
    return null;
  });
  await page.touchscreen.tap(aim.x, aim.y);
  await page.waitForFunction(() => document.querySelector('aside[aria-label^="Thread:"]') !== null, { timeout: 8000 }).catch(() => {});
  const openedOn = await paneLabel();

  // Tap Back to close. The retry tap follows RETRY_MS later, at the SAME point
  // (where the Back button was) — the operator tapping again because nothing
  // seemed to happen yet.
  const back = await backButton();
  if (back === null) {
    trials.push({ i, openedOn, error: "no back button" });
    continue;
  }
  const underBack = await cardUnder(back.x, back.y);
  const t0 = Date.now();
  await page.touchscreen.tap(back.x, back.y);
  await new Promise((r) => setTimeout(r, RETRY_MS));
  const afterDelayPane = await paneLabel();
  // What is under the retry point at the instant the retry is dispatched?
  const underRetry = await cardUnder(back.x, back.y);
  await page.touchscreen.tap(back.x, back.y);
  await new Promise((r) => setTimeout(r, 900));
  const finalPane = await paneLabel();
  const settleMs = Date.now() - t0 - RETRY_MS - 900;

  trials.push({
    i,
    aimedCardId: aim.id,
    openedOn,
    underBackButton: underBack,
    paneStillOpenAtRetry: afterDelayPane !== null,
    underRetryPoint: underRetry,
    finalPane,
    // The bug: after the retry, a pane is open on a thread that is NOT the one
    // the operator opened and closed — the retry tap hit a board card.
    reopenedUnintended: finalPane !== null && finalPane === openedOn,
    reopenedDifferentThread: finalPane !== null && finalPane !== openedOn,
  });

  // Reset for the next trial.
  await page.evaluate(() => {
    const btn = document.querySelector('aside[aria-label^="Thread:"] button[aria-label="Back to board"]');
    if (btn !== null) btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

const result = {
  machine: { chrome: await browser.version(), cpuThrottleRate: CPU, scale: SCALE, viewport: PHONE, query: QUERY, retryMs: RETRY_MS },
  trials,
  summary: {
    unintendedReopen: trials.filter((t) => t.reopenedUnintended).length,
    differentThread: trials.filter((t) => t.reopenedDifferentThread).length,
    deadTap: trials.filter((t) => t.finalPane === null).length,
  },
};
await writeFile(`${OUT}evidence.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();

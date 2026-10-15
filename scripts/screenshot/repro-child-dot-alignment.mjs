// Child-dot alignment repro (operator report on issue #174's landing): the
// collapsed dot strip, the expanded rows, and the collapsed active-child row
// must share ONE dot column. jsdom cannot verify this (no layout), so this
// driver measures real geometry in the harness: every dot's left edge minus
// its own card's left edge, compared across the collapsed and expanded
// renders of the same family. The regression shipped with the strip's old
// 18px indent: its dots sat 6px right of the rows' dot column.
// Usage: vite harness first (README above), then node scripts/screenshot/repro-child-dot-alignment.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = "docs/screenshots/repro-child-dot-alignment";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });

/** A dot's left edge RELATIVE to its own family card's left edge. */
async function measure(url, selector) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return page.evaluate((sel) => {
    const card = document.querySelector('[data-thread-card="thr_demo_needs"]');
    if (card === null) throw new Error("missing demo family card");
    const dot = card.querySelector(sel);
    if (dot === null) throw new Error(`missing dot for ${sel}`);
    const cardLeft = card.getBoundingClientRect().left;
    return (
      Math.round((dot.getBoundingClientRect().left - cardLeft) * 100) / 100
    );
  }, selector);
}

// Expanded: any nested row's dot (the rows' dot column).
// Collapsed, with the family's child deep-linked (it is the active thread):
// the strip's first dot, and the active-child row's dot below it.
const rowsDotLeft = await measure(
  BASE + "?demo=1#/plugins/focus-board/board/t/thr_demo_needs_c0",
  "[data-nested-rows] [data-thread-card] span.size-1\\.5",
);
const collapsed =
  BASE + "?demo=1&collapsed=thr_demo_needs#/plugins/focus-board/board/t/thr_demo_needs_c0";
const stripDotLeft = await measure(collapsed, "[data-child-thread-dots] [data-child-dot-glyph]");
const activeRowDotLeft = await measure(
  collapsed,
  "[data-child-active-row] [data-thread-card] span.size-1\\.5",
);

const result = {
  rowsDotLeft,
  stripDotLeft,
  activeRowDotLeft,
  stripVsRowsDelta: Math.round((stripDotLeft - rowsDotLeft) * 100) / 100,
  activeRowVsRowsDelta: Math.round((activeRowDotLeft - rowsDotLeft) * 100) / 100,
};
mkdirSync(OUT, { recursive: true });
const card = await page.$('[data-thread-card="thr_demo_needs"]');
const cardBox = await card.boundingBox();
await page.screenshot({
  path: `${OUT}/family-collapsed-with-active-row.png`,
  clip: {
    x: Math.max(0, cardBox.x - 8),
    y: Math.max(0, cardBox.y - 8),
    width: Math.min(1200, cardBox.width + 16),
    height: Math.min(900, cardBox.height + 16),
  },
});
console.log(JSON.stringify(result, null, 1));
const ok = result.stripVsRowsDelta === 0 && result.activeRowVsRowsDelta === 0;
console.log(ok ? "ALIGNED" : "MISALIGNED");
await browser.close();
process.exit(ok ? 0 : 1);
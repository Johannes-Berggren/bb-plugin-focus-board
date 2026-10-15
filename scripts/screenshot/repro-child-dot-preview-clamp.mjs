// Viewport-clamp check for the child dot's preview bubble (issue #174's
// overflow follow-up): the bubble is a fixed portal; hovering a dot near
// the screen's right edge must keep the whole 256px bubble on screen, and
// it must be allowed to cross the family card's own box (the operator
// report: bubbles were clipped to the card, and a right-edge dot pushed the
// bubble off the screen).
// Usage: vite harness first, then node scripts/screenshot/repro-child-dot-preview-clamp.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
// Start wide: the mock shell's own chrome only overlays the plugin at
// narrow widths, and the demo board needs no pane for the strip alone.
await page.setViewport({ width: 1400, height: 700, deviceScaleFactor: 2 });
await page.goto(HARNESS_URL_DEMO(), { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 1200));

function HARNESS_URL_DEMO() {
  return (process.env.HARNESS_URL ?? "http://localhost:5173/") + "?demo=1&collapsed=thr_demo_needs";
}

// Where the strip's last dot sits determines the viewport that makes it a
// screen-edge dot: shrink the window so the dot's center lands ~110px from
// the right edge — with a 128px bubble half-width, un-clamped centering
// would hang ~18px of the bubble past the screen.
const dotCenter = await page.evaluate(() => {
  const dots = [...document.querySelectorAll("[data-child-thread-dots] [data-child-dot]")];
  const r = dots[dots.length - 1].getBoundingClientRect();
  return r.left + r.width / 2;
});
await page.setViewport({ width: Math.round(dotCenter + 110), height: 700, deviceScaleFactor: 2 });
await new Promise((r) => setTimeout(r, 600));
let hoverId = await page.evaluate(() => {
  const dots = [...document.querySelectorAll("[data-child-thread-dots] [data-child-dot]")];
  return dots[dots.length - 1].dataset.childDot;
});
await page.hover(`[data-child-dot="${hoverId}"]`);
await new Promise((r) => setTimeout(r, 300));

const result = await page.evaluate((id) => {
  const bubble = document.querySelector("[data-child-dot-preview]");
  if (bubble === null) throw new Error("missing open bubble");
  const dot = document.querySelector(`[data-child-dot="${id}"]`);
  const card = dot?.closest("[data-thread-card]");
  const r = bubble.getBoundingClientRect();
  const cr = card?.getBoundingClientRect();
  return {
    viewport: window.innerWidth,
    bubble: { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) },
    cardRight: cr === undefined ? null : Math.round(cr.right),
    fixed: getComputedStyle(bubble).position === "fixed",
    portaled: bubble.parentElement === document.body,
    contentSized: Math.round(r.width) <= 256,
    onScreen: r.left >= 0 && r.right <= window.innerWidth,
  };
}, hoverId);
mkdirSync("docs/screenshots/repro-child-dot-alignment", { recursive: true });
const box = await page.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_needs"]');
  const r = card.getBoundingClientRect();
  return { x: r.x, y: Math.max(0, r.y - 40), w: Math.min(r.width, window.innerWidth), h: Math.min(r.height, 520) };
});
await page.screenshot({
  path: "docs/screenshots/repro-child-dot-alignment/child-dot-preview-clamped.png",
  clip: {
    x: Math.max(0, box.x),
    y: box.y,
    width: Math.min(dotCenter + 110, box.w),
    height: box.h,
  },
});
console.log(JSON.stringify(result, null, 1));
const ok = result.fixed && result.portaled && result.onScreen && result.contentSized;
console.log(ok ? "CLAMPED" : "NOT CLAMPED");
await browser.close();
process.exit(ok ? 0 : 1);
// Repro/verification for issue #227: the ghost duplicate card strip in the
// right gutter of the Parent thread view while a thread pane is open.
//
// The operator drives the Parent thread board with a pane open and hovers a
// card in the pane's lane. The open pane's attention capture (origin
// selection) and the hover capture (origin hover) both pin that lane, and
// applyLaneFreezes used to splice the lane in once PER CAPTURE — a ghost
// copy of the whole lane rendered beside the real one, clipped to slivers
// where it outlived the scrollport. Reproduces that headlessly: opens a
// lane pane, hovers the lane's first card with real mouse moves, and exits
// non-zero unless no lane content duplicated and nothing renders in the
// gutter band (board right edge → pane left edge).
//
// Artifacts land in docs/screenshots/repro-ghost-gutter-strip/ (a pane-open
// rest shot, a hover shot, plus evidence.json; the pre-fix run is preserved
// in docs/screenshots/repro-ghost-gutter-strip-prefix/ via OUT_DIR).
// Run the vite harness first (same as above); honors the same CHROME_PATH,
// HARNESS_URL, and OUT_DIR overrides.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1920, height: 1080, deviceScaleFactor: 2 };

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-ghost-gutter-strip/", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
const errors = [];
const violations = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() !== "error") return;
  // React's duplicate-key warning is the ghost's own tell: the duplicated
  // lane renders two children with the same key.
  if (msg.text().includes("Encountered two children with the same key")) {
    violations.push(`[duplicate-key] ${msg.text().slice(0, 200)}`);
  }
});

// Dump the board's render state: per-card rects keyed by thread id,
// duplicates, gutter-band squatters, and stuck FLIP transforms.
async function dump(label) {
  await sleep(300);
  return page.evaluate((label) => {
    const board = document.querySelector("[data-parent-board]");
    const boardRect = board ? board.getBoundingClientRect() : null;
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    const paneRect = pane ? pane.getBoundingClientRect() : null;
    const cardEls = [...document.querySelectorAll("[data-thread-card]")];
    const cards = cardEls.map((el) => {
      const r = el.getBoundingClientRect();
      const cell = el.closest("[data-cell]");
      return {
        id: el.closest("[data-cell]")?.getAttribute("data-key") ?? el.getAttribute("data-thread-card"),
        variant: cell ? cell.getAttribute("data-variant") : null,
        left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      };
    });
    const ids = cards.map((c) => c.id);
    const dupIds = [...new Set(ids.filter((id, i) => id !== null && ids.indexOf(id) !== i))];
    // The gutter band: right of the board box, left of the pane. Anything
    // from the board painting there escapes its scrollport.
    const gutterEls = [];
    if (boardRect && paneRect && paneRect.left > boardRect.right) {
      for (const el of document.querySelectorAll("[data-parent-board] *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > boardRect.right + 1 && r.left < paneRect.left - 1) {
          gutterEls.push({
            tag: el.tagName.toLowerCase(),
            left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
          });
        }
      }
    }
    const stuckTransforms = [...document.querySelectorAll("[data-cell]")].filter(
      (el) => (el.style.transform ?? "") !== "",
    ).map((el) => ({ key: el.getAttribute("data-key"), transform: el.style.transform }));
    return {
      label,
      board: boardRect
        ? { right: Math.round(boardRect.right), scrollWidth: Math.round(board.scrollWidth), clientWidth: board.clientWidth }
        : null,
      cardCount: cards.length,
      dupIds,
      gutterEls,
      stuckTransforms,
    };
  }, label);
}

// Move the mouse onto an element with a short path so pointerenter and
// mouseenter fire naturally.
async function hoverCard(index) {
  const box = await page.evaluate((i) => {
    const el = [...document.querySelectorAll("[data-thread-card]")][i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, index);
  if (box === null) return false;
  await page.mouse.move(box.x - 40, box.y - 20);
  await page.mouse.move(box.x, box.y, { steps: 6 });
  return true;
}

// ---- The operator's scenario -------------------------------------------
await page.goto(`${BASE}?groupBy=parent&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-parent-board]", { timeout: 30_000 });
await sleep(600);
const rest = await dump("1 pane-open rest");

// Open a thread pane via a lane header (the operator's repro step): the pane
// takes the right side and the board narrows.
await page.evaluate(() => {
  const header = document.querySelector("[data-lane-header] button");
  if (!header) throw new Error("no lane header");
  header.click();
});
await page.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 10_000 });
await sleep(600);
await page.screenshot({ path: `${OUT}pane-open-rest.png` });
const paneOpen = await dump("2 pane-open rest");

// Hover the pane's lane's first card (a card IN THE SAME LANE the pane
// pinned): its hover capture joins the pane's capture of that lane.
const hovered = await hoverCard(0);
if (!hovered) { console.error("no card to hover"); process.exit(2); }
const hit = await dump("3 hover in the pane's lane");
const hoverShot = `${OUT}hover-ghost.png`;
await page.screenshot({ path: hoverShot });

// Park the pointer off-board: the ghost strip persists while the pane is
// open (the hover capture released, the lane copy may remain).
await page.mouse.move(200, 900);
await sleep(400);
const parked = await dump("4 mouse parked away");

// ---- Decisive assertions ----------------------------------------------
if (paneOpen.cardCount !== rest.cardCount) {
  violations.push(`[dup] pane open already changed the card count: ${rest.cardCount} → ${paneOpen.cardCount}`);
}
for (const step of [hit, parked]) {
  if (step.dupIds.length > 0) {
    violations.push(`[dup] ${step.label}: duplicated cards ${step.dupIds.join(", ")}`);
  }
  if (step.cardCount !== paneOpen.cardCount) {
    violations.push(`[dup] ${step.label}: card count ${paneOpen.cardCount} → ${step.cardCount}`);
  }
  if (step.gutterEls.length > 0) {
    violations.push(`[gutter] ${step.label}: ${step.gutterEls.length} board elements render in the gutter band`);
  }
  if (step.stuckTransforms.length > 0) {
    violations.push(`[flip] ${step.label}: ${step.stuckTransforms.length} stuck cell transforms`);
  }
}

await writeFile(
  `${OUT}evidence.json`,
  JSON.stringify({ errors, violations, results: [rest, paneOpen, hit, parked] }, null, 2),
);
console.log(JSON.stringify({ errors, violations, results: [rest, paneOpen, hit, parked] }, null, 2));
await browser.close();
if (violations.length > 0) {
  console.error(`ghost gutter strip reproduced (${violations.length} violations)`);
  process.exit(1);
}
console.log("no ghost gutter strip: clean");
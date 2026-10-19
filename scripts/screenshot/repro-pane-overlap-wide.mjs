// [REDWORK] One-shot repro/verification driver for the pane-overlap bug
// (issue #273, thread thr_cz3bvp4kcz).
//
// The operator drags the thread pane's left edge (`aria-label="Resize thread
// pane"`) far enough wide that the board behind it stops collapsing cleanly
// and its chrome overlaps the pane instead. The cause is twofold:
//
//   1. The pane's stored width is clamped to the row but nothing keeps the
//      BOARD any room, so a 900px pane on a 1150px panel leaves a 250px board
//      column whose toolbar needs ~153px of min-content width.
//   2. With a wallpaper active, app.tsx paints the board's flex column
//      `relative z-10`; the side-by-side pane is `relative` with
//      `z-index: auto`, so the board column wins the paint order and its
//      overflowing chrome paints ON TOP of the pane.
//
// The driver runs three passes at a fixed panel width with a wallpaper seeded:
//
//   matrix   — the (wallpaper × ribbon × panel × pane) grid, reporting each
//              cell's board width, z-indexes, crossing board elements, and how
//              many hit-test samples inside the pane land on BOARD elements
//              (the operator's symptom).
//   floor    — the margin sweep that names the threshold: the margin left of
//              the pane, lanes it affords, whether the toolbar band wrapped,
//              and the first margin where board chrome paints past the board's
//              own edge.
//   hysteresis — the pane's width walking in (wider) then out (narrower),
//              proving the clamp is symmetric with no dead drag step.
//
// Screenshots land under OUT_DIR. Exits non-zero on any page error, so the
// run cannot be read as a pass when the app threw.
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PANEL_WIDTH, WALLPAPER.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT_DIR =
  process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-pane-overlap-wide/", import.meta.url).pathname;
const PANEL = Number(process.env.PANEL_WIDTH ?? "1150");
const WALLPAPER_ON = process.env.WALLPAPER !== "0";
const LANE = 256;
// The lane floor the fix introduces: 1.25 lanes of board must stay left of the
// pane. Lane geometry (components/board.tsx): a 256px lane plus the surface's
// 12px horizontal padding each side and 16px between lanes.
const LANE_FLOOR = LANE * 1.25;

const WALLPAPER = JSON.stringify({
  version: 1,
  global: {
    url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC",
    dim: 0.2,
    fit: "cover",
  },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1700, height: 900, deviceScaleFactor: 2 },
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
mkdirSync(OUT_DIR, { recursive: true });

/** Seed the wallpaper (or clear it) and land on the harness. */
async function boot() {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(
    ({ wallpaper, on }) => {
      if (on) window.localStorage.setItem("focus-board:wallpaper", wallpaper);
      else window.localStorage.removeItem("focus-board:wallpaper");
    },
    { wallpaper: WALLPAPER, on: WALLPAPER_ON },
  );
}

/** Squeeze the plugin panel itself (stands in for a narrower bb panel on a
 *  wide window). A stylesheet, not inline styles: opening the pane remounts
 *  the panel and wipes inline overrides. */
async function squeeze(width) {
  await page.evaluate((width) => {
    let tag = document.getElementById("repro-squeeze");
    if (tag === null) {
      tag = document.createElement("style");
      tag.id = "repro-squeeze";
      document.head.appendChild(tag);
    }
    tag.textContent = `[data-bb-plugin="focus-board"] { width: ${width}px !important; min-width: ${width}px !important; max-width: ${width}px !important; }`;
    window.dispatchEvent(new Event("resize"));
  }, width);
  await sleep(280);
}

/** Load a page at a stored pane width, squeeze the panel, open the pane. */
async function stage(storedPane, panel, { ribbon = false } = {}) {
  await page.goto(`${BASE}?paneWidth=${storedPane}`, { waitUntil: "networkidle0" });
  await sleep(800);
  await squeeze(panel);
  const card = await page.$("[data-thread-card] a");
  if (card === null) return "no-card";
  await card.click();
  await sleep(600);
  if (ribbon) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        (b.textContent ?? "").trim().startsWith("Filters"),
      );
      if (button !== undefined && button.getAttribute("aria-expanded") !== "true") button.click();
    });
    await sleep(350);
  }
  return "staged";
}

/** Drag the pane's left edge to an absolute pane width. The handle moves with
 *  the pane, so its grab point is re-read each time. */
async function dragTo(target) {
  const handle = await page.$('[aria-label="Resize thread pane"]');
  if (handle === null) return "no-handle";
  const box = await handle.boundingBox();
  if (box === null) return "no-box";
  const paneBox = await (await page.$('aside[role="complementary"]')).boundingBox();
  if (paneBox === null || paneBox.width === 0) return "no-pane";
  const dx = target - paneBox.width;
  if (Math.abs(dx) < 0.5) return "at-target";
  const grabX = Math.round(box.x + box.width / 2);
  const grabY = Math.round(box.y + box.height / 2);
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(grabX - (dx * i) / 8, grabY);
  await page.mouse.up();
  await sleep(170);
  return "dragged";
}

/** Everything read at one state: pane/board rects, the board column's z-index,
 *  board elements painting past the pane's left edge, how many board elements
 *  win a hit-test grid inside the pane, the toolbar band's rows, the margin,
 *  and the visible lane count. */
const readState = (label) =>
  page.evaluate(
    ({ label, LANE, LANE_FLOOR }) => {
      const round = (n) => Math.round(n * 100) / 100;
      const root = document.querySelector('[data-bb-plugin="focus-board"]');
      const aside = document.querySelector('aside[role="complementary"]');
      const board = root?.querySelector(":scope > div > div.flex-1") ?? null;
      const band = board?.querySelector(":scope > div") ?? null;
      const surface = document.querySelector("[data-columns-board]");
      if (aside === null || board === null || band === null || surface === null) return null;
      const paneRect = aside.getBoundingClientRect();
      const boardRect = board.getBoundingClientRect();
      const bandRect = band.getBoundingClientRect();
      const surfRect = surface.getBoundingClientRect();
      // Board elements whose paint crosses the pane's left edge.
      let boardCross = 0;
      for (const el of board.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.left < paneRect.left && r.right > paneRect.left + 1) boardCross += 1;
      }
      // Board controls painting past the BOARD's own right edge.
      let bandOut = -Infinity;
      for (const el of band.querySelectorAll("button, input, div, span")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        bandOut = Math.max(bandOut, r.right - boardRect.right);
      }
      let lanePixels = 0;
      let fullyVisible = 0;
      for (const el of document.querySelectorAll("[data-column-id]")) {
        const r = el.getBoundingClientRect();
        const visible = Math.max(0, Math.min(r.right, surfRect.right) - Math.max(r.left, surfRect.left));
        if (visible >= r.width - 1) fullyVisible += 1;
        lanePixels += visible;
      }
      // Hit-test grid over the pane's upper region: a BOARD element winning a
      // sample is the operator's overlap symptom.
      let boardWins = 0;
      let samples = 0;
      for (let y = 8; y < Math.min(240, paneRect.height); y += 16) {
        for (let x = Math.max(6, paneRect.left + 6); x < Math.min(paneRect.right - 6, paneRect.left + 400); x += 24) {
          const el = document.elementFromPoint(x, y);
          if (el === null) continue;
          samples += 1;
          if (board.contains(el) && !aside.contains(el)) boardWins += 1;
        }
      }
      const margin = round(paneRect.left - boardRect.left);
      return {
        label,
        paneW: round(paneRect.width),
        paneX: round(paneRect.left),
        boardW: round(boardRect.width),
        boardZ: getComputedStyle(board).zIndex,
        paneZ: getComputedStyle(aside).zIndex,
        sheet: aside.className.includes("absolute inset-0"),
        boardCross,
        boardWins,
        samples,
        margin,
        lanes: round(margin / LANE),
        belowFloor: margin < LANE_FLOOR,
        bandH: round(bandRect.height),
        bandRows: round(bandRect.height / 49),
        bandOut: Number.isFinite(bandOut) ? round(bandOut) : null,
        lanesVisible: round(lanePixels / LANE),
        fullyVisible,
      };
    },
    { label, LANE, LANE_FLOOR },
  );

const evidence = { pageErrors: errors, panel: PANEL, wallpaper: WALLPAPER_ON, lane: LANE, laneFloor: LANE_FLOOR };

// ---- matrix: wallpaper on/off, ribbon on/off, across panels and panes ------
const MATRIX = JSON.parse(
  process.env.MATRIX ??
    JSON.stringify([
      [1, 1, 1150, 900],
      [0, 1, 1150, 900],
      [1, 1, 700, 640],
      [0, 1, 700, 640],
      [1, 1, 1440, 900],
    ]),
);
const matrix = [];
for (const [wallpaper, ribbon, panel, pane] of MATRIX) {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.evaluate(
    ({ wallpaper, on }) => {
      if (on) window.localStorage.setItem("focus-board:wallpaper", wallpaper);
      else window.localStorage.removeItem("focus-board:wallpaper");
    },
    { wallpaper: WALLPAPER, on: wallpaper === 1 },
  );
  const staged = await stage(pane, panel, { ribbon: ribbon === 1 });
  const state = staged === "staged" ? await readState(`wp${wallpaper}-ribbon${ribbon}-panel${panel}-pane${pane}`) : { label: `wp${wallpaper}-ribbon${ribbon}-panel${panel}-pane${pane}`, error: staged };
  matrix.push(state);
  await page.screenshot({
    path: `${OUT_DIR}matrix-wp${wallpaper}-ribbon${ribbon}-panel${panel}-pane${pane}.png`,
  });
}
evidence.matrix = matrix;

// ---- floor: the margin sweep that names the threshold ----------------------
const MARGINS = JSON.parse(
  process.env.MARGINS ?? "[520,480,440,400,384,368,352,340,336,328,320,312,304,296,288,280,272,264,256,240,224,208,192,176,160]",
);
const floor = [];
for (const margin of MARGINS) {
  const staged = await stage(320, PANEL);
  if (staged !== "staged") break;
  await dragTo(PANEL - margin);
  const state = await readState(`margin-${margin}`);
  if (state !== null) floor.push(state);
}
evidence.floor = floor;

// ---- hysteresis: the pane walking in then out -----------------------------
const staged = await stage(480, PANEL);
if (staged === "staged") {
  const inward = [];
  const outward = [];
  for (let i = 0; i < 12; i += 1) {
    await dragTo((await (await page.$('aside[role="complementary"]')).boundingBox()).width + 60);
    inward.push(await readState(`in-${i}`));
  }
  for (let i = 0; i < 12; i += 1) {
    await dragTo((await (await page.$('aside[role="complementary"]')).boundingBox()).width - 60);
    outward.push(await readState(`out-${i}`));
  }
  evidence.hysteresis = { inward, outward };
  await page.screenshot({ path: `${OUT_DIR}after-panel${PANEL}-pane900.png` });
}
for (const m of MATRIX) {
  await stage(m[3], m[2]);
  await page.screenshot({ path: `${OUT_DIR}after-panel${m[2]}-pane${m[3]}.png` });
}

writeFileSync(`${OUT_DIR}evidence.json`, JSON.stringify(evidence, null, 2));
console.log("matrix:");
for (const c of evidence.matrix) {
  if (c.error !== undefined) {
    console.log(`  ${c.label} ERROR ${c.error}`);
    continue;
  }
  console.log(
    `  ${c.label.padEnd(34)} pane=${String(c.paneW).padStart(5)} board=${String(c.boardW).padStart(5)} boardZ=${String(c.boardZ).padStart(4)} sheet=${c.sheet ? "Y" : "n"} cross=${String(c.boardCross).padStart(3)} boardWins=${c.boardWins}/${c.samples}`,
  );
}
console.log("floor (margin sweep):");
for (const s of evidence.floor) {
  console.log(
    `  margin=${String(s.margin).padStart(6)} lanes=${String(s.lanes).padStart(5)} board=${String(s.boardW).padStart(5)} bandH=${String(s.bandH).padStart(5)} bandOut=${String(s.bandOut).padStart(7)} lanesVis=${String(s.lanesVisible).padStart(5)} boardWins=${String(s.boardWins).padStart(3)}/${s.samples}${s.belowFloor ? " BELOW-1.25" : ""}`,
  );
}
if (evidence.hysteresis !== undefined) {
  console.log(`hysteresis inward:  ${evidence.hysteresis.inward.map((s) => s.paneW).join(", ")}`);
  console.log(`hysteresis outward: ${evidence.hysteresis.outward.map((s) => s.paneW).join(", ")}`);
}
if (errors.length > 0) process.exitCode = 1;
await browser.close();

// Right-gutter repro (issue #192): a family card with a ticket chip and
// expanded nested children must stop short of its lane's right edge. jsdom
// cannot verify geometry, so this driver measures real rects in the harness
// on both surfaces that render family cards — the columns board (default
// groupBy=status) and the parent-lanes board (?groupBy=parent) — and fails
// when any card surface or content surface crosses a boundary it should not.
//
// Boundaries checked per card:
//   card right ≤ lane right − inset   (lane: [data-column-id] or [data-lane-id])
//   content right ≤ card right        (anchor, title, chip rows, nested rows)
// Usage: vite harness first (README above), then
//   node scripts/screenshot/repro-right-gutter.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = "docs/screenshots/repro-right-gutter";
const CARD_ID = "thr_demo_gutter";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

/**
 * Measure the card's box and every content surface's right edge against the
 * lane's right edge and the card's own right edge. Returns one row per
 * measured node: its tag+selector, and its right edge RELATIVE to the card's
 * right edge (negative = inside, positive = past the card) plus the card's
 * right edge relative to the lane's right edge (negative = gutter left).
 */
async function measure(url) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return page.evaluate((cardId) => {
    const card = document.querySelector(`[data-thread-card="${cardId}"]`);
    if (card === null) return { error: `missing card ${cardId}` };
    const lane = card.closest("[data-column-id]");
    if (lane === null) return { error: "missing lane ancestor" };
    const laneRect = lane.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const surfaces = [
      ["anchor", "a[href]"],
      ["title", "[data-title]"],
      ["chip-row", "[data-provider-row]"],
      ["nested-rows", "[data-nested-rows]"],
      ["nested-child-row", '[data-nested-rows] [data-thread-card]'],
      ["sub-rows", "[data-child-sub-rows]"],
    ];
    const rows = [];
    for (const [name, sel] of surfaces) {
      const node = card.querySelector(sel);
      if (node === null) continue;
      const rect = node.getBoundingClientRect();
      rows.push({
        surface: name,
        selector: sel,
        cardRightMinusContentRight:
          Math.round((cardRect.right - rect.right) * 100) / 100,
        contentRightMinusLaneRight:
          Math.round((rect.right - laneRect.right) * 100) / 100,
      });
    }
    return {
      cardRightMinusLaneRight:
        Math.round((cardRect.right - laneRect.right) * 100) / 100,
      laneWidth: Math.round(laneRect.width),
      cardWidth: Math.round(cardRect.width),
      rows,
    };
  }, CARD_ID);
}

/**
 * On the parent-lanes board the parent thread renders as a LANE, not a card —
 * its children are the lane's cells — so the lane-level geometry suspect
 * (GAP / CELL_PAD in parent-lane-layout.ts) is measured here instead: every
 * cell's right edge must stay CELL_PAD (4px) short of its lane's right edge.
 */
async function measureParentLane(url) {
  await page.goto(url, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  return page.evaluate((laneId) => {
    const lane = document.querySelector(`[data-lane-id="${laneId}"]`);
    if (lane === null) return { error: `missing lane ${laneId}` };
    const laneRect = lane.getBoundingClientRect();
    const cells = [...lane.querySelectorAll("[data-cell]")];
    if (cells.length === 0) return { error: "lane renders no cells" };
    const worst = Math.min(
      ...cells.map((cell) => laneRect.right - cell.getBoundingClientRect().right),
    );
    return {
      laneWidth: Math.round(laneRect.width),
      cellCount: cells.length,
      minCellInsetFromLaneRight: Math.round(worst * 100) / 100,
    };
  }, `thr_demo_gutter`);
}

mkdirSync(OUT, { recursive: true });
const evidence = {};

// Surface 1 — the columns board (default groupBy=status), family expanded.
evidence.columnsBoard = await measure(`${BASE}?demo=1#/plugins/focus-board/board`);
const card1 = await page.$(`[data-thread-card="${CARD_ID}"]`);
if (card1 !== null) {
  const box = await card1.boundingBox();
  await page.screenshot({
    path: `${OUT}/columns-board-family-card.png`,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: Math.min(1400, box.width + 40),
      height: Math.min(900, box.height + 16),
    },
  });
  // The depth-2 evidence: the grandchild sub-row tier's own clip.
  const subRowsShot = await page.$(`[data-thread-card="${CARD_ID}"] [data-child-sub-rows]`);
  if (subRowsShot !== null) {
    const subBox = await subRowsShot.boundingBox();
    await page.screenshot({
      path: `${OUT}/columns-board-subrows-depth2.png`,
      clip: {
        x: Math.max(0, subBox.x - 8),
        y: Math.max(0, subBox.y - 8),
        width: Math.min(1400, subBox.width + 40),
        height: Math.min(900, subBox.height + 16),
      },
    });
  }
}

// Surface 2 — the parent-lanes board (?groupBy=parent). The harness main.tsx
// seeds groupBy from the query string. The parent renders as a lane there, so
// the lane's cells are measured instead of a card.
evidence.parentLanes = await measureParentLane(
  `${BASE}?demo=1&groupBy=parent#/plugins/focus-board/board`,
);
const card2 = await page.$(`[data-lane-id="${CARD_ID}"]`);
if (card2 !== null) {
  const box = await card2.boundingBox();
  await page.screenshot({
    path: `${OUT}/parent-lanes-family-card.png`,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: Math.min(1400, box.width + 40),
      height: Math.min(900, box.height + 16),
    },
  });
}

writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 1));
await browser.close();

// Fail when the geometry violates a boundary. Any content surface whose
// right edge sits closer than CELL_PAD (4px — the smallest inset the lane
// geometry uses) to the card's right edge is flush: the gutter is consumed.
// A cardRightMinusLaneRight of 0 or above means the card box crosses the
// lane's right edge (no gutter left).
function findLeaks(e) {
  const leaks = [];
  for (const [surface, data] of Object.entries(e)) {
    if (data.error !== undefined) {
      leaks.push(`${surface}: ${data.error}`);
      continue;
    }
    if (data.cardRightMinusLaneRight >= 0) {
      leaks.push(
        `${surface}: card box crosses the lane's right edge (${data.cardRightMinusLaneRight}px)`,
      );
    }
    for (const row of data.rows ?? []) {
      if (row.cardRightMinusContentRight < 4) {
        leaks.push(
          `${surface}: ${row.surface} sits ${row.cardRightMinusContentRight}px from the card's right edge (flush)`,
        );
      }
    }
    // Lane-level contract (the parent-lanes surface): a lane's cells keep a
    // CELL_PAD inset from the lane's right edge.
    if (data.minCellInsetFromLaneRight !== undefined && data.minCellInsetFromLaneRight < 4) {
      leaks.push(
        `${surface}: a lane cell sits ${data.minCellInsetFromLaneRight}px from the lane's right edge (CELL_PAD is 4)`,
      );
    }
  }
  return leaks;
}
const leaks = findLeaks(evidence);
if (leaks.length > 0) {
  console.log("LEAKS:\n" + leaks.join("\n"));
  process.exit(1);
}
console.log("GUTTER RESPECTED");
process.exit(0);
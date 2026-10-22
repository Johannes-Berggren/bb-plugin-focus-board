// Repro: the orchestrator family's collapsed strip and its folded/revealed
// rows — "grandchildren don't pop out" (operator report, 2026-10-22).
// Measures the collapsed dot-strip dot count vs the fold label, the folded
// rows list (whole rows, no scroll, a Show all handle), the revealed list
// (every row), and whether any row is clipped by the card's bottom edge.
// Usage: vite harness first, then
//   node scripts/screenshot/repro-orchestrator-grandchildren.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT =
  process.env.OUT_DIR ?? "docs/screenshots/repro-orchestrator-grandchildren";
const ROOT = "thr_demo_orch";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 1000, deviceScaleFactor: 2 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Read the board's card geometry for the orchestrator root. */
async function probe() {
  return page.evaluate((rootId) => {
    const card = document.querySelector(`[data-thread-card="${rootId}"]`);
    if (card === null) return { error: `missing card ${rootId}` };
    const rect = card.getBoundingClientRect();
    const strip = card.querySelector("[data-child-thread-dots]");
    const dots = card.querySelectorAll("[data-child-thread-dots] button[data-child-dot]");
    const childGlyphs = card.querySelectorAll(
      '[data-child-thread-dots] button[data-child-dot] [data-child-dot-glyph].size-1\\.5',
    );
    const subGlyphs = card.querySelectorAll(
      '[data-child-thread-dots] button[data-child-dot] [data-child-dot-glyph].size-1',
    );
    const label = card.querySelector("button[data-child-threads-toggle]");
    const rows = card.querySelector("[data-nested-rows]");
    const anchors =
      rows === null ? [] : [...rows.querySelectorAll("a[data-thread-card]")];
    const clippedRows =
      rows === null
        ? 0
        : anchors.filter(
            (a) => a.getBoundingClientRect().bottom > rect.bottom + 0.5,
          ).length;
    const handle = rows === null ? null : rows.querySelector("[data-show-all-rows]");
    return {
      cardHeight: Math.round(rect.height),
      cardWidth: Math.round(rect.width),
      label: label?.textContent?.trim() ?? null,
      strip:
        strip === null
          ? null
          : {
              dotCount: dots.length,
              childGlyphCount: childGlyphs.length,
              subGlyphCount: subGlyphs.length,
              stripHeight: Math.round(strip.getBoundingClientRect().height),
            },
      rows:
        rows === null
          ? null
          : {
              rowCount: anchors.length,
              clippedRows,
              scrollHeight: rows.scrollHeight,
              clientHeight: rows.clientHeight,
              scrolls: rows.scrollHeight > rows.clientHeight + 1,
              handle: handle?.textContent?.trim() ?? null,
            },
    };
  }, ROOT);
}

async function shot(name) {
  const box = await (await page.$(`[data-thread-card="${ROOT}"]`))?.boundingBox();
  if (!box) return;
  await page.screenshot({
    path: `${OUT}/${name}.png`,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 8),
      width: Math.min(1500, box.width + 40),
      height: Math.min(1000, box.height + 16),
    },
  });
}

mkdirSync(OUT, { recursive: true });
const evidence = {};

await page.goto(`${BASE}?orchestrator=1&collapsed=${ROOT}#/plugins/focus-board/board`, {
  waitUntil: "networkidle0",
});
await sleep(1200);
evidence.collapsed = await probe();
await shot("collapsed");

await page.goto(`${BASE}?orchestrator=1#/plugins/focus-board/board`, {
  waitUntil: "networkidle0",
});
await sleep(1200);
evidence.folded = await probe();
await shot("expanded-folded");

// The handle reveals the whole family in place.
const clicked = await page.evaluate((rootId) => {
  const button = document.querySelector(
    `[data-thread-card="${rootId}"] [data-show-all-rows]`,
  );
  if (button === null) return false;
  button.click();
  return true;
}, ROOT);
if (clicked) {
  await sleep(500);
  evidence.revealed = await probe();
  await shot("expanded-revealed");
} else {
  evidence.revealed = { error: "missing Show all handle" };
}

await page.goto(`${BASE}?orchestrator=1&groupBy=parent#/plugins/focus-board/board`, {
  waitUntil: "networkidle0",
});
await sleep(1200);
evidence.parentView = await page.evaluate((laneId) => {
  const lane = document.querySelector(`[data-lane-id="${laneId}"]`);
  if (!lane) return { error: `missing lane ${laneId}` };
  const cells = lane.querySelectorAll("[data-cell]");
  const plusChip = [...lane.querySelectorAll("span")].find((s) =>
    /^\+\d+ more$/.test(s.textContent?.trim() ?? ""),
  );
  return {
    cellCount: cells.length,
    laneHeight: Math.round(lane.getBoundingClientRect().height),
    plusChip: plusChip?.textContent?.trim() ?? null,
  };
}, ROOT);

writeFileSync(`${OUT}/evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();

// The verdict: the fold shows a whole-row budget with no scroll and no
// clipped row plus a handle that reveals the whole family.
const foldOk =
  evidence.folded?.rows?.rowCount === 5 &&
  evidence.folded?.rows?.clippedRows === 0 &&
  evidence.folded?.rows?.scrolls === false &&
  typeof evidence.folded?.rows?.handle === "string" &&
  evidence.revealed?.rows?.rowCount === 86 &&
  evidence.revealed?.rows?.clippedRows === 0;
process.exitCode = foldOk ? 0 : 1;
console.log(foldOk ? "FOLD WHOLE, HANDLE REVEALS ALL" : "FOLD BROKEN");
process.exit(process.exitCode);

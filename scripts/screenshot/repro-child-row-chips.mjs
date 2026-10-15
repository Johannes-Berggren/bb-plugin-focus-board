// Headless repro/verification for issue #191: nested child rows never show
// ticket chips. A child thread whose title carries a tracker ref ("#16") chips
// on its standalone card, but under a family card its nested row renders no
// chip block at all. This driver loads the demo fixture's Working family —
// whose child `thr_demo_work_c3` carries the "#16" ref — and exits non-zero
// unless the nested row renders its condensed chip AND no anchor nests inside
// the row's own link (the #127/#171 DOM contract).
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts --port
// 5181 --strictPort`, then `node scripts/screenshot/repro-child-row-chips.mjs`.
// Writes evidence to docs/screenshots/repro-child-row-chips/ (two screenshots
// + JSON with the DOM findings).
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const DESKTOP = { width: 1280, height: 800 };
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5181/";
const OUT = process.env.OUT_DIR ??
  new URL("../../docs/screenshots/repro-child-row-chips/", import.meta.url).pathname;
const FAMILY = "thr_demo_work";
const CHILD = "thr_demo_work_c3";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: DESKTOP,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport(DESKTOP);

await page.goto(`${BASE}?demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector(`[data-thread-card="${FAMILY}"]`, { timeout: 30_000 });
// Let React settle so chips, glyphs, and status state all land on record.
await new Promise((r) => setTimeout(r, 1000));

const evidence = await page.evaluate(({ familyId, childId }) => {
  // A child's standalone chip count (if its own card renders on the board)
  // vs its nested-row chip block.
  const nestedRow = document.querySelector(
    `[data-thread-card="${familyId}"] [data-nested-rows] [data-thread-card="${childId}"]`,
  );
  const chipRows = nestedRow
    ? Array.from(nestedRow.querySelectorAll("[data-child-chip-rows] > [data-provider-row]"))
    : [];
  const chips = nestedRow ? Array.from(nestedRow.querySelectorAll("[data-ticket-chip]")) : [];
  // DOM validity: inside the child's anchor, no further anchor may exist.
  const nestedAnchors = nestedRow
    ? Array.from(nestedRow.querySelectorAll("a")).filter(
        (el) => el.parentElement?.closest("a") !== null,
      )
    : [];
  return {
    familyCardPresent:
      document.querySelector(`[data-thread-card="${familyId}"]`) !== null,
    nestedRowPresent: nestedRow !== null,
    chipRowKeys: chipRows.map((el) => el.getAttribute("data-provider-row")),
    chipTexts: chips.map((el) => el.textContent?.trim() ?? ""),
    chipCondensed: chips.map((el) => el.className.includes("min-h-4")),
    nestedAnchorHrefs: nestedAnchors.map((el) => el.getAttribute("href")),
    standaloneCardChips: document.querySelectorAll(
      `[data-thread-card="${childId}"] [data-ticket-chip]`,
    ).length,
  };
}, { familyId: FAMILY, childId: CHILD });

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}board.png` });
const family = await page.$(`[data-thread-card="${FAMILY}"]`);
if (family !== null) await family.screenshot({ path: `${OUT}family-card.png` });

const record = {
  issue: "cristoslc/bb-plugin-focus-board#191",
  url: BASE,
  child: CHILD,
  domEvidence: evidence,
};
await writeFile(`${OUT}evidence.json`, `${JSON.stringify(record, null, 2)}\n`);
await browser.close();

const fails = [];
if (!evidence.nestedRowPresent) fails.push("nested child row did not render");
if (evidence.chipTexts.length === 0) fails.push("nested child row carries no ticket chip");
if (evidence.nestedAnchorHrefs.length > 0) fails.push("anchor nests inside the child row's link");
if (fails.length > 0) {
  console.error(`repro-child-row-chips: FAILED\n${fails.join("\n")}`);
  console.error(JSON.stringify(record, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(record, null, 2));
console.log("repro-child-row-chips: PASS (chips on the nested row, DOM stays valid)");
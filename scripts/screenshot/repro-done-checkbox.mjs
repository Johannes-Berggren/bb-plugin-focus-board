// One-shot headless repro for the hover Mark Done checkbox: a non-done card
// shows an empty checkbox on hover, the first click arms it ("Mark Done"),
// the second click moves the card to Done. Dumps structural evidence to
// docs/screenshots/repro-done-checkbox/evidence.json and captures
// hover.png / armed.png. Run the vite harness first:
//   npm run build && npx vite --config scripts/screenshot/vite.config.ts
// then: node scripts/screenshot/repro-done-checkbox.mjs
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, "..", "..", "docs", "screenshots", "repro-done-checkbox");
await fs.mkdir(outDir, { recursive: true });
const base = process.env.HARNESS_URL ?? "http://localhost:5173/";

const chromePath =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: "new",
  args: ["--no-first-run", "--disable-search-engine-choice-screen"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.goto(base, { waitUntil: "networkidle2" });
await page.waitForSelector('[data-thread-card]', { timeout: 15000 });

const cardSel = '[data-thread-card="thr_ship_release"]';
// A non-done card: the Working lane's first card in the base fixture.
const evidence = {};

const checkboxCount = async () =>
  (await page.$$('[data-done-checkbox]')).length;

// 1. Not hovering: the checkbox exists in the DOM but paints at opacity 0.
await page.waitForSelector(cardSel);
const cardHandle = (await page.$$(cardSel))[0];
const cardId = await page.$eval(cardSel, (el) => el.getAttribute("data-thread-card"));
await cardHandle.scrollIntoView();
evidence.cardId = cardId;

// Hover the card: the checkbox becomes visible (opacity 1) and idle-armed.
await cardHandle.hover();
await new Promise((r) => setTimeout(r, 300));
const hoverStyle = await page.$eval(
  `[data-thread-card="${cardId}"] [data-done-checkbox]`,
  (el) => {
    const s = getComputedStyle(el);
    return { opacity: s.opacity };
  },
);
evidence.hoverReveal = hoverStyle;
await page.screenshot({ path: path.join(outDir, "hover.png") });

// 2. Click 1: arms. The button reports data-done-armed and shows the tag.
await page.click(`[data-thread-card="${cardId}"] [data-done-checkbox]`);
await new Promise((r) => setTimeout(r, 200));
evidence.armed = await page.$eval(
  `[data-thread-card="${cardId}"] [data-done-checkbox]`,
  (el) => ({
    armed: el.hasAttribute("data-done-armed"),
    tag: el.querySelector('[data-done-armed-tag]')?.textContent ?? null,
  }),
);
await page.screenshot({ path: path.join(outDir, "armed.png") });

// 3. Click 2: marks done — the card lands in the Done lane.
await page.click(`[data-thread-card="${cardId}"] [data-done-checkbox]`);
await new Promise((r) => setTimeout(r, 400));
evidence.done = await page.evaluate((id) => {
  // A pinned thread keeps a render in the Pinned lane while its parked pin
  // write rides the mock; judge done by ANY render of the id in the lane.
  const cards = [...document.querySelectorAll(`[data-thread-card="${id}"]`)];
  const doneLane = document.querySelector('[data-column-id="done"]');
  return {
    cardStillRendered: cards.length > 0,
    cardInDoneLane: cards.some((card) => doneLane?.contains(card) ?? false),
    lanes: [
      ...new Set(
        cards.map((card) =>
          card.closest("[data-column-id]")?.getAttribute("data-column-id"),
        ),
      ),
    ],
    checkboxOnCard: cards.some((card) => card.querySelector("[data-done-checkbox]") !== null),
  };
}, cardId);
await page.screenshot({ path: path.join(outDir, "done.png") });

evidence.totalCheckboxesBeforeHover = await checkboxCount();

await fs.writeFile(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
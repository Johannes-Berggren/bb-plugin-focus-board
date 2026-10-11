// One-shot headless repro for the status-dot done checkbox: on hover the
// card's state dot swaps to the checkbox (nothing else moves), the first
// click arms it (the label joins the header row), the second click moves
// the card to Done; a done card mirrors with a checked box arming "Mark
// Not Done". Dumps structural evidence to
// docs/screenshots/repro-done-checkbox/evidence.json and captures
// hover.png / armed.png / done-armed.png. Run the vite harness first:
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

// A non-done card: the Working lane's first card in the base fixture.
const cardSel = '[data-thread-card="thr_ship_release"]';
const checkboxSel = `${cardSel} [data-done-checkbox]`;
const evidence = {};

await page.waitForSelector(cardSel);
const cardHandle = (await page.$$(cardSel))[0];
const cardId = await page.$eval(cardSel, (el) => el.getAttribute("data-thread-card"));
await cardHandle.scrollIntoView();
evidence.cardId = cardId;

// Title width with no hover, for the nothing-moves contract.
const titleBoxIdle = await page.$eval(`${cardSel} [data-title]`, (el) => el.getBoundingClientRect().width);

// 1. Hover the card: the checkbox is visible (opacity 1) at the dot slot —
// top-left of the card body, level with the timestamp row — and the title
// keeps its exact idle width (the swap moves nothing).
await cardHandle.hover();
await new Promise((r) => setTimeout(r, 300));
const hoverStyle = await page.$eval(checkboxSel, (el) => {
  const s = getComputedStyle(el);
  const card = el.closest("[data-thread-card]").getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return {
    opacity: s.opacity,
    // Dot slot: within the card's header area, at its left edge.
    inHeaderLeft: box.top < card.top + 40 && box.left < card.left + 40,
  };
});
const titleBoxHover = await page.$eval(`${cardSel} [data-title]`, (el) => el.getBoundingClientRect().width);
evidence.hoverReveal = { ...hoverStyle, titleWidthIdle: titleBoxIdle, titleWidthHover: titleBoxHover };
await page.screenshot({ path: path.join(outDir, "hover.png") });

// 2. Click 1: arms. The label joins the header row and the title keeps its
// width (the arm pushes nothing out of the title).
await page.click(checkboxSel);
await new Promise((r) => setTimeout(r, 200));
const titleBoxArmed = await page.$eval(`${cardSel} [data-title]`, (el) => el.getBoundingClientRect().width);
evidence.armed = {
  ...(await page.$eval(checkboxSel, (el) => ({ armed: el.hasAttribute("data-done-armed") }))),
  tag: await page.$eval(`${cardSel} [data-done-armed-tag]`, (el) => el.textContent),
  titleWidthArmed: titleBoxArmed,
};
await page.screenshot({ path: path.join(outDir, "armed.png") });

// 3. Click 2: marks done — the card lands in the Done lane, and its idle
// checkbox there is the CHECKED glyph.
await page.click(checkboxSel);
await new Promise((r) => setTimeout(r, 400));
evidence.done = await page.evaluate((id) => {
  // A pinned thread keeps a render in the Pinned lane while its parked pin
  // write rides the mock; judge done by ANY render of the id in the lane.
  const cards = [...document.querySelectorAll(`[data-thread-card="${id}"]`)];
  const doneLane = document.querySelector('[data-column-id="done"]');
  const doneCard = cards.find((card) => doneLane?.contains(card));
  return {
    cardInDoneLane: doneCard !== undefined,
    doneCardCheckboxGlyph:
      doneCard?.querySelector("[data-done-checkbox] [data-icon]")?.getAttribute("data-icon") ??
      null,
  };
}, cardId);

// 4. The done card mirrors: hover arms "Mark Not Done".
const doneEl = await page.evaluateHandle((id) => {
  const doneLane = document.querySelector('[data-column-id="done"]');
  return [...doneLane.querySelectorAll(`[data-thread-card="${id}"]`)][0];
}, cardId).then((h) => h.asElement());
if (doneEl === null) throw new Error("done card not found in Done lane");
await doneEl.scrollIntoView();
await doneEl.hover();
await new Promise((r) => setTimeout(r, 300));
await page.click(`[data-column-id="done"] [data-thread-card="${cardId}"] [data-done-checkbox]`);
await new Promise((r) => setTimeout(r, 200));
evidence.doneArmed = await page.$eval(
  `[data-column-id="done"] [data-thread-card="${cardId}"] [data-done-checkbox]`,
  (el) => ({ armed: el.hasAttribute("data-done-armed") }),
);
evidence.doneArmed.tag = await page.$eval(
  `[data-column-id="done"] [data-thread-card="${cardId}"] [data-done-armed-tag]`,
  (el) => el.textContent,
);
await page.screenshot({ path: path.join(outDir, "done-armed.png") });

await fs.writeFile(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
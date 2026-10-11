// One-shot headless repro for the title-row Mark Done checkbox: a non-done
// card shows an empty checkbox LEFT OF THE TITLE on hover, the first click
// arms it ("Mark Done" inline, pushing the title right), the second click
// moves the card to Done. A done card mirrors: a checked box that arms
// "Mark Not Done" with the same push. Dumps structural evidence to
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

// 1. Hover the card: the checkbox is visible (opacity 1) and idle-armed.
await cardHandle.hover();
await new Promise((r) => setTimeout(r, 300));
const hoverStyle = await page.$eval(checkboxSel, (el) => {
  const s = getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const title = el.nextElementSibling?.getBoundingClientRect();
  return {
    opacity: s.opacity,
    // Left of the title: the box's right edge sits at or before the
    // title's left edge.
    leftOfTitle: title === undefined ? null : box.right <= title.left + 1,
  };
});
evidence.hoverReveal = hoverStyle;
await page.screenshot({ path: path.join(outDir, "hover.png") });

// 2. Click 1: arms. The label joins in-flow and the title's box narrows
// (the push), reporting both the armed state and the title shift.
const titleBoxBefore = await page.$eval(`${cardSel} [data-title]`, (el) => el.getBoundingClientRect().width);
await page.click(checkboxSel);
await new Promise((r) => setTimeout(r, 200));
evidence.armed = await page.$eval(checkboxSel, (el) => ({
  armed: el.hasAttribute("data-done-armed"),
  tag: el.querySelector('[data-done-armed-tag]')?.textContent ?? null,
}));
const titleBoxAfter = await page.$eval(`${cardSel} [data-title]`, (el) => el.getBoundingClientRect().width);
evidence.armed.titlePush = { titleWidthBefore: titleBoxBefore, titleWidthAfter: titleBoxAfter };
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

// 4. The done card mirrors: hover arms "Mark Not Done" with the same push.
const doneCardHandle = await page.evaluateHandle((id) => {
  const doneLane = document.querySelector('[data-column-id="done"]');
  return [...doneLane.querySelectorAll(`[data-thread-card="${id}"]`)][0];
}, cardId);
const doneEl = doneCardHandle.asElement();
if (doneEl === null) throw new Error("done card not found in Done lane");
await doneEl.scrollIntoView();
await doneEl.hover();
await new Promise((r) => setTimeout(r, 300));
await page.click(`[data-column-id="done"] [data-thread-card="${cardId}"] [data-done-checkbox]`);
await new Promise((r) => setTimeout(r, 200));
evidence.doneArmed = await page.$eval(
  `[data-column-id="done"] [data-thread-card="${cardId}"] [data-done-checkbox]`,
  (el) => ({
    armed: el.hasAttribute("data-done-armed"),
    tag: el.querySelector('[data-done-armed-tag]')?.textContent ?? null,
  }),
);
await page.screenshot({ path: path.join(outDir, "done-armed.png") });

await fs.writeFile(path.join(outDir, "evidence.json"), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
/**
 * Chip probe: screenshots the chip-heavy sim cards (thr_chips, thr_chips_open)
 * in both themes so the provider-chip layout and merged treatment get looked
 * at visually, not just asserted in jsdom.
 *
 * Run once vite is up: `npx vite --config scripts/screenshot/vite.config.ts`
 * then `node scripts/screenshot/probe-chips.mjs`.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/", import.meta.url).pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 480, height: 900, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.goto(`${BASE}?demo=1&groupBy=status`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
await new Promise((resolve) => setTimeout(resolve, 800));

for (const theme of ["dark", "light"]) {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle("dark", t === "dark");
  }, theme);
  await new Promise((resolve) => setTimeout(resolve, 400));
  for (const thrId of ["thr_chips", "thr_chips_open", "thr_chips_single", "thr_chips_pair", "thr_chips_cove"]) {
    const card = await page.waitForSelector(`[data-thread-card="${thrId}"]`, { timeout: 10_000 });
    await card.screenshot({ path: `${OUT}chip-probe-${thrId}-${theme}.png`, timeout: 15_000 });
    console.log(`shot chip-probe-${thrId}-${theme}.png`);
  }
}

// Hover the first id on the merged card to prove the enlarge-on-hover
// renders inside its cell without moving the neighbors.
const mergedCard = await page.waitForSelector('[data-thread-card="thr_chips"]', { timeout: 10_000 });
const firstId = await page.waitForSelector('[data-thread-card="thr_chips"] [data-ticket-id="#43"]', { timeout: 10_000 });
const idBox = await firstId.boundingBox();
await page.mouse.move(idBox.x + idBox.width / 2, idBox.y + idBox.height / 2);
await new Promise((resolve) => setTimeout(resolve, 300));
await mergedCard.screenshot({ path: `${OUT}chip-probe-hover-dark.png`, timeout: 15_000 });
console.log("shot chip-probe-hover-dark.png");

await browser.close();
console.log("done");
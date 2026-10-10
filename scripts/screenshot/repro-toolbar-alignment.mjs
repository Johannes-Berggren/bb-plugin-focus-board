// Toolbar alignment repro: for the toolbar row (components/board-toolbar.tsx)
// measure every control's vertical center under several host font-metric
// sets. The line-box regression (bare `relative` wrappers positioning
// inline-flex triggers on the text baseline) showed up as a non-zero center
// delta between the wallpaper icon and the What's-new gift — and as cluster
// height growth — only under host fonts other than the harness default.
// Usage: vite harness first (README above), then node scripts/screenshot/repro-toolbar-alignment.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const HARNESS_URL = process.env.HARNESS_URL ?? "http://localhost:58123/";
const CHROME_PATH =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = "docs/screenshots/repro-toolbar-alignment";

const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 900, deviceScaleFactor: 2 });
await page.goto(HARNESS_URL, { waitUntil: "networkidle0" });
await new Promise((resolve) => setTimeout(resolve, 1200));

const FONT_SETS = [
  null,
  { fs: "16px", lh: "1.5" },
  { fs: "14px", lh: "1.45" },
  { fs: "15px", lh: "1.6" },
  { fs: "12px", lh: "1.4" },
];
const results = [];
for (const font of FONT_SETS) {
  if (font === null) {
    await page.evaluate(() => {
      const panel = document.querySelector('[data-bb-plugin="focus-board"]');
      panel.style.fontSize = "";
      panel.style.lineHeight = "";
    });
  } else {
    await page.evaluate((font) => {
      const panel = document.querySelector('[data-bb-plugin="focus-board"]');
      panel.style.fontSize = font.fs;
      panel.style.lineHeight = font.lh;
    }, font);
  }
  await new Promise((resolve) => setTimeout(resolve, 150));
  results.push(await page.evaluate(() => {
    const gift = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "What's new",
    );
    const wp = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Wallpaper",
    );
    const view = [...document.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "View",
    );
    const search = [...document.querySelectorAll("input")].find(
      (i) => i.getAttribute("aria-label") === "Search threads",
    );
    const newThread = [...document.querySelectorAll("button")].find(
      (b) => b.textContent.includes("New thread"),
    );
    const cluster = gift.parentElement;
    const row = view.closest("[class*='flex-wrap']");
    const cr = cluster.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const cy = (el) =>
      Math.round((el.getBoundingClientRect().top + el.getBoundingClientRect().height / 2 - rr.top) * 100) / 100;
    return {
      clusterH: Math.round(cr.height * 100) / 100,
      font: getComputedStyle(cluster).fontSize + "/" + getComputedStyle(cluster).lineHeight,
      centers: {
        newThread: cy(newThread),
        search: cy(search),
        view: cy(view),
        wallpaper: cy(wp),
        gift: cy(gift),
      },
    };
  }));
}
console.log(JSON.stringify(results, null, 1));
mkdirSync(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}/toolbar.png`, clip: { x: 0, y: 0, width: 1500, height: 56 } });
await browser.close();
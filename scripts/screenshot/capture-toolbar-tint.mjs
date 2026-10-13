/**
 * One-shot headless capture for the toolbar header tint (thread
 * thr_6kdehqjar9): screenshots the toolbar band in both themes and both
 * toolbar variants, with the computed background color of the root band in
 * each state written to evidence.json. Run the vite harness first, then
 * `HARNESS_URL=... node scripts/screenshot/capture-toolbar-tint.mjs`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = `${new URL("../../docs/screenshots/", import.meta.url).pathname}repro-toolbar-tint/`;

const VIEWPORTS = {
  desktop: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  phone: { width: 390, height: 844, deviceScaleFactor: 2 },
};

await mkdir(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars"],
});

const evidence = [];

for (const [variant, viewport] of Object.entries(VIEWPORTS)) {
  for (const theme of ["dark", "light"]) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.goto(`${BASE}?demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
    await page.evaluate((t) => {
      document.documentElement.classList.toggle("dark", t === "dark");
    }, theme);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const background = await page.evaluate(() => {
      const el = document.querySelector(
        'header, [data-bb-plugin="focus-board"] > div',
      );
      const row = el?.matches("header") ? el : el?.firstElementChild;
      const band = row?.matches("header")
        ? row
        : [...(row?.children ?? [])].find((child) => (child?.className ?? "").toString().includes("bg-muted/50")) ?? null;
      if (!band) return null;
      return getComputedStyle(band).backgroundColor;
    });
    await page.screenshot({
      path: `${OUT}${variant}-${theme}.png`,
      clip: { x: 0, y: 0, width: viewport.width, height: 140 },
    });
    evidence.push({ variant, theme, toolbarBackground: background });
    await page.close();
  }
}

await browser.close();
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2) + "\n");

const bad = evidence.filter((row) => row.toolbarBackground === null);
console.log(JSON.stringify(evidence, null, 2));
if (bad.length !== 0) {
  console.error(`MISSING TINT: ${bad.length} state(s) report null`);
  process.exitCode = 1;
}
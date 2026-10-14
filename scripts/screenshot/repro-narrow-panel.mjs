// [REDWORK] Narrow-panel repro: on a WIDE window the media query reads
// "desktop", but the operator can squeeze the bb panel itself to ~250px.
// The collapsed header holds its own there; what clips is the thread pane:
// the non-compact `<aside>` keeps its stored width beside the board, and
// a wide pane juts past the panel's right edge (title + ✨ painted over
// the host's chat area). Captures three states plus geometry evidence.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:58123/";
const OUT = new URL("../../docs/screenshots/repro-narrow-panel/", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1100, height: 700, deviceScaleFactor: 2 },
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

await mkdir(OUT, { recursive: true });
await page.goto(BASE, { waitUntil: "networkidle0" });
await sleep(1000);

// Squeeze the plugin panel itself (simulating a narrow bb panel on the
// wide window above). A stylesheet, not inline styles: opening the pane
// remounts the panel and wipes inline overrides.
const squeeze = async (width) => {
  await page.evaluate((width) => {
    let tag = document.getElementById("repro-squeeze");
    if (tag === null) {
      tag = document.createElement("style");
      tag.id = "repro-squeeze";
      document.head.appendChild(tag);
    }
    tag.textContent = `[data-bb-plugin="focus-board"] { width: ${width}px !important; min-width: ${width}px !important; max-width: ${width}px !important; outline: 1px solid red; }`;
  }, width);
};
await squeeze(250);

const evidence = { pageErrors: errors, states: [] };

async function snapshot(label) {
  await sleep(400);
  const data = await page.evaluate((label) => {
    const rect = (el) => {
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const panel = document.querySelector('[data-bb-plugin="focus-board"]');
    const aside = document.querySelector('aside[role="complementary"]');
    const title = aside?.querySelector("h1, h2, [title]") ?? null;
    return {
      label,
      panel: rect(panel),
      toolbar: rect(document.querySelector(".border-b")),
      search: rect([...document.querySelectorAll("input")].find((i) => i.getAttribute("aria-label") === "Search threads") ?? null),
      pane: rect(aside),
      paneTitle: title?.textContent ?? null,
    };
  }, label);
  evidence.states.push(data);
  const file = `${OUT}${label}.png`;
  await page.screenshot({ path: file });
  return file;
}

// A: pane closed.
await snapshot("A-pane-closed-250px");

// B: open the first card's pane.
const firstCard = await page.$('[data-thread-card] a');
if (firstCard === null) throw new Error("no thread card anchor found");
await firstCard.click();
await sleep(1000);
await snapshot("B-pane-open-250px");

// C: same, wider panel (420px).
await squeeze(420);
await page.evaluate(() => window.dispatchEvent(new Event("resize")));
await sleep(500);
await snapshot("C-pane-open-420px");

await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
if (errors.length > 0) process.exitCode = 1;
await browser.close();
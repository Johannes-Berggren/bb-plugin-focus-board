/**
 * Animated-GIF capture for the README's "Zoom to family" sequence: Focus
 * view → right-click a 24-child family card → the card menu's "Zoom to
 * family" entry → the Parent view scoped to that family. Renders the real
 * app against the screenshot harness (`?demo=1&zoomfamily=1`), drives the
 * gestures with real mouse events, and overlays a synthetic cursor so the
 * pointer is part of the shot.
 *
 * One-time setup: `npm i --no-save puppeteer-core`. Then, in two terminals:
 *   npm run build                                    # harness loads dist/app.css
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-family-zoom-gif.mjs
 *
 * Frames land in a temp dir (FRAMES_DIR overrides); the palette-optimized
 * GIF is written to docs/screenshots/family-zoom.gif (OUT_DIR and GIF_WIDTH
 * override, width default 1200). ffmpeg does the assembly.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const execFileP = promisify(execFile);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT_DIR = process.env.OUT_DIR ?? new URL("../../docs/screenshots/", import.meta.url).pathname;
const FRAMES_DIR = process.env.FRAMES_DIR ?? (await mkdtemp(path.join(os.tmpdir(), "family-zoom-gif-")));
const GIF_PATH = path.join(OUT_DIR, "family-zoom.gif");
const GIF_WIDTH = Number(process.env.GIF_WIDTH ?? "1200");
const QUERY = "?demo=1&zoomfamily=1&collapsed=thr_zoomfam";
const FAMILY_TITLE = "Migrate the board to fractional ranks";
const MENU_ENTRY = "Zoom to family";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
const shots = [];

/** A synthetic pointer: headless screenshots carry no OS cursor, so the
 *  GIF's pointer is an overlay arrow this driver moves with the mouse. */
const CURSOR_SVG = `
<svg id="gif-cursor" width="21" height="28" viewBox="0 0 21 28"
     style="position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;
            filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.55))" aria-hidden="true">
  <path d="M2.5 1.5 L2.5 20.5 L7.6 15.8 L10.7 23.4 L14.3 21.9 L11.2 14.4 L17.5 14.4 Z"
        fill="#fff" stroke="#1a1a1a" stroke-width="1.4" stroke-linejoin="round"/>
</svg>`;

async function injectCursor() {
  await page.evaluate((svg) => {
    document.body.insertAdjacentHTML("beforeend", svg);
  }, CURSOR_SVG);
}

async function moveCursor(x, y) {
  await page.mouse.move(x, y);
  await page.evaluate((x, y) => {
    const cursor = document.getElementById("gif-cursor");
    cursor.style.transform = `translate(${x}px, ${y}px)`;
  }, x, y);
}

/** The innermost element whose text names the target, scrolled into view. */
async function pointOfText(text) {
  const rect = await page.evaluate((text) => {
    const matches = [...document.querySelectorAll("body *")]
      .filter((el) => el.textContent?.trim() === text);
    if (matches.length === 0) return null;
    // The innermost match: icons and wrapper spans make leaf checks fail, so
    // rank by box area and take the smallest (the label itself, not a menu).
    const el = matches
      .map((candidate) => ({ candidate, area: candidate.getBoundingClientRect().width * candidate.getBoundingClientRect().height }))
      .sort((a, b) => a.area - b.area)[0].candidate;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, text);
  if (!rect) throw new Error(`no element reading exactly "${text}"`);
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function shoot(name) {
  const file = path.join(FRAMES_DIR, `${name}.png`);
  await page.screenshot({ path: file, timeout: 30_000 });
  shots.push(name);
  console.log(`  ${name}`);
}

/** The concat demuxer's per-frame durations; every entry is a distinct PNG. */
async function assemble() {
  const list = path.join(FRAMES_DIR, "frames.txt");
  const DURATION_S = {
    "00-focus": 1.1,
    "01-approach": 0.14,
    "02-on-card": 0.4,
    "03-menu": 1.3,
    "04-to-entry": 0.14,
    "05-hover": 1.1,
    "06-swap-a": 0.16,
    "07-swap-b": 0.16,
    "08-swap-c": 0.16,
    "09-parent": 2.6,
  };
  const entries = shots.map((name) => `file '${name}.png'\nduration ${DURATION_S[name] ?? 0.2}`);
  // The concat demuxer ignores the last entry's duration, so the final frame
  // is listed twice — the repeat carries the settle hold.
  entries.push(`file '${shots.at(-1)}.png'\nduration 0.1`);
  await writeFile(list, entries.join("\n") + "\n");
  const vf = [
    "fps=12",
    `scale=${GIF_WIDTH}:-2:flags=lanczos`,
    "split[a][b]",
    "[a]palettegen=max_colors=192[p]",
    "[b][p]paletteuse=dither=bayer:bayer_scale=4",
  ].join(",");
  await execFileP("ffmpeg", [
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-vf", vf, "-loop", "0", GIF_PATH,
  ]);
  console.log(`  wrote ${GIF_PATH}`);
}

try {
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // The family card's title is the capture's anchor: its presence means the
  // zoom fixture mounted and the board rendered.
  await page.waitForFunction(
    (text) => [...document.querySelectorAll("body *")]
      .some((el) => el.childElementCount === 0 && el.textContent?.trim() === text),
    { timeout: 30_000 },
    FAMILY_TITLE,
  );
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
  await injectCursor();
  await new Promise((resolve) => setTimeout(resolve, 900));
  await moveCursor(1500, 900);
  await shoot("00-focus");

  // Slide the pointer onto the family card, then right-click its title row.
  const card = await pointOfText(FAMILY_TITLE);
  await moveCursor(card.x - 140, card.y - 90);
  await shoot("01-approach");
  await moveCursor(card.x - 30, card.y);
  await shoot("02-on-card");
  await page.mouse.click(card.x - 30, card.y, { button: "right" });
  await page.waitForFunction(
    (text) => [...document.querySelectorAll("body *")]
      .some((el) => el.textContent?.trim() === text),
    { timeout: 5_000 },
    MENU_ENTRY,
  );
  await new Promise((resolve) => setTimeout(resolve, 350));
  const menuAnchor = await pointOfText("Open thread");
  await moveCursor(menuAnchor.x - 30, menuAnchor.y);
  await shoot("03-menu");

  // Down to the entry, hover-highlight it, then run it with a real click.
  const entry = await pointOfText(MENU_ENTRY);
  await moveCursor(entry.x - 60, entry.y - 40);
  await shoot("04-to-entry");
  await moveCursor(entry.x, entry.y);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await shoot("05-hover");
  await page.mouse.click(entry.x, entry.y);

  // The view swap is a state write, not an animation; three quick frames
  // cover the Parent board's mount, then the settle hold ends the loop.
  for (const name of ["06-swap-a", "07-swap-b", "08-swap-c"]) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    await shoot(name);
  }
  // The zoom lands with the family surface framed from its parent card down:
  // reset every scroll container (a title probe here would scroll the family's
  // inner scroller and push the parent card out of frame), park the pointer
  // in the surface's empty lower-right, then hold the settle.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollTop) el.scrollTop = 0;
    }
  });
  await moveCursor(1800, 1020);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await shoot("09-parent");

  await assemble();
} finally {
  await browser.close().catch(() => {});
}
console.log(`done — frames in ${FRAMES_DIR}`);

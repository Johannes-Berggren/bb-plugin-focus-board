// Headless repro for the alert-banner overflow bug: the board's four status
// banners (rank-error, sweep-notice, browser-reveal-notice, sweep-refusal)
// render as in-flow children of the board's horizontal overflow-x-auto scroll
// container, so they (a) can end up wider than the visible viewport when the
// board's column row overflows and (b) scroll away with the columns.
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts`, then
// `node scripts/screenshot/repro-banner-offscreen.mjs`. Writes evidence to
// docs/screenshots/repro-banner-offscreen/ (screenshot + JSON).
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const DESKTOP = { width: 1280, height: 800 };

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/repro-banner-offscreen/", import.meta.url).pathname;

const BANNER_CLASSES =
  "mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: DESKTOP,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport(DESKTOP);
await page.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("section[aria-label]", { timeout: 30_000 });
await new Promise((r) => setTimeout(r, 400));

// Inject a synthetic rank-error banner (exact production classes + a long
// message) where components/board.tsx renders the status banners: inside the
// board's new banner row (`[data-banner-row]`) once the fix ships, or — on
// the unfixed tree — as the first child of the horizontal scroll container.
const evidence = await page.evaluate((classes) => {
  const board = document.querySelector("[data-columns-board]");
  if (!board) throw new Error("board scroll container not found");
  const mount =
    document.querySelector("[data-banner-row]") ??
    (() => {
      const legacy = document.createElement("div");
      board.prepend(legacy);
      return legacy;
    })();
  const bannerRowMount = mount.matches("[data-banner-row]");
  const before = {
    boardClientWidth: board.clientWidth,
    boardScrollWidth: board.scrollWidth,
    viewportWidth: innerWidth,
    bannerRowMount,
  };
  // Guarantee horizontal overflow: widen the first column row if needed.
  const row = board.querySelector(".flex.h-full");
  if (row && row.scrollWidth < board.clientWidth) {
    row.style.width = `${board.clientWidth * 1.6}px`;
    row.style.overflow = "hidden";
  }
  const banner = document.createElement("div");
  banner.setAttribute("role", "status");
  banner.setAttribute("data-testid", "repro-rank-error-banner");
  banner.className = classes;
  const msg = document.createElement("p");
  msg.className = "min-w-0";
  msg.textContent =
    "Rank write refused: the thread is locked by another operator who still holds the reorder lease for several more seconds so this move cannot be applied right now.";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "✕";
  banner.append(msg, btn);
  mount.append(banner);

  const afterOverflow = {
    boardClientWidth: board.clientWidth,
    boardScrollWidth: board.scrollWidth,
  };
  const atOrigin = (() => {
    const r = banner.getBoundingClientRect();
    const t = msg.getBoundingClientRect();
    return { bannerLeft: r.left, bannerRight: r.right, textRight: t.right, overflowsViewport: r.right > innerWidth };
  })();
  board.scrollLeft = board.scrollWidth; // scroll to the right edge
  const rect = banner.getBoundingClientRect();
  const tr = msg.getBoundingClientRect();
  const scrolledRight = {
    boardScrollLeft: board.scrollLeft,
    bannerLeft: rect.left,
    bannerRight: rect.right,
    textLeft: tr.left,
    textRight: tr.right,
    textFullyOffscreen: tr.right <= 0,
  };
  board.scrollLeft = 0;
  const rect0 = banner.getBoundingClientRect();
  const fixed =
    bannerRowMount === true &&
    atOrigin.overflowsViewport === false &&
    scrolledRight.textFullyOffscreen === false;
  return {
    verdict: fixed ? "fixed — banner stays viewport-bound while the board scrolls" : "broken — banner text ends up horizontally offscreen",
    before, afterOverflow, atOrigin, scrolledRight, bannerWidthAtOrigin: rect0.width,
  };
}, BANNER_CLASSES);

const bannerShot = await page.$("[data-testid=repro-rank-error-banner]");
await mkdir(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}board-with-banner.png`, fullPage: false });
if (bannerShot) await bannerShot.screenshot({ path: `${OUT}banner.png` });
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
await browser.close();
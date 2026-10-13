// Headless verification for the hovered-card prominence fix (issue #123): a
// card under the pointer must read MORE prominent, not less. The bug's hover
// style swapped the card's opaque surface (`bg-card`) for a translucent one
// (`hover:bg-accent/50`), so the hovered card let the lane background /
// wallpaper bleed through — it faded, and the sibling cards stayed opaque.
// This driver hovers one card and records computed styles before/during
// hover for the hovered card and a sibling card, then verifies:
//   1. hovered card's background-color is fully OPAQUE while hovered
//   2. hovered card's opacity stays 1 — the hovered card never fades
//   3. the SIBLING card recedes during the hover (spotlight dim < 1)
// A non-faded card may dim by the spotlight; a `data-card-faded` or
// `data-sweep-highlighted` sibling keeps its own dim semantics and is only
// recorded. Exits 1 when a check fails (CI-able). Artifacts land in
// docs/screenshots/repro-card-hover-fade/ (before/after PNGs + evidence.json).
// Run the vite harness first (same as shoot.mjs), then
// `node scripts/screenshot/repro-card-hover-fade.mjs`; honors the same
// `CHROME_PATH`, `HARNESS_URL`, and `OUT_DIR` overrides.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2 };
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT =
  process.env.OUT_DIR ??
  new URL("../../docs/screenshots/repro-card-hover-fade/", import.meta.url)
    .pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The alpha of a computed CSS color (modern `lab/… /a)` space syntax, or the
 *  legacy `rgba(r,g,b,a)` comma syntax); 1 when the color has no alpha. */
function alphaOf(browserColor) {
  const slash = browserColor.match(/\/\s*([0-9.]+)\s*\)\s*$/);
  if (slash !== null) return parseFloat(slash[1]);
  const comma = browserColor.match(/,\s*([0-9.]+)\s*\)\s*$/);
  if (comma !== null) return parseFloat(comma[1]);
  return 1;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport(VIEW);
await page.goto(`${BASE}?groupBy=status`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
await sleep(600);

/** Pick the first card div fully inside the viewport, optionally excluding
 *  one thread id (the already-picked hover target). */
async function visibleCard(excludeId) {
  return page.evaluate((exclude) => {
      // Card divs only: child rows are anchors wearing the same attr, and
      // their hover lives inside the parent card's opaque surface.
      const cards = [...document.querySelectorAll("div[data-thread-card]")];
      const visible = cards.find((el) => {
        if (exclude !== null && el.getAttribute("data-thread-card") === exclude)
          return false;
        const r = el.getBoundingClientRect();
        return (
          r.width > 100 &&
          r.height > 40 &&
          r.top > 0 &&
          r.bottom < window.innerHeight &&
          r.left > 0 &&
          r.right < window.innerWidth
        );
      });
      if (visible === undefined) return null;
      const r = visible.getBoundingClientRect();
      const cs = getComputedStyle(visible);
      return {
        id: visible.getAttribute("data-thread-card"),
        faded: visible.hasAttribute("data-card-faded"),
        sweepHighlighted: visible.hasAttribute("data-sweep-highlighted"),
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        style: {
          backgroundColor: cs.backgroundColor,
          opacity: cs.opacity,
        },
      };
    },
    excludeId,
  );
}

// Read the hovered candidate and a sibling card's style with no pointer
// anywhere near them.
const cardInfo = await visibleCard(null);
if (cardInfo === null) {
  console.error("no visible top-level card found in the viewport");
  process.exit(1);
}
const siblingInfo = await visibleCard(cardInfo.id);

await mkdir(OUT, { recursive: true });
await page.screenshot({
  path: `${OUT}before.png`,
  clip: {
    x: Math.max(0, cardInfo.rect.x - 40),
    y: Math.max(0, cardInfo.rect.y - 20),
    width: Math.min(VIEW.width - Math.max(0, cardInfo.rect.x - 40), cardInfo.rect.width + 240),
    height: Math.min(VIEW.height, cardInfo.rect.height + 80),
  },
});

// Hover the card's center, then let the color/opacity transitions settle.
await page.mouse.move(
  cardInfo.rect.x + cardInfo.rect.width / 2,
  cardInfo.rect.y + cardInfo.rect.height / 2,
);
await sleep(500);

// Capture the hovered state, then read the styles.
await page.screenshot({
  path: `${OUT}after.png`,
  clip: {
    x: Math.max(0, cardInfo.rect.x - 40),
    y: Math.max(0, cardInfo.rect.y - 20),
    width: Math.min(VIEW.width - Math.max(0, cardInfo.rect.x - 40), cardInfo.rect.width + 240),
    height: Math.min(VIEW.height, cardInfo.rect.height + 80),
  },
});

const hoverInfo = await page.evaluate(
  (hoverId, siblingId) => {
    const card = document.querySelector(`[data-thread-card="${CSS.escape(hoverId)}"]`);
    const sibling = document.querySelector(
      `[data-thread-card="${CSS.escape(siblingId)}"]`,
    );
    const read = (el) => {
      if (el === null) return null;
      const cs = getComputedStyle(el);
      return {
        backgroundColor: cs.backgroundColor,
        opacity: cs.opacity,
        faded: el.hasAttribute("data-card-faded"),
        sweepHighlighted: el.hasAttribute("data-sweep-highlighted"),
      };
    };
    return { hovered: read(card), sibling: read(sibling) };
  },
  cardInfo.id,
  siblingInfo?.id ?? "",
);

const failures = [];
if (hoverInfo.hovered === null) {
  failures.push("hovered card disappeared during the hover");
} else {
  const alpha = alphaOf(hoverInfo.hovered.backgroundColor);
  if (alpha < 1) {
    failures.push(
      `hovered card surface is translucent while hovered (alpha ${alpha}, ` +
        `${hoverInfo.hovered.backgroundColor}) — the lane/wallpaper bleeds through`,
    );
  }
  if (parseFloat(hoverInfo.hovered.opacity) < 1) {
    failures.push(
      `hovered card's opacity faded to ${hoverInfo.hovered.opacity}`,
    );
  }
}
if (hoverInfo.sibling === null) {
  // No sibling visible: the spotlight dim is unverifiable in this board.
} else if (hoverInfo.sibling.faded || hoverInfo.sibling.sweepHighlighted) {
  // Exempt card: its own dim system is in charge; the spotlight must not
  // stack on it, and its opacity stays whatever its own semantics keep.
} else if (parseFloat(hoverInfo.sibling.opacity) >= 1) {
  failures.push(
    `sibling card ${siblingInfo?.id ?? "?"} did not recede during the ` +
      `hover (opacity ${hoverInfo.sibling.opacity})`,
  );
}

const pass = failures.length === 0;
const evidence = { pass, failures, cardInfo, siblingInfo, hoverInfo };
console.log(JSON.stringify(evidence, null, 2));
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2) + "\n");

await browser.close();
if (!pass) {
  console.error(`repro-card-hover-fade FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
// Headless reproduction for the light-mode hover muting: HOVER_SURFACE darkens
// the hovered card in BOTH themes (components/thread-card.tsx ~241-248, the
// issue #123 follow-up's deliberate choice), and in dark mode a darker card
// against a darker canvas reads as emphasis. In light mode the same darkening
// turns a near-white card (oklch 98.5%) into a mid-gray one (~oklch 78-79%) —
// it reads as MUTED, not emphasized. This driver hovers one card in each
// theme and records the rest vs hovered surface lightness, then exits 1 only
// while the light pass fails: in light mode the hovered card's surface must
// not be DARKER than its rest surface. (Dark mode's darkening stays allowed —
// that direction is the design the hover comment pins.) Artifacts land in
// docs/screenshots/repro-card-hover-lightmode/ (before/after PNGs per theme +
// evidence.json). Run the vite harness first (same as shoot.mjs), then
// `node scripts/screenshot/repro-card-hover-lightmode.mjs`; honors the same
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
  new URL("../../docs/screenshots/repro-card-hover-lightmode/", import.meta.url)
    .pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The lightness channel of Chrome's computed `oklch(L …)` / `oklab(L a b / …)`
 *  background-color, 0..1; null when the surface is not a modern OK-space
 *  color the driver can read. */
function lightnessOf(browserColor) {
  const lch = browserColor.match(/oklch\(\s*([0-9.]+)(%?)\b/);
  if (lch !== null) {
    return lch[2] === "%" ? parseFloat(lch[1]) / 100 : parseFloat(lch[1]);
  }
  const lab = browserColor.match(/oklab\(\s*([0-9.]+)\b/);
  return lab === null ? null : parseFloat(lab[1]);
}

function pickVisibleCard() {
  const cards = [...document.querySelectorAll("div[data-thread-card]")];
  const visible = cards.find((el) => {
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
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    backgroundColor: cs.backgroundColor,
  };
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

function setTheme(dark) {
  return page.evaluate((dark) => {
    document.documentElement.classList.toggle("dark", dark);
    return document.documentElement.className;
  }, dark);
}

/** One pass: read the card's rest surface, hover it, read the hovered
 *  surface, and capture a screenshot for each state. */
async function runPass(dark) {
  const theme = dark ? "dark" : "light";
  await setTheme(dark);
  await sleep(400);
  const rest = await page.evaluate(pickVisibleCard);
  if (rest === null) return { theme, error: "no visible top-level card" };
  await page.screenshot({
    path: `${OUT}${theme}-before.png`,
    clip: {
      x: Math.max(0, rest.rect.x - 40),
      y: Math.max(0, rest.rect.y - 20),
      width: Math.min(VIEW.width - Math.max(0, rest.rect.x - 40), rest.rect.width + 240),
      height: Math.min(VIEW.height, rest.rect.height + 80),
    },
  });
  await page.mouse.move(
    rest.rect.x + rest.rect.width / 2,
    rest.rect.y + rest.rect.height / 2,
  );
  await sleep(600);
  const hovered = await page.evaluate(pickVisibleCard);
  await page.screenshot({
    path: `${OUT}${theme}-after.png`,
    clip: {
      x: Math.max(0, rest.rect.x - 40),
      y: Math.max(0, rest.rect.y - 20),
      width: Math.min(VIEW.width - Math.max(0, rest.rect.x - 40), rest.rect.width + 240),
      height: Math.min(VIEW.height, rest.rect.height + 80),
    },
  });
  // Un-hover so the second pass's rest read is clean.
  await page.mouse.move(10, VIEW.height - 10);
  await sleep(600);
  return {
    theme,
    cardId: rest.id,
    rest: {
      backgroundColor: rest.backgroundColor,
      lightness: lightnessOf(rest.backgroundColor),
    },
    hovered: {
      backgroundColor: hovered === null ? null : hovered.backgroundColor,
      lightness: hovered === null ? null : lightnessOf(hovered.backgroundColor),
    },
  };
}

await mkdir(OUT, { recursive: true });
const lightPass = await runPass(false);
const darkPass = await runPass(true);

// The assertion lives on the light pass: the hovered card must not be darker
// than its rest surface there — darkening a near-white card reads as muting.
const failures = [];
if (lightPass.error !== undefined) {
  failures.push(`light pass failed: ${lightPass.error}`);
} else if (lightPass.rest.lightness === null || lightPass.hovered.lightness === null) {
  failures.push(
    `Chrome computed a background-color this driver cannot read: rest ` +
      `${lightPass.rest.backgroundColor} / hovered ${lightPass.hovered.backgroundColor}`,
  );
} else if (lightPass.hovered.lightness < lightPass.rest.lightness) {
  failures.push(
    `in light mode the hovered card's surface DARKENED (rest L ` +
      `${lightPass.rest.lightness}, hovered L ${lightPass.hovered.lightness}) — ` +
      `on a light canvas darkening reads as muting, not emphasis`,
  );
}

const evidence = { pass: failures.length === 0, failures, lightPass, darkPass };
console.log(JSON.stringify(evidence, null, 2));
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2) + "\n");
await browser.close();
if (!pass(evidence)) {
  console.error(`repro-card-hover-lightmode FAILED:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

function pass(e) {
  return e.pass;
}
// Repro/verification for issue #233: alert banners paint translucent tinted
// surfaces (10%-alpha amber/destructive backgrounds), so with a wallpaper
// behind the board the banner text loses contrast and becomes illegible.
//
// The probe seeds a busy, high-variance "photographic" wallpaper (a
// deterministic multicolor SVG surrogate kept self-contained: no network, no
// flaky remote fetch), triggers two live banner families on the real app —
// the rank refusal banner (destructive: a drop that resolves to no move) and
// the pinned nest receipt (amber: a nest whose child keeps its own slot,
// gestures per tests/board-reparent.test.tsx and tests/app-pin-drag-rank.test.tsx)
// — then measures each banner's computed background color in BOTH themes
// (the harness toggles the `dark` class per capture, like shoot.mjs).
//
// A banner fails when its background is translucent (alpha < 1: the wallpaper
// shows through the surface that carries the text) or when the text's contrast
// ratio against the wallpaper-composited background drops below 4.5 (WCAG AA
// small text). The wallpaper contribution is sampled from the wallpaper image
// itself with a canvas (the data URL stays untainted), averaged over the
// image's painted area, dimmed like the panel's scrim, then composited under
// the banner's color at its computed alpha.
//
// Artifacts land in docs/screenshots/repro-banner-contrast/ (full-board shots
// with each banner up, per-theme banner clips, plus evidence.json; the pre-fix
// run is preserved in docs/screenshots/repro-banner-contrast-prefix/ via
// OUT_DIR). Run the vite harness first (same as the other repros); honors the
// same CHROME_PATH, HARNESS_URL, and OUT_DIR overrides.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1920, height: 1080, deviceScaleFactor: 2 };

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-banner-contrast/", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await mkdir(OUT, { recursive: true });

// Color plumbing: the computed styles come back in CSS Color 4 forms
// (oklch()/oklab() — Tailwind v4's palette vars and its oklab color-mix
// output, and the theme's oklch tokens), so every color the contrast math
// reads is converted to sRGB 0-255 + alpha first.
function parseColor(value) {
  let match = /^rgba?\(([^)]+)\)$/u.exec(value);
  if (match !== null) {
    const parts = match[1].split(/[\s,]+/u).filter((part) => part !== "");
    let alpha = 1;
    if (parts.length === 4) alpha = Number(parts[3].replace("%", "")) / (parts[3].includes("%") ? 100 : 1);
    const channel = (c) => (c.endsWith("%") ? (Number(c.slice(0, -1)) / 100) * 255 : Number(c));
    return { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
  }
  match = /^oklab\(([^)]+)\)$/u.exec(value);
  if (match === null) match = /^oklch\(([^)]+)\)$/u.exec(value);
  if (match !== null) {
    const parts = match[1].split(/[\s,]+/u).filter((part) => part !== "");
    let alpha = 1;
    let fields = parts;
    if (parts[parts.length - 1].startsWith("0.") || parts[parts.length - 1] === "1") {
      // The "/0.1" alpha suffix: Chrome may serialize it with the slash
      // attached to the last field or as its own token.
      const joined = match[1];
      const slash = /\/\s*([\d.]+)\s*$/u.exec(joined);
      if (slash !== null) alpha = Number(slash[1]);
      fields = match[1].replace(/\/[^)]*$/u, "").trim().split(/[\s,]+/u);
    }
    const L = Number(fields[0]);
    let a = 0;
    let b = 0;
    if (match[0].startsWith("oklab")) {
      a = Number(fields[1]);
      b = Number(fields[2]);
    } else {
      const radians = (Number(fields[2]) * Math.PI) / 180;
      a = Number(fields[1]) * Math.cos(radians);
      b = Number(fields[1]) * Math.sin(radians);
    }
    // oklab → linear sRGB (Björn Ottosson's matrix).
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.291485548 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    const linear = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0034146787 * l - 0.0425063846 * m + 1.046944824 * s,
    ];
    const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    return {
      r: gamma(Math.min(1, Math.max(0, linear[0]))) * 255,
      g: gamma(Math.min(1, Math.max(0, linear[1]))) * 255,
      b: gamma(Math.min(1, Math.max(0, linear[2]))) * 255,
      a: alpha,
    };
  }
  throw new Error(`unsupported computed color: ${value}`);
}

/** A deterministic busy wallpaper: ~240 layered shapes across the full hue
 *  wheel (an LCG, no Math.random), midtones to lights and darks — the
 *  high-frequency stand-in for the operator's photographic wallpaper. */
function wallpaperSvg() {
  let seed = 0x233233;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const parts = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000">',
    '<rect width="1600" height="1000" fill="#8a7a63"/>',
  ];
  for (let i = 0; i < 240; i++) {
    const hue = Math.floor(rand() * 360);
    const sat = 45 + Math.floor(rand() * 45);
    const light = 15 + Math.floor(rand() * 75);
    const w = 40 + rand() * 240;
    const h = 30 + rand() * 200;
    const x = rand() * 1600;
    const y = rand() * 1000;
    const alpha = (45 + rand() * 45) / 100;
    parts.push(
      `<ellipse cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" rx="${(w / 2).toFixed(0)}" ry="${(h / 2).toFixed(0)}" fill="hsl(${hue} ${sat}% ${light}%)" fill-opacity="${alpha}"/>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}
const WALLPAPER_URL = "data:image/svg+xml," + encodeURIComponent(wallpaperSvg());
const WALLPAPER_STORE = {
  version: 1,
  global: { url: WALLPAPER_URL, darkUrl: WALLPAPER_URL, dim: 0.25 },
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

// ---- The wallpaper -------------------------------------------------------
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-focus-board-panel]", { timeout: 30_000 });
await page.evaluate((layer) => {
  window.localStorage.setItem("focus-board:wallpaper", JSON.stringify(layer));
}, WALLPAPER_STORE);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-focus-board-panel]", { timeout: 30_000 });
await sleep(800);

// The wallpaper must actually paint, or every later reading is void.
const wallpaperPainted = await page.evaluate(() => {
  const root = document.querySelector("[data-focus-board-panel]");
  if (!root) return false;
  return [...root.children].some(
    (child) => child.getAttribute("aria-hidden") === "true"
      && [...child.children].some(
        (layer) => (layer.getAttribute("style") ?? "").includes("background-image:"),
      ),
  );
});
if (!wallpaperPainted) {
  console.error("wallpaper did not paint — the probe's readings would be void");
  await browser.close();
  process.exit(2);
}

// ---- Banners -------------------------------------------------------------
// The whole drag of `fromId` onto `targetId`'s rank slot at `clientY`:
// dragstart on the source anchor, dragover + drop on the target slot, then
// dragend (the gestures tests/board-reparent.test.tsx drives, in a real
// browser with a real DataTransfer).
async function dragOnto(fromId, targetId, yRatio) {
  await page.evaluate(
    ({ fromId, targetId, yRatio }) => {
      const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
      const slot = document.querySelector(`li[data-rank-slot="${targetId}"]`);
      if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
      if (!(slot instanceof HTMLElement)) throw new Error(`missing rank slot ${targetId}`);
      const rect = slot.getBoundingClientRect();
      const y = rect.top + rect.height * yRatio;
      const dt = new DataTransfer();
      const init = (extra) => ({ bubbles: true, cancelable: true, dataTransfer: dt, ...extra });
      anchor.dispatchEvent(new DragEvent("dragstart", init()));
      slot.dispatchEvent(new DragEvent("dragover", init({ clientY: y })));
      slot.dispatchEvent(new DragEvent("drop", init({ clientY: y })));
      anchor.dispatchEvent(new DragEvent("dragend", init()));
    },
    { fromId, targetId, yRatio },
  );
}

function waitBanner(testId) {
  return page.waitForSelector(`[data-testid="${testId}"]`, { timeout: 10_000 });
}

async function dismiss(testId) {
  await page.evaluate((id) => {
    const banner = document.querySelector(`[data-testid="${id}"]`);
    const button = banner?.querySelector("button[aria-label^='Dismiss']");
    if (button instanceof HTMLElement) button.click();
  }, testId);
  await sleep(300);
}

// One measurement: the banner's computed background + text color in the
// CURRENT theme, plus the wallpaper's average painted color read off a canvas
// and the panel's scrim (the --background veil at the wallpaper's dim
// opacity), so the contrast ratio here is the contrast the operator reads.
async function measure(testId, theme) {
  return page.evaluate(async ({ testId, theme }) => {
    const banner = document.querySelector(`[data-testid="${testId}"]`);
    if (!(banner instanceof HTMLElement)) return null;
    const style = getComputedStyle(banner);
    const rect = banner.getBoundingClientRect();
    const panel = document.querySelector("[data-focus-board-panel]");
    const image = panel?.querySelector("[style*='background-image:']");
    const scrim = [...(panel?.children ?? [])].find(
      (child) =>
        child.getAttribute("aria-hidden") === "true" &&
        child.getAttribute("style") !== null &&
        child.getAttribute("style").includes("opacity"),
    );
    const scrimStyle = scrim ? getComputedStyle(scrim) : null;
    const urlMatch = image
      ? /url\("(data:image\/[^"]+)"\)/.exec(image.getAttribute("style") ?? "")
      : null;
    if (!urlMatch) throw new Error("wallpaper image layer not found in the panel");
    if (!scrimStyle) throw new Error("wallpaper scrim layer not found in the panel");
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 250;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.src = urlMatch[1];
    await img.decode();
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const pixels = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return {
      banner: testId,
      theme,
      rect: { top: Math.round(rect.top), left: Math.round(rect.left), w: Math.round(rect.width), h: Math.round(rect.height) },
      backgroundColor: style.backgroundColor,
      color: style.color,
      wallpaperAvg: [r / pixels, g / pixels, b / pixels],
      scrimColor: scrimStyle.backgroundColor,
      scrimAlpha: Number(scrim.style.opacity),
    };
  }, { testId, theme });
}

// WCAG contrast of the banner's text against the background the wallpaper
// composes under it. The panel composites twice: the scrim lays
// scrimColor at dimAlpha over the wallpaper (dimmed background), then the
// banner lays its surface color at its computed alpha over that.
function contrastOf(sample) {
  const bg = parseColor(sample.backgroundColor);
  const fg = parseColor(sample.color);
  const alpha = bg.a;
  const scrim = parseColor(sample.scrimColor);
  const under = sample.wallpaperAvg.map(
    (c, i) => c * (1 - sample.scrimAlpha) + scrim[i === 0 ? "r" : i === 1 ? "g" : "b"] * sample.scrimAlpha,
  );
  const composited = `rgba(${bg.r.toFixed(0)}, ${bg.g.toFixed(0)}, ${bg.b.toFixed(0)}, ${alpha.toFixed(2)}) over rgba(${under.map((c) => c.toFixed(0)).join(", ")}, 1)`;
  const lum = ({ r, g, b }) => {
    const lin = [r, g, b].map((channel) => {
      const c = Math.min(255, Math.max(0, channel)) / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  };
  const bgLum = lum({
    r: bg.r * alpha + under[0] * (1 - alpha),
    g: bg.g * alpha + under[1] * (1 - alpha),
    b: bg.b * alpha + under[2] * (1 - alpha),
  });
  const fgLum = lum(fg);
  const ratio = (Math.max(bgLum, fgLum) + 0.05) / (Math.min(bgLum, fgLum) + 0.05);
  return { alpha, composited, ratio: Math.round(ratio * 100) / 100 };
}

const results = [];
const violations = [];

async function auditBanner(testId, label) {
  for (const theme of ["dark", "light"]) {
    // Tailwind's dark: variant is media-based, so the theme rides both
    // switches the harness itself uses: the `dark` class carries the host
    // token set, prefers-color-scheme emulation carries the plugin's dark:
    // utilities (same pair scripts/uat/run.mjs drives).
    await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
    await page.evaluate((dark) => {
      document.documentElement.classList.toggle("dark", dark);
    }, theme === "dark");
    await sleep(250);
    const sample = await measure(testId, theme);
    if (sample === null) {
      violations.push(`[${label}] banner [data-testid="${testId}"] is not on screen`);
      continue;
    }
    const { alpha, ratio, composited } = contrastOf(sample);
    results.push({ ...sample, alpha, contrast: ratio, composited });
    const clip = `${OUT}${testId}-${theme}.png`;
    const handle = await page.$(`[data-testid="${testId}"]`);
    if (handle) await handle.screenshot({ path: clip });
    if (alpha < 1) {
      violations.push(
        `[${label}] ${theme}: background alpha ${alpha} < 1 — the banner surface is translucent, the wallpaper shows through under the text`,
      );
    }
    if (ratio < 4.5) {
      violations.push(
        `[${label}] ${theme}: text contrast ${ratio} < 4.5 over the wallpaper-composited background (${composited})`,
      );
    }
  }
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
  });
}

await page.screenshot({ path: `${OUT}board-wallpaper-rest.png` });

// Banner 1 — the destructive rank refusal: drop the first pinned card onto
// its own slot's top edge; the drop resolves to no move and refuses loudly.
await dragOnto("thr_ship_release", "thr_ship_release", 0.18);
await waitBanner("rank-error-banner");
await page.screenshot({ path: `${OUT}rank-error-banner-board.png` });
await auditBanner("rank-error-banner", "rank refusal");
await dismiss("rank-error-banner");

// Banner 2 — the amber nest receipt: nest the second pinned card onto the
// first's middle third; the pinned child keeps its own slot, so the receipt
// posts (the invisible-placement contract).
await dragOnto("thr_roadmap", "thr_ship_release", 0.5);
await waitBanner("nest-notice");
await page.screenshot({ path: `${OUT}nest-notice-board.png` });
await auditBanner("nest-notice", "nest receipt");

await writeFile(
  `${OUT}evidence.json`,
  JSON.stringify({ errors, violations, wallpaperPainted, results }, null, 2),
);
console.log(JSON.stringify({ errors, violations, wallpaperPainted, results }, null, 2));
await browser.close();
if (errors.length > 0 || violations.length > 0) {
  console.error(`banner contrast reproduced (${violations.length} violations, ${errors.length} page errors)`);
  process.exit(1);
}
console.log("banners carry opaque, legible surfaces over the wallpaper: clean");
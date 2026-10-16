// Inspect driver (thread thr_pczkebjtyr, "Fix clipped selector"): the
// operator's screenshot shows an expanded family card on a ~330px-wide
// panel and reports "selector still gets clipped". This driver shots the
// family card at several panel widths and dumps the geometry of the
// child-threads section (toggle row, eye toggle, nested rows, last row's
// chips) against the card's box, flagging anything that sits past the
// card's right or bottom edge. Usage: vite harness running, then node this
// file. Honors CHROME_PATH, HARNESS_URL, OUT_DIR.
import { mkdirSync, writeFileSync } from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT_DIR = process.env.OUT_DIR ?? new URL("../../docs/screenshots/repro-clipped-selector/", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  defaultViewport: { width: 1100, height: 900, deviceScaleFactor: 2 },
  args: ["--no-first-run", "--disable-extensions"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

await page.setViewport({ width: 1100, height: 900, deviceScaleFactor: 2 });
await page.goto(`${BASE}?demo=1#/plugins/focus-board/board/t/thr_demo_big_c2`, { waitUntil: "networkidle0" });
await sleep(1500);
await mkdirSync(OUT_DIR, { recursive: true });

// Squeeze the plugin panel itself, like repro-narrow-panel.mjs does.
const squeeze = async (width) => {
  await page.evaluate((width) => {
    let tag = document.getElementById("repro-squeeze");
    if (tag === null) {
      tag = document.createElement("style");
      tag.id = "repro-squeeze";
      document.head.appendChild(tag);
    }
    tag.textContent = `[data-bb-plugin="focus-board"] { width: ${width}px !important; min-width: ${width}px !important; max-width: ${width}px !important; outline: 1px solid red; }`;
    window.dispatchEvent(new Event("resize"));
  }, width);
};

const measure = () =>
  page.evaluate(() => {
    const card = document.querySelector('[data-thread-card="thr_demo_big"]');
    if (card === null) throw new Error("no thr_demo_big card");
    const pick = (root, sel) => {
      const el = root.querySelector(sel);
      if (el === null) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    };
    const cr = card.getBoundingClientRect();
    const out = { card: { x: Math.round(cr.x), y: Math.round(cr.y), w: Math.round(cr.width), h: Math.round(cr.height), right: Math.round(cr.right), bottom: Math.round(cr.bottom) } };
    const section = card.querySelector("[data-child-thread-section]");
    if (section === null) return { ...out, section: null };
    for (const [name, el] of Object.entries({
      section,
      toggle: section.querySelector("[data-child-threads-toggle]"),
      eye: section.querySelector("[data-idle-children-toggle]"),
      nestedRows: section.querySelector("[data-nested-rows]"),
      lastRow: section.querySelector("[data-nested-rows] > ul > li:last-child [data-thread-card]") ?? section.querySelector("[data-nested-rows] > ul > li:last-child a"),
      chips: section.querySelector("[data-nested-rows] [data-ticket-chips]") ?? section.querySelector("[data-nested-rows] [data-ticket-chip]"),
    })) {
      if (el === null) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      out[name] = {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom),
        pastCardRight: r.right > cr.right + 0.5,
        pastCardBottom: r.bottom > cr.bottom + 0.5,
      };
    }
    // Scroll state of the nested rows.
    const nr = out.nestedRows;
    if (nr !== null && nr !== undefined && typeof nr.h === "number") {
      const el = section.querySelector("[data-nested-rows]");
      out.nestedRowsScroll = {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: Math.round(el.scrollTop),
      };
    }
    // Any wider overflow signals inside the card.
    const offenders = [];
    for (const el of card.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > cr.right + 1)) {
        offenders.push({ cls: (el.className ?? "").toString().slice(0, 80), right: Math.round(r.right), pastBy: Math.round(r.right - cr.right) });
      }
    }
    const seen = new Set();
    out.rightOffenders = offenders.filter((o) => (seen.has(o.cls) ? false : (seen.add(o.cls), true))).slice(0, 12);
    return out;
  });

const results = { pageErrors: errors, widths: [] };
for (const width of [900, 560, 420, 331]) {
  await squeeze(width);
  await sleep(500);
  const data = await measure();
  data.panelWidth = width;
  results.widths.push(data);
  const card = await page.$('[data-thread-card="thr_demo_big"]');
  const box = await card.boundingBox();
  if (width === 560) {
    await page.screenshot({ path: `${OUT_DIR}full-w${width}.png` });
  }
  await page.screenshot({
    path: `${OUT_DIR}card-w${width}.png`,
    clip: {
      x: Math.max(0, box.x - 6),
      y: Math.max(0, box.y - 6),
      width: Math.min(1100, box.width + 12),
      height: Math.min(900, box.height + 12),
    },
  });
}

// The rest-slice probe: wheel the capped rows list a few px down and read
// where the scroll rests. Without whole-row snapping the rest lands mid-row
// (the operator's sliced first child at the cap's edge); with it, the rest
// must settle back on a row boundary. jsdom cannot answer this, so this is
// the real-geometry verification.
const restProbe = await page.evaluate(async () => {
  const el = document.querySelector('[data-thread-card="thr_demo_big"] [data-nested-rows]');
  if (!(el instanceof HTMLElement)) throw new Error("missing nested rows container");
  const firstRow = el.querySelector(":scope > ul > li");
  if (!(firstRow instanceof HTMLElement)) throw new Error("missing first row");
  const rowH = firstRow.getBoundingClientRect().height + 4; // rows + gap-1
  const scrollBefore = el.scrollTop;
  // A small wheel tick, the trackpad-sized gesture that stopped the
  // operator's list mid-row.
  el.dispatchEvent(
    new WheelEvent("wheel", { deltaY: 9, bubbles: true, cancelable: true }),
  );
  el.scrollTop = scrollBefore + 9;
  await new Promise((r) => setTimeout(r, 450));
  return {
    rowHeight: Math.round(rowH),
    scrollTopAt9: Math.round(el.scrollTop),
    slicedTop: el.scrollTop % rowH > 1,
  };
});
results.restProbe = restProbe;

writeFileSync(`${OUT_DIR}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify({ restProbe }, null, 1));
const bad = results.widths.some((w) => Object.values(w).some((v) => v && typeof v === "object" && v.pastCardRight));
console.log(bad ? "OFFENDER FOUND" : "no right-edge offender");
const restOk = restProbe.slicedTop === false && restProbe.scrollTopAt9 % 1 === 0 && restProbe.scrollTopAt9 < 5;
console.log(restOk ? "REST ALIGNED" : "REST SLICED");
// The whole probe's verdict: every geometry must sit inside the card and
// the rest must land snapped on a row boundary.
process.exitCode = restOk && !bad ? 0 : 1;
await browser.close();
process.exit(process.exitCode);
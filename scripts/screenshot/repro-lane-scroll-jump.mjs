// Repro: parent-lane board vertical scroll yank.
// With a card selected (pane open, its lane locked), an attention re-sort
// (a hovered card sorts first in its row — sortActiveRow) changes the
// lane assembly; the [activeThreadId, activeLaneId, flat] effect re-locks
// (lockTo same-lane path) and runCorrections() re-asserts the vertical
// scroll to keep the SELECTED card in view — yanking the operator's
// vertical scroll back every time a card sorts/moves above it.
//
// Run: npx vite --config scripts/screenshot/vite.config.ts --port 5199
// then: node scripts/screenshot/repro-lane-scroll-jump.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync, writeFileSync } from "node:fs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = new URL("../../docs/screenshots/repro-lane-scroll-jump/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 800 },
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`[console.error] ${msg.text().slice(0, 300)}`);
});

await page.goto(`${BASE}?groupBy=parent`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-parent-board]", { timeout: 30_000 });
await sleep(2500);

// Instrument: log every scrollTop/scrollLeft write on the parent board.
await page.evaluate(() => {
  const board = document.querySelector("[data-parent-board]");
  const log = (window.__scrollWrites = []);
  const wrap = (el, prop) => {
    const desc =
      Object.getOwnPropertyDescriptor(el, prop) ??
      Object.getOwnPropertyDescriptor(Element.prototype, prop);
    Object.defineProperty(el, prop, {
      configurable: true,
      set(value) {
        log.push({
          t: Math.round(performance.now()),
          prop,
          value: Math.round(value),
          site: (new Error().stack ?? "")
            .split("\n")
            .slice(2, 6)
            .map((line) => line.replace(/\?.*$/, "").replace(/^\s*at /, "").trim())
            .join(" <- "),
        });
        desc.set.call(el, value);
      },
      get() {
        return desc.get.call(el);
      },
    });
  };
  wrap(board, "scrollTop");
  wrap(board, "scrollLeft");
  // Ambient position samples without writes.
  setInterval(() => {
    (window.__scrollSamples ??= []).push({
      t: Math.round(performance.now()),
      scrollTop: Math.round(board.scrollTop),
    });
  }, 150);
});
const shot = (name) => page.screenshot({ path: `${OUT}${name}.png` });
const scrollTop = () =>
  page.evaluate(() => Math.round(document.querySelector("[data-parent-board]").scrollTop));
const cards = () =>
  page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll("[data-thread-card]")) {
      const r = card.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.left < 0 || r.right > innerWidth) continue;
      const cy = Math.max(10, Math.min((Math.max(r.top, 0) + Math.min(r.bottom, innerHeight)) / 2, innerHeight - 40));
      const cx = r.left + r.width / 2;
      const hit = document.elementFromPoint(cx, cy);
      out.push({
        x: Math.round(cx),
        y: Math.round(cy),
        id: card.getAttribute("data-thread-card"),
        hitIsCard: hit?.closest?.("[data-thread-card]")?.getAttribute("data-thread-card") ?? null,
        r: { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left) },
      });
    }
    return out;
  });

// S1: click the big family's top card -> pane opens, the lane unfolds
// (all nine children render as rows); then click the DEEPEST child (c0):
// keep-in-view scrolls the board down to bring it into view.
const target = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("section[data-lane-id]")];
  const last = sections[sections.length - 1];
  return last.querySelector("[data-thread-card]")?.getAttribute("data-thread-card") ?? null;
});
if (target === null) throw new Error("no card in the last parent lane");
let el = await page.$(`[data-thread-card="${target}"]`);
let box = await el.boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await sleep(1200);
console.log("== S1a selected", target, "scrollTop", await scrollTop());
await shot("s1a-selected-pane-open");

// S1b: wheel down so the deepest child (bottom row) is fully visible,
// then click it: it becomes the active card.
const deepTarget = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("section[data-lane-id]")];
  const last = sections[sections.length - 1];
  const ids = [...last.querySelectorAll("[data-thread-card]")].map((c) => c.getAttribute("data-thread-card"));
  return ids[ids.length - 1] ?? null;
});
if (deepTarget !== null && deepTarget !== target) {
  // find its y in the CURRENT viewport; wheel if needed
  const p = await page.evaluate((id) => {
    const card = document.querySelector(`[data-thread-card="${id}"]`);
    const r = card?.getBoundingClientRect();
    return r ? { top: r.top, bottom: r.bottom, h: r.height } : null;
  }, deepTarget);
  if (p !== null) {
    if (p.bottom > 760) {
      const scrollDown = Math.ceil(p.bottom - 700);
      await page.mouse.move(516, 300);
      await page.mouse.wheel({ deltaY: scrollDown });
      await sleep(600);
    }
    const q = await page.evaluate((id) => {
      const r = document.querySelector(`[data-thread-card="${id}"]`).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, deepTarget);
    if (q.y > 0 && q.y < 780) {
      await page.mouse.click(q.x, q.y);
      await sleep(1200);
      console.log("== S1b selected", deepTarget, "scrollTop", await scrollTop());
      await shot("s1b-deep-card-selected");
    } else {
      console.log("== S1b skipped:", deepTarget, "at", JSON.stringify(q));
    }
  }
}
const activeTarget = deepTarget ?? target;

// S2: the operator wheels the board vertically UP toward the cards above
// the selected one — past the point where the selected card slips back
// behind the bottom fold.
const before2 = await scrollTop();
await page.mouse.move(516, 300);
await page.mouse.wheel({ deltaY: -(Math.max(0, before2 - 60)) }); // scroll up to ~60
await sleep(600);
const after2 = await scrollTop();
console.log(`== S2 operator wheeled up: ${before2} -> ${after2}`);
await shot("s2-scrolled-away");

// S3: hover a card that is NOW visible -> hover attention capture re-sorts
// (the hovered card's capture feeds laneFreezes; flat identity changes;
// the refire effect re-locks and runCorrections yanks the scroll back).
const hoverTargets = (await cards()).filter(
  (c) => c.hitIsCard === c.id && c.id !== activeTarget && c.id !== target,
);
console.log("hover candidates:", JSON.stringify(hoverTargets));
let hoverDone = false;
if (hoverTargets.length > 0) {
  await page.mouse.move(hoverTargets[0].x, hoverTargets[0].y);
  hoverDone = true;
  await sleep(1500);
  console.log("== S3 hovered", hoverTargets[0].id, "scrollTop", await scrollTop());
}
await shot(hoverDone ? "s3-after-hover-yank" : "s3-no-hover-target");

// S4: one more hover to a different visible card — is the fight ongoing?
const hoverTargets2 = (await cards()).filter((c) => c.hoverDone !== true);
if (hoverTargets2.length > 0) {
  await page.mouse.move(hoverTargets2[0].x, hoverTargets2[0].y);
  await sleep(1500);
  console.log("== S4 second hover scrollTop", await scrollTop());
  await page.mouse.wheel({ deltaY: 400 }); // try to scroll away again
  await sleep(800);
  const afterWheel = await scrollTop();
  console.log("== S4 wheeled down again -> scrollTop", afterWheel);
  await page.mouse.wheel({ deltaY: 400 }); // and once more
  await sleep(800);
  console.log("== S4 wheeled again -> scrollTop", await scrollTop());
  await shot("s4-settled");
}

const writes = await page.evaluate(() => window.__scrollWrites);
const samples = await page.evaluate(() => window.__scrollSamples);
writeFileSync(`${OUT}evidence.json`, JSON.stringify({ target, writes, samples }, null, 1));
console.log("== programmatic scroll writes ==");
for (const w of writes) console.log(`t=${w.t} ${w.prop} -> ${w.value}  at ${w.site}`);
console.log("== scrollTop samples ==", samples.map((s) => s.scrollTop).join(", "));

await browser.close();
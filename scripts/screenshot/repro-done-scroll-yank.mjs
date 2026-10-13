// Headless repro for the post-done scroll-yank bug (issue #119), post-fix
// verification: open a pane on an Unread card, mark it done via the on-card
// checkbox, close the pane by clicking the board area, scroll the board back
// to 0, then force board re-renders (wheels + hover, the way a live-thread
// refresh feeds them) — the board must rest where the operator left it
// (scrollLeft stays 0). Exits non-zero if the Done column yanks the board
// back, so it is usable as a CI-able regression driver.
//
// Instruments the board container's scrollLeft setter, recording a stack for
// every programmatic write, plus a scroll-event timeline.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1280, height: 800, deviceScaleFactor: 2 };
const CHROME =
  process.env.CHROME_PATH ??
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT =
  process.env.OUT_DIR ??
  new URL("../../docs/screenshots/repro-done-scroll-yank/", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
await page.setViewport(VIEW);
page.on("console", (m) => {
  const t = m.text();
  if (t.includes("scrollLeft") || t.includes("yank")) console.log("[console]", t);
});
await page.goto(`${BASE}?groupBy=status`, {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await page.waitForSelector("[data-columns-board]", { timeout: 30_000 });
await sleep(600);

// Instrument: record every scrollLeft write (with stack) and every scroll
// event on the board container; expose a sampler.
const instrument = await page.evaluate(() => {
  const el = document.querySelector("[data-columns-board]");
  const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
  window.__log = [];
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    get() {
      return desc.get.call(this);
    },
    set(v) {
      window.__log.push({
        t: performance.now(),
        kind: "write",
        value: v,
        stack: new Error().stack.split("\n").slice(1, 8).join(" | "),
      });
      desc.set.call(this, v);
    },
  });
  el.addEventListener("scroll", () => {
    window.__log.push({
      t: performance.now(),
      kind: "event",
      value: el.scrollLeft,
    });
  });
  return {
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollLeft: desc.get.call(el),
  };
});
console.log("container geo:", JSON.stringify(instrument));

const sample = () =>
  page.evaluate(() => {
    const el = document.querySelector("[data-columns-board]");
    const done = document.querySelector('[data-thread-card="thr_uat_queue"]');
    const pane = document.querySelector('aside[aria-label^="Thread:"]');
    return {
      scrollLeft: el.scrollLeft,
      pane: pane !== null,
      doneCardRect: done
        ? (({ left, right, top, bottom }) => ({ left, right, top, bottom }))(
            done.getBoundingClientRect(),
          )
        : null,
      doneCardVisible:
        done !== null &&
        done.getBoundingClientRect().left < el.getBoundingClientRect().right - 40 &&
        done.getBoundingClientRect().right > el.getBoundingClientRect().left + 40,
      hash: location.hash,
    };
  });

console.log("initial:", JSON.stringify(await sample()));

// 1. Open the pane on the Unread card.
const cardLink = await page.$('a[href*="thr_uat_queue"]');
if (!cardLink) throw new Error("thr_uat_queue card anchor not found");
await cardLink.click();
await page.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 10_000 });
await sleep(700);
console.log("pane open:", JSON.stringify(await sample()));
await page.screenshot({ path: `${OUT}01-pane-open.png` });

// 2. Mark done via the on-card two-click checkbox.
for (const want of ["Arm Mark Done", "Mark Done"]) {
  await page.waitForSelector('[data-thread-card="thr_uat_queue"] [data-done-checkbox]', {
    timeout: 5_000,
  });
  const label = await page.evaluate((want) => {
    const b = document.querySelector('[data-thread-card="thr_uat_queue"] [data-done-checkbox]');
    if (!b) throw new Error("done checkbox missing");
    if (b.getAttribute("aria-label") !== want) return null;
    b.click();
    return b.getAttribute("aria-label");
  }, want);
  if (label === null) throw new Error(`expected checkbox aria-label "${want}"`);
  console.log("checkbox click:", label);
  await sleep(250);
}
await sleep(900);
console.log("after done:", JSON.stringify(await sample()));
await page.screenshot({ path: `${OUT}02-after-done.png` });

// 3. Close the pane by clicking empty board area (bottom padding band of the
// scroll container — not a card or control).
const clickPt = await page.evaluate(() => {
  const el = document.querySelector("[data-columns-board]");
  const r = el.getBoundingClientRect();
  return { x: r.left + 160, y: r.bottom - 6 };
});
await page.mouse.click(clickPt.x, clickPt.y);
await sleep(700);
const afterClose = await sample();
console.log("after close:", JSON.stringify(afterClose));
await page.screenshot({ path: `${OUT}03-after-close.png` });

// 4. The operator scrolls back left: repeated leftward wheels, then a hard
// jump to 0, sampling between each re-render the wheels/hover produce.
const timeline = [];
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => {
    const el = document.querySelector("[data-columns-board]");
    const r = el.getBoundingClientRect();
    el.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: -240,
        deltaY: 0,
        bubbles: true,
        cancelable: true,
        clientX: r.left + r.width / 2,
        clientY: r.top + r.height / 2,
      }),
    );
  });
  await sleep(200);
  timeline.push({ phase: "wheel-left", i, ...(await sample()) });
}
await page.evaluate(() => {
  const el = document.querySelector("[data-columns-board]");
  el.scrollLeft = 0;
});
await sleep(250);
timeline.push({ phase: "hard-jump-0", ...(await sample()) });
await page.screenshot({ path: `${OUT}04-after-scroll-away.png` });

// 5. Post-fix stability gate: force board re-renders (a hover, which feeds
// the assembly memo the way a live-thread refresh does) and assert the board
// rests at scrollLeft 0 — the consumed reveal must never re-scroll. Any
// write from the reveal path on these commits is a #119 regression.
const hoverTarget = await page.$('[data-thread-card="thr_rpc_auth"]');
if (hoverTarget) {
  const box = await hoverTarget.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 40, box.y + 20);
    for (let i = 0; i < 10; i++) {
      await sleep(200);
      timeline.push({ phase: "post-hover", i, ...(await sample()) });
    }
  }
} else {
  timeline.push({ phase: "post-hover", note: "thr_rpc_auth card not found" });
}
await page.screenshot({ path: `${OUT}05-after-refresh.png` });

const log = await page.evaluate(() => window.__log);
const writes = log.filter((e) => e.kind === "write");
const hoverSamples = timeline.filter((t) => t.phase === "post-hover");
const yanked = hoverSamples.some((t) => t.scrollLeft !== 0);
const verdict = yanked
  ? "YANK: board moved back to the Done column after reveal was consumed"
  : "REST: board rests at scrollLeft 0 through hover/refresh re-renders";
const evidence = { issue: 119, instrument, afterClose, timeline, verdict, writesCount: writes.length };
if (yanked) {
  evidence.writes = writes;
}
await writeFile(`${OUT}evidence.json`, JSON.stringify(evidence, null, 2));

console.log("\n=== scrollLeft timeline ===");
for (const t of timeline) {
  console.log(
    `${t.phase.padEnd(13)} #${t.i ?? "-"}  scrollLeft=${String(t.scrollLeft).padStart(6)}  pane=${t.pane}  doneVisible=${t.doneCardVisible}`,
  );
}
console.log("\n=== programmatic scrollLeft writes ===");
console.log("total writes:", writes.length);
console.log("\n=== verdict ===");
console.log(verdict);
await browser.close();
if (yanked) process.exit(1);
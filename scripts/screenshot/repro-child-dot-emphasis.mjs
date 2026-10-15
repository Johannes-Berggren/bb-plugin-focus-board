// One-off check for the dot emphasis: the active child's dot holds the
// selected emphasis (accent background + active ring) and the hovered dot
// lights the accent halo with its bubble wide open. Leaves a screenshot.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 900, deviceScaleFactor: 2 });
await p.goto(
  "http://localhost:5223/?demo=1&collapsed=thr_demo_needs#/plugins/focus-board/board/t/thr_demo_needs_c0",
  { waitUntil: "networkidle0" },
);
await new Promise((r) => setTimeout(r, 1200));

const active = await p.evaluate(() => {
  const btn = document.querySelector("[data-child-dot-active]");
  if (!btn) return null;
  const s = getComputedStyle(btn);
  return { bg: s.backgroundColor, boxShadow: s.boxShadow.slice(0, 40) };
});

// Hover the SECOND dot so the active (first) and hovered (second) both show.
const dotHandles = await p.$$("[data-child-thread-dots] [data-child-dot]");
await dotHandles[1].hover();
await new Promise((r) => setTimeout(r, 300));
const hovered = await p.evaluate(() => {
  const btns = [...document.querySelectorAll("[data-child-thread-dots] [data-child-dot]")];
  const s = getComputedStyle(btns[1]);
  const bubble = btns[1].querySelector("[data-child-dot-preview]");
  const br = bubble.getBoundingClientRect();
  return { hoverBg: s.backgroundColor, bubbleVisible: br.width > 200, bubbleWidth: Math.round(br.width) };
});

mkdirSync("docs/screenshots/repro-child-dot-alignment", { recursive: true });
const box = await p.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_needs"]');
  const r = card.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: Math.min(r.height, 420) };
});
await p.screenshot({
  path: "docs/screenshots/repro-child-dot-alignment/child-dot-hover-and-active.png",
  clip: { x: box.x, y: box.y, width: Math.min(1200, box.w), height: box.h },
});
console.log(JSON.stringify({ active, hovered }, null, 1));
await b.close();
// One-off check for the dot emphasis (issue #174's hover/selection follow-up):
// the active child's dot holds the selected emphasis (accent background plus
// the active ring) and the hovered dot lights the AMBER halo with its
// content-sized preview open (a body-level portal). Leaves a screenshot.
// Usage: vite harness first, then node scripts/screenshot/repro-child-dot-emphasis.mjs
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const b = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--no-first-run", "--disable-extensions"],
});
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 700, deviceScaleFactor: 2 });
// Deep-link the family's child: its pane opens, so the collapsed family's
// first dot reads selected while the strip stays folded.
await p.goto(
  (process.env.HARNESS_URL ?? "http://localhost:5173/") +
    "?demo=1&collapsed=thr_demo_needs#/plugins/focus-board/board/t/thr_demo_needs_c0",
  { waitUntil: "networkidle0" },
);
await new Promise((r) => setTimeout(r, 1200));

const active = await p.evaluate(() => {
  const btn = document.querySelector("[data-child-dot-active]");
  if (!btn) return null;
  const s = getComputedStyle(btn);
  return { bg: s.backgroundColor, boxShadow: s.boxShadow.slice(0, 40) };
});

// Hover the SECOND dot: active (first) and hovered (second) show together.
const dotHandles = await p.$$("[data-child-thread-dots] [data-child-dot]");
await dotHandles[1].hover();
await new Promise((r) => setTimeout(r, 300));
const hovered = await p.evaluate(() => {
  const btns = [...document.querySelectorAll("[data-child-thread-dots] [data-child-dot]")];
  const s = getComputedStyle(btns[1]);
  return { hoverBg: s.backgroundColor };
});

mkdirSync("docs/screenshots/repro-child-dot-alignment", { recursive: true });
const box = await p.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_needs"]');
  const r = card.getBoundingClientRect();
  return { x: r.x, y: Math.max(0, r.y - 30), w: Math.min(r.width, window.innerWidth), h: Math.min(r.height + 30, 700) };
});
await p.screenshot({
  path: "docs/screenshots/repro-child-dot-alignment/child-dot-hover-and-active.png",
  clip: { x: Math.max(0, box.x), y: box.y, width: Math.min(box.w, 1200), height: box.h },
});
console.log(JSON.stringify({ active, hovered }, null, 1));
await b.close();
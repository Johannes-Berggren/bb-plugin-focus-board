// Headless repro for issue #171: a ticket chip's link renders inside the
// card's own link. The card's content anchor (
// components/thread-card.tsx <a href={thread.href}>) wraps the chip rows, and
// ProviderTicketChip renders its mark as an <a data-ticket-chip-mark> (and
// each id as an <a data-ticket-id>) whenever the href exists, so HTML forbids
// the nesting and React logs "In HTML, <a> cannot be a descendant of <a>." on
// every render of an affected card.
//
// Usage: start `npx vite --config scripts/screenshot/vite.config.ts --port
// 5181 --strictPort`, then `node scripts/screenshot/repro-chip-anchor-nesting.mjs`.
// Writes evidence to docs/screenshots/repro-chip-anchor-nesting/ (screenshot
// + JSON with the console trace and the DOM ancestry of one nested anchor).
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const DESKTOP = { width: 1280, height: 800 };
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5181/";
const OUT = new URL("../../docs/screenshots/repro-chip-anchor-nesting/", import.meta.url)
  .pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: DESKTOP,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
await page.setViewport(DESKTOP);

const consoleTrace = [];
page.on("console", (msg) => {
  const text = msg.text();
  if (msg.type() === "error" || msg.type() === "warning" || text.includes("descendant")) {
    consoleTrace.push({ type: msg.type(), text });
  }
});
page.on("pageerror", (err) => {
  consoleTrace.push({ type: "pageerror", text: String(err) });
});

await page.goto(`${BASE}?demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
// Let React settle so a first-render nesting error (if any) is on record.
await new Promise((r) => setTimeout(r, 800));

const evidence = await page.evaluate(() => {
  const cards = Array.from(document.querySelectorAll("[data-thread-card]"));
  const chips = document.querySelectorAll("[data-ticket-chip]").length;
  const chipMarks = document.querySelectorAll("[data-ticket-chip-mark]").length;
  const chipIds = document.querySelectorAll("[data-ticket-id]").length;
  const findings = [];
  for (const card of cards) {
    const anchors = Array.from(card.querySelectorAll("a"));
    for (const anchor of anchors) {
      const outer = anchor.parentElement?.closest("a");
      if (outer === null) continue;
      findings.push({
        card: card.getAttribute("data-thread-card"),
        outerHref: outer.getAttribute("href"),
        innerHref: anchor.getAttribute("href"),
        innerMark: anchor.hasAttribute("data-ticket-chip-mark"),
        innerId: anchor.getAttribute("data-ticket-id"),
      });
    }
  }
  return { cards: cards.length, chips, chipMarks, chipIds, findings };
});

await mkdir(OUT, { recursive: true });
await page.screenshot({ path: `${OUT}board.png` });

// Force a re-render (open the What's-new-free board again via reload) to show
// the error repeats on re-render, not just once.
await page.reload({ waitUntil: "domcontentloaded" });
await new Promise((r) => setTimeout(r, 800));

const record = {
  issue: "cristoslc/bb-plugin-focus-board#171",
  url: BASE,
  domEvidence: evidence,
  nestedAnchorConsoleErrors: consoleTrace.filter((line) =>
    line.text.includes("descendant"),
  ),
  consoleTraceCount: consoleTrace.length,
  consoleTraceAfterReload: consoleTrace,
};
await writeFile(`${OUT}evidence.json`, `${JSON.stringify(record, null, 2)}\n`);

await browser.close();
console.log(JSON.stringify(record, null, 2));
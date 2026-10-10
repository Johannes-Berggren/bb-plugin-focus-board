// Extended repro for the view-switch Pinned bug. Scenarios per run:
//   A: fresh Attention -> Parent -> Attention (pane closed)
//   B: fresh Parent, open pane, -> Attention (pane open)
//   C: fresh Parent, PIN a card via its card menu, -> Attention (pane closed)
//   D: fresh Parent, PIN a card, open pane, -> Attention
// Each snapshot lists columns (id + ordered card ids) and the parent board's
// lane order, plus every button/menu interaction used, so evidence is complete.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const VIEW = { width: 1600, height: 1000, deviceScaleFactor: 2 };

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const OUT = new URL("../../docs/screenshots/repro-pinned-viewswitch/", import.meta.url).pathname;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: VIEW,
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

// Snapshot which cards carry the pin icon, plus the column layout.
async function pinStateSnapshot(label) {
  await sleep(300);
  return page.evaluate((label) => ({
    label,
    pinnedIds: [...document.querySelectorAll("[data-thread-card]")].filter(
      (card) => card.querySelector('[data-icon="Pin"]') !== null,
    ).map((card) => card.getAttribute("data-thread-card")),
  }), label);
}

async function boardState(label) {
  await sleep(600);
  return page.evaluate((label) => {
    const columns = [...document.querySelectorAll("[data-column-id]")].map((col) => ({
      id: col.getAttribute("data-column-id"),
      cards: [...col.querySelectorAll("[data-thread-card]")].map(
        (card) => card.getAttribute("data-thread-card"),
      ),
    }));
    const lanes = [...document.querySelectorAll("[data-lane-header]")].map((el) =>
      el.getAttribute("data-lane-header") ?? el.textContent?.trim(),
    );
    return { label, kind: lanes.length > 0 ? "parent-lane-board" : "column-board", columns, lanes };
  }, label);
}

async function switchView(optionLabel) {
  await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="View"]');
    if (!btn) throw new Error("View button not found");
    btn.click();
  });
  await sleep(300);
  await page.evaluate((label) => {
    const options = [...document.querySelectorAll('[role="option"]')];
    const match = options.find((o) => o.textContent?.trim() === label);
    if (!match) throw new Error(`option ${label} not found: ${options.map((o) => o.textContent?.trim()).join(", ")}`);
    match.click();
  }, optionLabel);
  await sleep(500);
}

// Pin a card in the parent view via its right-click card menu (contextmenu → Pin).
async function pinCardInParent(selector) {
  const attempt = await page.evaluate((sel) => {
    const card = sel === undefined
      ? [...document.querySelectorAll("[data-thread-card]")][0]
      : document.querySelector(sel);
    if (!card) return { ok: false, why: "no cards" };
    const id = card.getAttribute("data-thread-card");
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    return { ok: true, id };
  }, selector);
  await sleep(300);
  if (!attempt.ok) return attempt;
  const clicked = await page.evaluate((threadId) => {
    const menus = [...document.querySelectorAll('[role="menu"]')].filter(
      (menu) => (menu.getAttribute("aria-label") ?? "") === "Thread actions",
    );
    const menu = menus[0];
    if (!menu) return { ok: false, why: "menu did not open" };
    // Scope to the menu owned by the right-clicked card: the menu body
    // prints its title; match by position instead (single menu is fine).
    void threadId;
    const items = [...menu.querySelectorAll('[role="menuitem"]')];
    const pin = items.find((item) => (/^(Pin|Unpin)$/.test((item.textContent ?? "").trim())));
    if (!pin) return { ok: false, why: `no Pin item (${items.map((i) => i.textContent?.trim()).slice(0, 12).join(", ")})` };
    pin.click();
    return { ok: true, item: pin.textContent?.trim() };
  }, attempt.id);
  await sleep(400);
  return { attempt, clicked };
}

const results = [];

// Run A: pane closed round-trip.
await page.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-column-id]", { timeout: 30_000 });
results.push(await boardState("A1 fresh attention"));
await switchView("Parent thread");
results.push(await boardState("A2 parent"));
await switchView("Attention");
results.push(await boardState("A3 attention after round-trip"));

// Run B: pane open in parent, then switch.
await page.goto(`${BASE}?groupBy=parent&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
results.push(await boardState("B1 fresh parent"));
await page.evaluate(() => {
  const el = document.querySelector("[data-thread-card] a, a[href*='/threads/']");
  if (el) el.click();
});
await page.waitForSelector('aside[aria-label^="Thread:"]', { timeout: 10_000 });
results.push(await boardState("B2 parent, pane open"));
await switchView("Attention");
results.push(await boardState("B3 attention with pane open"));

// Run C: pin a card in the parent view, snapshot, then switch.
await page.goto(`${BASE}?groupBy=parent&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
const pinC = await pinCardInParent();
results.push({ label: "C1 pin attempt in parent", pinC });
results.push(await pinStateSnapshot("C2 parent view right after menu Pin"));
const pinLogAfterPin = await page.evaluate(() => globalThis.__pinLog ?? []);
await switchView("Attention");
const pinLogAfterSwitch = await page.evaluate(() => globalThis.__pinLog ?? []);
const parkLog = await page.evaluate(() => globalThis.__parkLog ?? null);
results.push(await boardState("C3 attention after pinning in parent"));
results.push(await pinStateSnapshot("C4 attention snapshot"));
results.push({ label: "C5 pin log after pin", pinLogAfterPin, pinLogAfterSwitch, parkLog });

// Run D (control): pin a card in the ATTENTION view, stay, snapshot.
await page.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
const pinD = await pinCardInParent('[data-thread-card="thr_flaky_ci"]');
results.push({ label: "D1 pin attempt in attention", pinD });
results.push(await pinStateSnapshot("D2 attention right after menu Pin"));
results.push(await boardState("D3 attention columns after pin"));
await switchView("Parent thread");
await switchView("Attention");
results.push(await boardState("D4 attention columns after round-trip"));

// Screenshot + dump.
await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}evidence.json`, JSON.stringify({ errors, results }, null, 2));
await page.screenshot({ path: `${OUT}final-board.png`, fullPage: false });
console.log(JSON.stringify({ errors, results }, null, 2));
await browser.close();
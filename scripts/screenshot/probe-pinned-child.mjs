// Focused probe: pin a child card in the Parent view, switch to Attention,
// then dump the pinned child's card DOM and where it rendered.
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));

await page.goto(`${BASE}?groupBy=parent&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });

// Right-click the child card, Pin it.
const attempt = await page.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_work_c0"]');
  if (!card) return { ok: false, why: "card not found" };
  card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  return { ok: true };
});
console.log("right-click:", attempt);
await sleep(300);
const clicked = await page.evaluate(() => {
  const menu = [...document.querySelectorAll('[role="menu"][aria-label="Thread actions"]')][0];
  if (!menu) return { ok: false, why: "menu missing" };
  const pin = [...menu.querySelectorAll('[role="menuitem"]')].find((item) =>
    /^(Pin|Unpin)$/.test((item.textContent ?? "").trim()),
  );
  if (!pin) return { ok: false, why: "no pin item" };
  pin.click();
  return { ok: true, item: pin.textContent?.trim() };
});
console.log("menu click:", clicked);
await sleep(400);

const inParent = await page.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_work_c0"]');
  return { pinIcon: card?.querySelector('[data-icon="Pin"]') !== null, outside: card?.closest("[data-columns-board]") === null };
});
console.log("in parent view:", inParent);

// Switch to Attention.
await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="View"]');
  if (!btn) throw new Error("View button missing");
  btn.click();
});
await sleep(300);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === "Attention");
  if (!opt) throw new Error("Attention option missing");
  opt.click();
});
await sleep(600);

const inAttention = await page.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_work_c0"]');
  const column = card?.closest("[data-column-id]");
  const menuOpenProbe = card === null;
  return {
    cardPresent: card !== null,
    pinIcon: card !== null && card.querySelector('[data-icon="Pin"]') !== null,
    columnId: column === null ? null : column.getAttribute("data-column-id"),
  };
});
console.log("in attention view:", inAttention);

// Also re-open the card menu there: does the app's data still think pinned?
await page.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_work_c0"]');
  if (card !== null) card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
});
await sleep(300);
const menuInAttention = await page.evaluate(() => {
  const menus = [...document.querySelectorAll('[role="menu"][aria-label="Thread actions"]')];
  for (const menu of menus) {
    const items = [...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim());
    const pin = items.find((text) => /^(Pin|Unpin)$/.test(text ?? ""));
    if (pin !== undefined) return { PinOrUnpin: pin, items: items.slice(0, 14) };
  }
  return { why: "no menu", menus: menus.length };
});
console.log("menu in attention view:", JSON.stringify(menuInAttention));
await browser.close();
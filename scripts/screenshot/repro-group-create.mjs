/**
 * Group create & assign probe: right-clicks a card, opens Group…, types a
 * NEW group name, clicks Create & assign, and reports what the board shows
 * afterward — reproducing the operator's "no new group created, card not
 * assigned" report headlessly.
 *
 * Run once vite is up: `npx vite --config scripts/screenshot/vite.config.ts`
 * then `node scripts/screenshot/repro-group-create.mjs`.
 */
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = new URL("../../docs/screenshots/", import.meta.url).pathname;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const page = await browser.newPage();
page.on("console", (msg) => {
  const text = msg.text();
  if (/error|warn/i.test(msg.type()) || /rpc|group/i.test(text)) console.log(`[page:${msg.type()}] ${text}`);
});
page.on("pageerror", (err) => console.log(`[pageerror] ${err}`));

await page.goto(`${BASE}?demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
await sleep(800);

// Pick a card NOT already grouped (one outside the default box).
const cardId = await page.evaluate(() => {
  const cards = [...document.querySelectorAll("[data-thread-card]")].map((el) => ({
    id: el.getAttribute("data-thread-card"),
    boxed: el.closest("[data-group-box]") !== null,
  }));
  const free = cards.find((c) => !c.boxed);
  return { free: free?.id ?? null, cards };
});
console.log("cards:", JSON.stringify(cardId));

const target = cardId.cards.find((c) => !c.boxed)?.id;
if (!target) throw new Error("no ungrouped card found");

const card = await page.waitForSelector(`[data-thread-card="${target}"]`, { timeout: 10_000 });
await card.click({ button: "right" });
await sleep(400);

// The card's context menu: click the Group… entry.
const menuEntry = await page.evaluateHandle((label) => {
  const entries = [...document.querySelectorAll('[role="menuitem"], [data-menu-entry]')];
  return entries.find((el) => el.textContent.trim().startsWith(label));
}, "Group");
console.log("menu entry found:", Boolean(menuEntry));
await menuEntry.asElement()?.click();
await sleep(400);

await page.waitForSelector("[data-group-dialog]", { timeout: 10_000 });
await page.$eval("[data-group-dialog]", () => {});

const nameInput = await page.waitForSelector('[data-group-name-input=""]', { timeout: 5_000 });
await nameInput.type("Probe Group");
await sleep(200);
await (await page.waitForSelector('[data-group-create=""]', { timeout: 5_000 })).click();
console.log("clicked Create & assign");
await sleep(1500);

await page.screenshot({ path: `${OUT}repro-group-create-after.png`, timeout: 15_000 });

// Observe: is the card now inside a group box? Does the registry know the group?
const observed = await page.evaluate((threadId) => {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  return {
    cardInGroupBox: card?.closest("[data-group-box]") !== null,
    groupBoxCount: document.querySelectorAll("[data-group-box]").length,
    groupCalls: (globalThis.__uat?.calls?.() ?? [])
      .filter((call) => String(call.method).startsWith("group"))
      .map((call) => ({ method: call.method, args: call.args })),
  };
}, target);
console.log("after:", JSON.stringify(observed, null, 2));

await browser.close();
console.log("done");
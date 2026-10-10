/**
 * Headless verification for the settings-modal change against the real app
 * mounted in the screenshot harness (mock SDK). Asserts the gear/gift
 * double-duty icon in both states, deep-linking, the modal's tabs, and the
 * Behavior write path.
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5181/";
const OUT = new URL("./shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const fail = (message) => {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
};
const ok = (name) => console.log(`PASS: ${name}`);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
});

async function open(query) {
  const page = await browser.newPage();
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("div[data-focus-board-panel]", { timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return page;
}

const clickButton = async (page, selector) => {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`missing: ${sel}`);
    el.click();
  }, selector);
};

const selectedTab = (page) =>
  page.$eval('[role="tab"][aria-selected="true"]', (el) => el.textContent);

// 1. Dev build with a standing [Unreleased] group (the default state of every
//    dev tree): the icon is the pulsing What's-new gift, deep-linking to that
//    tab.
{
  const page = await open("?demo=1");
  const gift = await page.$('button[aria-label="What\'s new"]');
  if (gift === null) fail("default dev board shows no What's-new gift");
  else ok("default dev board: gift icon with What's-new label");
  await clickButton(page, 'button[aria-label="What\'s new"]');
  await page.waitForSelector('[role="tabpanel"]', { timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const tab = await selectedTab(page);
  if (tab === "What's new") ok("gift click deep-links to the What's-new tab");
  else fail(`pulse click landed on '${tab}', expected What's new`);
  const feed = await page.$eval('[role="tabpanel"]', (el) => el.textContent ?? "");
  if (feed.includes("Version ") || feed.includes("Unreleased ")) {
    ok("What's-new tab renders the condensed feed");
  } else fail(`What's-new tab shows no feed entries (got: ${feed.slice(0, 120)})`);
  await page.screenshot({ path: `${OUT}settings-whats-new-deeplink.png` });

  // The rail lists exactly the three tabs.
  const tabs = await page.$$eval('[role="tab"]', (els) => els.map((el) => el.textContent));
  if (JSON.stringify(tabs) !== JSON.stringify(["Behavior", "What's new", "About"])) {
    fail(`rail tabs are ${JSON.stringify(tabs)}`);
  } else ok(`rail tabs: ${tabs.join(" | ")}`);

  // About tab.
  await clickButton(page, 'button[role="tab"]:not([aria-selected="true"]):nth-last-child(1)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const aboutTab = await selectedTab(page);
  if (aboutTab === "About") {
    const about = await page.$eval('[role="tabpanel"]', (el) => el.textContent ?? "");
    if (about.includes("Focus Board") && about.includes("dev build") && about.includes("github.com/cristoslc")) {
      ok("About tab: name, dev-build mark, and repo link");
    } else fail(`About tab content incomplete: ${about.slice(0, 180)}`);
  } else fail(`About rail click selected '${aboutTab}'`);
  await page.screenshot({ path: `${OUT}settings-about.png` });

  // Closing the modal marks the feed seen: the icon must now be the plain
  // gear with the settings label (the binary costume flips live, no reload).
  await clickButton(page, 'button[class*="rounded-sm"][aria-hidden] span.sr-only, button span');
  // The built-in Dialog X close: press Escape instead — deterministic.
  await page.keyboard.press("Escape");
  await new Promise((resolve) => setTimeout(resolve, 400));
  const gearNow = await page.$('button[aria-label="Focus Board settings"]');
  const giftGone = await page.$('button[aria-label="What\'s new"]');
  if (gearNow !== null && giftGone === null) {
    ok("after opening the feed once, the icon is the plain settings gear");
  } else fail("opening the feed did not flip the icon to the settings gear");
  await page.screenshot({ path: `${OUT}toolbar-gear.png` });

  // Gear click opens on Behavior.
  if (gearNow) {
    await clickButton(page, 'button[aria-label="Focus Board settings"]');
    await page.waitForSelector('[role="tabpanel"]', { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const tab = await selectedTab(page);
    if (tab === "Behavior") ok("gear click opens on Behavior");
    else fail(`gear click landed on '${tab}', expected Behavior`);
    await page.screenshot({ path: `${OUT}settings-behavior.png` });

    // Toggling writes the plugin setting (the mock records the call).
    await clickButton(page, 'button[aria-label="Escape stops a running thread first"]');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const writes = await page.evaluate(() => {
      const uat = globalThis.__uat;
      if (typeof uat?.calls !== "function") return null;
      return JSON.stringify(
        uat.calls().filter((c) => String(c.method).includes("updateSettings")),
      );
    });
    if (writes === null) fail("harness exposes no recorded call log for updateSettings");
    else if (writes.includes("escStopsRunningThread")) ok("Behavior toggle wrote the plugin setting");
    else fail(`no recorded updateSettings write for escStopsRunningThread (got: ${writes})`);
    const errorShown = await page.$eval('[role="tabpanel"]', (el) => (el.textContent ?? "").includes("Saving failed"));
    if (errorShown) fail("a successful write surfaced an inline error");
    else ok("successful write shows no inline error");
  }
  await page.close();
}

await browser.close();

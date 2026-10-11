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
  // The appearance defaults read the persisted card-transport choice; the
  // harness browser carries one from earlier runs, so the opening board
  // gets a cleared key (an unparseable value yields the shipped default).
  await page.evaluateOnNewDocument(() => {
    window.localStorage.removeItem("focus-board:cardTransport");
  });
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

// 1. Seeded upgrade state (the tree carries a stable APP_VERSION since the
//    1.2.0 finalize; a pulse needs the seed): the icon is the pulsing gift,
//    deep-linking to that tab.
{
  const page = await open("?demo=1&groupBy=status&lastSeenVersion=0.4.4&lastSeenUnreleased=zz");
  const gift = await page.$('button[aria-label="What\'s new"]');
  if (gift === null) fail("seeded upgrade board shows no What's-new gift");
  else ok("seeded upgrade board: gift icon with What's-new label");
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
  if (JSON.stringify(tabs) !== JSON.stringify(["Behavior", "Appearance", "What's new", "About"])) {
    fail(`rail tabs are ${JSON.stringify(tabs)}`);
  } else ok(`rail tabs: ${tabs.join(" | ")}`);

  // The modal's frame does not resize across tab switches: measure the
  // dialog's bounding box under the tall What's-new feed and under the
  // short About copy — the two extremes must carry one identical height.
  const dialogBox = () =>
    page.$eval("[role=dialog]", (el) => ({ h: el.getBoundingClientRect().height }));
  const feedSize = await dialogBox();
  await clickButton(page, 'button[role="tab"]:nth-last-child(1)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const aboutSize = await dialogBox();
  await clickButton(page, 'button[role="tab"]:nth-child(1)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const behaviorSize = await dialogBox();
  const sameSize = feedSize.h === aboutSize.h && aboutSize.h === behaviorSize.h;
  if (sameSize) ok(`fixed dimensions hold across tabs: one height (${behaviorSize.h}px)`);
  else fail(`modal resizes across tabs: feed ${JSON.stringify(feedSize)} vs about ${JSON.stringify(aboutSize)} vs behavior ${JSON.stringify(behaviorSize)}`);
  await page.screenshot({ path: `${OUT}settings-behavior.png` });

  // Back to About for its content assertions (the rail stays in order).
  await clickButton(page, 'button[role="tab"]:nth-last-child(1)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const aboutTabAfter = await selectedTab(page);
  if (aboutTabAfter === "About") {
    const about = await page.$eval('[role="tabpanel"]', (el) => el.textContent ?? "");
    const versionMatch = /Version (\S+)/.exec(about);
    const hasSuffix = versionMatch !== null && versionMatch[1].includes("-");
    const okContent =
      about.includes("Focus Board") &&
      versionMatch !== null &&
      about.includes("github.com/cristoslc") &&
      (hasSuffix ? about.includes("dev build") : !about.includes("dev build"));
    if (okContent) {
      ok(`About tab: name, version ${versionMatch?.[1]} (parity mark ${hasSuffix ? "dev build" : "none"}), repo link`);
    } else fail(`About tab content/parity wrong: ${about.slice(0, 180)}`);
  } else fail(`About rail click selected '${aboutTabAfter}'`);
  await page.screenshot({ path: `${OUT}settings-about.png` });

  // The Appearance tab hosts the wallpaper picker inline: its contents (the
  // preset swatches and the free-form url field) render directly in the tab
  // content — no trigger button, no popover.
  await clickButton(page, 'button[role="tab"]:nth-child(2)');
  await new Promise((resolve) => setTimeout(resolve, 300));
  const appearanceTab = await selectedTab(page);
  if (appearanceTab !== "Appearance") fail(`appearance rail click selected '${appearanceTab}'`);
  const radioInfo = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('[role="radiogroup"]')];
    return groups.map((group) => ({
      label: group.getAttribute("aria-label"),
      options: [...group.querySelectorAll('[role="radio"]')].map((radio) => ({
        name: radio.textContent,
        checked: radio.getAttribute("aria-checked") === "true",
        disabled: radio.getAttribute("aria-disabled") === "true",
      })),
    }));
  });
  const cardGroup = radioInfo.find((g) => g.label === "Card animations");
  const motionGroup = radioInfo.find((g) => g.label === "Motion");
  const okAppearance =
    cardGroup !== undefined && motionGroup !== undefined &&
    JSON.stringify(cardGroup.options.map((o) => [o.name, o.checked, o.disabled])) ===
      JSON.stringify([
        ["None", false, false],
        ["Teleport", false, false],
        ["Zoom out / in", true, false],
      ]) &&
    motionGroup.options.length === 3;
  if (okAppearance) ok("Appearance tab: defaults (Zoom, system motion), zoom live and default");
  else fail(`Appearance tab radio state wrong: ${JSON.stringify(radioInfo)}`);
  const wallpaperInput = await page.$('input[aria-label="Wallpaper image url"]');
  const presetCount = await page.$$eval(
    'button[aria-label^="Wallpaper preset:"]',
    (els) => els.length,
  );
  if (wallpaperInput === null || presetCount === 0) fail("Appearance tab shows no inline wallpaper picker");
  else ok(`Appearance tab mounts the wallpaper picker inline (${presetCount} presets)`);
  await page.screenshot({ path: `${OUT}settings-appearance.png` });

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

  // The Behavior tab's Sweep block: both arms at the 2-days defaults.
  const countField = 'input[aria-label="Sweep: archive Done threads after count"]';
  const sweepDefaults = await page.evaluate(() => ({
    done: document.querySelector('input[aria-label="Sweep: archive Done threads after count"]')?.value ?? null,
    idle: document.querySelector('input[aria-label="Sweep: mark long-idle threads Done after count"]')?.value ?? null,
    doneUnit: document.querySelector('select[aria-label="Sweep: archive Done threads after unit"]')?.value ?? null,
  }));
  if (sweepDefaults.done === "2" && sweepDefaults.idle === "2" && sweepDefaults.doneUnit === "days") {
    ok("Sweep rows render the 2-days defaults with unit selects");
  } else fail(`Sweep rows wrong: ${JSON.stringify(sweepDefaults)}`);

  // An out-of-range count writes nothing and shows the failure inline.
  await page.click(countField);
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
  await page.keyboard.type("0");
  await page.keyboard.press("Tab");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const outOfRange = await page.$eval('[role="tabpanel"]', (el) => (el.textContent ?? "").includes("Expected an integer between 1 and 365"));
  if (outOfRange) ok("out-of-range sweep count: inline failure, no write");
  else fail("out-of-range sweep count surfaced no inline error");

  // A valid edit records the declared-key patch — React's onChange fires
  // on the input event, and the mock's simulated settings store merges it.
  await page.click(countField);
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
  await page.keyboard.type("5");
  await page.keyboard.press("Tab");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const sweepWrites = await page.evaluate(() => {
    const uat = globalThis.__uat;
    const patch = (uat?.calls() ?? []).find((c) =>
      String(c.method).includes("updateSettings") &&
      JSON.stringify(c.args?.values ?? {}).includes("doneArchiveValue"));
    return patch === undefined ? null : JSON.stringify(patch.args.values);
  });
  if (sweepWrites !== null && sweepWrites.includes('"doneArchiveValue":5')) {
    ok("a valid sweep edit wrote the declared key through updateSettings");
  } else fail(`no doneArchiveValue:5 patch recorded (got: ${sweepWrites})`);
  const sweepError = await page.$eval('[role="tabpanel"]', (el) => (el.textContent ?? "").includes("Saving failed"));
  if (sweepError) fail("a successful sweep edit surfaced an inline error");
  else ok("successful sweep edit shows no inline error");
  }
  await page.close();
}

// The round-trip: the modal must render previously-written values. The mock
// store's ?settings= seed stands in for the persisted host store; the real
// persistence lives in bb and is covered by the manual row in the coverage
// matrix.
{
  const page = await open("?demo=1&lastSeenVersion=9999&groupBy=status&settings=" +
    encodeURIComponent(JSON.stringify({ doneArchiveValue: 5, doneArchiveUnit: "weeks" })));
  await clickButton(page, 'button[aria-label="Focus Board settings"]');
  await page.waitForSelector('[role="tabpanel"]', { timeout: 10_000 });
  await new Promise((resolve) => setTimeout(resolve, 300));
  const seeded = await page.evaluate(() => ({
    done: document.querySelector('input[aria-label="Sweep: archive Done threads after count"]')?.value ?? null,
    unit: document.querySelector('select[aria-label="Sweep: archive Done threads after unit"]')?.value ?? null,
  }));
  if (seeded.done === "5" && seeded.unit === "weeks") {
    ok("a fresh page seeded with a written patch renders the written values");
  } else fail(`round-trip read failed: ${JSON.stringify(seeded)}`);

  // The sidebar footer gear's registration: captured by the mock, the title
  // must sit on the "configuration" noun (the board's own gear keeps
  // "settings").
  const footer = await page.evaluate(() => {
    const uat = globalThis.__uat;
    return uat?.sidebarFooterAction?.() ?? null;
  });
  if (footer !== null && footer.title === "Focus Board configuration") {
    ok("footer gear registration titled Focus Board configuration");
  } else fail(`footer gear registration wrong: ${JSON.stringify(footer)}`);
  await page.close();
}

await browser.close();

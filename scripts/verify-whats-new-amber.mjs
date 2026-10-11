/**
 * Headless acceptance for the per-line amber arithmetic in the What's-new
 * tab (the operator's fix round): old, already-open lines must stay muted
 * while the lines that landed since the last open tint amber — surface
 * headings and the unreleased header following their bullets.
 *
 * Drives the real app in the screenshot harness: pass 1 opens the modal
 * once to stamp the per-line store, then a reseeded pass 2 simulates a
 * group that gained bullets since — exactly those render amber.
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

/** FNV-1a 32-bit over "\n" + lines + "\n", hex — byte-identical to the lib. */
const unreleasedFingerprint = (texts) => {
  let hash = 0x811c9dc5;
  const source = `\n${texts.join("\n")}\n`;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
});

const open = async (query) => {
  const page = await browser.newPage();
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("div[data-focus-board-panel]", { timeout: 30_000 });
  await new Promise((resolve) => setTimeout(resolve, 400));
  return page;
};

const clickSelector = async (page, selector) => {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null) throw new Error(`missing: ${sel}`);
    el.click();
  }, selector);
};

/**
 * The feed's line inventory over the live DOM, per top-level bullet: the
 * item lead, its child leads, and whether the li renders amber.
 */
const readFeed = (page) =>
  page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]');
    if (panel === null) return null;
    // Scope to the What's-new section: the h3 that starts the section, up to
    // the next h3 ("Version …").
    const h3s = [...panel.querySelectorAll("h3")];
    const unreleasedSection = h3s.find((h) => h.textContent?.startsWith("Unreleased "));
    if (unreleasedSection === undefined) return null;
    const sectionEl = unreleasedSection.parentElement;
    if (sectionEl === null) return null;
    const topLevelLis = [...sectionEl.querySelectorAll("ul > li")].filter(
      (li) => li.parentElement !== null && !li.parentElement.parentElement?.matches("li"),
    );
    return topLevelLis.map((li) => {
      const amber = li.className.includes("text-amber");
      const childLis = [...li.querySelectorAll("ul > li")];
      return {
        lead: li.textContent.replace(childLis.map((c) => c.textContent).join(""), ""),
        children: childLis.map((c) => c.textContent),
        amber,
        label: li.closest("[class*='tracking-wider']")?.textContent ?? null,
        labelAmber:
          li.closest("[class*='tracking-wider']")?.className.includes("text-amber") ?? false,
      };
    });
  });

/**
 * Click the double-duty icon in whichever costume it wears right now: the
 * pulsing gift (unseen changelog) or the plain settings gear (caught up, as
 * pass 1 left this browser's local storage).
 */
const clickSettingsIcon = async (page) => {
  await page.evaluate(() => {
    const el =
      document.querySelector('button[aria-label="What\'s new"]') ??
      document.querySelector('button[aria-label="Focus Board settings"]');
    if (el === null) throw new Error("missing: settings icon (either costume)");
    el.click();
  });
};

// Pass 1: first open — everything reads amber (nothing has been seen), and
// the open stamps the per-line store with every current lead.
const page1 = await open("?demo=1&groupBy=status");
await clickSettingsIcon(page1);
await page1.waitForSelector('[role="tabpanel"]', { timeout: 10_000 });
await new Promise((resolve) => setTimeout(resolve, 400));
const feed = await readFeed(page1);
if (feed === null || feed.length === 0) {
  fail("pass 1: no feed items found");
  process.exit(1);
}
ok(`pass 1: ${feed.length} top-level items in the dev unreleased feed`);
  // The whole unreleased section on a never-opened tree: header amber,
  // every bullet amber (it is the only content there and nothing has been
  // seen). The older sections beside it (published history the reader had)
  // stay muted by construction.
  const unreleasedAmber = feed.every((item) => item.amber);
  const header1 = await page1.evaluate(
    () =>
      [...document.querySelectorAll('[role="tabpanel"] h3')].find((h) =>
        h.textContent?.startsWith("Unreleased "),
      )?.className.includes("text-amber") ?? false,
  );
  if (unreleasedAmber && header1) {
    ok("pass 1: the never-opened unreleased section reads amber (header included)");
  } else {
    fail(
      `pass 1: a fresh unreleased section should read amber end to end (items all amber=${unreleasedAmber}, header amber=${header1})`,
    );
  }
  const leads = feed.flatMap((item) => [item.lead, ...item.children]);
  const seenCount = await page1.evaluate(() =>
    (JSON.parse(window.localStorage.getItem("focus-board:lastSeenUnreleasedItems") ?? "[]")).length,
  );
  if (seenCount === leads.length) ok(`pass 1: opening stamped ${seenCount} leads seen`);
  else fail(`pass 1: store holds ${seenCount} leads, expected ${leads.length}`);
await page1.close();

// Pass 2: the accumulated group "gained" bullets since the last open —
// reseed the store with every fingerprint EXCEPT the family-box group's
// first two items, then open again and assert the fresh/seen split.
const page2 = await browser.newPage();
const freshLeads = feed.slice(0, 2);
const freshTexts = freshLeads.map((item) => item.lead);
const freshSet = new Set(freshTexts);
const seenFps = unreleasedFingerprint(
  feed.filter((item) => !freshSet.has(item.lead)).flatMap((item) => [item.lead, ...item.children]),
);
void seenFps;
const storedFps = feed
  .filter((item) => !freshSet.has(item.lead))
  .flatMap((item) => [unreleasedFingerprint([item.lead]), ...item.children.map((c) => unreleasedFingerprint([c]))]);
await page2.evaluateOnNewDocument((fps) => {
  window.localStorage.setItem("focus-board:lastSeenUnreleasedItems", JSON.stringify(fps));
}, storedFps);
await page2.goto(`${BASE}?demo=1&groupBy=status`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page2.waitForSelector("div[data-focus-board-panel]", { timeout: 30_000 });
await new Promise((resolve) => setTimeout(resolve, 400));
await clickSettingsIcon(page2);
await page2.waitForSelector('[role="tabpanel"]', { timeout: 10_000 });
// Whatever tab the icon opened (pulse gift → What's new, caught-up gear →
// Behavior), navigate the rail to What's new.
await clickSelector(page2, '[role="tab"]:nth-child(3)');
await new Promise((resolve) => setTimeout(resolve, 400));

const feed2 = await readFeed(page2);
if (feed2 === null) {
  fail("pass 2: feed disappeared on reopen");
  process.exit(1);
}
const mismatches = feed2.filter((item) => item.amber !== freshSet.has(item.lead));
if (mismatches.length === 0 && freshSet.size > 0) {
  ok(`pass 2: exactly ${freshSet.size} fresh lines amber, ${feed2.length - freshSet.size} muted`);
} else {
  fail(
    `pass 2: amber split wrong — expected amber for ${JSON.stringify([...freshSet])}, got: ${JSON.stringify(
      feed2.map((item) => [item.lead.slice(0, 40), item.amber]),
    )}`,
  );
}
// Headings follow their bullets: the unreleased header is amber (something
// under it is fresh), and each label is amber exactly when a bullet of its
// group is.
const headerAmber = await page2.evaluate(
  () =>
    [...document.querySelectorAll('[role="tabpanel"] h3')].find((h) =>
      h.textContent?.startsWith("Unreleased "),
    )?.className.includes("text-amber") ?? false,
);
if (headerAmber && freshSet.size > 0) ok("pass 2: the unreleased header is amber (fresh bullets under it)");
else fail("pass 2: the unreleased header did not follow its bullets");

// Label/bullet agreement per surface: walk each label and its list.
await page2.evaluate(() => {});
const labels = [...(await page2.$$('[role="tabpanel"] div.uppercase'))];
let labelOk = true;
for (const label of labels) {
  const amber = (await label.evaluate((el) => el.className.includes("text-amber")));
  const anyFreshInGroup = await label.evaluate((el) => {
    const wrapper = el.parentElement;
    if (wrapper === null) return false;
    const lis = [...wrapper.querySelectorAll("ul > li")].filter(
      (li) => !li.parentElement.parentElement?.matches("li"),
    );
    return lis.some((li) => li.className.includes("text-amber"));
  });
  if (amber !== anyFreshInGroup) {
    labelOk = false;
    console.error(`label mismatch: ${await label.evaluate((e) => e.textContent)} amber=${amber} fresh=${anyFreshInGroup}`); }
}
if (labelOk) ok("pass 2: every surface heading follows its bullets");
else fail("pass 2: a surface heading tinted against its bullets");
await page2.screenshot({ path: `${OUT}whats-new-amber-granular.png` });
await page2.close();
await browser.close();

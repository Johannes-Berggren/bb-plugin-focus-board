// Probe for issue #106: unpin leaves a Working card missing from the lane
// order. Drives the real app (screenshot harness) through the failing menu
// gesture, then dumps every lane's order so the vanished card's actual
// destination (another lane, a nested row, or nowhere) is visible.
//
// One-time setup: `npx vite --config scripts/screenshot/vite.config.ts --port 5199`
// then: node scripts/screenshot/repro-unpin-drop.mjs
import puppeteer from "puppeteer-core";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5199/";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 720, height: 800, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});
const page = await browser.newPage();
page.on("pageerror", (err) => console.log(`[pageerror] ${err.message}`));
page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
});

await page.goto(`${BASE}?groupBy=status`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
await sleep(800);

/** Every lane: each top-level card and any nested row ids under it. */
const dump = () => page.evaluate(() => {
  const out = {};
  for (const section of document.querySelectorAll("section[data-column-id]")) {
    const col = section.getAttribute("data-column-id");
    const lis = [...section.querySelectorAll(":scope > div > ul > li")];
    out[col] = lis.map((li) => {
      const top = li.querySelector(":scope a[href]");
      const rows = [...li.querySelectorAll(":scope li a[href]")].map((a) =>
        (a.getAttribute("href") ?? "").split("/").pop(),
      );
      const id = (top?.getAttribute("href") ?? "").split("/").pop();
      return rows.length > 0 ? { id, nested: rows } : id;
    });
  }
  return out;
});

/** Which lane (and which parent, if nested) holds a thread id? */
const locate = (threadId) => page.evaluate((id) => {
  for (const section of document.querySelectorAll("section[data-column-id]")) {
    const col = section.getAttribute("data-column-id");
    for (const li of section.querySelectorAll(":scope > div > ul > li")) {
      const top = li.querySelector(":scope a[href]");
      if ((top?.getAttribute("href") ?? "").endsWith(id)) return { col, nested: false };
      for (const a of li.querySelectorAll(":scope li a[href]")) {
        if ((a.getAttribute("href") ?? "").endsWith(id)) {
          return {
            col,
            nested: true,
            under: top?.getAttribute("href")?.split("/").pop() ?? null,
          };
        }
      }
    }
  }
  return { absent: true };
}, threadId);

console.log("BEFORE:", JSON.stringify(await dump(), null, 2));
console.log("locate thr_drag_done BEFORE:", JSON.stringify(await locate("thr_drag_done")));

// The failing gesture: right-click thr_ship_release → Unpin.
const menuResult = await page.evaluate(async () => {
  const host = document.querySelector('[data-thread-card="thr_ship_release"]');
  if (!host) throw new Error("no card thr_ship_release");
  const rect = host.getBoundingClientRect();
  host.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }),
  );
  const deadline = window.performance.now() + 2000;
  while (window.performance.now() < deadline) {
    const target = [...document.querySelectorAll('[role="menuitem"]')].find(
      (button) => button.textContent?.trim() === "Unpin",
    );
    if (target !== undefined) {
      target.click();
      return { ok: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Unpin never offered");
});
console.log("menu:", JSON.stringify(menuResult));
await sleep(1500);

console.log("AFTER:", JSON.stringify(await dump(), null, 2));
console.log("locate thr_drag_done AFTER:", JSON.stringify(await locate("thr_drag_done")));
console.log("locate thr_ship_release AFTER:", JSON.stringify(await locate("thr_ship_release")));
console.log("ranks after:", await page.evaluate(() => globalThis.__uat?.ranks?.() ?? null));

await browser.close();
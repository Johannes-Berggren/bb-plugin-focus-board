// Reorder probe: drives the REAL app (mounted by the screenshot harness)
// with REAL mouse drags — native HTML5 DnD, the path jsdom and the
// synthetic-DragEvent suites cannot fully exercise. Covers: top-level
// reorder (the control that always worked), in-box member reorder, and
// nested child-row reorder.
//
// One-time setup: `npm i --no-save puppeteer-core`. Run a vite server:
//   npx vite --config scripts/screenshot/vite.config.ts --port 5199
// then: node scripts/screenshot/repro-reorder.mjs
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
page.on("console", (msg) => {
  if (msg.type() === "error") console.log(`[console.error] ${msg.text()}`);
});

await page.goto(`${BASE}?groupBy=status&demo=1`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("[data-thread-card]", { timeout: 30_000 });
await sleep(800);

// Instrument: capture-phase log of the native DnD events.
await page.evaluate(() => {
  const log = [];
  const describe = (e) => {
    if (!(e.target instanceof Element)) return "?";
    const slot = e.target.closest("[data-rank-slot]");
    if (slot !== null) return `slot:${slot.getAttribute("data-rank-slot")}`;
    const row = e.target.closest("a[data-thread-card]");
    if (row !== null) return `row:${row.getAttribute("data-thread-card")}`;
    const box = e.target.closest("[data-group-box]");
    if (box !== null) return `box:${box.getAttribute("data-group-box")}`;
    return e.target.tagName.toLowerCase();
  };
  window.__dragLog = log;
  for (const type of ["dragstart", "drop", "dragend"]) {
    document.addEventListener(
      type,
      (e) => {
        log.push({ type, target: describe(e), types: [...(e.dataTransfer?.types ?? [])] });
      },
      true,
    );
  }
  document.addEventListener("dragover", (e) => {
    log.push({ type: "over/capture", target: describe(e), types: [...(e.dataTransfer?.types ?? [])] });
  }, true);
  document.addEventListener("dragover", (e) => {
    log.push({ type: "over/bubble", target: describe(e), prevented: e.defaultPrevented });
  }, false);
});

/** Column id → run-order ids: top-level slots in display order, box
 *  containers flattened into their member ids (the box sits where its first
 *  member sits). */
const orderOf = (columnId) => page.evaluate((col) => {
  const section = document.querySelector(`section[data-column-id="${col}"]`);
  if (!section) return null;
  const list = section.querySelector("ul");
  if (!list) return null;
  const ids = [];
  for (const li of list.children) {
    if (li.getAttribute("data-group-box") !== null) {
      ids.push(
        ...[...li.querySelectorAll("a[data-thread-card]")].map((a) => a.getAttribute("data-thread-card")),
      );
      continue;
    }
    if (li.getAttribute("data-rank-slot") !== null) {
      const a = li.querySelector("a[data-thread-card]");
      if (a !== null) ids.push(a.getAttribute("data-thread-card"));
    }
  }
  return ids;
}, columnId);

const bannerText = () => page.evaluate(() => {
  const banner = [...document.querySelectorAll("[role='status'], [data-rank-error], aside")]
    .map((el) => el.textContent ?? "").find((text) => text.includes("Reorder refused"));
  return banner ?? null;
});

/** A real-mouse HTML5 drag: down at the source's center, stepped moves to
 *  the target point (Chrome starts the native drag after ~4px), up there. */
/** A faithful native drag via CDP Input.dispatchDragEvent: Chrome's own
 *  drag interception (mousedown + move start a real drag session, the page
 *  receives real dragover/drop with a REAL dataTransfer, `types` readable and
 *  `getData` protected exactly like a human drag). Returns whether a native
 *  drag session actually engaged. */
async function cdpDrag(page, sourcePoint, targetPoint) {
  const client = await page.target().createCDPSession();
  await client.send("Input.setInterceptDrags", { enabled: true }).catch(() => {});
  let dragData = null;
  const intercepted = new Promise((resolve) => {
    client.on("Input.dragIntercepted", (event) => resolve(event.data));
    setTimeout(() => resolve(null), 3000);
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mousePressed", x: sourcePoint.x, y: sourcePoint.y, button: "left", clickCount: 1,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseMoved", x: sourcePoint.x + 6, y: sourcePoint.y + 6, button: "left", clickCount: 1,
  });
  dragData = await intercepted;
  if (dragData === null) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased", x: sourcePoint.x, y: sourcePoint.y, button: "left", clickCount: 1,
    });
    await client.detach();
    return "NO_DRAG_START";
  }
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const x = sourcePoint.x + ((targetPoint.x - sourcePoint.x) * i) / steps;
    const y = sourcePoint.y + ((targetPoint.y - sourcePoint.y) * i) / steps;
    await client.send("Input.dispatchDragEvent", { type: "dragOver", x, y, data: dragData });
    await sleep(30);
  }
  await client.send("Input.dispatchDragEvent", {
    type: "drop", x: targetPoint.x, y: targetPoint.y, data: dragData,
  });
  await client.send("Input.dispatchMouseEvent", {
    type: "mouseReleased", x: targetPoint.x, y: targetPoint.y, button: "left", clickCount: 1,
  });
  await client.detach();
  return "DRAGGED";
}

async function realDrag(sourceId, targetId, targetYFraction) {
  // The draggable anchor is where a native drag starts (a top-level card's
  // anchor lives in its ranked slot; a row is its own anchor).
  const handleFor = async (cardId) => {
    const li = await page.$(`li[data-rank-slot="${cardId}"]`);
    let el = li === null ? null : await li.$("a[draggable]");
    if (el === null) el = await page.$(`a[data-thread-card="${cardId}"]`);
    if (el === null) {
      console.log(`MISSING draggable anchor for ${cardId}`);
      return null;
    }
    return el;
  };
  const source = await handleFor(sourceId);
  const target = await handleFor(targetId);
  if (source === null || target === null) return false;
  const box = await target.boundingBox();
  if (box === null) {
    console.log(`no bounding box for ${targetId}`);
    return false;
  }
  await page.setDragInterception(true);
  try {
    await source.dragAndDrop(target, {
      targetPosition: {
        x: Math.round(box.width / 2),
        y: Math.round(box.height * targetYFraction),
      },
    });
  } catch (err) {
    console.log(`drag ${sourceId} -> ${targetId} failed: ${err.message}`);
    return false;
  }
  await page.setDragInterception(false);
  await sleep(500);
  return true;
}

// ---- Baselines -------------------------------------------------------------
const workBefore = await orderOf("working");
console.log("working column before:", workBefore);
const rowsBefore = await page.evaluate(() => {
  const rows = document.querySelectorAll('[data-nested-rows=""] a[data-thread-card]');
  return [...rows].map((a) => a.getAttribute("data-thread-card"));
});
console.log("nested rows (all families) before:", rowsBefore);

// ---- 0. Board dump ----------------------------------------------------------
const dump = await page.evaluate(() => {
  const sections = [...document.querySelectorAll("section[data-column-id]")];
  return sections.map((section) => {
    const col = section.getAttribute("data-column-id");
    const ul = section.querySelector("ul");
    const items = ul === null ? [] : [...ul.children].map((li) => {
      const boxId = li.getAttribute("data-group-box");
      if (boxId !== null) {
        return `box(${boxId})=[${[...li.querySelectorAll("[data-thread-card]")]
          .map((a) => a.getAttribute("data-thread-card")).join(", ")}]`;
      }
      const slotId = li.getAttribute("data-rank-slot");
      if (slotId !== null) {
        const cardEl = li.querySelector(":scope > [data-thread-card]");
        return `slot(${slotId}) card=${cardEl !== null ? cardEl.getAttribute("data-thread-card") : "NO-CARD-EL"}`;
      }
      return li.tagName.toLowerCase();
    });
    return { col, items };
  });
});
console.log("board dump:", JSON.stringify(dump, null, 1));

// ---- 1. Control: top-level same-lane reorder -------------------------------
// Pick two plain top-level cards from the working column (skip box members:
// their slots are data-group-box-member'd).
const plainPair = await page.evaluate(() => {
  const cards = [...document.querySelectorAll(
    'section[data-column-id="working"] > div > ul > li[data-rank-slot]:not([data-group-box-member])',
  )];
  return cards.slice(0, 2).map((li) => li.getAttribute("data-rank-slot"));
});
console.log("control pair:", plainPair);
if (plainPair.length === 2) {
  // Drag the SECOND card onto the FIRST's top half: the run order flips.
  await realDrag(plainPair[1], plainPair[0], 0.2);
  const after = await orderOf("working");
  console.log("CONTROL top-level:", JSON.stringify({ before: workBefore, after }));
  console.log("banner:", await bannerText());
}

// ---- 2. In-box member reorder ----------------------------------------------
// Scan EVERY column for one multi-member dashed box (the demo's
// grp_chat_imagegent wraps two active threads).
const boxPair = await page.evaluate(() => {
  for (const boxEl of document.querySelectorAll("li[data-group-box]")) {
    const ids = [...boxEl.querySelectorAll("[data-thread-card]")].map((a) =>
      a.getAttribute("data-thread-card"),
    );
    if (ids.length >= 2) {
      const section = boxEl.closest("section[data-column-id]");
      return { ids, column: section?.getAttribute("data-column-id") ?? "?" };
    }
  }
  return null;
});
console.log("box members:", JSON.stringify(boxPair));
if (boxPair !== null) {
  // Drag the SECOND member onto the FIRST member's top half: it should land
  // directly above it, inside the box.
  await realDrag(boxPair.ids[1], boxPair.ids[0], 0.2);
  const after = await orderOf(boxPair.column);
  console.log("IN-BOX:", JSON.stringify({ column: boxPair.column, after }));
  console.log("banner:", await bannerText());
} else {
  console.log("no multi-member box found in any column");
}

// ---- 2b. Same in-box gesture, SYNTHETIC events (protected mode) ------------
if (boxPair !== null) {
  const synthetic = await page.evaluate(({ from, to }) => {
    const slotOf = (cardId) => {
      const li = document.querySelector(`li[data-rank-slot="${cardId}"]`);
      if (li === null) return null;
      const anchor = li.querySelector("a[draggable]");
      const rect = (anchor ?? li).getBoundingClientRect();
      return { anchor, rect };
    };
    const source = slotOf(from);
    const target = slotOf(to);
    if (source === null || target === null) return { ok: false, why: `missing ${from}/${to}` };
    const transfer = new DataTransfer();
    const realGetData = transfer.getData.bind(transfer);
    Object.defineProperty(transfer, "getData", {
      configurable: true,
      value: (format) => (source.reading ? realGetData(format) : ""),
    });
    source.anchor.dispatchEvent(
      new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    const point = {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: target.rect.left + target.rect.width / 2,
      clientY: target.rect.top + target.rect.height * 0.2,
    };
    source.reading = false;
    const over = new DragEvent("dragover", point);
    target.anchor.dispatchEvent(over);
    const drop = new DragEvent("drop", point);
    target.anchor.dispatchEvent(drop);
    source.anchor.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
    return { ok: true, dropAllowed: over.defaultPrevented };
  }, { from: boxPair.ids[1], to: boxPair.ids[0] });
  console.log("IN-BOX SYNTHETIC:", JSON.stringify(synthetic));
  const boxAfter = await page.evaluate(() => {
    for (const boxEl of document.querySelectorAll("li[data-group-box]")) {
      const ids = [...boxEl.querySelectorAll("[data-thread-card]")].map((a) =>
        a.getAttribute("data-thread-card"),
      );
      if (ids.length >= 2) return ids;
    }
    return null;
  });
  console.log("box members after synthetic drop:", JSON.stringify(boxAfter), "(want thr_drag_done before thr_column_sort)");
  const store = await page.evaluate(() => (globalThis).__uat?.ranks?.() ?? null);
  console.log("mock rank store:", JSON.stringify(store));
  console.log("mock rpc calls:", JSON.stringify((globalThis).__uat?.calls?.()));
  const texts = await page.evaluate(() => document.body.innerText);
  const flagged = texts.split("\n").filter((line) => /refus|Refus|no move|Reorder/.test(line));
  console.log("refusal/announced lines:", JSON.stringify(flagged));
  console.log("banner:", await bannerText());
}

// ---- 3. Nested child-row reorder -------------------------------------------
const familyCard = await page.evaluate(() => {
  const card = document.querySelector('[data-thread-card="thr_demo_work"]');
  if (!card) return null;
  const rows = [...card.querySelectorAll('[data-nested-rows=""] a[data-thread-card]')];
  return rows.map((a) => a.getAttribute("data-thread-card"));
});
console.log("family rows:", familyCard);
if (familyCard !== null && familyCard.length >= 2) {
  // Drag the SECOND row onto the FIRST row's top half: the order should flip.
  const rowDrag = await realDrag(familyCard[1], familyCard[0], 0.2);
  const rowsAfter = await page.evaluate(() => {
    const card = document.querySelector('[data-thread-card="thr_demo_work"]');
    if (!card) return null;
    const rows = card.querySelectorAll('[data-nested-rows=""] a[data-thread-card]');
    return [...rows].map((a) => a.getAttribute("data-thread-card"));
  });
  console.log("CHILD-ROW reorder:", JSON.stringify({ moved: rowDrag, before: familyCard, after: rowsAfter }));
  console.log("banner:", await bannerText());
} else {
  console.log("thr_demo_work has no visible child rows to drag (folded or placed elsewhere?)");
}

// ---- Event log -------------------------------------------------------------
console.log("native DnD log (compact):", await page.evaluate(() => {
  const describe = (e) => {
    const slot = e.target.closest("[data-rank-slot]");
    if (slot !== null) return slot.getAttribute("data-rank-slot");
    const row = e.target.closest("a[data-thread-card]");
    if (row !== null) return row.getAttribute("data-thread-card");
    const box = e.target.closest("[data-group-box]");
    if (box !== null) return `box:${box.getAttribute("data-group-box")}`;
    return e.target.tagName.toLowerCase();
  };
  return window.__dragLog.map((entry) => {
    const target = entry.target === undefined ? "?" : entry.target;
    return `${entry.type}@${target}${entry.prevented === undefined ? "" : entry.prevented ? " AUTH" : " NO-AUTH"}`;
  }).join("\n");
}));

await browser.close();
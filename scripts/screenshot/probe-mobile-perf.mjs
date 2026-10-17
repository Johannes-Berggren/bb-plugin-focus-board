// Headless performance probe for the Focus Board at phone width (issue: mobile
// performance). Loads the real app through the screenshot harness, then
// measures, per board and per interaction:
//
//   - load timeline: DCL, load, FCP, LCP, DOM interactive, time until the
//     board's first card paints, total blocking time (long tasks over 50ms)
//   - interaction windows: wall time, React commit count, long tasks
//     (count + summed ms), animation frames and dropped frames
//   - scroll: the same, while a busy lane is scrolled with real touch/wheel
//   - optional Chrome trace per phase for the style/layout/paint breakdown
//
// Usage:
//   npx vite --config scripts/screenshot/vite.config.ts   # terminal 1
//   node scripts/screenshot/probe-mobile-perf.mjs          # terminal 2
//
// Honors CHROME_PATH, HARNESS_URL, OUT_DIR, PROBE_TRACE=1 (emit
// docs/screenshots/probe-mobile-perf/trace-<phase>.json plus a rolled-up
// breakdown), and PROBE_CPU=<n> (CDP Emulation.setCPUThrottlingRate — a
// mid-range phone sits several times slower than the dev machine's M3 Pro, so
// the default runs at 4x). The 390x844 viewport is the release harness's
// phone size.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-mobile-perf/", import.meta.url).pathname;
const TRACE = process.env.PROBE_TRACE === "1";
const CPU = Number(process.env.PROBE_CPU ?? "4");

const PHONE = { width: 390, height: 844 };
const LONG_TASK_MS = 50;

// ── The in-page instrument ────────────────────────────────────────────────
// Installed before any app code runs (evaluateOnNewDocument): a React commit
// counter riding the devtools hook React looks for at boot, a long-task
// observer, a frame sampler, and a small recorder API the driver calls.
function installInstrument() {
  const w = window;
  w.__perf = {
    commits: [],
    longTasks: [],
    frames: [],
    events: [],
    readyAt: null,
    boardPaintAt: null,
  };

  // React commit counter. React (both the dev build the harness bundles and a
  // production build) calls onCommitFiberRoot on the global devtools hook when
  // it is present at module init, so installing a stub before the bundle runs
  // is enough to observe every commit.
  const hook = {
    renderers: new Map(),
    supportsFiber: true,
    inject(renderer) {
      const id = hook.renderers.size + 1;
      hook.renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot(_id, _root, _priority) {
      w.__perf.commits.push(performance.now());
    },
    onCommitFiberUnmount() {},
    checkDCE() {},
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        w.__perf.longTasks.push({ t: entry.startTime, d: entry.duration });
      }
    }).observe({ entryTypes: ["longtask"] });
  } catch {
    /* longtask is Chrome-only; the probe runs on Chrome */
  }

  // LCP needs its own buffered observer; getEntriesByType misses it when the
  // entry lands before the first paint read.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) w.__perf.lcp = Math.round(entry.startTime);
    }).observe({ type: "largest-contentful-paint", buffered: true });
  } catch {
    /* LCP is Chrome-only */
  }

  // Frame sampler: one rAF loop for the whole session. The driver reads the
  // timestamp list between marks to compute frames and dropped frames.
  const tick = (ts) => {
    w.__perf.frames.push(ts);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  // Board-paint moment: the first `[data-thread-card]` in the DOM. Recorded
  // once from a MutationObserver so "time to interactive board" is measured
  // rather than guessed. Observes `document` (documentElement does not exist
  // yet at document creation, which made this silently record nothing).
  try {
    const mo = new MutationObserver(() => {
      if (w.__perf.boardPaintAt === null && document.querySelector("[data-thread-card]") !== null) {
        w.__perf.boardPaintAt = performance.now();
        mo.disconnect();
      }
    });
    mo.observe(document, { childList: true, subtree: true });
  } catch {
    /* document always exists */
  }

  /** Mark a labeled instant. */
  w.__perf.mark = (name) => {
    w.__perf.events.push({ name, t: performance.now() });
    return w.__perf.events.length - 1;
  };
  /** Summarize the window between two marks. */
  w.__perf.window = (fromIndex, toIndex) => {
    const a = w.__perf.events[fromIndex];
    const b = w.__perf.events[toIndex];
    if (!a || !b) return null;
    const [t0, t1] = [a.t, b.t];
    const longTasks = w.__perf.longTasks.filter((e) => e.t >= t0 && e.t <= t1);
    const frames = w.__perf.frames.filter((f) => f >= t0 && f <= t1);
    const commits = w.__perf.commits.filter((c) => c >= t0 && c <= t1).length;
    let dropped = 0;
    for (let i = 1; i < frames.length; i += 1) {
      if (frames[i] - frames[i - 1] > 33) dropped += 1;
    }
    const span = t1 - t0;
    return {
      wallMs: Math.round(span),
      commits,
      longTaskCount: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((sum, e) => sum + e.d, 0)),
      longestTaskMs: Math.round(longTasks.reduce((max, e) => Math.max(max, e.d), 0)),
      frames: frames.length,
      dropped,
      fps: span > 0 ? Math.round((frames.length / span) * 1000) : null,
    };
  };
}

// ── Load metrics ──────────────────────────────────────────────────────────
async function loadMetrics(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByType("paint");
    const fcp = paint.find((p) => p.name === "first-contentful-paint");
    const perf = window.__perf;
    // Total blocking time: every long task's excess over 50ms, summed.
    const tbt = perf.longTasks.reduce((sum, e) => sum + Math.max(0, e.d - 50), 0);
    return {
      domInteractive: Math.round(nav?.domInteractive ?? 0),
      domContentLoaded: Math.round(nav?.domContentLoadedEventEnd ?? 0),
      load: Math.round(nav?.loadEventEnd ?? 0),
      fcp: fcp ? Math.round(fcp.startTime) : null,
      lcp: perf.lcp ?? null,
      boardPaintAt: perf.boardPaintAt === null ? null : Math.round(perf.boardPaintAt),
      totalBlockingTime: Math.round(tbt),
      longTaskCount: perf.longTasks.length,
      commitCount: perf.commits.length,
      nodeCount: document.querySelectorAll("*").length,
      cardCount: document.querySelectorAll("[data-thread-card]").length,
      laneCount: document.querySelectorAll("[data-column-id], section[data-lane-id]").length,
      // The style engine's own view of the sheet: how many CSS rules the
      // spotlight's :has() chain makes Chromium re-evaluate each frame is not
      // exposed, but the rule count and selector complexity are.
      styleSheets: document.styleSheets.length,
    };
  });
}

// ── V8 CPU profile attribution ────────────────────────────────────────────
// The strongest evidence for "every state change re-renders the board": a CDP
// CPU profile names each function and its self time. The harness serves the
// UNMINIFIED vite dev bundle, so names survive as written in the source.
async function cpuProfile(page, label, action) {
  const session = await page.createCDPSession();
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 100 });
  await session.send("Profiler.start");
  await action();
  const { profile } = await session.send("Profiler.stop");
  await session.detach();
  await writeFile(`${OUT}profile-${label}.json`, JSON.stringify(profile));
  return { label, ...rankProfile(profile) };
}

function rankProfile(profile) {
  const total = profile.nodes.reduce((sum, n) => sum + (n.hitCount ?? 0), 0);
  // Group by function + line, and keep only the renderer's own work (idle and
  // program buckets carry no attribution).
  const byFn = new Map();
  for (const n of profile.nodes) {
    const hits = n.hitCount ?? 0;
    if (hits === 0) continue;
    const fn = n.callFrame.functionName || "(anonymous)";
    if (fn === "(idle)" || fn === "(program)" || fn === "(root)") continue;
    const file = (n.callFrame.url || "").split("/").slice(-1)[0].split("?")[0];
    const line = n.callFrame.lineNumber + 1;
    const key = `${file}:${line}:${fn}`;
    byFn.set(key, (byFn.get(key) ?? 0) + hits);
  }
  const totalActive = [...byFn.values()].reduce((a, b) => a + b, 0);
  const top = [...byFn.entries()]
    .map(([key, hits]) => {
      const [file, line, ...rest] = key.split(":");
      return {
        file,
        line: Number(line),
        fn: rest.join(":"),
        selfSamples: hits,
        selfPctActive: totalActive > 0 ? Math.round((hits / totalActive) * 1000) / 10 : 0,
        selfPctTotal: total > 0 ? Math.round((hits / total) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 30);
  // Per-module roll-up: the plugin's own files vs React vs the rest.
  const byFile = new Map();
  for (const [key, hits] of byFn) {
    const file = key.split(":")[0];
    byFile.set(file, (byFile.get(file) ?? 0) + hits);
  }
  const files = [...byFile.entries()]
    .map(([file, hits]) => ({
      file,
      selfSamples: hits,
      selfPctActive: totalActive > 0 ? Math.round((hits / totalActive) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.selfSamples - a.selfSamples)
    .slice(0, 15);
  return { totalSamples: total, activeSamples: totalActive, sampleIntervalUs: 100, top, files };
}


// Chrome's own trace categories: the rolled-up per-category main-thread time
// is the hard evidence for where an interaction's milliseconds go.
async function traceBreakdown(page, label, action) {
  await page.tracing.start({
    path: `${OUT}trace-${label}.json`,
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline"],
  });
  await action();
  await page.tracing.stop();
  return summarizeTrace(`${OUT}trace-${label}.json`);
}

async function summarizeTrace(path) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const events = raw.traceEvents ?? raw;
  const totals = new Map();
  // Main-thread-ish categories on the renderer: the top-level ones that carry
  // time. Summing duration per name over the whole trace is enough for a
  // ranked breakdown.
  const interesting = new Set([
    "UpdateLayoutTree",
    "Layout",
    "Paint",
    "PrePaint",
    "ParseHTML",
    "EvaluateScript",
    "FunctionCall",
    "TimerFire",
    "EventDispatch",
    "HitTest",
    "Commit",
    "CompositeLayers",
    "RecalculateStyles",
    "RunTask",
  ]);
  for (const e of events) {
    if (typeof e.dur !== "number") continue;
    if (!interesting.has(e.name)) continue;
    const stat = totals.get(e.name) ?? { name: e.name, us: 0, count: 0 };
    stat.us += e.dur;
    stat.count += 1;
    totals.set(e.name, stat);
  }
  const ranked = [...totals.values()].sort((a, b) => b.us - a.us).map((s) => ({
    name: s.name,
    ms: Math.round(s.us / 1000),
    count: s.count,
  }));
  return ranked;
}

// ── The driver ────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--hide-scrollbars", "--enable-precise-memory-info"],
});

await mkdir(OUT, { recursive: true });
const results = { machine: null, boards: [] };

results.machine = {
  chrome: await browser.version(),
  viewport: PHONE,
  cpuThrottleRate: CPU,
  base: BASE,
  userAgent: await (async () => {
    const p = await browser.newPage();
    const ua = await p.evaluate(() => navigator.userAgent);
    await p.close();
    return ua;
  })(),
};

/** Open the harness at a phone viewport with the instrument installed. */
async function openBoard(query) {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(installInstrument);
  await page.setViewport({ ...PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const session = await page.createCDPSession();
  await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("[data-thread-card]", { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 800));
  return page;
}

/** Run a windowed interaction and summarize it. */
async function windowed(page, label, action) {
  const { from, to } = await page.evaluate(() => ({
    from: window.__perf.mark(`start:${Math.random()}`),
    to: null,
  }));
  void to;
  await action();
  return page.evaluate((from) => {
    const to = window.__perf.mark(`end:${Math.random()}`);
    const summary = window.__perf.window(from, to);
    return { label: window.__perf.events[from].name, ...summary };
  }, from);
}

const boards = [
  { name: "columns-demo", query: "?demo=1", kind: "columns" },
  { name: "columns-base", query: "", kind: "columns" },
  { name: "parent-lanes-demo", query: "?groupBy=parent&demo=1", kind: "parent" },
];

// PROBE_SCALE=N appends that query to every board, so the same probe sweeps a
// board of realistic size (`?scale=300`) instead of the ~50-thread fixture.
const SCALE_Q = process.env.PROBE_SCALE ? `scale=${process.env.PROBE_SCALE}` : "";
if (SCALE_Q) {
  for (const b of boards) b.query = b.query ? `${b.query}&${SCALE_Q}` : `?${SCALE_Q}`;
}

for (const board of boards) {
  const page = await openBoard(board.query);
  const entry = { board: board.name, query: board.query, load: await loadMetrics(page), interactions: [] };
  const boardSel = board.kind === "parent" ? "[data-parent-board]" : "[data-columns-board]";

  // ── Scroll the board horizontally with a real touch pan ──
  const boardBox = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  }, boardSel);
  entry.boardBox = boardBox;

  const pan = await windowed(page, "pan-board", async () => {
    const ts = page.touchscreen;
    const sy = Math.round(boardBox.y + boardBox.h / 2);
    const sx = Math.round(boardBox.x + boardBox.w * 0.7);
    await ts.touchStart(sx, sy);
    for (let i = 1; i <= 12; i += 1) {
      await ts.touchMove(sx - i * 24, sy);
      await new Promise((r) => setTimeout(r, 16));
    }
    await ts.touchEnd();
    await new Promise((r) => setTimeout(r, 600));
  });
  entry.interactions.push({ ...pan, label: "pan-board-horizontal" });

  // ── Scroll a lane's own list vertically (wheel over the busiest lane) ──
  const laneScroll = await page.evaluate((sel) => {
    const board = document.querySelector(sel);
    const lists = [...board.querySelectorAll("[data-card-list]")];
    const busiest = lists
      .map((l) => ({ l, cards: l.querySelectorAll("[data-thread-card]").length }))
      .sort((a, b) => b.cards - a.cards)[0];
    if (!busiest) return null;
    const r = busiest.l.getBoundingClientRect();
    return {
      cards: busiest.cards,
      scrollHeight: busiest.l.scrollHeight,
      clientHeight: busiest.l.clientHeight,
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
    };
  }, boardSel);
  entry.laneScroll = laneScroll;
  if (laneScroll !== null) {
    const scroll = await windowed(page, "scroll-lane", async () => {
      await page.mouse.move(laneScroll.x, laneScroll.y);
      for (let i = 0; i < 14; i += 1) {
        await page.mouse.wheel({ deltaY: 120 });
        await new Promise((r) => setTimeout(r, 16));
      }
      await new Promise((r) => setTimeout(r, 400));
    });
    entry.interactions.push({ ...scroll, label: "scroll-busiest-lane-vertical" });
  }

  // ── Hover sweep across cards (the attention capture path) ──
  const hover = await windowed(page, "hover-cards", async () => {
    const points = await page.evaluate((sel) => {
      const cards = [...document.querySelectorAll(`${sel} [data-thread-card]`)].slice(0, 12);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    }, boardSel);
    for (const p of points) {
      await page.mouse.move(p.x, p.y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  entry.interactions.push({ ...hover, label: "hover-12-cards" });

  // ── Open a thread pane (click a card) ──
  const openPane = await windowed(page, "open-pane", async () => {
    const p = await page.evaluate((sel) => {
      const card = document.querySelector(`${sel} [data-thread-card] a`);
      const r = card.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, boardSel);
    await page.mouse.click(p.x, p.y);
    await new Promise((r) => setTimeout(r, 900));
  });
  entry.interactions.push({ ...openPane, label: "open-thread-pane" });

  // ── CPU profile of a hover sweep: names the functions that own the cost ──
  entry.hoverProfile = await cpuProfile(page, "hover-12-cards", async () => {
    const points = await page.evaluate((sel) => {
      const cards = [...document.querySelectorAll(`${sel} [data-thread-card]`)].slice(0, 12);
      return cards.map((c) => {
        const r = c.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
    }, boardSel);
    for (const p of points) {
      await page.mouse.move(p.x, p.y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });

  if (TRACE) {
    entry.traces = {
      pan: await traceBreakdown(page, `${board.name}-pan`, async () => {
        await page.evaluate(() => {
          const b = document.querySelector("[data-parent-board], [data-columns-board]");
          b.scrollLeft = 0;
        });
        const ts = page.touchscreen;
        const sy = Math.round(boardBox.y + boardBox.h / 2);
        const sx = Math.round(boardBox.x + boardBox.w * 0.7);
        await ts.touchStart(sx, sy);
        for (let i = 1; i <= 12; i += 1) {
          await ts.touchMove(sx - i * 24, sy);
          await new Promise((r) => setTimeout(r, 16));
        }
        await ts.touchEnd();
        await new Promise((r) => setTimeout(r, 400));
      }),
    };
  }

  results.boards.push(entry);
  await page.close();
}

await writeFile(`${OUT}evidence.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();

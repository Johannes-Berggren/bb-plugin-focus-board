// Measurement for issue #279: the cost of the working dots' rate pulse.
//
// Opens `?workpulse=N&collapsedGroups=…`, whose board renders N folded feature
// boxes of three active members each — 3N genuine `working` dots breathing
// through the shipped rate pulse (components/dot-pulse.ts), not probe-injected
// clones. Each case measures the same page three times:
//
//   1. GATED   — the shipped board: the visible-only gate parks every off-screen
//                dot, so only the handful on screen animate.
//   2. UNGATED — the gate's stylesheet removed from the page, so every dot
//                animates. The difference between 1 and 2 is what the gate buys.
//   3. KILLED  — every rate pulse stopped, the page's achievable ceiling.
//
// It also records the client's poll behaviour: how many `pulse_rates` calls the
// page made and how much of the elapsed wall time went to long tasks.
//
// Usage: build the probe first, then
//   HARNESS_URL=http://localhost:5174/ node scripts/screenshot/probe-working-dot-pulse.mjs
//
// Env: CHROME_PATH, HARNESS_URL (default http://localhost:5174/), PROBE_CPU
// (default 4), PROBE_GROUPS (default "0,20,70"), PROBE_VIEWPORTS (default
// "phone-390,desktop-1280x800"), OUT_DIR.
import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5174/";
const OUT = process.env.OUT_DIR ?? new URL("../../docs/screenshots/probe-working-dot-pulse/", import.meta.url).pathname;
const CPU = Number(process.env.PROBE_CPU ?? "4");
const GROUPS = (process.env.PROBE_GROUPS ?? "0,20,70")
  .split(",")
  .map((value) => Math.max(0, Number(value) || 0));

const VIEWPORTS = {
  "phone-390": { width: 390, height: 844, isMobile: true },
  "desktop-1280x800": { width: 1280, height: 800, isMobile: false },
  "desktop-1920x1080": { width: 1920, height: 1080, isMobile: false },
};
const WANTED = (process.env.PROBE_VIEWPORTS ?? "phone-390,desktop-1280x800")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name in VIEWPORTS)
  .map((name) => ({ name, ...VIEWPORTS[name] }));

/** The folded-box ids the `?collapsedGroups=` seed needs for N groups. */
const groupIds = (count) => Array.from({ length: count }, (_, i) => `grp_wp_${i}`).join(",");

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
await mkdir(OUT, { recursive: true });

/** Idle frame rate plus the long tasks recorded by the page observer. */
async function fpsWindow(page, ms) {
  return page.evaluate(async (duration) => {
    const frames = [];
    await new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        frames.push(performance.now());
        if (performance.now() - start < duration) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    const lt = window.__pulseLt ?? [];
    const span = frames.length > 1 ? frames[frames.length - 1] - frames[0] : 0;
    let dropped = 0;
    for (let i = 1; i < frames.length; i += 1) if (frames[i] - frames[i - 1] > 33) dropped += 1;
    return {
      fps: span > 0 ? Math.round((frames.length / span) * 1000) : 0,
      frames: frames.length,
      dropped,
      longTasks: lt.length,
      longTaskMs: Math.round(lt.reduce((s, e) => s + e.d, 0)),
    };
  }, ms);
}

/** The dot census: how many rate dots exist, which animate, which are parked. */
async function census(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const dots = [...document.querySelectorAll("[data-dot-pulse]")];
    let parked = 0;
    let animating = 0;
    let animatingVisible = 0;
    for (const dot of dots) {
      if (dot.hasAttribute("data-pulse-parked")) parked += 1;
      const running = (dot.getAnimations?.() ?? []).some(
        (a) => a.playState === "running" && !a.transitionProperty,
      );
      if (!running) continue;
      animating += 1;
      const r = dot.getBoundingClientRect();
      if (r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw && r.width > 0 && r.height > 0) {
        animatingVisible += 1;
      }
    }
    let anyRunning = 0;
    for (const el of document.querySelectorAll("*")) {
      const anims = el.getAnimations?.() ?? [];
      if (anims.some((a) => a.playState === "running" && !a.transitionProperty)) anyRunning += 1;
    }
    return { dots: dots.length, parked, animating, animatingVisible, anyRunning };
  });
}

/** How many `pulse_rates` calls the page has made so far. */
async function pulseCalls(page) {
  return page.evaluate(() => {
    const uat = globalThis.__uat;
    if (uat === undefined || typeof uat.calls !== "function") return null;
    return uat.calls().filter((entry) => entry.method === "pulse_rates").length;
  });
}

const results = {
  machine: { chrome: await browser.version(), cpuThrottleRate: CPU },
  groups: GROUPS,
  cases: [],
};

for (const vp of WANTED) {
  for (const N of GROUPS) {
    const query = `?workpulse=${N}${N > 0 ? `&collapsedGroups=${groupIds(N)}` : ""}`;
    const page = await browser.newPage();
    await page.setViewport({
      width: vp.width,
      height: vp.height,
      deviceScaleFactor: vp.isMobile ? 2 : 1,
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
    });
    const session = await page.createCDPSession();
    await session.send("Emulation.setCPUThrottlingRate", { rate: CPU });
    await page.goto(`${BASE}${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    if (N > 0) {
      await page.waitForSelector("[data-collapsed-group-dot]", { timeout: 120_000 });
    } else {
      await page.waitForSelector("[data-thread-card]", { timeout: 120_000 });
    }
    await page.evaluate(() => {
      window.__pulseLt = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__pulseLt.push({ d: e.duration });
        }).observe({ entryTypes: ["longtask"] });
      } catch {}
    });
    await new Promise((r) => setTimeout(r, 1500));

    const startedAt = Date.now();
    // ── 1. GATED (shipped) ──
    const gatedCensus = await census(page);
    const gatedIdle = await fpsWindow(page, 2500);

    // ── 2. UNGATED: remove the gate's stylesheet so every dot animates ──
    const gateRemoved = await page.evaluate(() => {
      const sheet = document.getElementById("focus-board-pulse-gate");
      if (sheet === null) return false;
      sheet.remove();
      return true;
    });
    await new Promise((r) => setTimeout(r, 300));
    const ungatedCensus = await census(page);
    const ungatedIdle = await fpsWindow(page, 2500);

    // ── 3. KILLED: the page's ceiling (no rate pulse runs at all) ──
    await page.addStyleTag({ content: `[data-dot-pulse]{animation:none !important;}` });
    await new Promise((r) => setTimeout(r, 300));
    const killedCensus = await census(page);
    const killedIdle = await fpsWindow(page, 2500);

    const elapsedMs = Date.now() - startedAt;
    const callsAtEnd = await pulseCalls(page);
    const cards = await page.evaluate(() => document.querySelectorAll("[data-thread-card]").length);
    const stylesheetInjected = await page.evaluate(
      () => document.getElementById("focus-board-dot-pulse") !== null,
    );

    results.cases.push({
      viewport: vp.name,
      width: vp.width,
      height: vp.height,
      groups: N,
      query,
      cards,
      rateDots: gatedCensus.dots,
      stylesheetInjected,
      gateRemoved,
      gatedCensus,
      gatedIdle,
      ungatedCensus,
      ungatedIdle,
      killedCensus,
      killedIdle,
      elapsedMs,
      pulseRateCalls: callsAtEnd,
      // Every case's measurement window is well under the hook's 20s poll
      // cadence (9s of fps windows plus setup), so ONE call is the expected
      // count: the mount fetch. A larger number would mean the hook is
      // polling faster than it declares.
      pollsInWindow: callsAtEnd,
    });
    await page.close();
  }
}

// NOTE on the BEFORE numbers. This probe measures the shipped build; its own
// KILLED pass is the ceiling (every rate pulse stopped), which on this feature
// is also the pre-change board, because before it no working dot animated at
// all. The committed evidence keeps both captures anyway, for the same reason
// the attention-pulse probe does: `evidence-4x-before.json` is this same probe
// run against a tree whose rate-pulse source files are stashed, so it reports
// `rateDots: 0`, no injected stylesheet, and no `pulse_rates` call at all.
// Reproduce it with:
//   git stash push -u -- app.tsx server.ts components/thread-card.tsx \
//     components/board.tsx components/parent-lane-board.tsx components/dot-pulse.ts \
//     hooks/use-pulse-rates.ts lib/pulse-rate.ts lib/thread-pulse.ts
//   npx vite build --config scripts/screenshot/vite.probe.config.ts
//   node scripts/screenshot/probe-working-dot-pulse.mjs && git stash pop

await writeFile(`${OUT}evidence.json`, `${JSON.stringify(results, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
await browser.close();

/**
 * Animated-GIF capture for the working dots' rate pulse (issue #279): the
 * folded family box's member dots breathing at three different measured rates,
 * so the difference between a fast thread and a slow one reads at a glance.
 *
 * Renders the real app against the screenshot harness
 * (`?workpulse=3&collapsedGroups=…`, which paints three folded boxes of three
 * active members each and answers `pulse_rates` with 0.5, 4, and 40 tok/s per
 * group), waits for the folded boxes, then photographs the first box every
 * ~110ms for about 4s. Each frame carries that 110ms duration in the GIF, so
 * playback runs at roughly the real pulse speed rather than time-lapsing it.
 *
 * One-time setup: `npm i --no-save puppeteer-core`. Then, in two terminals:
 *   npm run build                                    # harness loads dist/app.css
 *   npx vite --config scripts/screenshot/vite.config.ts
 *   node scripts/screenshot/capture-dot-pulse-gif.mjs
 *
 * Frames land in a temp dir (FRAMES_DIR overrides); the palette-optimized GIF
 * is written to docs/screenshots/dot-pulse.gif (OUT_DIR, GIF_WIDTH and
 * FRAME_MS override, width default 900). ffmpeg does the assembly.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

const execFileP = promisify(execFile);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.HARNESS_URL ?? "http://localhost:5173/";
const OUT_DIR = process.env.OUT_DIR ?? new URL("../../docs/screenshots/", import.meta.url).pathname;
const FRAMES_DIR = process.env.FRAMES_DIR ?? (await mkdtemp(path.join(os.tmpdir(), "dot-pulse-gif-")));
const GIF_PATH = path.join(OUT_DIR, "dot-pulse.gif");
const GIF_WIDTH = Number(process.env.GIF_WIDTH ?? "900");
const FRAME_MS = Number(process.env.FRAME_MS ?? "110");
const FRAME_COUNT = Number(process.env.FRAME_COUNT ?? "36");
const GROUPS = 3;
const GROUP_IDS = Array.from({ length: GROUPS }, (_, i) => `grp_wp_${i}`).join(",");
const QUERY = `?workpulse=${GROUPS}&collapsedGroups=${GROUP_IDS}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 2 },
  args: ["--hide-scrollbars"],
});

const page = await browser.newPage();
const shots = [];

/** The clip the capture frames: the first folded box with a small margin, so
 *  the dots fill the GIF instead of a whole 1280-wide board. */
async function clipOf() {
  const box = await page.evaluate(() => {
    const el = document.querySelector('[data-collapsed-group="grp_wp_0"]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (box === null) throw new Error("the folded family box never rendered");
  const pad = 10;
  return {
    x: Math.max(0, Math.round(box.x - pad)),
    y: Math.max(0, Math.round(box.y - pad)),
    width: Math.round(box.width + pad * 2),
    height: Math.round(box.height + pad * 2),
  };
}

try {
  await page.goto(`${BASE}${QUERY}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector('[data-collapsed-group="grp_wp_0"] [data-dot-pulse]', { timeout: 60_000 });
  const clip = await clipOf();

  for (let i = 0; i < FRAME_COUNT; i += 1) {
    const name = `frame-${String(i).padStart(3, "0")}`;
    await page.screenshot({ path: path.join(FRAMES_DIR, `${name}.png`), clip, timeout: 30_000 });
    shots.push(name);
    // Let the animation advance between frames; the sampler below subtracts
    // the capture time so the GIF's duration tracks real elapsed time.
    await new Promise((r) => setTimeout(r, FRAME_MS));
  }

  const list = path.join(FRAMES_DIR, "frames.txt");
  const seconds = FRAME_MS / 1000;
  const entries = shots.map((name) => `file '${name}.png'\nduration ${seconds}`);
  entries.push(`file '${shots.at(-1)}.png'\nduration ${seconds}`);
  await writeFile(list, `${entries.join("\n")}\n`);
  const vf = [
    `fps=${Math.round(1000 / FRAME_MS)}`,
    `scale=${GIF_WIDTH}:-2:flags=lanczos`,
    "split[a][b]",
    "[a]palettegen=max_colors=128[p]",
    "[b][p]paletteuse=dither=bayer:bayer_scale=4",
  ].join(",");
  await execFileP("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-loop", "0", GIF_PATH]);
  console.log(`done — ${shots.length} frames in ${FRAMES_DIR}; wrote ${GIF_PATH}`);
} finally {
  await browser.close();
}

/**
 * The wallpaper picker's sources (global scope; the picker writes into the
 * same versioned wallpaper document the url field does).
 *
 * - WALLPAPER_PRESETS: bundled SVG-gradient wallpapers shipped as data urls —
 *   offline-first, no third-party dependency, no licensing questions.
 * - PICSUM_*: the deterministic Picsum Photos seed list for photo shuffles
 *   (keyless service, Unsplash-licensed photos served through picsum.photos).
 * - openverseSearchUrl / parseOpenverseResults: the keyless Openverse API
 *   (openly licensed images), the picker's searchable photo source.
 */

export interface WallpaperPreset {
  id: string;
  label: string;
  url: string;
  dim: number;
}

/** Encode an SVG document as an image data url (no quotes or backslashes
 *  survive encodeURIComponent, so the app's url() escaping is a no-op). */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function gradientPreset(
  id: string,
  label: string,
  colors: readonly [string, string, string],
  dim: number,
): WallpaperPreset {
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080">`,
    `<defs>`,
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`,
    `<stop offset="0" stop-color="${colors[0]}"/>`,
    `<stop offset="0.55" stop-color="${colors[1]}"/>`,
    `<stop offset="1" stop-color="${colors[2]}"/>`,
    `</linearGradient>`,
    `<radialGradient id="r" cx="0.82" cy="0.18" r="0.9">`,
    `<stop offset="0" stop-color="${colors[2]}" stop-opacity="0.65"/>`,
    `<stop offset="1" stop-color="${colors[2]}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `</defs>`,
    `<rect width="1920" height="1080" fill="url(#g)"/>`,
    `<rect width="1920" height="1080" fill="url(#r)"/>`,
    `</svg>`,
  ].join("");
  return { id, label, url: svgDataUrl(svg), dim };
}

/** Eight bundled gradient wallpapers, light washes by default (the theme
 *  overlay stays subtle so cards do their own contrast work). */
export const WALLPAPER_PRESETS: readonly WallpaperPreset[] = [
  gradientPreset("aurora", "Aurora", ["#0b3b3c", "#2dd4bf", "#a7f3d0"], 0.25),
  gradientPreset("ember", "Ember", ["#1c0a04", "#b45309", "#f59e0b"], 0.25),
  gradientPreset("meadow", "Meadow", ["#0b1f0e", "#15803d", "#86efac"], 0.25),
  gradientPreset("dusk", "Dusk", ["#1e1035", "#7c3aed", "#f0abfc"], 0.25),
  gradientPreset("ocean", "Ocean", ["#082032", "#1d4ed8", "#7dd3fc"], 0.25),
  gradientPreset("slate", "Slate", ["#0f172a", "#475569", "#94a3b8"], 0.25),
  gradientPreset("sand", "Sand", ["#2a1c07", "#a16207", "#fde68a"], 0.25),
  gradientPreset("night", "Night", ["#030712", "#1e293b", "#475569"], 0.25),
];

/** Stable seeds: the shuffle is deterministic, so a thumbnail and the url it
 *  commits never disagree about which photo they show. */
export const PICSUM_SEEDS: readonly string[] = [
  "focus-board-1",
  "focus-board-2",
  "focus-board-3",
  "focus-board-4",
  "focus-board-5",
  "focus-board-6",
  "focus-board-7",
  "focus-board-8",
];

/** The full-resolution wallpaper url for a seed. */
export function picsumWallpaperUrl(seed: string): string {
  return `https://picsum.photos/seed/${seed}/1920/1080`;
}

/** The picker thumbnail for a seed (same seed, small crop). */
export function picsumThumbUrl(seed: string): string {
  return `https://picsum.photos/seed/${seed}/240/135`;
}

/** The keyless Openverse search url for a query. */
export function openverseSearchUrl(query: string): string {
  return `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=12`;
}

export interface OpenverseImage {
  id: string;
  title: string;
  url: string;
  thumb: string | null;
  license: string;
  creator: string | null;
}

function openverseLicenseLabel(license: unknown, version: unknown): string {
  if (typeof license !== "string" || license.trim() === "") return "unknown license";
  const code = license.trim().toUpperCase();
  const suffix = typeof version === "string" && version.trim() !== "" ? ` ${version.trim()}` : "";
  return `CC ${code}${suffix}`;
}

/**
 * Parse an Openverse search response with the store's tolerance: only
 * http(s) result urls survive, thumbs are optional, non-string titles and
 * creators degrade to fallbacks, and the list caps at twelve.
 */
export function parseOpenverseResults(payload: unknown): OpenverseImage[] {
  if (payload === null || typeof payload !== "object") return [];
  const results: unknown = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];
  const out: OpenverseImage[] = [];
  for (const entry of results) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as {
      id?: unknown;
      title?: unknown;
      url?: unknown;
      thumbnail?: unknown;
      license?: unknown;
      license_version?: unknown;
      creator?: unknown;
    };
    if (typeof record.url !== "string") continue;
    try {
      const url = new URL(record.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    } catch {
      continue;
    }
    const thumb =
      typeof record.thumbnail === "string" &&
      record.thumbnail.startsWith("https://") &&
      record.thumbnail !== ""
        ? record.thumbnail
        : null;
    out.push({
      id: typeof record.id === "string" ? record.id : `${record.url}`,
      title: typeof record.title === "string" && record.title.trim() !== "" ? record.title : "Untitled",
      url: record.url,
      thumb,
      license: openverseLicenseLabel(record.license, record.license_version),
      creator: typeof record.creator === "string" && record.creator.trim() !== "" ? record.creator : null,
    });
    if (out.length >= 12) break;
  }
  return out;
}
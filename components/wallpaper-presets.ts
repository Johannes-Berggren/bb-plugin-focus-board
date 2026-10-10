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
  darkUrl: string;
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
  light: readonly [string, string, string],
  dark: readonly [string, string, string],
  dim: number,
): WallpaperPreset {
  const svg = (colors: readonly [string, string, string]) => [
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
  return { id, label, url: svgDataUrl(svg(light)), darkUrl: svgDataUrl(svg(dark)), dim };
}

/** Eight bundled Maine-flavored gradient wallpapers with a light and a dark
 *  palette each (the scheme flip swaps them live); the theme overlay stays
 *  subtle so cards do their own contrast work. */
export const WALLPAPER_PRESETS: readonly WallpaperPreset[] = [
  // Acadia's granite coast: grays warmed by sea-spray light.
  gradientPreset(
    "acadia",
    "Acadia",
    ["#4a5158", "#8f9aa3", "#dfe6ea"],
    ["#14181d", "#3a444d", "#77828d"],
    0.25,
  ),
  // Wild blueberry: indigo barrens ripening to a pale bloom.
  gradientPreset(
    "blueberry",
    "Blueberry",
    ["#2e1a5e", "#5b3fa8", "#c7b8f0"],
    ["#170b31", "#40247e", "#7c5cd6"],
    0.25,
  ),
  // Lobster shell: deep coral through a steamed-red blush.
  gradientPreset(
    "lobster",
    "Lobster",
    ["#7f1d1d", "#dc2626", "#fca5a5"],
    ["#450a0a", "#991b1b", "#ef4444"],
    0.25,
  ),
  // Upland pine: dark spruce greens with needle-highlight glints.
  gradientPreset(
    "pine",
    "Pine",
    ["#0f2417", "#2f6b3f", "#a3d9a5"],
    ["#05130b", "#14532d", "#4ade80"],
    0.25,
  ),
  // Coastal fog: soft grays rolling in over a pale sky.
  gradientPreset(
    "fog",
    "Fog",
    ["#6b7280", "#9ca3af", "#e5e7eb"],
    ["#111827", "#374151", "#6b7280"],
    0.25,
  ),
  // Tide pools: deep sea blues to a shallow-shell glow.
  gradientPreset(
    "tide",
    "Tide",
    ["#0c4a6e", "#0284c7", "#bae6fd"],
    ["#082f49", "#0369a1", "#38bdf8"],
    0.25,
  ),
  // Dawn over Cadillac Mountain: first light in the eastern US.
  gradientPreset(
    "dawn",
    "Dawn",
    ["#7c2d12", "#ea580c", "#fed7aa"],
    ["#431407", "#c2410c", "#fdba74"],
    0.25,
  ),
  // Fall foliage: turning maples from gold to ember.
  gradientPreset(
    "foliage",
    "Foliage",
    ["#5c2e0e", "#b45309", "#fbbf24"],
    ["#3b1606", "#92400e", "#f59e0b"],
    0.25,
  ),
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

/**
 * The keyless Openverse search url for a query, at `page` (page 1 is the
 * API's own default, but it stays on the wire so a re-searched page and the
 * first page are never confused).
 */
export function openverseSearchUrl(query: string, page = 1): string {
  return `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&page_size=12&page=${page}`;
}

/**
 * The response's page_count — the last reachable page (Openverse caps
 * anonymous pagination depth, and the field reports that cap). Garbage or
 * absence degrades to null; the picker then paginates without an end.
 */
export function openversePageCount(payload: unknown): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const pageCount = (payload as { page_count?: unknown }).page_count;
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 1) return null;
  return pageCount;
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
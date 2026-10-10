import type { GroupBy } from "./grouping";
import type { CSSProperties } from "react";

/**
 * The "Nest child threads" toggle's localStorage persistence (R3). The
 * parsing lives here — pure, unit-testable without a DOM — so app.tsx only
 * wires localStorage access around it.
 */

export const NEST_CHILDREN_KEY = "focus-board:nestChildren";

/** Stored values are `"on"`/`"off"`; anything else (or nothing) defaults to ON. */
export function parseNestStored(raw: string | null): boolean {
  return raw === "off" ? false : true;
}

export function nestStoredValue(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

/** The Group-by dropdown's localStorage persistence (D1). */
export const GROUP_BY_KEY = "focus-board:groupBy";

const ALLOWED_GROUP_BY: readonly GroupBy[] = [
  "none",
  "status",
  "recency",
  "project",
  "provider",
  "machine",
  "parent",
  "group",
];

/** Validate a stored group-by value; anything stale or unknown falls back to Attention. */
export function parseGroupStored(raw: string | null): GroupBy {
  return (ALLOWED_GROUP_BY as readonly string[]).includes(raw ?? "")
    ? (raw as GroupBy)
    : "status";
}

/** The parent-lane board lane-order toggle (D5a): recency (default) or project grouping. */
export const PARENT_LANE_ORDER_KEY = "focus-board:parentLaneOrder";

export type ParentLaneOrder = "recency" | "project";

const ALLOWED_PARENT_LANE_ORDER: readonly ParentLaneOrder[] = ["recency", "project"];

/** Validate the stored lane-order value; anything stale or unknown falls back to recency. */
export function parseParentLaneOrderStored(raw: string | null): ParentLaneOrder {
  return (ALLOWED_PARENT_LANE_ORDER as readonly string[]).includes(raw ?? "")
    ? (raw as ParentLaneOrder)
    : "recency";
}

/**
 * Collapsed family cards' persistence. The stored list holds the PARENT
 * thread ids whose nested child rows are collapsed; every id absent from it
 * renders expanded (the default), so the list only ever records deliberate
 * collapses. Tolerant like every other stored value: corrupt JSON, a
 * non-array, or non-string entries degrade to fewer (or zero) collapsed
 * families, never to a board that fails to load.
 */
export const COLLAPSED_FAMILIES_KEY = "focus-board:collapsedFamilies";

export function parseCollapsedFamiliesStored(raw: string | null): ReadonlySet<string> {
  if (raw === null || raw === "") return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    return new Set();
  }
}

/** Sorted for a stable stored form, so equal sets round-trip byte-identical. */
export function collapsedFamiliesStoredValue(ids: ReadonlySet<string>): string {
  return JSON.stringify([...ids].sort());
}

/**
 * The server-declared boolean setting backing the thread pane's Escape
 * behavior (see server.ts `escStopsRunningThread`). Only an explicit stored
 * `false` is off: while loading, unset (default applied host-side as true),
 * or an unexpected type, the default ON applies.
 */
export function escStopsRunningFromSetting(
  value: string | number | boolean | undefined,
): boolean {
  return value !== false;
}

/**
 * The board wallpaper's localStorage persistence. Versioned document with a
 * single GLOBAL layer for now; per-project / per-group overrides extend this
 * same document (version 2) instead of growing sibling keys, so every scope
 * keeps one parser.
 */
export const WALLPAPER_KEY = "focus-board:wallpaper";

/** One wallpaper layer: where the image lives and how strongly the theme
 *  background wash covers it. */
export interface WallpaperLayer {
  /** http(s) or data URL. Anything else is refused at parse time so a
   *  javascript:-style string can never reach a CSS url(). */
  url: string;
  /** The dark-scheme variant (optional): a matchMedia
   *  (prefers-color-scheme: dark) flip swaps the paint to this url. Same
   *  url rules as `url`; an invalid stored value degrades by dropping the
   *  FIELD only (the layer survives with the light url). */
  darkUrl?: string;
  /** Overlay opacity in [0, 0.9]; 0 = untinted image, high dim keeps cards readable. */
  dim: number;
}

export interface WallpaperSettings {
  version: 1;
  global: WallpaperLayer | null;
}

export const NO_WALLPAPER: WallpaperSettings = { version: 1, global: null };

/** Dim bounds and the default for a layer that arrives without one. */
const WALLPAPER_DIM_MIN = 0;
const WALLPAPER_DIM_MAX = 0.9;
const WALLPAPER_DIM_DEFAULT = 0.35;

function clampWallpaperDim(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return WALLPAPER_DIM_DEFAULT;
  return Math.min(
    WALLPAPER_DIM_MAX,
    Math.max(WALLPAPER_DIM_MIN, raw),
  );
}

/** True for http(s) and data image-reference URLs; everything else (a
 *  javascript:-style scheme, a plain word, an invalid URL) is refused so it
 *  can never reach a CSS url() or a committed wallpaper document. */
export function isAllowedWallpaperUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "data:";
  } catch {
    return false;
  }
}

function parseWallpaperLayer(raw: unknown): WallpaperLayer | null {
  if (raw === null || typeof raw !== "object") return null;
  const record = raw as { url?: unknown; dim?: unknown; darkUrl?: unknown };
  if (typeof record.url !== "string") return null;
  const url = record.url.trim();
  if (url === "" || !isAllowedWallpaperUrl(url)) return null;
  // Per-key tolerance like every other stored value: a bad darkUrl drops the
  // FIELD, never the layer (dark mode then falls back to the light url).
  let darkUrl: string | undefined;
  if (typeof record.darkUrl === "string") {
    const dark = record.darkUrl.trim();
    if (dark !== "" && isAllowedWallpaperUrl(dark)) darkUrl = dark;
  }
  // A missing dim takes the default; a garbage-typed dim drops the whole
  // layer, so no stale image ever renders untinted by accident.
  if (record.dim === undefined) {
    return darkUrl === undefined ? { url, dim: WALLPAPER_DIM_DEFAULT } : { url, dim: WALLPAPER_DIM_DEFAULT, darkUrl };
  }
  if (typeof record.dim !== "number" || !Number.isFinite(record.dim)) return null;
  return darkUrl === undefined
    ? { url, dim: clampWallpaperDim(record.dim) }
    : { url, dim: clampWallpaperDim(record.dim), darkUrl };
}

/**
 * The url a wallpaper layer paints right now: the dark variant while the OS
 * prefers dark, the light url otherwise (and whenever no dark variant exists).
 */
export function resolvedWallpaperUrl(
  layer: Pick<WallpaperLayer, "url" | "darkUrl">,
  isDark: boolean,
): string {
  return isDark ? layer.darkUrl ?? layer.url : layer.url;
}

/**
 * The style object the panel root paints a wallpaper with, letterboxed
 * (contain, no-repeat, centered — full-fit beats aggressive cropping), with
 * the url escaped so quotes and backslashes can never break out of url().
 * Null = no wallpaper (the caller paints no background style at all).
 */
export function wallpaperBackgroundStyle(
  layer: WallpaperLayer | null,
  isDark: boolean,
): CSSProperties | null {
  if (layer === null) return null;
  const url = resolvedWallpaperUrl(layer, isDark).replace(/["\\]/gu, "\\$&");
  return {
    backgroundImage: `url("${url}")`,
    backgroundSize: "contain",
    backgroundRepeat: "no-repeat",
    backgroundPosition: "center",
  };
}

/**
 * Validate a stored wallpaper document with the same tolerance as every
 * other stored preference: corruption, a foreign version, or a rejected url
 * degrades to NO_WALLPAPER rather than a board that fails to load.
 */
export function parseWallpaperStored(raw: string | null): WallpaperSettings {
  if (raw === null || raw === "") return NO_WALLPAPER;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return NO_WALLPAPER;
    const record = parsed as { version?: unknown; global?: unknown };
    if (record.version !== 1) return NO_WALLPAPER;
    if (record.global === null) return NO_WALLPAPER;
    const layer = parseWallpaperLayer(record.global);
    return layer === null ? NO_WALLPAPER : { version: 1, global: layer };
  } catch {
    return NO_WALLPAPER;
  }
}

/** The layer the board currently paints behind itself (null = none). */
export function wallpaperLayerOf(settings: WallpaperSettings): WallpaperLayer | null {
  return settings.global;
}

/** Sorted and trimmed for a stable stored form, like collapsedFamilies. */
export function wallpaperStoredValue(settings: WallpaperSettings): string {
  if (settings.global === null) return JSON.stringify({ version: 1, global: null });
  const layer = parseWallpaperLayer(settings.global) ?? null;
  return JSON.stringify({ version: 1, global: layer });
}

import { describe, expect, it } from "vitest";
import {
  COLLAPSED_FAMILIES_KEY,
  NEST_CHILDREN_KEY,
  WALLPAPER_KEY,
  collapsedFamiliesStoredValue,
  escStopsRunningFromSetting,
  nestStoredValue,
  parseCollapsedFamiliesStored,
  parseGroupStored,
  parseNestStored,
  parseParentLaneOrderStored,
  parseWallpaperStored,
  wallpaperLayerOf,
  wallpaperStoredValue,
} from "../components/preferences";

describe("wallpaper persistence", () => {
  it("exposes the localStorage key", () => {
    expect(WALLPAPER_KEY).toBe("focus-board:wallpaper");
  });

  it("round-trips a global url and dim", () => {
    const settings = { version: 1 as const, global: { url: "https://example.com/w.png", dim: 0.4 } };
    expect(parseWallpaperStored(wallpaperStoredValue(settings))).toEqual(settings);
    expect(wallpaperStoredValue(settings)).toBe(
      '{"version":1,"global":{"url":"https://example.com/w.png","dim":0.4}}',
    );
  });

  it("round-trips an unset wallpaper", () => {
    expect(parseWallpaperStored(wallpaperStoredValue({ version: 1, global: null }))).toEqual({
      version: 1,
      global: null,
    });
  });

  it("defaults to no wallpaper for null / empty / garbage", () => {
    for (const raw of [null, "", "not json", "123", "null", "[1,2,3]", JSON.stringify(5)]) {
      expect(parseWallpaperStored(raw)).toEqual({ version: 1, global: null });
    }
  });

  it("drops stored shapes it does not understand", () => {
    expect(parseWallpaperStored(JSON.stringify({ version: 2, global: { url: "https://a", dim: 0 } }))).toEqual({ version: 1, global: null });
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: 7, dim: 0 } }))).toEqual({ version: 1, global: null });
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: "high" } }))).toEqual({ version: 1, global: null });
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "", dim: 0 } }))).toEqual({ version: 1, global: null });
  });

  it("rejects non-http(s)/data url schemes instead of rendering them", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "chrome://settings",
      "not-a-url",
      "ftp://example.com/w.png",
    ]) {
      expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url, dim: 0.3 } }))).toEqual({ version: 1, global: null });
    }
  });

  it("accepts https, http, and data urls", () => {
    const url = "data:image/png;base64,iVBORw0KGgo=";
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url, dim: 0.3 } })).global?.url).toBe(url);
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "http://intranet/w.jpg", dim: 0.3 } })).global?.url).toBe("http://intranet/w.jpg");
  });

  it("clamps dim into [0, 0.9] and defaults to 0.35 when absent or invalid", () => {
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: 2 } })).global?.dim).toBe(0.9);
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a", dim: -1 } })).global?.dim).toBe(0);
    expect(parseWallpaperStored(JSON.stringify({ version: 1, global: { url: "https://a" } })).global?.dim).toBe(0.35);
  });

  it("exposes the active layer through wallpaperLayerOf (the future per-project read builds on it)", () => {
    expect(wallpaperLayerOf({ version: 1, global: null })).toBeNull();
    expect(wallpaperLayerOf({ version: 1, global: { url: "https://a", dim: 0.4 } })).toEqual({
      url: "https://a",
      dim: 0.4,
    });
  });
});

describe("nesting toggle persistence (R3)", () => {
  it("exposes the localStorage key", () => {
    expect(NEST_CHILDREN_KEY).toBe("focus-board:nestChildren");
  });

  it("round-trips: on for true, off for false", () => {
    expect(parseNestStored(nestStoredValue(true))).toBe(true);
    expect(parseNestStored(nestStoredValue(false))).toBe(false);
    expect(nestStoredValue(true)).toBe("on");
    expect(nestStoredValue(false)).toBe("off");
  });

  it("defaults to ON (nesting enabled) for null — first visit", () => {
    expect(parseNestStored(null)).toBe(true);
  });

  it("validates like readStored: any invalid stored value falls back to ON", () => {
    expect(parseNestStored("yes")).toBe(true);
    expect(parseNestStored("")).toBe(true);
    expect(parseNestStored("OFF")).toBe(true); // case-sensitive allow-list
    expect(parseNestStored("0")).toBe(true);
  });
});

describe("collapsed family persistence", () => {
  it("exposes the localStorage key", () => {
    expect(COLLAPSED_FAMILIES_KEY).toBe("focus-board:collapsedFamilies");
  });

  it("round-trips a set of parent ids", () => {
    const ids = new Set(["thr_a", "thr_b"]);
    expect([...parseCollapsedFamiliesStored(collapsedFamiliesStoredValue(ids))].sort()).toEqual([
      "thr_a",
      "thr_b",
    ]);
  });

  it("defaults to an empty set for null — first visit, everything expanded", () => {
    expect(parseCollapsedFamiliesStored(null).size).toBe(0);

  });

  it("falls back to an empty set on corrupt JSON", () => {
    expect(parseCollapsedFamiliesStored("{not json").size).toBe(0);
    expect(parseCollapsedFamiliesStored("").size).toBe(0);
  });

  it("falls back to an empty set when the stored value is not an array", () => {
    expect(parseCollapsedFamiliesStored(JSON.stringify({ thr_a: true })).size).toBe(0);
    expect(parseCollapsedFamiliesStored(JSON.stringify("thr_a")).size).toBe(0);
  });

  it("drops non-string entries instead of admitting them", () => {
    const parsed = parseCollapsedFamiliesStored(JSON.stringify(["thr_a", 7, null, {}]));
    expect([...parsed]).toEqual(["thr_a"]);
  });
});

describe("Esc-stops-thread setting read side", () => {
  // The server-declared boolean renders in the plugin detail page's config
  // panel; the board reads it reactively through `useSettings()` and
  // narrows the value through this helper.
  it("is off only for an explicit stored false", () => {
    expect(escStopsRunningFromSetting(false)).toBe(false);
  });

  it("defaults to ON for unset, loading, and unexpected values", () => {
    expect(escStopsRunningFromSetting(undefined)).toBe(true); // loading / unset
    expect(escStopsRunningFromSetting(true)).toBe(true);
    expect(escStopsRunningFromSetting(0)).toBe(true);
    expect(escStopsRunningFromSetting("off")).toBe(true); // wrong type
  });
});
describe("simultaneous corruption (every key garbage at once)", () => {
  // The 1.0 hardening pass: per-key degradation is pinned above; this pins
  // the WHOLE-storage case — every persisted preference corrupted in the
  // same session still degrades to the documented fallbacks, so the board
  // always renders. The law is per-parser (the storage keys have no shared
  // read path), so the same garbage list drives every parser at once.
  const garbage: Array<string | null> = [
    null,
    "",
    "not json",
    "{",
    "123",
    "null",
    "[1,2,3]",
    JSON.stringify({ wakeAt: 123 }),
    JSON.stringify(5),
  ];

  it("every parser survives the full garbage list and returns its documented fallback", () => {
    for (const raw of garbage) {
      expect(parseNestStored(raw)).toBe(true); // default ON
      expect(parseGroupStored(raw)).toBe("status"); // Attention fallback
      expect(parseParentLaneOrderStored(raw)).toBe("recency");
      expect(parseWallpaperStored(raw)).toEqual({ version: 1, global: null });
      expect(parseCollapsedFamiliesStored(raw)).toBeInstanceOf(Set);
      for (const id of parseCollapsedFamiliesStored(raw)) {
        expect(typeof id).toBe("string");
      }
    }
  });
});

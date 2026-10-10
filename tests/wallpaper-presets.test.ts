// The shipped wallpaper sources: SVG-gradient presets bundled as data urls
// (offline-first, zero third-party dependency) and the deterministic Picsum
// seed list for photo shuffles. Every produced url must survive the same
// validation the store applies, so a preset or thumb can never be typed in
// a form the wallpaper document would refuse.
import { describe, expect, it } from "vitest";
import {
  PICSUM_SEEDS,
  WALLPAPER_PRESETS,
  openversePageCount,
  openverseSearchUrl,
  parseOpenverseResults,
  picsumThumbUrl,
  picsumWallpaperUrl,
} from "../components/wallpaper-presets";
import {
  isAllowedWallpaperUrl,
  parseWallpaperStored,
  wallpaperStoredValue,
} from "../components/preferences";

describe("shipped Maine-flavored wallpaper presets", () => {
  it("is exactly the Maine lineup with unique ids and labels", () => {
    expect(WALLPAPER_PRESETS.map((preset) => preset.label)).toEqual([
      "Acadia",
      "Blueberry",
      "Lobster",
      "Pine",
      "Fog",
      "Tide",
      "Dawn",
      "Foliage",
    ]);
    const ids = new Set(WALLPAPER_PRESETS.map((preset) => preset.id));
    expect(ids.size).toBe(WALLPAPER_PRESETS.length);
    const labels = new Set(WALLPAPER_PRESETS.map((preset) => preset.label));
    expect(labels.size).toBe(WALLPAPER_PRESETS.length);
    for (const preset of WALLPAPER_PRESETS) {
      expect(preset.dim).toBeLessThanOrEqual(0.9);
      expect(preset.dim).toBeGreaterThanOrEqual(0);
    }
  });

  it("every preset carries BOTH variants; both urls allowed and both survive the store round-trip", () => {
    for (const preset of WALLPAPER_PRESETS) {
      expect(isAllowedWallpaperUrl(preset.url)).toBe(true);
      expect(isAllowedWallpaperUrl(preset.darkUrl)).toBe(true);
      const roundTripped = parseWallpaperStored(
        wallpaperStoredValue({
          version: 1,
          global: { url: preset.url, dim: preset.dim, darkUrl: preset.darkUrl },
        }),
      );
      expect(roundTripped.global).toEqual({ url: preset.url, dim: preset.dim, darkUrl: preset.darkUrl });
    }
  });

  it("light and dark palettes differ for every preset", () => {
    for (const preset of WALLPAPER_PRESETS) {
      expect(preset.darkUrl).not.toBe(preset.url);
    }
  });

  it("dim stays around 0.25 so cards keep doing their own contrast work", () => {
    for (const preset of WALLPAPER_PRESETS) {
      expect(preset.dim).toBe(0.25);
    }
  });
});

describe("picsum shuffle urls", () => {
  it("each seed yields a stable 1920x1080 url and a 240x135 thumbnail", () => {
    expect(PICSUM_SEEDS.length).toBe(8);
    expect(picsumWallpaperUrl("focus-board-3")).toBe(
      "https://picsum.photos/seed/focus-board-3/1920/1080",
    );
    expect(picsumThumbUrl("focus-board-3")).toBe("https://picsum.photos/seed/focus-board-3/240/135");
    for (const seed of PICSUM_SEEDS) {
      expect(isAllowedWallpaperUrl(picsumWallpaperUrl(seed))).toBe(true);
    }
  });
});

describe("openverse search url and result parsing", () => {
  it("encodes the query and requested page into the keyless api url", () => {
    expect(openverseSearchUrl("mountain lake")).toBe(
      "https://api.openverse.org/v1/images/?q=mountain%20lake&page_size=12&page=1",
    );
    expect(openverseSearchUrl("mountain lake", 3)).toBe(
      "https://api.openverse.org/v1/images/?q=mountain%20lake&page_size=12&page=3",
    );
  });

  it("reads the response's page_count tolerantly (missing or garbage degrades to null)", () => {
    expect(openversePageCount({ page_count: 80 })).toBe(80);
    expect(openversePageCount({ results: [] })).toBeNull();
    expect(openversePageCount({ page_count: 0 })).toBeNull();
    expect(openversePageCount({ page_count: -2 })).toBeNull();
    expect(openversePageCount({ page_count: 1.5 })).toBeNull();
    expect(openversePageCount({ page_count: "3" })).toBeNull();
    expect(openversePageCount(null)).toBeNull();
    expect(openversePageCount("no")).toBeNull();
  });

  it("parses results tolerantly: https-only, thumbs optional, capped at 12", () => {
    const parsed = parseOpenverseResults({
      results: [
        {
          id: "a",
          title: "Sunset",
          url: "https://example.com/a.jpg",
          thumbnail: "https://api.openverse.org/v1/images/a/thumb/",
          license: "by",
          license_version: "2.0",
          creator: "Ada",
        },
        { id: "b", url: "javascript:alert(1)", title: "bad" },
        { id: "c", url: "https://example.com/c.jpg" },
        { title: "no url at all (dropped)" },
      ],
    });
    expect(parsed.length).toBe(2);
    expect(parsed[0]).toEqual({
      id: "a",
      title: "Sunset",
      url: "https://example.com/a.jpg",
      thumb: "https://api.openverse.org/v1/images/a/thumb/",
      license: "CC BY 2.0",
      creator: "Ada",
    });
    expect(parsed[1]).toEqual({
      id: "c",
      title: "Untitled",
      url: "https://example.com/c.jpg",
      thumb: null,
      license: "unknown license",
      creator: null,
    });
  });

  it("degrades non-array garbage to an empty list", () => {
    expect(parseOpenverseResults(null)).toEqual([]);
    expect(parseOpenverseResults({ results: 5 })).toEqual([]);
    expect(parseOpenverseResults("no")).toEqual([]);
  });
});
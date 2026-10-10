// @vitest-environment jsdom
// The toolbar's Wallpaper control: an Image icon button opens a small
// popover with an image-url input and a dim slider. A typed url applies
// immediately (like the search box) and lands on onWallpaperChange as a
// versioned settings document; the Remove row (rendered only while a
// wallpaper is active) drops it back to global: null. The trigger reads
// active (amber ink) while a wallpaper renders behind the board.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";
import { WALLPAPER_PRESETS } from "../components/wallpaper-presets";
import type { WallpaperSettings } from "../components/preferences";
import type { FilterState } from "../components/grouping";

const PROVIDERS = [
  { id: "p-alpha-1", displayName: "Alpha One" },
  { id: "p-beta-1", displayName: "Beta One" },
];

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function toolbarProps(
  wallpaper: WallpaperSettings,
  overrides: Partial<BoardToolbarProps> = {},
): BoardToolbarProps {
  const filter: FilterState = {
    projects: new Set(),
    providers: new Set(),
    states: new Set(),
  };
  return {
    groupBy: "status",
    onGroupByChange: vi.fn(),
    nestChildren: false,
    onNestChildrenChange: vi.fn(),
    nestingLocked: false,
    filter,
    onFilterChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    projectIds: new Set<string>(),
    providerIds: new Set(PROVIDERS.map((provider) => provider.id)),
    projects: [],
    providers: PROVIDERS,
    onCreateProject: vi.fn(() => Promise.resolve()),
    totalCount: 0,
    onClearFilters: vi.fn(),
    anyFilterActive: false,
    onNewThread: vi.fn(),
    whatsNewUnseen: false,
    onOpenWhatsNew: vi.fn(),
    wallpaper,
    onWallpaperChange: vi.fn(),
    ...overrides,
  };
}

function renderToolbar(
  wallpaper: WallpaperSettings,
  overrides: Partial<BoardToolbarProps> = {},
): { onWallpaperChange: ReturnType<typeof vi.fn> } {
  const props = toolbarProps(wallpaper, overrides);
  const onWallpaperChange = props.onWallpaperChange as unknown as ReturnType<typeof vi.fn>;
  render(<BoardToolbar {...props} />);
  return { onWallpaperChange };
}

const NO_WALLPAPER: WallpaperSettings = { version: 1, global: null };

function openPopover(): void {
  fireEvent.click(screen.getByRole("button", { name: "Wallpaper" }));
}

afterEach(cleanup);

describe("toolbar wallpaper control", () => {
  it("opens a popover with an image-url input and a dim slider", () => {
    renderToolbar(NO_WALLPAPER, { wallpaper: NO_WALLPAPER });
    expect(screen.queryByRole("textbox", { name: "Wallpaper image url" })).toBeNull();
    openPopover();
    expect(screen.getByRole("textbox", { name: "Wallpaper image url" })).toBeTruthy();
    expect(screen.getByRole("slider", { name: "Wallpaper dim" })).toBeTruthy();
  });

  it("typing a url commits it as the global wallpaper, preserving the shown dim", () => {
    const { onWallpaperChange } = renderToolbar(
      { version: 1, global: null },
    );
    openPopover();
    const input = screen.getByRole("textbox", { name: "Wallpaper image url" });
    fireEvent.change(input, { target: { value: "https://example.com/w.png" } });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35 },
    });
  });

  it("typing a non-http/data string is refused: nothing changes and the input reads invalid", () => {
    const { onWallpaperChange } = renderToolbar(NO_WALLPAPER);
    openPopover();
    fireEvent.change(screen.getByRole("textbox", { name: "Wallpaper image url" }), {
      target: { value: "javascript:alert(1)" },
    });
    expect(onWallpaperChange).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Wallpaper image url" }).getAttribute("aria-invalid")).toBe("true");
  });

  it("the dim slider changes only the dim of the active wallpaper", () => {
    const { onWallpaperChange } = renderToolbar({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35 },
    });
    openPopover();
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper dim" }), {
      target: { value: "0.6" },
    });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6 },
    });
  });

  it("Remove is rendered only while a wallpaper is active and commits global: null", () => {
    renderToolbar(NO_WALLPAPER, { wallpaper: NO_WALLPAPER });
    openPopover();
    expect(screen.queryByRole("button", { name: "Remove wallpaper" })).toBeNull();

    cleanup();
    const { onWallpaperChange } = renderToolbar({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35 },
    });
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Remove wallpaper" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({ version: 1, global: null });
  });

  it("renders the shipped preset swatches and commits one on click, keeping the shown dim", () => {
    const { onWallpaperChange } = renderToolbar(NO_WALLPAPER);
    openPopover();
    const count = screen.getAllByRole("button", { name: /Wallpaper preset: / }).length;
    expect(count).toBeGreaterThanOrEqual(8);
    fireEvent.click(screen.getByRole("button", { name: "Wallpaper preset: Acadia" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: {
        url: expect.stringMatching(/^data:image\/svg\+xml/),
        dim: 0.35,
        darkUrl: expect.stringMatching(/^data:image\/svg\+xml/),
      },
    });
  });

  it("marks the active preset (aria-pressed) so the stored url is visible in the grid", () => {
    // No wallpaper: nothing pressed.
    const { unmount } = render(<BoardToolbar {...toolbarProps(NO_WALLPAPER)} />);
    openPopover();
    for (const button of screen.getAllByRole("button", { name: /Wallpaper preset: / })) {
      expect(button.getAttribute("aria-pressed")).toBe("false");
    }
    unmount();

    cleanup();
    const acadia = WALLPAPER_PRESETS.find((preset) => preset.label === "Acadia");
    if (acadia === undefined) throw new Error("missing Acadia preset");
    renderToolbar({ version: 1, global: { url: acadia.url, dim: 0.35, darkUrl: acadia.darkUrl } });
    openPopover();
    expect(
      screen.getByRole("button", { name: "Wallpaper preset: Acadia" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("renders Picsum thumbnails; clicking one commits its 1920x1080 url", () => {
    const { onWallpaperChange } = renderToolbar(NO_WALLPAPER);
    openPopover();
    const expected = screen.getAllByRole("button", { name: /Picsum: / }).length;
    expect(expected).toBe(8);
    fireEvent.click(screen.getByRole("button", { name: "Picsum: focus-board-3" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://picsum.photos/seed/focus-board-3/1920/1080", dim: 0.35 },
    });
  });

  it("an active dim is kept when a preset or Picsum thumb commits (not the 0.35 default)", () => {
    const { onWallpaperChange } = renderToolbar({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6 },
    });
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Picsum: focus-board-3" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://picsum.photos/seed/focus-board-3/1920/1080", dim: 0.6 },
    });
  });
  it("the dim slider preserves an active layer's dark variant", () => {
    const { onWallpaperChange } = renderToolbar({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.35, darkUrl: "https://example.com/w-dark.png" },
    });
    openPopover();
    fireEvent.change(screen.getByRole("slider", { name: "Wallpaper dim" }), {
      target: { value: "0.6" },
    });
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/w.png", dim: 0.6, darkUrl: "https://example.com/w-dark.png" },
    });
  });

  it("a preset swatch previews the current scheme's variant and flips live with the OS scheme", () => {
    const listeners: Array<() => void> = [];
    const state = { matches: false };
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return state.matches;
      },
      addEventListener(_type: string, listener: () => void) {
        listeners.push(listener);
      },
      removeEventListener: vi.fn(),
    }));
    const acadia = WALLPAPER_PRESETS.find((preset) => preset.label === "Acadia");
    if (acadia === undefined) throw new Error("missing Acadia preset");
    renderToolbar(NO_WALLPAPER);
    openPopover();
    const swatchStyle = () =>
      screen.getByRole("button", { name: "Wallpaper preset: Acadia" }).getAttribute("style") ?? "";
    expect(swatchStyle()).toContain(acadia.url);
    expect(swatchStyle()).not.toContain(acadia.darkUrl);
    act(() => {
      state.matches = true;
      for (const listener of listeners) listener();
    });
    expect(swatchStyle()).toContain(acadia.darkUrl);
    act(() => {
      state.matches = false;
      for (const listener of listeners) listener();
    });
    expect(swatchStyle()).not.toContain(acadia.darkUrl);
  });
});

describe("Openverse search in the wallpaper picker", () => {
  function mockFetch(behavior: "ok" | "empty" | "reject"): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn((_url: unknown, _init?: unknown) => {
      if (behavior === "reject") return Promise.reject(new Error("network gone"));
      if (behavior === "empty") {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ results: [] }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            results: [
              {
                id: "ov-1",
                title: "Sunset Beach",
                url: "https://example.com/sunset.jpg",
                thumbnail: "https://api.openverse.org/v1/images/ov-1/thumb/",
                license: "by",
                license_version: "2.0",
                creator: "Ada",
              },
              {
                id: "ov-2",
                title: "Not an image",
                url: "not-a-url",
                thumbnail: null,
                license: "",
                license_version: "",
                creator: "",
              },
            ],
          }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searching hits api.openverse.org and renders clickable results (bad urls dropped)", async () => {
    const fetchMock = mockFetch("ok");
    const { onWallpaperChange } = renderToolbar(NO_WALLPAPER);
    openPopover();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" })).toBeTruthy(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openverse.org/v1/images/?q=mountain%20lake&page_size=12",
      expect.anything(),
    );
    expect(screen.queryByRole("button", { name: "Not an image (unknown license)" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sunset Beach (CC BY 2.0)" }));
    expect(onWallpaperChange).toHaveBeenCalledWith({
      version: 1,
      global: { url: "https://example.com/sunset.jpg", dim: 0.35 },
    });
  });

  it("an empty result set renders a visible no-results line", async () => {
    mockFetch("empty");
    renderToolbar(NO_WALLPAPER);
    openPopover();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "nothing matches" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("No images found for “nothing matches”.")));
  });

  it("a failed search renders the failure (with the reason) and commits nothing", async () => {
    mockFetch("reject");
    const { onWallpaperChange } = renderToolbar(NO_WALLPAPER);
    openPopover();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Openverse" }), {
      target: { value: "mountain lake" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText(/Openverse search failed/)).toBeTruthy());
    expect(onWallpaperChange).not.toHaveBeenCalled();
  });
});
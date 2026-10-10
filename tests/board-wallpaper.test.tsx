// @vitest-environment jsdom
// The toolbar's Wallpaper control: an Image icon button opens a small
// popover with an image-url input and a dim slider. A typed url applies
// immediately (like the search box) and lands on onWallpaperChange as a
// versioned settings document; the Remove row (rendered only while a
// wallpaper is active) drops it back to global: null. The trigger reads
// active (amber ink) while a wallpaper renders behind the board.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";
import type { WallpaperSettings } from "../components/preferences";
import type { FilterState } from "../components/grouping";

const PROVIDERS = [
  { id: "p-alpha-1", displayName: "Alpha One" },
  { id: "p-beta-1", displayName: "Beta One" },
];

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function renderToolbar(
  wallpaper: WallpaperSettings,
  overrides: Partial<BoardToolbarProps> = {},
): { onWallpaperChange: ReturnType<typeof vi.fn> } {
  const onWallpaperChange = vi.fn();
  const filter: FilterState = {
    projects: new Set(),
    providers: new Set(),
    states: new Set(),
  };
  const props: BoardToolbarProps = {
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
    onWallpaperChange,
    ...overrides,
  };
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
});
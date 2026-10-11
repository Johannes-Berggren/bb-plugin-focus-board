// @vitest-environment jsdom
// Toolbar layout: one line, height-matched, three zones. New thread stands
// alone; search pairs with the View mode chip (no colon label — it names the
// current view like a mode, not a filter); the Project/Provider/State
// filters run together with the thread count and the settings gear/gift as
// one trailing cluster, so wrapping never strands the count across a void.
// The gear/gift is one icon with a binary costume: a pulsing gift while the
// changelog has unseen content (click deep-links to the What's-new tab), a
// plain settings gear otherwise (click opens on Behavior).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BoardToolbar } from "../components/board-toolbar";

type BoardToolbarProps = Parameters<typeof BoardToolbar>[0];

function renderToolbar(
  overrides: Partial<BoardToolbarProps> = {},
): HTMLElement {
  const props = {
    groupBy: "status" as const,
    onGroupByChange: vi.fn(),
    nestChildren: true,
    onNestChildrenChange: vi.fn(),
    nestingLocked: false,
    filter: { projects: new Set<string>(), providers: new Set<string>(), states: new Set<string>() },
    onFilterChange: vi.fn(),
    search: "",
    onSearchChange: vi.fn(),
    projectIds: new Set<string>(),
    providerIds: new Set<string>(),
    projects: [],
    providers: [],
    onCreateProject: vi.fn(),
    totalCount: 7,
    onClearFilters: vi.fn(),
    anyFilterActive: false,
    onNewThread: vi.fn(),
    whatsNewUnseen: false,
    onOpenSettings: vi.fn(),
    ...overrides,
  } as unknown as BoardToolbarProps;
  const view = render(<BoardToolbar {...props} />);
  return view.container.firstElementChild as HTMLElement;
}

/** True when `b` renders after `a` in DOM order. */
function follows(a: Element, b: Element): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

/** The closest element that contains both, walking up from `a`. */
function commonAncestor(a: Element, b: Element): Element | null {
  let ancestor: Element | null = a.parentElement;
  while (ancestor !== null && !ancestor.contains(b)) {
    ancestor = ancestor.parentElement;
  }
  return ancestor;
}

function openViewMenu(): void {
  const button = document.querySelector<HTMLButtonElement>(
    'button[aria-label="View"]',
  );
  if (button === null) throw new Error("View menu trigger not found");
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
});

describe("BoardToolbar layout", () => {
  it("one line: New thread, search, View chip, filters, count, settings icon", () => {
    renderToolbar();
    const newThread = screen.getByText("New thread");
    const search = screen.getByLabelText("Search threads");
    const view = document.querySelector('button[aria-label="View"]');
    if (view === null) throw new Error("View trigger not found");
    const project = screen.getByText(/Project:/);
    const provider = screen.getByText(/Provider:/);
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    const settings = screen.getByLabelText("Focus Board settings");
    expect(follows(newThread, search)).toBe(true);
    expect(follows(search, view)).toBe(true);
    expect(follows(view, project)).toBe(true);
    expect(follows(project, provider)).toBe(true);
    expect(follows(provider, state)).toBe(true);
    expect(follows(state, count)).toBe(true);
    expect(follows(count, settings)).toBe(true);
  });

  it("creation stands alone — no container shared with the count", () => {
    const root = renderToolbar();
    const newThread = screen.getByText("New thread");
    const count = screen.getByText("7 threads");
    // Only the toolbar root contains both: the button is not in a stacked
    // column with the count (the always-two-line stack is gone).
    expect(commonAncestor(newThread, count)).toBe(root);
  });

  it("search pairs with the View chip, apart from the filter cluster", () => {
    const root = renderToolbar();
    const search = screen.getByLabelText("Search threads");
    const view = document.querySelector('button[aria-label="View"]');
    if (view === null) throw new Error("View trigger not found");
    const project = screen.getByText(/Project:/);
    const pairCluster = commonAncestor(search, view);
    expect(pairCluster).not.toBeNull();
    expect(pairCluster).not.toBe(root);
    expect(pairCluster?.contains(project) ?? true).toBe(false);
  });

  it("count and settings icon travel with the filters, not pinned to the edge", () => {
    const root = renderToolbar();
    const project = screen.getByText(/Project:/);
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    const settings = screen.getByLabelText("Focus Board settings");
    const trailingCluster = commonAncestor(project, count);
    expect(trailingCluster).not.toBeNull();
    expect(trailingCluster).not.toBe(root);
    expect(trailingCluster?.contains(settings) ?? false).toBe(true);
    expect(trailingCluster?.contains(state) ?? false).toBe(true);
  });

  it("places Clear right behind the filters when one is active", () => {
    const onClearFilters = vi.fn();
    renderToolbar({ anyFilterActive: true, onClearFilters });
    const clear = screen.getByText("Clear");
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    expect(follows(state, clear)).toBe(true);
    expect(follows(clear, count)).toBe(true);
    fireEvent.click(clear);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("the View chip names the current view, no colon filter label", () => {
    renderToolbar();
    const view = document.querySelector('button[aria-label="View"]');
    if (view === null) throw new Error("View trigger not found");
    expect(view.textContent).toContain("Attention");
    // The filter anatomy ("View: Attention") is what made the mode read
    // like just another dropdown; the chip drops the colon prefix entirely.
    expect(screen.queryByText(/View:/)).toBeNull();
  });

  it("carries no standalone Nest toggle and no maximize button", () => {
    renderToolbar();
    expect(screen.queryByText("Nest child threads")).toBeNull();
    expect(screen.queryByLabelText("Maximize new thread")).toBeNull();
  });

  it("carries no wallpaper control — the picker lives in the settings' Appearance tab", () => {
    // The toolbar's wallpaper trigger was removed when the Appearance tab
    // became the picker's only home; nothing wallpaper-shaped may creep
    // back (a trigger, a popover, or the toolbar props resurfacing).
    renderToolbar();
    expect(screen.queryByLabelText("Wallpaper")).toBeNull();
    expect(screen.queryByTitle("Wallpaper")).toBeNull();
    expect(screen.queryByText(/Wallpaper/)).toBeNull();
  });

  it("the View menu's Nest row toggles nesting", () => {
    const onNestChildrenChange = vi.fn();
    renderToolbar({ onNestChildrenChange, nestChildren: false });
    openViewMenu();
    const row = screen.getByText("Nest child threads").closest("button");
    if (row === null) throw new Error("Nest row not rendered");
    expect(row.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row);
    expect(onNestChildrenChange).toHaveBeenCalledWith(true);
  });

  it("with nesting locked (parent view), the Nest row reads checked and stays put", () => {
    const onNestChildrenChange = vi.fn();
    renderToolbar({ nestingLocked: true, nestChildren: false });
    openViewMenu();
    const row = screen
      .getByText("Nest child threads")
      ?.closest("button");
    if (row === null) throw new Error("Nest row not rendered");
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
    expect(onNestChildrenChange).not.toHaveBeenCalled();
  });

  it("picking a grouping in the View menu reports the groupBy value", () => {
    const onGroupByChange = vi.fn();
    renderToolbar({ onGroupByChange });
    openViewMenu();
    fireEvent.click(screen.getByText("Last activity"));
    expect(onGroupByChange).toHaveBeenCalledWith("recency");
  });

  it("carries no maximize button — that lives in the New thread modal", () => {
    renderToolbar();
    expect(screen.queryByLabelText("Maximize new thread")).toBeNull();
  });

  it("centers every trigger by flex, not the host text baseline", () => {
    // The bare `relative` wrappers position their inline-flex triggers on
    // the wrapper's text baseline; under a host font whose line metrics
    // differ from the harness's, each such trigger rides up to ~1px high
    // of its flex-centered row neighbors (measured on-device, and
    // reproduced in the screenshot harness at 16px/1.5). Flex wrappers
    // position the trigger by centering, immune to line metrics.
    renderToolbar();
    const labels = ["View", "Project", "Provider", "State"];
    const triggers = [
      document.querySelector('button[aria-label="View"]'),
      screen.getByText(/Project:/).closest("button"),
      screen.getByText(/Provider:/).closest("button"),
      screen.getByText(/State:/).closest("button"),
    ];
    for (const [i, label] of labels.entries()) {
      const trigger = triggers[i];
      if (trigger === null) throw new Error(`${label} trigger not found`);
      const wrapper = trigger.parentElement;
      expect(wrapper?.className, `${label} wrapper`).toContain("flex");
      // flex centering only anchors the trigger when it is the sole in-flow child
      const inFlow = [...wrapper!.children].filter(
        (child) => getComputedStyle(child).position !== "absolute",
      );
      expect(inFlow.length, `${label} wrapper in-flow children`).toBe(1);
    }
  });
});

describe("BoardToolbar State filter: idle buckets", () => {
  it("lists one checkbox per idle lane with the board's labels — no bare Idle row", () => {
    renderToolbar();
    const trigger = screen.getByText(/State:/).closest("button");
    if (trigger === null) throw new Error("State trigger not found");
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox", { name: "State" });
    const rows = [...listbox.querySelectorAll('[role="option"]')].map(
      (row) => row.textContent,
    );
    expect(rows).toEqual([
      "Working",
      "Needs you",
      "Unread",
      "Idle · Recent",
      "Idle · Today",
      "Idle · Earlier",
      "Idle · A while ago",
    ]);
  });

  it("checking an idle-bucket row filters the board to that bucket", () => {
    const onFilterChange = vi.fn();
    renderToolbar({ onFilterChange });
    const trigger = screen.getByText(/State:/).closest("button");
    if (trigger === null) throw new Error("State trigger not found");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Idle · Today" }));
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ states: new Set(["idle-today"]) }),
    );
  });
});

describe("BoardToolbar settings icon: gear/gift double duty", () => {
  it("when caught up, the icon is a plain settings gear opening on Behavior", () => {
    const onOpenSettings = vi.fn();
    renderToolbar({ onOpenSettings });
    const button = screen.getByLabelText("Focus Board settings");
    expect(screen.queryByLabelText("What's new")).toBeNull();
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith("behavior");
  });

  it("with unseen changelog content, the icon is the What's-new gift deep-linking to that tab", () => {
    const onOpenSettings = vi.fn();
    renderToolbar({ whatsNewUnseen: true, onOpenSettings });
    const button = screen.getByLabelText("What's new");
    expect(screen.queryByLabelText("Focus Board settings")).toBeNull();
    fireEvent.click(button);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledWith("whats-new");
  });

  it("the pulse stays reachable without motion (reduce-motion users still get the gift)", () => {
    // The costume is binary regardless of reduced-motion preference; the
    // animation itself is motion-safe, so the label + glyph must not depend
    // on animation support.
    renderToolbar({ whatsNewUnseen: true });
    expect(screen.getByLabelText("What's new")).not.toBeNull();
  });
});

describe("BoardToolbar search clear button", () => {
  it("absent while the search field is empty", () => {
    renderToolbar({ search: "" });
    expect(screen.queryByLabelText("Clear search")).toBeNull();
  });

  it("appears once the field holds text and clears on click", () => {
    const onSearchChange = vi.fn();
    renderToolbar({ search: "walnut", onSearchChange });
    const clear = screen.getByLabelText("Clear search");
    expect(clear instanceof HTMLElement).toBe(true);
    fireEvent.click(clear);
    expect(onSearchChange).toHaveBeenCalledTimes(1);
    expect(onSearchChange).toHaveBeenCalledWith("");
  });

  it("stays inside the search input's own container, behind the field's text", () => {
    const root = renderToolbar({ search: "walnut" });
    const search = screen.getByLabelText("Search threads");
    const clear = screen.getByLabelText("Clear search");
    expect(clear instanceof HTMLElement && search instanceof HTMLElement).toBe(true);
    expect(commonAncestor(search, clear)).not.toBe(root);
  });
});
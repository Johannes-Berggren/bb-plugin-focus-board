// @vitest-environment jsdom
// Toolbar layout: New thread leads at the far left with the thread count and
// the What's-new gift centered under it; the search field pairs with the View
// menu (grouping + the Nest toggle live inside that menu); the Project /
// Provider / State controls form their own filter cluster. Wrapping breaks
// between clusters, never inside the creation stack.
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
    onOpenWhatsNew: vi.fn(),
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
  const trigger = screen.getByText(/View:/);
  const button = trigger instanceof HTMLButtonElement ? trigger : trigger.closest("button");
  if (button === null) throw new Error("View menu trigger not found");
  fireEvent.click(button);
}

afterEach(() => {
  cleanup();
});

describe("BoardToolbar layout", () => {
  it("stacks count and gift under New thread, before search, View, and filters", () => {
    renderToolbar();
    const newThread = screen.getByText("New thread");
    const count = screen.getByText("7 threads");
    const gift = screen.getByLabelText("What's new");
    const search = screen.getByLabelText("Search threads");
    const view = screen.getByText(/View:/);
    const project = screen.getByText(/Project:/);
    const provider = screen.getByText(/Provider:/);
    const state = screen.getByText(/State:/);
    expect(follows(newThread, count)).toBe(true);
    expect(follows(count, gift)).toBe(true);
    expect(follows(newThread, search)).toBe(true);
    expect(follows(search, view)).toBe(true);
    expect(follows(view, project)).toBe(true);
    expect(follows(project, provider)).toBe(true);
    expect(follows(provider, state)).toBe(true);
  });

  it("three clusters: creation stack, search+View pair, then the filter cluster", () => {
    const root = renderToolbar();
    const newThread = screen.getByText("New thread");
    const count = screen.getByText("7 threads");
    const gift = screen.getByLabelText("What's new");
    const search = screen.getByLabelText("Search threads");
    const view = screen.getByText(/View:/);
    const project = screen.getByText(/Project:/);
    const provider = screen.getByText(/Provider:/);
    const state = screen.getByText(/State:/);
    const creationStack = commonAncestor(newThread, count);
    const searchCluster = commonAncestor(search, view);
    const filterCluster = commonAncestor(project, state);
    // All three clusters are distinct subtrees inside the toolbar root.
    expect(creationStack).not.toBeNull();
    expect(searchCluster).not.toBeNull();
    expect(filterCluster).not.toBeNull();
    expect(creationStack).not.toBe(root);
    expect(searchCluster).not.toBe(root);
    expect(filterCluster).not.toBe(root);
    expect(creationStack).not.toBe(searchCluster);
    expect(searchCluster).not.toBe(filterCluster);
    // The creation stack holds the gift and never the search.
    expect(creationStack?.contains(gift) ?? false).toBe(true);
    expect(creationStack?.contains(search) ?? true).toBe(false);
    // Search pairs with View, not with the filters.
    expect(searchCluster?.contains(project) ?? true).toBe(false);
    // The filter cluster holds all three option controls.
    expect(filterCluster?.contains(provider) ?? false).toBe(true);
  });

  it("places Clear inside the filter cluster when one is active", () => {
    const onClearFilters = vi.fn();
    renderToolbar({ anyFilterActive: true, onClearFilters });
    const clear = screen.getByText("Clear");
    const state = screen.getByText(/State:/);
    const project = screen.getByText(/Project:/);
    const filterCluster = commonAncestor(project, state);
    expect(follows(state, clear)).toBe(true);
    expect(filterCluster?.contains(clear) ?? false).toBe(true);
    fireEvent.click(clear);
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("carries no standalone Nest toggle and no maximize button", () => {
    renderToolbar();
    expect(screen.queryByText("Nest child threads")).toBeNull();
    expect(screen.queryByLabelText("Maximize new thread")).toBeNull();
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

  it("picking a grouping in the View menu reports the ViewBy value", () => {
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
});
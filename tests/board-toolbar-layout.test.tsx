// @vitest-environment jsdom
// Toolbar layout: one line, height-matched, three zones. New thread stands
// alone; search pairs with the View mode chip (no colon label — it names the
// current view like a mode, not a filter); the Project/Provider/State
// filters run together with the thread count and the What's-new gift as one
// trailing cluster, so wrapping never strands the count across a void.
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
  it("one line: New thread, search, View chip, filters, count, gift", () => {
    renderToolbar();
    const newThread = screen.getByText("New thread");
    const search = screen.getByLabelText("Search threads");
    const view = document.querySelector('button[aria-label="View"]');
    if (view === null) throw new Error("View trigger not found");
    const project = screen.getByText(/Project:/);
    const provider = screen.getByText(/Provider:/);
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    const gift = screen.getByLabelText("What's new");
    expect(follows(newThread, search)).toBe(true);
    expect(follows(search, view)).toBe(true);
    expect(follows(view, project)).toBe(true);
    expect(follows(project, provider)).toBe(true);
    expect(follows(provider, state)).toBe(true);
    expect(follows(state, count)).toBe(true);
    expect(follows(count, gift)).toBe(true);
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

  it("count and gift travel with the filters, not pinned to the edge", () => {
    const root = renderToolbar();
    const project = screen.getByText(/Project:/);
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    const gift = screen.getByLabelText("What's new");
    const trailingCluster = commonAncestor(project, count);
    expect(trailingCluster).not.toBeNull();
    expect(trailingCluster).not.toBe(root);
    expect(trailingCluster?.contains(gift) ?? false).toBe(true);
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
});
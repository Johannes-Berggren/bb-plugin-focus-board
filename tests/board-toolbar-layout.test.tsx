// @vitest-environment jsdom
// Toolbar layout: New thread leads from the far left; the search field and
// the filter controls form one wrapping cluster (so a wrap moves whole
// filters to a continuation line, never stranding the count); the thread
// count and the What's-new gift form their own right-hand cluster.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

afterEach(() => {
  cleanup();
});

describe("BoardToolbar layout", () => {
  it("orders New thread, search, the five filters, then the count cluster", () => {
    renderToolbar();
    const newThread = screen.getByText("New thread");
    const search = screen.getByLabelText("Search threads");
    const group = screen.getByText(/Group:/);
    const project = screen.getByText(/Project:/);
    const provider = screen.getByText(/Provider:/);
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    expect(follows(newThread, search)).toBe(true);
    expect(follows(search, group)).toBe(true);
    expect(follows(group, project)).toBe(true);
    expect(follows(project, provider)).toBe(true);
    expect(follows(provider, state)).toBe(true);
    expect(follows(state, count)).toBe(true);
  });

  it("search and the filters wrap as one cluster, separate from the count", () => {
    const root = renderToolbar();
    const search = screen.getByLabelText("Search threads");
    const group = screen.getByText(/Group:/);
    const state = screen.getByText(/State:/);
    const count = screen.getByText("7 threads");
    const gift = screen.getByLabelText("What's new");
    const searchCluster = commonAncestor(search, group);
    const countCluster = commonAncestor(count, gift);
    expect(searchCluster).not.toBeNull();
    expect(countCluster).not.toBeNull();
    // The two clusters are different subtrees, both inside the toolbar root.
    expect(searchCluster).not.toBe(root);
    expect(countCluster).not.toBe(root);
    expect(searchCluster).not.toBe(countCluster);
    expect(searchCluster?.contains(state) ?? false).toBe(true);
    expect(countCluster?.contains(search) ?? true).toBe(false);
  });

  it("places Clear inside the search-and-filters cluster when one is active", () => {
    const root = renderToolbar({ anyFilterActive: true, onClearFilters: vi.fn() });
    const clear = screen.getByText("Clear");
    const search = screen.getByLabelText("Search threads");
    const state = screen.getByText(/State:/);
    const searchCluster = commonAncestor(search, state);
    expect(follows(state, clear)).toBe(true);
    expect(searchCluster?.contains(clear) ?? false).toBe(true);
  });

  it("carries no maximize button — that lives in the New thread modal", () => {
    renderToolbar();
    expect(screen.queryByLabelText("Maximize new thread")).toBeNull();
  });
});
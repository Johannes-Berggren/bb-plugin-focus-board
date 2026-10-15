// @vitest-environment jsdom
// Issue #174: the collapsed child-dot strip works per child instead of per
// family. Hovering one child's dot shows a preview of that child (title plus
// what the SDK exposes: state label, last-activity age, indicator label — the
// SDK does not expose a thread's messages); clicking a dot opens that child in
// the thread pane WITHOUT expanding the family's nested rows; and while the
// rows stay collapsed, the family's currently open child (and only it) is
// listed below the strip.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

function family(): { parent: PluginSidebarThread; children: PluginSidebarThread[] } {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: 5000 }),
    children: [
      thread({ id: "thr_c1", parentThreadId: "thr_parent", displayTitle: "Child one", updatedAt: 4000 }),
      thread({ id: "thr_c2", parentThreadId: "thr_parent", displayTitle: "Child two", isUnread: true, updatedAt: 3900 }),
      thread({
        id: "thr_c3",
        parentThreadId: "thr_parent",
        displayTitle: "Child three",
        status: "active",
        updatedAt: 3800,
        indicator: "background-agent",
        indicatorLabel: "Background agent running",
      }),
    ],
  };
}

type CardProps = Parameters<typeof ThreadCard>[0];

function renderCard(overrides: Partial<CardProps> = {}) {
  const { parent, children } = family();
  const props = {
    thread: parent,
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    childThreads: children,
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

function toggle(collapsed: boolean): HTMLElement {
  const button = document.querySelector(
    `button[data-child-threads-toggle][aria-label="${collapsed ? "Expand subthreads" : "Collapse subthreads"}"]`,
  );
  if (!(button instanceof HTMLElement)) throw new Error("missing child-section toggle");
  return button;
}

function dots(): HTMLElement {
  const strip = document.querySelector("[data-child-thread-dots]");
  if (!(strip instanceof HTMLElement)) throw new Error("missing child dot strip");
  return strip;
}

/** One dot button in the collapsed strip, by its child id. */
function dot(id: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`button[data-child-dot="${id}"]`);
  if (button === null) throw new Error(`missing dot for ${id}`);
  return button;
}

/** The preview bubble inside a dot button. */
function preview(id: string): HTMLElement {
  const bubble = dot(id).querySelector("[data-child-dot-preview]");
  if (!(bubble instanceof HTMLElement)) throw new Error(`missing preview for ${id}`);
  return bubble;
}

function activeRow(): HTMLElement | null {
  return document.querySelector("[data-child-active-row]");
}

function row(id: string): HTMLElement | null {
  return document.querySelector(`[data-thread-card="${id}"]`);
}

afterEach(cleanup);

describe("a child dot's hover preview", () => {
  it("carries the child's title", () => {
    renderCard({ isCollapsed: true });
    expect(preview("thr_c2").textContent).toContain("Child two");
  });

  it("carries the child's state label and indicator label", () => {
    renderCard({ isCollapsed: true });
    // thr_c2 is unread; thr_c3 runs an agent with the host's indicator label.
    expect(preview("thr_c2").textContent).toContain("Unread");
    expect(preview("thr_c3").textContent).toContain("Background agent running");
  });

  it("is aria-hidden: the dot's aria-label carries the child's name for screen readers", () => {
    renderCard({ isCollapsed: true });
    const button = dot("thr_c2");
    expect(button.getAttribute("aria-label")).toContain("Child two");
    expect(preview("thr_c2").hasAttribute("aria-hidden")).toBe(true);
  });
});

describe("clicking a child dot opens that child", () => {
  it("opens the child's pane without expanding the family's rows", () => {
    const onOpenThread = vi.fn();
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: true, onCollapsedChange, onOpenThread });
    fireEvent.click(dot("thr_c2"));
    expect(onOpenThread).toHaveBeenCalledTimes(1);
    expect(onOpenThread).toHaveBeenCalledWith("thr_c2");
    // The family stays folded: no rows render, no expansion is reported.
    expect(row("thr_c1")).toBeNull();
    expect(row("thr_c3")).toBeNull();
    expect(onCollapsedChange).not.toHaveBeenCalled();
    expect(document.querySelector("[data-child-thread-dots]")).not.toBeNull();
  });

  it("keeps the collapse held in local (unpersisted) state", () => {
    renderCard();
    fireEvent.click(toggle(false));
    fireEvent.click(dot("thr_c1"));
    expect(row("thr_c1")).toBeNull();
    expect(document.querySelector("[data-child-thread-dots]")).not.toBeNull();
  });

  it("does not open the child when it lands outside the card's gestures (bubbling blocked)", () => {
    const onOpen = vi.fn();
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), onOpen });
    fireEvent.click(dot("thr_c1"));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("the active child lists itself below the collapsed strip", () => {
  it("with the active child among the children, only it renders as a row", () => {
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), activeThreadId: "thr_c2" });
    const active = activeRow();
    if (active === null) throw new Error("missing active-child row");
    expect(active.contains(document.querySelector('[data-thread-card="thr_c2"]'))).toBe(true);
    expect(row("thr_c1")).toBeNull();
    expect(row("thr_c3")).toBeNull();
    // It reads as the active row: the open thread's ring marker.
    expect(document.querySelector('[data-thread-card="thr_c2"]')?.getAttribute("aria-current")).toBe("true");
  });

  it("switches to another child when the pane moves to it", () => {
    const view = renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), activeThreadId: "thr_c1" });
    expect(document.querySelector('[data-thread-card="thr_c1"]')).not.toBeNull();
    view.rerender(threadCardWithActive("thr_c3"));
    expect(document.querySelector('[data-thread-card="thr_c1"]')).toBeNull();
    expect(document.querySelector('[data-thread-card="thr_c3"]')).not.toBeNull();
  });

  it("does not render when nothing in the family is open", () => {
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), activeThreadId: null });
    expect(activeRow()).toBeNull();
  });

  it("does not render when the active thread is not one of the nested children", () => {
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), activeThreadId: "thr_other" });
    expect(activeRow()).toBeNull();
  });

  it("does not render while the rows are expanded — the rows list the whole family", () => {
    renderCard({ activeThreadId: "thr_c2" });
    expect(activeRow()).toBeNull();
    expect(row("thr_c2")).not.toBeNull();
  });

  it("does not render when the pane cannot be opened (no onOpenThread)", () => {
    renderCard({ isCollapsed: true, activeThreadId: "thr_c2", onOpenThread: undefined });
    expect(activeRow()).toBeNull();
  });
});

describe("the strip keeps its expand role", () => {
  it("clicking the strip's background (not a dot) re-expands the rows", () => {
    const onCollapsedChange = vi.fn();
    renderCard({ isCollapsed: true, onCollapsedChange });
    fireEvent.click(dots());
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });
});

describe("the dot grid and the child rows share one dot column", () => {
  // jsdom does no layout, so the alignment contract is pinned at the class
  // level: the strip's indent and glyph geometry put its first dot's left
  // edge at the same x as the rows' dot (strip margin 12px + centered glyph
  // inside its 16px button = 17px; rows: 1px border + 8px padding + the
  // row anchor's own 8px = 17px).
  it("the strip's indent puts its dots in the rows' dot column", () => {
    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), activeThreadId: "thr_c2" });
    expect(dots().className).toContain("ml-3");
    expect(dots().className).not.toContain("ml-[18px]");
  });

  it("the active child row uses the rows' indent geometry, not a new one", () => {
    // Render the expanded card to read the rows container's own indent
    // classes, then the collapsed one, and compare: the active row is one
    // of the family's rows, so it must not carry geometry of its own.
    const expanded = renderCard();
    const rows = document.querySelector("[data-nested-rows]");
    if (!(rows instanceof HTMLElement)) throw new Error("missing rows container");
    const rowsGeometry = rows.className;
    expanded.unmount();

    renderCard({ isCollapsed: true, onCollapsedChange: vi.fn(), activeThreadId: "thr_c2" });
    const active = document.querySelector("[data-child-active-row]");
    if (!(active instanceof HTMLElement)) throw new Error("missing active row");
    expect(active.className).toBe(rowsGeometry);
  });
});

function threadCardWithActive(activeThreadId: string) {
  const { parent, children } = family();
  const props = {
    thread: parent,
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    childThreads: children,
    isCollapsed: true,
    onCollapsedChange: vi.fn(),
    activeThreadId,
  } as unknown as CardProps;
  return <ThreadCard {...props} />;
}
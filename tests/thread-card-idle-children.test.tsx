// @vitest-environment jsdom
// The idle-children filter on a family card's child section: one button beside
// the section toggle hides every child whose state is idle, in BOTH views —
// the expanded nested rows and the collapsed dot strip. Non-idle children
// (attention, working, unread) always stay. The choice is controlled
// (persisted by the caller, fold-keyed like the collapse fold) with an
// uncontrolled local fallback; the count label names what is shown, not what
// the family stores.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

function family(): { parent: PluginSidebarThread; children: PluginSidebarThread[] } {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: 5000 }),
    children: [
      // One child per state, in display order: idle first, so the filter's
      // effect on the strip's head is assertable.
      thread({ id: "thr_c1", parentThreadId: "thr_parent", displayTitle: "Child one", updatedAt: 4000 }),
      thread({ id: "thr_c2", parentThreadId: "thr_parent", displayTitle: "Child two", isUnread: true, updatedAt: 3900 }),
      thread({ id: "thr_c3", parentThreadId: "thr_parent", displayTitle: "Child three", status: "active", updatedAt: 3800 }),
      thread({ id: "thr_c4", parentThreadId: "thr_parent", displayTitle: "Child four", hasPendingInteraction: true, updatedAt: 3700 }),
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

/** The idle-children filter button, beside the section toggle. */
function idleToggle(hidden: boolean | "either" = "either"): HTMLElement {
  const selector = hidden === "either" ? `"button[data-idle-children-toggle]"`
    : `button[data-idle-children-toggle][aria-label="${hidden ? "Show idle child threads" : "Hide idle child threads"}"]`;
  const button = document.querySelector(selector);
  if (!(button instanceof HTMLElement)) throw new Error("missing idle-children toggle");
  return button;
}

/** The section toggle, by its aria label. */
function sectionToggle(collapsed: boolean): HTMLElement {
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

function row(id: string): HTMLElement | null {
  return document.querySelector(`[data-thread-card="${id}"]`);
}

afterEach(cleanup);

describe("the idle-children filter, expanded", () => {
  it("the button beside the section toggle hides the idle rows and updates the count", () => {
    renderCard();
    expect(row("thr_c1")).not.toBeNull();
    fireEvent.click(idleToggle(false));
    expect(row("thr_c1")).toBeNull();
    expect(row("thr_c2")).not.toBeNull();
    expect(row("thr_c3")).not.toBeNull();
    expect(row("thr_c4")).not.toBeNull();
    expect(sectionToggle(false).textContent).toContain("3 active, 1 idle child threads");
    expect(sectionToggle(false).textContent).not.toContain("3 child threads");
    // The button reflects the filter state and announces how to undo it.
    expect(idleToggle(true).getAttribute("aria-pressed")).toBe("true");
  });

  it("clicking again restores the idle rows", () => {
    renderCard();
    fireEvent.click(idleToggle(false));
    fireEvent.click(idleToggle(true));
    expect(row("thr_c1")).not.toBeNull();
    expect(sectionToggle(false).textContent).toContain("4 child threads");
  });
});

describe("the idle-children filter, collapsed to dots", () => {
  it("the strip drops the idle dots first-in-line and keeps the rest in order", () => {
    renderCard();
    fireEvent.click(sectionToggle(false));
    fireEvent.click(idleToggle(false));
    expect(dots().children.length).toBe(3);
    // The per-dot control names the child in its aria-label (issue #174);
    // the first dot in line is now the second child, its idle sibling gone.
    expect(dots().children[0]?.getAttribute("aria-label")).toContain("Child two");
    expect(row("thr_c1")).toBeNull();
    expect(sectionToggle(true).textContent).toContain("3 active, 1 idle child threads");
  });

  it("the filter and the fold compose in the other order too", () => {
    renderCard();
    fireEvent.click(idleToggle(false));
    fireEvent.click(sectionToggle(false));
    expect(dots().children.length).toBe(3);
  });
});

describe("every child idle", () => {
  it("the rows and strip empty out, the count says 0, and the toggle stays to undo it", () => {
    const { parent, children } = family();
    const allIdle = children.map((child) =>
      // Fresh default fixtures: every field idle (default status, no unread,
      // no interaction), unlike the family()'s one-child-per-state list.
      thread({
        id: child.id,
        parentThreadId: "thr_parent",
        displayTitle: child.displayTitle,
        updatedAt: child.updatedAt,
      }),
    );
    renderCard({ childThreads: allIdle, thread: parent });
    fireEvent.click(idleToggle(false));
    expect(row("thr_c1")).toBeNull();
    expect(document.querySelector("[data-child-thread-dots]")).toBeNull();
    expect(document.querySelector("[data-nested-rows]")).toBeNull();
    expect(sectionToggle(false).textContent).toContain("0 active, 4 idle child threads");
    expect(idleToggle(true)).not.toBeNull();
    fireEvent.click(idleToggle(true));
    expect(row("thr_c1")).not.toBeNull();
  });
});

describe("controlled hide (persisted by the caller)", () => {
  it("a persisted hide starts filtered and reports every gesture as a boolean", () => {
    const onHideIdleChildrenChange = vi.fn();
    renderCard({ hideIdleChildren: true, onHideIdleChildrenChange });
    expect(row("thr_c1")).toBeNull();
    expect(idleToggle(true).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(idleToggle(true));
    expect(onHideIdleChildrenChange).toHaveBeenCalledWith(false);
  });

  it("a persisted show renders children as usual and reports the hide gesture", () => {
    const onHideIdleChildrenChange = vi.fn();
    renderCard({ hideIdleChildren: false, onHideIdleChildrenChange });
    expect(row("thr_c1")).not.toBeNull();
    fireEvent.click(idleToggle(false));
    expect(onHideIdleChildrenChange).toHaveBeenCalledWith(true);
  });
});

describe("sub-rows follow the filter", () => {
  it("an idle child's own rows hide with it; a visible child's idle grandchild hides too", () => {
    const { parent, children } = family();
    const grandchildThreadsByParent = new Map<string, PluginSidebarThread[]>([
      // Idle child thr_c1 keeps an idle grandchild: it hides with its parent.
      ["thr_c1", [thread({ id: "thr_g1", parentThreadId: "thr_c1", displayTitle: "Grandchild one", updatedAt: 3000 })]],
      // Working child thr_c3 keeps an idle and a working grandchild: only the
      // idle one filters out.
      [
        "thr_c3",
        [
          thread({ id: "thr_g2", parentThreadId: "thr_c3", displayTitle: "Grandchild two", updatedAt: 2900 }),
          thread({ id: "thr_g3", parentThreadId: "thr_c3", displayTitle: "Grandchild three", status: "active", updatedAt: 2800 }),
        ],
      ],
    ]);
    renderCard({ thread: parent, childThreads: children, grandchildThreadsByParent });
    fireEvent.click(idleToggle(false));
    expect(row("thr_g1")).toBeNull();
    expect(row("thr_c3")).not.toBeNull();
    expect(row("thr_g2")).toBeNull();
    expect(row("thr_g3")).not.toBeNull();
    // Three visible children plus one visible sub-row, one idle child away.
    expect(sectionToggle(false).textContent).toContain("4 active, 1 idle child threads");
    fireEvent.click(idleToggle(true));
    expect(row("thr_g1")).not.toBeNull();
    expect(row("thr_g2")).not.toBeNull();
  });
});

describe("without any idle-child gesture the card renders every child", () => {
  it("a controlled show and an uncontrolled default both keep the idle rows", () => {
    const a = renderCard();
    expect(row("thr_c1")).not.toBeNull();
    a.unmount();
    renderCard({ hideIdleChildren: false });
    expect(row("thr_c1")).not.toBeNull();
  });
});

describe("the enumerated count", () => {
  it("names what is shown and what is hidden; nothing idle means the plain count", () => {
    // An all-working family: hiding "idle" removes nothing, so the label
    // stays the plain count instead of enumerating "2 active, 0 idle".
    const { parent, children } = family();
    const allWorking = children.map((child) =>
      thread({
        id: child.id,
        parentThreadId: "thr_parent",
        displayTitle: child.displayTitle,
        status: "active",
        isUnread: false,
        hasPendingInteraction: false,
        updatedAt: child.updatedAt,
      }),
    );
    renderCard({ thread: parent, childThreads: allWorking });
    fireEvent.click(idleToggle(false));
    expect(sectionToggle(false).textContent).toContain("4 child threads");
    expect(sectionToggle(false).textContent).not.toContain("active");
  });
});

describe("the filter and the family's open child (issue #174 composition)", () => {
  it("the open child keeps its single row below the strip even when every other child hides", () => {
    // Child one is idle but OPEN: the count hides it, the open-child row
    // keeps it — an open anchor never filters.
    renderCard({ activeThreadId: "thr_c1" });
    fireEvent.click(idleToggle(false));
    fireEvent.click(sectionToggle(false));
    expect(row("thr_c1")).not.toBeNull();
    // The count still names the three visible dots; the open row rides
    // below them, not inside the count.
    expect(sectionToggle(true).textContent).toContain("3 active, 1 idle child threads");
    expect(document.querySelector("[data-child-active-row]")).not.toBeNull();
    fireEvent.click(idleToggle(true));
    expect(sectionToggle(true).textContent).toContain("4 child threads");
  });
});
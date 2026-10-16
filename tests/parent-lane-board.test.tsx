// @vitest-environment jsdom
import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ParentLaneBoard, verticalCardCorrection } from "../components/parent-lane-board";
import { buildParentLanes } from "../components/parent-lanes";
import { computeParentLaneLayout } from "../components/parent-lane-layout";
import { thread } from "./thread-fixture";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 10 * DAY;

afterEach(cleanup);

function renderBoard(threads: ReturnType<typeof thread>[], overrides: Partial<Parameters<typeof ParentLaneBoard>[0]> = {}) {
  const lanes = buildParentLanes(threads, new Set(), NOW);
  const openThread = vi.fn();
  return {
    openThread,
    ...render(
      <ParentLaneBoard
        lanes={lanes}
        activeThreadId={null}
        doneIds={new Set()}
        dimmedIds={new Set()}
        childrenByParent={new Map()}
        projectNameFor={() => "Proj"}
        repoBaseFor={() => null}
        parentLaneOrder="recency"
        onParentLaneOrderChange={vi.fn()}
        onOpenThread={openThread}
        onClosePane={vi.fn()}
        onNewTask={vi.fn()}
        menuActionsFor={() => []}
        {...overrides}
      />,
    ),
  };
}

describe("verticalCardCorrection", () => {
  /** Stub a scroll container + card with viewport-space rects. */
  function stub(top: number, bottom: number, cardTop: number, cardBottom: number, scrollTop = 100) {
    const el = {
      getBoundingClientRect: () => ({ top, left: 0, right: 900, bottom, width: 900, height: bottom - top }),
      scrollTop,
    } as unknown as HTMLElement;
    const card = {
      getBoundingClientRect: () => ({ top: cardTop, left: 200, right: 400, bottom: cardBottom, width: 200, height: cardBottom - cardTop }),
    } as unknown as HTMLElement;
    return { el, card };
  }

  it("returns zero for a card already fully visible below the header", () => {
    const { el, card } = stub(0, 600, 300, 380);
    expect(verticalCardCorrection(el, card, 76)).toBe(0);
  });

  it("scrolls a card that fell below the fold back into view (recut case)", () => {
    const { el, card } = stub(0, 640, 912, 969, 260);
    const delta = verticalCardCorrection(el, card, 76);
    expect(delta).toBe(969 - 640 + 8);
  });

  it("lifts a card hidden behind the sticky header band", () => {
    const { el, card } = stub(0, 640, 50, 118, 40);
    expect(verticalCardCorrection(el, card, 76)).toBeLessThan(0);
  });

  it("lifts a card scrolled above the viewport", () => {
    const { el, card } = stub(0, 640, -40, 30, 500);
    expect(verticalCardCorrection(el, card, 76)).toBeLessThan(0);
  });
});

describe("ParentLaneBoard rendering", () => {
  it("renders a lane header per family lane and no Standalone lane", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const standalone = thread({ id: "s", displayTitle: "Solo task" });
    renderBoard([parent, child, standalone]);
    expect(screen.getByText("Parent epic")).toBeTruthy();
    expect(screen.queryByText("Standalone")).toBeNull();
    expect(screen.queryByText("Solo task")).toBeNull();
  });

  it("shows the child-count chip on the family header", () => {
    const parent = thread({ id: "p" });
    const a = thread({ id: "a", parentThreadId: "p" });
    const b = thread({ id: "b", parentThreadId: "p" });
    renderBoard([parent, a, b]);
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("clicking a family header opens the parent pane", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const { openThread } = renderBoard([parent, child]);
    fireEvent.click(screen.getByText("Parent epic"));
    expect(openThread).toHaveBeenCalledWith("p");
  });

  it("clicking a lane card opens the child pane", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const { openThread } = renderBoard([parent, child]);
    fireEvent.click(screen.getByText("Child task"));
    expect(openThread).toHaveBeenCalledWith("c");
  });

  it("hides archived children (no riders under the family header)", () => {
    const parent = thread({ id: "p" });
    const archived = thread({ id: "a", parentThreadId: "p", displayTitle: "Archived task", isArchived: true });
    renderBoard([parent, archived]);
    expect(screen.queryByText("Archived task")).toBeNull();
    expect(screen.queryByText("archived")).toBeNull();
  });

  it("renders the row rail with every row label", () => {
    const parent = thread({ id: "p" });
    const child = thread({ id: "c", parentThreadId: "p" });
    renderBoard([parent, child]);
    expect(screen.getByText("Needs you")).toBeTruthy();
    expect(screen.getByText("Unread")).toBeTruthy();
    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("Idle · Recent")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("an empty board renders the no-families empty state", () => {
    renderBoard([]);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByText("Standalone")).toBeNull();
  });

  it("loose threads render no lane and no cards (excluded from the parent view)", () => {
    const solo = thread({ id: "solo", displayTitle: "Solo task" });
    renderBoard([solo]);
    expect(screen.queryByText("Solo task")).toBeNull();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("clicking By project calls onParentLaneOrderChange", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "Child task" });
    const onChange = vi.fn();
    renderBoard([parent, child], { parentLaneOrder: "recency", onParentLaneOrderChange: onChange });
    fireEvent.click(screen.getByText("By project"));
    expect(onChange).toHaveBeenCalledWith("project");
  });
});

describe("ruler+wrap board geometry", () => {
  const RAIL_W = 140;

  /** Two families. A: 2 working children, fresh (recency → lane 0, locked).
   *  B: 30 working children, older (lane 1 → context, must overflow+chip). */
  function twoFamilies() {
    const p0 = thread({ id: "p0", displayTitle: "Family A" });
    const p1 = thread({ id: "p1", displayTitle: "Family B" });
    const a = (i: number) => thread({ id: `a${i}`, parentThreadId: "p0", status: "active", updatedAt: NOW });
    const b = (i: number) => thread({ id: `b${i}`, parentThreadId: "p1", status: "active", updatedAt: NOW - DAY });
    return [p0, a(0), a(1), p1, ...Array.from({ length: 30 }, (_, i) => b(i))];
  }

  const busyBoard = () => {
    const lanes = buildParentLanes(twoFamilies(), new Set(), NOW);
    const board = renderBoard(twoFamilies());
    return { lanes, board };
  };

  it("marks the locked lane and attributes row counts to it in the rail", () => {
    const { board } = busyBoard();
    const { container } = board;
    const locked = container.querySelectorAll("section[data-locked]");
    expect(locked).toHaveLength(1);
    expect(locked[0].getAttribute("data-lane-id")).toBe("p0");
    expect(screen.getByText("2 · Family A")).toBeTruthy();
  });

  it("renders one band per status row in every lane, in row order", () => {
    const { lanes, board } = busyBoard();
    const { container } = board;
    const rowIds = lanes[0].rows.map((row) => row.id);
    for (const lane of container.querySelectorAll("section[data-lane-id]")) {
      const bands = [...lane.querySelectorAll("[data-band]")].map((el) => el.getAttribute("data-band"));
      expect(bands).toEqual(rowIds);
    }
  });

  it("chips overflow in context lanes as +N more", () => {
    const { lanes, board } = busyBoard();
    const { container } = board;
    const layout = computeParentLaneLayout(lanes, 0, window.innerWidth, RAIL_W);
    const w = lanes[0].rows.findIndex((row) => row.id === "working");
    const chip = layout.lanes[1].chipFor[w];
    expect(chip).toBeGreaterThan(0);
    expect(screen.getByText(`+${chip} more`)).toBeTruthy();
    // The chip lives in the context lane's band, not the locked one.
    const lockedId = container.querySelector("section[data-locked]")?.getAttribute("data-lane-id");
    expect(lockedId).toBe("p0");
  });

  it("renders a slab for empty bands so seams visibly span the lane", () => {
    const { board } = busyBoard();
    const { container } = board;
    const doneBand = container.querySelector('section[data-locked] [data-band="done"]');
    expect(doneBand?.querySelector("[data-slab]")).toBeTruthy();
  });

  it("keeps the New Task affordance in the rail header", () => {
    const { board } = busyBoard();
    const onNewTask = vi.fn();
    // Re-render with a spy for the new-task callback.
    board.unmount();
    renderBoard(twoFamilies(), { onNewTask });
    fireEvent.click(screen.getByRole("button", { name: "New Task" }));
    expect(onNewTask).toHaveBeenCalled();
  });

  it("renders compact mini cards in context lanes and regular cards in the ruler", () => {
    const { board } = busyBoard();
    const { container } = board;
    const ruler = container.querySelector('section[data-locked] [data-band="working"] [data-thread-card]');
    expect(ruler?.closest("[data-cell]")?.getAttribute("data-variant")).toBe("ruler");
    const mini = container.querySelector('section:not([data-locked]) [data-band="working"] [data-thread-card]');
    expect(mini?.closest("[data-cell]")?.getAttribute("data-variant")).toBe("mini");
  });
});

describe("scroll snap vs overflowing lanes (issue #22)", () => {
  /** jsdom reports clientWidth 0 (the measure effect keeps its estimate);
   *  pin a value the effect can read instead. */
  function stubClientWidth(width: number) {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "clientWidth")!;
    Object.defineProperty(Element.prototype, "clientWidth", {
      configurable: true,
      get: () => width,
    });
    return () => Object.defineProperty(Element.prototype, "clientWidth", descriptor);
  }

  /** Three families, recency order a → b → c, two working children each. */
  function threeFamilies() {
    const mk = (id: string, age: number) => {
      const parent = thread({ id, displayTitle: `Family ${id}`, updatedAt: NOW - age });
      const kids = Array.from({ length: 2 }, (_, i) =>
        thread({ id: `${id}k${i}`, parentThreadId: id, status: "active", updatedAt: NOW - age }),
      );
      return [parent, ...kids];
    };
    return [...mk("a", 0), ...mk("b", HOUR), ...mk("c", 2 * HOUR)];
  }

  function setup(clientWidth: number) {
    vi.useFakeTimers();
    const restoreWidth = stubClientWidth(clientWidth);
    const rendered = renderBoard(threeFamilies());
    const board = rendered.container.querySelector("[data-parent-board]") as HTMLElement;
    // jsdom leaves Element.scrollTo undefined; the glide pin must find a stub.
    const scrollTo = vi.fn();
    Object.defineProperty(board, "scrollTo", { configurable: true, value: scrollTo });
    return {
      board,
      rendered,
      scrollTo,
      restore: () => {
        restoreWidth();
        vi.useRealTimers();
      },
    };
  }

  it("still snaps the resting scroll to the nearest lane when lanes fit the viewport", async () => {
    const { board, rendered, restore } = setup(1400);
    try {
      board.scrollLeft = 4000;
      fireEvent.scroll(board);
      await vi.advanceTimersByTimeAsync(3200);
      expect(
        rendered.container.querySelector("section[data-locked]")?.getAttribute("data-lane-id"),
      ).toBe("c");
    } finally {
      restore();
    }
  });

  it("does not snap-to on scroll when a lane is wider than the viewport", async () => {
    const { board, rendered, scrollTo, restore } = setup(380);
    try {
      board.scrollLeft = 4000;
      fireEvent.scroll(board);
      await vi.advanceTimersByTimeAsync(3200);
      // The pan rests where the operator left it: no re-lock, no glide, and
      // the released board carries no locked section.
      expect(rendered.container.querySelector("section[data-locked]")).toBeNull();
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("does not snap-to on scroll at phone widths that fit one lane (424px)", async () => {
    // 424px fits the floored locked lane (budget 244 >= 224) but fewer than
    // two context mini columns, so snap-to still stays off — the pan rests.
    const { board, rendered, scrollTo, restore } = setup(424);
    try {
      board.scrollLeft = 4000;
      fireEvent.scroll(board);
      await vi.advanceTimersByTimeAsync(3200);
      expect(rendered.container.querySelector("section[data-locked]")).toBeNull();
      expect(scrollTo).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it("header clicks still re-lock and recut lanes when snap is disabled", async () => {
    const { rendered, restore } = setup(380);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Open Family b" }));
      await vi.advanceTimersByTimeAsync(3200);
      expect(
        rendered.container.querySelector("section[data-locked]")?.getAttribute("data-lane-id"),
      ).toBe("b");
    } finally {
      restore();
    }
  });
});

describe("active-card re-lock vs lane assembly refresh (issue #124)", () => {
  // jsdom has no CSS.escape; runCorrections escapes the active id to build
  // its card selector.
  let restoreCss: () => void;
  beforeAll(() => {
    const globalWithCss = globalThis as { CSS?: { escape?: unknown } };
    if (globalWithCss.CSS?.escape !== undefined) {
      restoreCss = () => {};
      return;
    }
    globalWithCss.CSS = {
      escape: (value: string) => value.replace(/[^\w-]/g, "\\$&"),
    };
    restoreCss = () => {
      delete globalWithCss.CSS;
    };
  });
  afterAll(() => restoreCss());

  /** Base props shared across rerenders (ids are stable; only lanes change). */
  const baseProps = {
    doneIds: new Set<string>(),
    dimmedIds: new Set<string>(),
    childrenByParent: new Map(),
    projectNameFor: () => "Proj",
    repoBaseFor: () => null,
    parentLaneOrder: "recency" as const,
    onParentLaneOrderChange: vi.fn(),
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
  };

  /** Family A (two working children, freshest) then family B (one child,
   *  older) — recency order is stable across the rebuild, so only the row
   *  sort inside family A changes. */
  function families(childAges: [number, number]) {
    const p0 = thread({ id: "p0", displayTitle: "Family A", updatedAt: NOW - DAY });
    const p1 = thread({ id: "p1", displayTitle: "Family B", updatedAt: NOW - 2 * DAY });
    const a0 = thread({ id: "a0", parentThreadId: "p0", status: "active", updatedAt: NOW - childAges[0] });
    const a1 = thread({ id: "a1", parentThreadId: "p0", status: "active", updatedAt: NOW - childAges[1] });
    const b0 = thread({ id: "b0", parentThreadId: "p1", status: "active", updatedAt: NOW - 2 * DAY });
    return [p0, a0, a1, p1, b0];
  }

  /** Working-row cell order in the locked lane (data-key sequence). */
  function workingCellOrder(container: HTMLElement): string[] {
    return [...container.querySelectorAll('section[data-locked] [data-band="working"] [data-cell]')]
      .map((el) => el.getAttribute("data-key"));
  }

  it("keeps the operator's vertical scroll when a sibling re-sorts above the selected card", () => {
    const lanesBefore = buildParentLanes(families([2 * HOUR, HOUR]), new Set(), NOW);
    const rendered = render(
      <ParentLaneBoard lanes={lanesBefore} activeThreadId="a1" {...baseProps} />,
    );
    const container = rendered.container;
    // a1 sorts above a0 before the rebuild.
    expect(workingCellOrder(container)).toEqual(["a1", "a0"]);

    const board = container.querySelector("[data-parent-board]") as HTMLElement;
    // The operator wheels up to read the cards above the selected one.
    board.scrollTop = 60;
    expect(board.scrollTop).toBe(60);

    // A hover capture (or ambient touch) re-sorts the row: a0 jumps above
    // the selected a1 — sortActiveRow puts the freshest first — and the
    // parent-lane assembly rebuilds. Lane ids, lane order, and the active
    // card are all unchanged; only the lanes array identity moves.
    const lanesAfter = buildParentLanes(families([0, HOUR]), new Set(), NOW);
    rendered.rerender(<ParentLaneBoard lanes={lanesAfter} activeThreadId="a1" {...baseProps} />);
    expect(workingCellOrder(container)).toEqual(["a0", "a1"]);

    // The re-sort must not drag the board back down to the selected card.
    expect(board.scrollTop).toBe(60);
  });

  it("still brings the selected card into view when the selection changes within its lane", () => {
    const lanes = buildParentLanes(families([HOUR, HOUR]), new Set(), NOW);
    const { rerender, container } = render(
      <ParentLaneBoard lanes={lanes} activeThreadId="a1" {...baseProps} />,
    );
    const board = container.querySelector("[data-parent-board]") as HTMLElement;
    board.scrollTop = 60;
    // Clicking a sibling in the same lane is explicit intent: the vertical
    // bring-into-view must still run (jsdom zero rects make every card
    // "hidden behind the header", so any correction is a negative write).
    rerender(<ParentLaneBoard lanes={lanes} activeThreadId="a0" {...baseProps} />);
    expect(board.scrollTop).not.toBe(60);
  });
});

describe("LaneHeader context menu (issue #226)", () => {
  /** The lane header's button: fire the menu gesture at the header itself. */
  function headerButton(container: HTMLElement, title: string): HTMLElement {
    const header = [...container.querySelectorAll("[data-lane-header] button")].find(
      (button) => button.textContent?.includes(title),
    );
    expect(header).toBeTruthy();
    return header as HTMLElement;
  }

  it("right-clicking a lane header opens the thread context menu with the seeded actions", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const run = vi.fn();
    const { openThread, container } = renderBoard([parent, child], {
      menuActionsFor: () => [{ id: "pin", label: "Pin", icon: "Pin", run }],
    });
    // Red contract: nothing was wired, so the contextmenu gesture rendered
    // no menu at all.
    fireEvent.contextMenu(headerButton(container, "Parent epic"));
    const menu = screen.getByRole("menu", { name: "Thread actions" });
    expect(menu).toBeTruthy();
    expect(menu.textContent ?? "").toContain("Parent epic");
    // The built-ins and the board-seeded actions share the one surface,
    // exactly the card menu's shape.
    expect(screen.getByRole("menuitem", { name: "Open thread" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Copy link to thread" })).toBeTruthy();
    // The action's run writes and closes; the entry never opens the pane
    // as a side effect.
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(openThread).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the header menu's Open thread entry opens the parent pane", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const { openThread, container } = renderBoard([parent, child], {
      menuActionsFor: () => [],
    });
    fireEvent.contextMenu(headerButton(container, "Parent epic"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Open thread" }));
    expect(openThread).toHaveBeenCalledWith("p");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("right-clicking a done lane's header opens the same menu", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const { container } = renderBoard([parent, child], {
      doneIds: new Set(["p"]),
      menuActionsFor: () => [{ id: "pin", label: "Pin", icon: "Pin", run: vi.fn() }],
    });
    // The header dims for a done parent, but the menu keeps working.
    fireEvent.contextMenu(headerButton(container, "Parent epic"));
    expect(screen.getByRole("menu", { name: "Thread actions" })).toBeTruthy();
  });

  it("opening and closing the header menu reports the lane parent's attention", () => {
    const parent = thread({ id: "p", displayTitle: "Parent epic" });
    const child = thread({ id: "c", parentThreadId: "p" });
    const onAttentionEnter = vi.fn();
    const onAttentionLeave = vi.fn();
    const { container } = renderBoard([parent, child], {
      menuActionsFor: () => [],
      onAttentionEnter,
      onAttentionLeave,
    });
    // The freeze origin "menu": the popover is a portal outside the
    // header's DOM, so its open/close reports pin and release the lane.
    fireEvent.contextMenu(headerButton(container, "Parent epic"));
    expect(onAttentionEnter).toHaveBeenCalledWith("p");
    fireEvent.click(screen.getByRole("menuitem", { name: "Open thread" }));
    expect(onAttentionLeave).toHaveBeenCalledWith("p");
  });
});
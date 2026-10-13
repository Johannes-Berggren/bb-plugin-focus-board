// @vitest-environment jsdom
// [REDWORK] Regression for the mobile/desktop horizontal snap: Board's
// keep-active-card-in-view effect observes the board container with a
// ResizeObserver and re-fits (slides the active card's lane into the visible
// horizontal range) on EVERY callback — every container resize, whatever
// moved it. On mobile the container resizes constantly with the browser
// chrome (URL bar hide/show, keyboard), and on desktop ambient host layout
// changes (composer animations, banners) resize it too, so the board kept
// yanking back to the selected card's lane — the far-right end when that card
// sat in the status tail. The pane-driven intent (pane opening / drag resize)
// is a WIDTH change; height ambient noise must not re-fit.
//
// Contract:
// 1. A height-only (or any same-width) container resize does NOT re-fit — the
//    operator's pan rests.
// 2. A real width change (pane opening, drag-resize) still re-fits the card.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

/** ResizeObserver stub: records each (callback, target) pair; the test fires
 *  callbacks by hand. jsdom has no ResizeObserver at all. */
class StubResizeObserver {
  static instances: { callback: ResizeObserverCallback; target: Element | null }[] = [];
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    StubResizeObserver.instances.push({ callback: this.cb, target });
  }
  unobserve(): void {}
  disconnect(): void {}
}

function renderBoardWithSelection(activeThreadId: string): HTMLElement {
  const threads: PluginSidebarThread[] = [thread({ id: activeThreadId, updatedAt: NOW - 5000 })];
  const full = {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  render(<Board {...full} />);
  const board = document.querySelector("[data-columns-board]") as HTMLElement;
  if (!board || !board.querySelector(`[data-thread-card="${activeThreadId}"]`)) {
    throw new Error("board container or active card missing in DOM");
  }
  return board;
}

/** Stub rects: container spans viewport-x 0…containerWidth; the active card
 *  sits far off-screen right (x 1200…1500), like a far lane on a narrow board. */
function stubRects(board: HTMLElement, containerWidth: () => number) {
  const card = board.querySelector('[data-thread-card]') as HTMLElement;
  board.getBoundingClientRect = () =>
    ({ left: 0, right: containerWidth(), top: 0, bottom: 600, width: containerWidth(), height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  card.getBoundingClientRect = () =>
    ({ left: 1200, right: 1500, top: 0, bottom: 100, width: 300, height: 100, x: 1200, y: 0, toJSON: () => ({}) }) as DOMRect;
}

function boardResizeCallback(board: HTMLElement): ResizeObserverCallback {
  const entry = StubResizeObserver.instances.find((e) => e.target === board);
  if (!entry) throw new Error("board container was never observed");
  return entry.callback;
}

/** Mimic the component firing with (entries, observer) both unread. */
const fire = (entry: { callback: ResizeObserverCallback }) =>
  entry.callback([] as ResizeObserverEntry[], {} as ResizeObserver);

describe("Board keep-in-view re-fit on container resize", () => {
  it("a same-width (height-only) container resize does NOT slide the board back to the active card", () => {
    let width = 430;
    const board = renderBoardWithSelection("thr_a");
    stubRects(board, () => width);
    const callback = boardResizeCallback(board);

    // Prime: the observer's first sizing callback (initial observe).
    fire({ callback });
    // The operator pans the board back away from the selected card's lane.
    board.scrollLeft = 0;

    // Ambient resize: same width, any height (URL bar, keyboard, banner,
    // composer animation). The pan must rest.
    fire({ callback });
    expect(board.scrollLeft).toBe(0);
  });

  it("a real width change (pane opening) still re-fits the active card into view", () => {
    let width = 430;
    const board = renderBoardWithSelection("thr_a");
    stubRects(board, () => width);
    const callback = boardResizeCallback(board);

    fire({ callback });
    board.scrollLeft = 0;

    // A pane opens and the board's width shrinks to 200: the card (x 1200…)
    // falls past the visible range, the original intent re-fits it.
    width = 200;
    fire({ callback });
    expect(board.scrollLeft).toBeGreaterThan(0);
  });

  it("a width change with the card already fully in view scrolls nothing", () => {
    const board = renderBoardWithSelection("thr_a");
    stubRects(board, () => 200);
    const callback = boardResizeCallback(board);

    // Card rect fully inside the 0…200 container: nothing to correct.
    const card = board.querySelector('[data-thread-card]') as HTMLElement;
    card.getBoundingClientRect = () =>
      ({ left: 10, right: 150, top: 0, bottom: 100, width: 140, height: 100, x: 10, y: 0, toJSON: () => ({}) }) as DOMRect;

    board.scrollLeft = 37; // the operator's resting pan position
    fire({ callback });
    expect(board.scrollLeft).toBe(37);
  });
});
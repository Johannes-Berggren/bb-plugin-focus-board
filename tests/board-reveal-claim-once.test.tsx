// @vitest-environment jsdom
// [REDWORK] Regression for issue #119: marking a thread done kept re-scrolling
// the board to the Done column. Board's reveal layout effect consumed a claim
// by nulling revealClaimRef, but the stale `reveal` prop stayed set in
// app.tsx — on every later `columns` commit the same claim re-armed (the seq
// gate read `seq !== undefined` as "new claim") and the board yanked back to
// the revealed card's lane indefinitely, fighting the operator's scroll.
//
// Contract:
// 1. A fresh reveal seq scrolls the target card into view.
// 2. After the reveal is consumed, any later `columns` commit (status flip,
//    hover re-render, live refresh) does NOT scroll again.
// 3. A claim whose card is not on the board yet survives (honoured late),
//    then is consumed once.
// 4. A genuinely new reveal (fresh seq, e.g. the next relocating action)
//    still scrolls exactly as before.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

let restoreRects: (() => void) | null = null;

afterEach(() => {
  restoreRects?.();
  restoreRects = null;
  cleanup();
});

/** Pin the geometry BEFORE mount: the reveal layout effect fires at mount, so
 *  the reveal claim scroll must already see real-ish rects. jsdom has no
 *  layout — every card sits far off-screen right (x 1200…1500) of a narrow
 *  0…430 board, like the far Done lane on a scrolled board. */
function installRectStubs(): void {
  const original = Element.prototype.getBoundingClientRect;
  const containerRect = {
    left: 0, right: 430, top: 0, bottom: 600, width: 430, height: 600, x: 0, y: 0, toJSON: () => ({}),
  };
  const cardRect = {
    left: 1200, right: 1500, top: 0, bottom: 100, width: 300, height: 100, x: 1200, y: 0, toJSON: () => ({}),
  };
  Element.prototype.getBoundingClientRect = function () {
    if ((this as HTMLElement).hasAttribute?.("data-thread-card")) {
      return cardRect as DOMRect;
    }
    return containerRect as DOMRect;
  };
  restoreRects = () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

function boardProps(threads: PluginSidebarThread[]) {
  return {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
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
    reveal: null,
  } as unknown as BoardProps;
}

describe("Board reveal claim is consumed exactly once", () => {
  it("a fresh reveal seq scrolls the target card into view", () => {
    installRectStubs();
    const threads = [thread({ id: "thr_a", updatedAt: NOW - 5000 })];
    render(<Board {...boardProps(threads)} reveal={{ threadId: "thr_a", seq: 1 }} />);
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(board.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
    expect(board.scrollLeft).toBeGreaterThan(0);
  });

  it("a consumed reveal does NOT re-scroll on later columns commits (issue #119)", () => {
    installRectStubs();
    const threads = [thread({ id: "thr_a", updatedAt: NOW - 5000 })];
    const props = boardProps(threads);
    const rendered = render(<Board {...props} reveal={{ threadId: "thr_a", seq: 1 }} />);
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(board.scrollLeft).toBeGreaterThan(0);
    // The operator pans away from the revealed card's lane.
    board.scrollLeft = 0;
    // Any later board commit (fresh columns identity, same content, e.g. a
    // status flip or a live refresh) must not re-scroll: the stale reveal
    // stays set in app.tsx, but its claim was consumed.
    rendered.rerender(
      <Board
        {...boardProps([thread({ id: "thr_a", updatedAt: NOW - 4000 })])}
        reveal={{ threadId: "thr_a", seq: 1 }}
      />,
    );
    expect(board.scrollLeft).toBe(0);
  });

  it("a claim whose card is not on the board yet is honoured late, then consumed once", () => {
    installRectStubs();
    // First render: the revealed thread is absent (host state not landed or a
    // filter hides it) — the claim must survive, not scroll and not be lost.
    const before = boardProps([thread({ id: "thr_b", updatedAt: NOW - 5000 })]);
    const rendered = render(<Board {...before} reveal={{ threadId: "thr_a", seq: 1 }} />);
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(board.querySelector('[data-thread-card="thr_a"]')).toBeNull();
    expect(board.scrollLeft).toBe(0);
    // The thread arrives on a later commit: the pending claim scrolls to it.
    const arrive = boardProps([thread({ id: "thr_a", updatedAt: NOW - 5000 })]);
    rendered.rerender(<Board {...arrive} reveal={{ threadId: "thr_a", seq: 1 }} />);
    expect(board.scrollLeft).toBeGreaterThan(0);
    // And the honoured claim is now consumed: no re-scroll on the next commit.
    board.scrollLeft = 0;
    rendered.rerender(<Board {...arrive} reveal={{ threadId: "thr_a", seq: 1 }} />);
    expect(board.scrollLeft).toBe(0);
  });

  it("a genuinely new reveal (fresh seq) still scrolls after a consumed one", () => {
    installRectStubs();
    const props = boardProps([thread({ id: "thr_a", updatedAt: NOW - 5000 })]);
    const rendered = render(<Board {...props} reveal={{ threadId: "thr_a", seq: 1 }} />);
    const board = document.querySelector("[data-columns-board]") as HTMLElement;
    expect(board.scrollLeft).toBeGreaterThan(0);
    board.scrollLeft = 0;
    // The next relocating action (another Mark Done, a Pin) issues a fresh
    // seq: it must scroll exactly as before.
    rendered.rerender(
      <Board
        {...boardProps([thread({ id: "thr_a", updatedAt: NOW - 4000 })])}
        reveal={{ threadId: "thr_a", seq: 2 }}
      />,
    );
    expect(board.scrollLeft).toBeGreaterThan(0);
  });
});
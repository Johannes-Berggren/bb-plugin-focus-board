// @vitest-environment jsdom
// Reordering the nested child rows WITHIN a family: dropping a child row on
// a sibling row's edge reorders the rows under the parent card — its own
// child:<parentId> rank order, never the parent card's column order. The
// floor keeps the detach gesture (the inverse of a nest), and rows of a
// DIFFERENT family refuse the reorder.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function makeDataTransfer() {
  const payload = new Map<string, string>();
  const types: string[] = [];
  return {
    get types() {
      return [...types];
    },
    setData(type: string, value: string) {
      if (!types.includes(type)) types.push(type);
      payload.set(type, value);
    },
    getData(type: string) {
      return payload.get(type) ?? "";
    },
    effectAllowed: "move",
    dropEffect: "none",
  };
}

/** The draggable anchor of a row (a child row is its own anchor). */
function draggable(fromId: string): HTMLElement {
  const el = document.querySelector(`[data-thread-card="${fromId}"]`);
  if (!(el instanceof HTMLElement) || !el.draggable) {
    throw new Error(`missing draggable row/card ${fromId}`);
  }
  return el;
}

function withRect(el: HTMLElement, height = 300): void {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 100, bottom: height, width: 100, height }) as DOMRect;
}

afterEach(cleanup);

interface ChildBoardResult {
  onRankMove: ReturnType<typeof vi.fn>;
  onReparent: ReturnType<typeof vi.fn>;
}

function renderFamilyBoard(overrides: Partial<BoardProps> = {}): ChildBoardResult {
  const parent = thread({ id: "p", status: "active", updatedAt: NOW - 1000 });
  const childA = thread({
    id: "c1",
    parentThreadId: "p",
    updatedAt: NOW - 2000,
  });
  const childB = thread({
    id: "c2",
    parentThreadId: "p",
    updatedAt: NOW - 3000,
  });
  const foreignParent = thread({ id: "q", status: "active", updatedAt: NOW - 4000 });
  const foreignChild = thread({
    id: "f1",
    parentThreadId: "q",
    updatedAt: NOW - 5000,
  });
  const threads = [parent, childA, childB, foreignParent, foreignChild];
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map([
      ["p", [childA, childB]],
      ["q", [foreignChild]],
    ]),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map([
      ["p", 2],
      ["q", 1],
    ]),
    dimmedIds: new Set<string>(),
    rawParentOf: new Map([
      ["c1", "p"],
      ["c2", "p"],
      ["f1", "q"],
    ]),
    rankStore: {},
    onRankMove: vi.fn(),
    onReparent: vi.fn().mockResolvedValue(undefined),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  render(<Board {...props} />);
  return { onRankMove: props.onRankMove, onReparent: props.onReparent };
}

/**
 * The full row drag: dragstart on the source row (which sets the payload and
 * the live drag ref), then dragover and drop on the target row at `clientY`.
 * Returns whether the target row's dragover authorized the drop.
 */
function dragRowOnto(fromId: string, targetId: string, clientY: number) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(draggable(fromId), { dataTransfer: dt });
  const anchor = draggable(targetId);
  withRect(anchor);
  const over = createEvent.dragOver(anchor, { dataTransfer: dt });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(anchor, over);
  const drop = createEvent.drop(anchor, { dataTransfer: dt });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(anchor, drop);
  return { dropAllowed: over.defaultPrevented };
}

describe("the reorder-nested-children gesture", () => {
  it("a row dropped on a sibling's edge writes the family's own child order", () => {
    const { onRankMove, onReparent } = renderFamilyBoard();
    const { dropAllowed } = dragRowOnto("c1", "c2", 10); // c1 onto c2's top half
    expect(dropAllowed).toBe(true);
    expect(onRankMove).toHaveBeenCalledTimes(1);
    expect(onRankMove).toHaveBeenCalledWith(
      "child:p",
      "c1",
      "c2",
      false,
      ["c1", "c2"],
    );
    // The gesture never rides the parent card's handlers: no nest, no
    // column-order write for the reorder itself.
    expect(onReparent).not.toHaveBeenCalled();
  });

  it("a row dropped below its following sibling anchors past it (one slot further)", () => {
    const { onRankMove } = renderFamilyBoard();
    dragRowOnto("c1", "c2", 290);
    expect(onRankMove).toHaveBeenCalledWith(
      "child:p",
      "c1",
      null,
      true,
      ["c1", "c2"],
    );
  });

  it("rows of a DIFFERENT family never write a child order (the reorder is family-scoped)", () => {
    const { onRankMove } = renderFamilyBoard();
    // The drop may bubble to the hovered family's own card gesture (today's
    // column path), but no child:<parentId> order is ever written for a
    // cross-family drop: the reorder is a same-family gesture.
    dragRowOnto("c1", "f1", 10);
    expect(onRankMove).not.toHaveBeenCalledWith("child:p", expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it("the floor keeps the detach gesture (drag a row out of the family)", () => {
    const { onRankMove, onReparent } = renderFamilyBoard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(draggable("c1"), { dataTransfer: dt });
    const floor = document.querySelector(`[data-column-id="working"]`);
    if (!(floor instanceof HTMLElement)) throw new Error("missing working column");
    fireEvent.drop(floor, { dataTransfer: dt });
    expect(onReparent).toHaveBeenCalledWith("c1", null);
    expect(onRankMove).not.toHaveBeenCalled();
  });
});
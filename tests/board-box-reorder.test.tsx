// @vitest-environment jsdom
// Reordering INSIDE a family box: the dashed box used to be a unit — any
// drop beside a member anchored at the box's edge or refused. Now a member
// dropped on a sibling's edge moves ALONE within the box (the unit-move
// gesture stays for every hover outside the box).
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

function cardAnchor(fromId: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
  return anchor;
}

function boxLabel(groupId: string): HTMLElement {
  const label = document.querySelector(`[data-group-box-label="${groupId}"]`);
  if (!(label instanceof HTMLElement)) throw new Error(`missing group box label ${groupId}`);
  return label;
}

function cardSlot(id: string): HTMLElement {
  const slot = document.querySelector(`[data-rank-slot="${id}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing rank slot ${id}`);
  return slot;
}

/** jsdom rects are 0×0; give the slot a 300px-tall box so halves are real. */
function withRect(el: HTMLElement, height = 300): void {
  el.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 100, bottom: height, width: 100, height }) as DOMRect;
}

/**
 * The full drag: dragstart on the source anchor, then dragover and drop on
 * the target slot at `clientY` (forced onto the events; jsdom does not map
 * it). Returns whether dragover authorized the drop.
 */
function dragOnto(fromId: string, targetId: string, clientY: number) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(cardAnchor(fromId), { dataTransfer: dt });
  const slot = cardSlot(targetId);
  withRect(slot);
  const over = createEvent.dragOver(slot, { dataTransfer: dt });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(slot, over);
  const drop = createEvent.drop(slot, { dataTransfer: dt });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(slot, drop);
  return { dropAllowed: over.defaultPrevented };
}

/** The same gesture, started from the box's LABEL instead of a member card. */
function labelDragOnto(groupId: string, targetId: string, clientY: number) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(boxLabel(groupId), { dataTransfer: dt });
  const slot = cardSlot(targetId);
  withRect(slot);
  const over = createEvent.dragOver(slot, { dataTransfer: dt });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(slot, over);
  const drop = createEvent.drop(slot, { dataTransfer: dt });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(slot, drop);
  return { dropAllowed: over.defaultPrevented };
}

afterEach(cleanup);

const membersFixture = [
  thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
  thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  thread({ id: "thr_c", status: "active", updatedAt: NOW - 3000 }),
  thread({ id: "thr_x", status: "active", updatedAt: NOW - 4000 }),
];

function renderBoxedBoard(overrides: Partial<BoardProps> = {}) {
  const members = membersFixture;
  const groupBoxOf = new Map([
    [
      "thr_b",
      { groupId: "grp_auth", name: "Auth rework", members: [members[1], members[2]] },
    ],
    [
      "thr_c",
      { groupId: "grp_auth", name: "Auth rework", members: [members[1], members[2]] },
    ],
  ]);
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(members, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: vi.fn(),
    groupBoxOf,
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
  return props;
}

describe("the reorder-inside-a-family-box gesture", () => {
  it("a member dropped beside a sibling moves ALONE (no unit ids), anchored at the sibling", () => {
    const props = renderBoxedBoard();
    const { dropAllowed } = dragOnto("thr_c", "thr_b", 10); // c onto b's top half
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "status:working",
      "thr_c",
      "thr_b",
      false,
      ["thr_a", "thr_b", "thr_c", "thr_x"],
    );
  });

  it("the box keeps moving as a unit for every hover outside it", () => {
    const props = renderBoxedBoard();
    // thr_x's bottom half: below thr_x holds nothing, so the box appends
    // below it — the slot above thr_x is the box's own, and its earlier
    // self-anchored write reproduced the order unchanged.
    const { dropAllowed } = dragOnto("thr_b", "thr_x", 290);
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "status:working",
      "thr_b",
      null,
      true,
      ["thr_a", "thr_b", "thr_c", "thr_x"],
      ["thr_b", "thr_c"],
    );
  });
});

describe("dragging a family box by its LABEL", () => {
  it("the label drags the whole box: a drop at a plain card's edge moves the unit", () => {
    const props = renderBoxedBoard();
    // The box onto the lane's top card's top half: "before thr_a" is the
    // lane's head, not the box's own slot (the box sits second).
    const { dropAllowed } = labelDragOnto("grp_auth", "thr_a", 10);
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "status:working",
      "thr_b",
      "thr_a",
      false,
      ["thr_a", "thr_b", "thr_c", "thr_x"],
      ["thr_b", "thr_c"],
    );
  });

  it("a group of one's label drags its lone member plain (no unit ids)", () => {
    const props = renderBoxedBoard({
      groupBoxOf: new Map<string, { groupId: string; name: string; members: unknown[] }>([
        [
          "thr_b",
          { groupId: "grp_auth", name: "Auth rework", members: [membersFixture[1], membersFixture[2]] },
        ],
        [
          "thr_c",
          { groupId: "grp_auth", name: "Auth rework", members: [membersFixture[1], membersFixture[2]] },
        ],
        ["thr_x", { groupId: "grp_one", name: "Lone rider", members: [membersFixture[3]] }],
      ]) as unknown as BoardProps["groupBoxOf"],
    });
    const { dropAllowed } = labelDragOnto("grp_one", "thr_a", 10); // thr_x before thr_a
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      "status:working",
      "thr_x",
      "thr_a",
      false,
      ["thr_a", "thr_b", "thr_c", "thr_x"],
    );
  });

  it("a sleeping lead member refuses the label drag outright", () => {
    renderBoxedBoard({ snoozeFor: (id: string) => (id === "thr_b" ? NOW + 600_000 : null) });
    const start = createEvent.dragStart(boxLabel("grp_auth"), { dataTransfer: makeDataTransfer() });
    fireEvent(boxLabel("grp_auth"), start);
    expect(start.defaultPrevented).toBe(true);
  });
});
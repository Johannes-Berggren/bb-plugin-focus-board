// @vitest-environment jsdom
// Issue #249, first cut (goals 3 and 4): a dot on the collapsed strip drags
// to reorder its tier of the family — the board owns the decision (target,
// guard, write) exactly as it does for the nested-row reorder, and the write
// rides the EXISTING child rank machinery (`child:<parentId>` rank keys) on
// lib/rank.ts, so no store shape changes.
//
// Laws pinned here:
// - A dot drag stays inside its tier of the family; a cross-tier or
//   outside-the-strip release refuses with a banner and writes nothing.
// - A release that resolves to no change refuses with a banner (#231).
// - The floor never un-nests a dot drag ("dot drags never leave the
//   hierarchy"; the drag-out is a later cut's explicit morph gesture).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { childRankKey, DOT_DRAG_TYPE, DRAG_ID_KEY } from "../lib/rank";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

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

type BoardProps = Parameters<typeof Board>[0];

function familyScene() {
  const parent = thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: NOW - 6000 });
  const childOne = thread({
    id: "thr_c1",
    parentThreadId: "thr_parent",
    displayTitle: "Child one",
    status: "working",
    updatedAt: NOW - 5000,
  });
  const childTwo = thread({
    id: "thr_c2",
    parentThreadId: "thr_parent",
    displayTitle: "Child two",
    status: "working",
    updatedAt: NOW - 4000,
  });
  const subOne = thread({
    id: "thr_c1_s1",
    parentThreadId: "thr_c1",
    displayTitle: "Sub one",
    status: "working",
    updatedAt: NOW - 3000,
  });
  const subTwo = thread({
    id: "thr_c1_s2",
    parentThreadId: "thr_c1",
    displayTitle: "Sub two",
    status: "working",
    updatedAt: NOW - 2000,
  });
  return {
    threads: [parent, childOne, childTwo, subOne, subTwo],
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
      ["thr_parent", [childOne, childTwo]],
      ["thr_c1", [subOne, subTwo]],
    ]),
  };
}

function renderFamilyBoard(
  overrides: Partial<BoardProps> = {},
  sceneOverride: Partial<ReturnType<typeof familyScene>> = {},
) {
  const scene = { ...familyScene(), ...sceneOverride };
  const props = {
    columns: buildColumns(scene.threads, "status", context, new Map(), new Set(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: scene.nestedChildrenByParent,
    childCountByParent: new Map<string, number>([
      ["thr_parent", 2],
      ["thr_c1", 2],
    ]),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    collapsedFamilyIds: new Set(["thr_parent", "thr_c1"]),
    rawParentOf: new Map<string, string>([
      ["thr_c1", "thr_parent"],
      ["thr_c2", "thr_parent"],
      ["thr_c1_s1", "thr_c1"],
      ["thr_c1_s2", "thr_c1"],
    ]),
    rankStore: {},
    onRankMove: vi.fn(),
    onReparent: vi.fn(),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return { props: props as BoardProps & { onRankMove: ReturnType<typeof vi.fn> }, ...render(<Board {...props} />) };
}

function dot(id: string): HTMLElement {
  // Scope to the PARENT card's strip: the board renders a strip on every
  // tier's own card (thr_c1's card carries its subs too), and `dot()` must
  // name the dot inside the family's whole-family strip, not the first
  // matching button elsewhere in the DOM.
  const button = document.querySelector<HTMLElement>(
    `[data-thread-card="thr_parent"] [data-child-thread-dots] button[data-child-dot="${id}"]`,
  );
  if (button === null) throw new Error(`missing dot for ${id}`);
  return button;
}

function columnSection(id: string): HTMLElement {
  const section = document.querySelector(`section[data-column-id="${id}"]`);
  if (section === null) throw new Error(`missing column ${id}`);
  return section;
}

function cardAnchor(id: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${id}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${id}`);
  return anchor;
}

function refusalBanner(): HTMLElement {
  const banner = document.querySelector<HTMLElement>('[data-testid="rank-error-banner"]');
  if (banner === null) throw new Error("no rank refusal banner");
  return banner;
}

/** A dot gesture: dragstart on `fromId`, then optional dragover and drop on
 * `toId` (or still hovering `fromId`). Returns what the dragover authorised. */
function dotGesture(
  fromId: string,
  toId?: string,
  finalize: "drop" | "end" = "drop",
) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(dot(fromId), { dataTransfer: dt });
  let dropAllowed = false;
  if (toId !== undefined) {
    const over = createEvent.dragOver(dot(toId), { dataTransfer: dt });
    fireEvent(dot(toId), over);
    dropAllowed = over.defaultPrevented;
    if (finalize === "drop") {
      fireEvent.drop(dot(toId), { dataTransfer: dt });
    }
  }
  if (finalize === "end") {
    fireEvent.dragEnd(dot(fromId), { dataTransfer: dt });
  }
  return { dt, dropAllowed };
}

afterEach(cleanup);

describe("a dot drag reorders its own tier of the family", () => {
  it("a child dot released on a sibling child dot writes child:<parentId>", () => {
    const { props } = renderFamilyBoard();
    // jsdom rects are all zero, so the hover half always reads "after":
    // thr_c1 dropped after thr_c2 is an append (toEnd) in thr_parent's tier.
    const { dropAllowed } = dotGesture("thr_c1", "thr_c2");
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      childRankKey("thr_parent"),
      "thr_c1",
      null,
      true,
      ["thr_c1", "thr_c2"],
    );
  });

  it("a sub-dot released on a sibling sub-dot writes child:<childId>", () => {
    const { props } = renderFamilyBoard();
    const { dropAllowed } = dotGesture("thr_c1_s1", "thr_c1_s2");
    expect(dropAllowed).toBe(true);
    expect(props.onRankMove).toHaveBeenCalledTimes(1);
    expect(props.onRankMove).toHaveBeenCalledWith(
      childRankKey("thr_c1"),
      "thr_c1_s1",
      null,
      true,
      ["thr_c1_s1", "thr_c1_s2"],
    );
  });

  it("hovering a sibling in the same tier promises the insertion line (drop authorised)", () => {
    renderFamilyBoard();
    const { dropAllowed } = dotGesture("thr_c1", "thr_c2", "end");
    expect(dropAllowed).toBe(true);
    // No drop, no write: the gesture ended without one.
  });
});

describe("a dot drag never leaves its tier or its family", () => {
  it("a child dot dropped on a sub-dot claims and refuses with a banner, writing nothing", () => {
    const { props } = renderFamilyBoard();
    const { dropAllowed } = dotGesture("thr_c2", "thr_c1_s1");
    expect(dropAllowed).toBe(true); // claimed, so the drop can be refused loudly
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
  });

  it("releasing a dot outside the strip (plain dragend) refuses with a banner, writing nothing", () => {
    const { props } = renderFamilyBoard();
    const { dt } = dotGesture("thr_c1", undefined, "end");
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
    expect(dt.types).toContain(DOT_DRAG_TYPE);
  });

  it("the column floor never authorises a dot drag, and a dot drop there unnests nothing", () => {
    const { props } = renderFamilyBoard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1"), { dataTransfer: dt });
    const over = createEvent.dragOver(columnSection("working"), { dataTransfer: dt });
    fireEvent(columnSection("working"), over);
    expect(over.defaultPrevented).toBe(false);
    const drop = createEvent.drop(columnSection("working"), { dataTransfer: dt });
    fireEvent(columnSection("working"), drop);
    expect(props.onReparent).not.toHaveBeenCalled();
    expect(props.onRankMove).not.toHaveBeenCalled();
  });

  it("a dot dropped onto a card surface nests nothing", () => {
    const scene = familyScene();
    // A second, childless card to aim at: a nest write would child thr_c1 under it.
    const stranger = thread({
      id: "thr_stranger",
      displayTitle: "Stranger",
      status: "working",
      updatedAt: NOW - 100,
    });
    const { props } = renderFamilyBoard({}, { threads: [...scene.threads, stranger] });
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1"), { dataTransfer: dt });
    const over = createEvent.dragOver(cardAnchor("thr_stranger"), { dataTransfer: dt });
    fireEvent(cardAnchor("thr_stranger"), over);
    const drop = createEvent.drop(cardAnchor("thr_stranger"), { dataTransfer: dt });
    fireEvent(cardAnchor("thr_stranger"), drop);
    expect(props.onReparent).not.toHaveBeenCalled();
    expect(props.onRankMove).not.toHaveBeenCalled();
  });
});

describe("the no-change law holds on the strip", () => {
  it("a dot released on its own slot refuses loudly and writes nothing", () => {
    const { props } = renderFamilyBoard();
    const { dropAllowed } = dotGesture("thr_c1", "thr_c1");
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
    void dropAllowed;
  });

  it("a dot hovered onto the sibling directly below it resolves to no move and refuses", () => {
    // jsdom DragEvent carries no clientX, so the hover half always reads
    // "after" — the adjacency case under that edge: hovering ON thr_c1
    // promises landing "after" thr_c1, whose next member IS thr_c2, the
    // dragged dot — its own slot. moveTargetFor refuses; the drop must
    // repeat the refusal loudly and write nothing.
    const { props } = renderFamilyBoard();
    const { dropAllowed } = dotGesture("thr_c2", "thr_c1");
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
    void dropAllowed;
  });

});

describe("wiring gates", () => {
  it("with no rank write wired, dots stay undraggable click-preview controls", () => {
    renderFamilyBoard({ onRankMove: undefined });
    expect(dot("thr_c1").draggable).toBe(false);
    expect(dot("thr_c1_s1").draggable).toBe(false);
  });

  it("an unroutable payload id at drop refuses loudly and writes nothing", () => {
    const { props } = renderFamilyBoard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1"), { dataTransfer: dt });
    dt.setData(DRAG_ID_KEY, "thr_ghost");
    fireEvent.drop(dot("thr_c2"), { dataTransfer: dt });
    expect(props.onRankMove).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
  });
});

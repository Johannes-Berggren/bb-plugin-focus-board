// @vitest-environment jsdom
// Issue #249, goal 6 (cut 4): a CARD dragged into a collapsed family's dot
// field children it. The strip claims the dragover so the card's own
// nest/reorder promises never fire under the cursor, the release writes the
// existing `thread_reparent` nest path (the board owns every refusal), and
// the count chip and strip update with the refetch the write triggers.
// Dot-marked drags keep their own home rules on the same surface.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { childRankKey } from "../lib/rank";
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

function scene() {
  const parent = thread({ id: "thr_fam", displayTitle: "Family root", updatedAt: NOW - 6000 });
  const childOne = thread({
    id: "thr_fam_c1",
    parentThreadId: "thr_fam",
    displayTitle: "Family child one",
    status: "working",
    updatedAt: NOW - 5000,
  });
  const subOne = thread({
    id: "thr_fam_c1_s1",
    parentThreadId: "thr_fam_c1",
    displayTitle: "Family sub one",
    status: "working",
    updatedAt: NOW - 3000,
  });
  const childTwo = thread({
    id: "thr_fam_c2",
    parentThreadId: "thr_fam",
    displayTitle: "Family child two",
    status: "working",
    updatedAt: NOW - 2000,
  });
  const stranger = thread({
    id: "thr_stranger",
    displayTitle: "Stranger card",
    status: "working",
    updatedAt: NOW - 4000,
  });
  return {
    threads: [parent, childOne, childTwo, subOne, stranger],
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
      ["thr_fam", [childOne, childTwo]],
      ["thr_fam_c1", [subOne]],
    ]),
    rawParentOf: new Map<string, string>([
      ["thr_fam_c1", "thr_fam"],
      ["thr_fam_c2", "thr_fam"],
      ["thr_fam_c1_s1", "thr_fam_c1"],
    ]),
  };
}

function renderStripBoard(
  overrides: Partial<BoardProps> = {},
  sceneOverride: Partial<ReturnType<typeof scene>> = {},
) {
  const state = { ...scene(), ...sceneOverride };
  const props = {
    columns: buildColumns(state.threads, "status", context, new Map(), new Set(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: state.nestedChildrenByParent,
    childCountByParent: new Map<string, number>([["thr_fam", 2]]),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    collapsedFamilyIds: new Set(["thr_fam"]),
    rawParentOf: state.rawParentOf,
    rankStore: {},
    onRankMove: vi.fn(),
    onReparent: vi.fn().mockResolvedValue(undefined),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return {
    props: props as BoardProps & { onReparent: ReturnType<typeof vi.fn>; onRankMove: ReturnType<typeof vi.fn> },
    ...render(<Board {...props} />),
  };
}

function stripOf(family = "thr_fam"): HTMLElement {
  const strip = document.querySelector(`[data-thread-card="${family}"] [data-child-thread-dots]`);
  if (!(strip instanceof HTMLElement)) throw new Error(`missing strip of ${family}`);
  return strip;
}

function cardAnchor(id: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${id}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${id}`);
  return anchor;
}

function rowAnchor(id: string): HTMLElement {
  const anchor = document.querySelector(`[data-nested-rows] a[data-thread-card="${id}"]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing nested row ${id}`);
  return anchor;
}

/** Card drag: dragstart on the source, dragover + drop on the strip. */
function dragCardOntoStrip(fromAnchor: HTMLElement, fromId: string, drop = true) {
  const dt = makeDataTransfer();
  fireEvent.dragStart(fromAnchor, { dataTransfer: dt });
  const over = createEvent.dragOver(stripOf(), { dataTransfer: dt });
  fireEvent(stripOf(), over);
  let dropResult: HTMLElement | null = null;
  if (drop) {
    const dropEvt = createEvent.drop(stripOf(), { dataTransfer: dt });
    fireEvent(stripOf(), dropEvt);
  }
  return { dt, dropAllowed: over.defaultPrevented, dropResult };
}

function refusalBanner(): HTMLElement {
  const banner = document.querySelector<HTMLElement>('[data-testid="rank-error-banner"]');
  if (banner === null) throw new Error("no rank refusal banner");
  return banner;
}

function stripBubble(): HTMLElement {
  const bubble = document.querySelector('[data-child-dot-preview][data-strip-nest=""]');
  if (!(bubble instanceof HTMLElement)) throw new Error("no strip-nest preview bubble");
  return bubble;
}

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
class StubResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
});

afterEach(cleanup);

describe("a card hovered over a dot field collapses into tooltip plus dot", () => {
  it("the strip claims the dragover and previews the dragged card", () => {
    renderStripBoard();
    const from = cardAnchor("thr_stranger");
    const { dropAllowed } = dragCardOntoStrip(from, "thr_stranger", false);
    expect(dropAllowed).toBe(true);
    expect(document.querySelector('[data-thread-card="thr_fam"] [data-strip-nest-target]')).not.toBeNull();
    expect(document.querySelector('[data-thread-card="thr_fam"] [data-strip-nest-ghost]')).not.toBeNull();
    expect(stripBubble().textContent).toContain("Stranger card");
  });

  it("releasing there children the card under the family root and writes nothing else", async () => {
    const { props } = renderStripBoard();
    dragCardOntoStrip(cardAnchor("thr_stranger"), "thr_stranger");
    expect(props.onReparent).toHaveBeenCalledWith("thr_stranger", "thr_fam");
    // The plan's land-last rule: the reparent resolves, then the member
    // ranks last in its tier through the same onRankMove the dot drags write.
    await vi.waitFor(() => {
      expect(props.onRankMove).toHaveBeenCalledTimes(1);
    });
    expect(props.onRankMove).toHaveBeenCalledWith(
      "child:thr_fam",
      "thr_stranger",
      null,
      true,
      ["thr_fam_c1", "thr_fam_c2", "thr_stranger"],
    );
    expect(props.onDropUnread).not.toHaveBeenCalled();
    expect(props.onDropDone).not.toHaveBeenCalled();
    expect(props.onDropPinned).not.toHaveBeenCalled();
    // The affordance dies with the release.
    expect(document.querySelector('[data-strip-nest-ghost]')).toBeNull();
  });

  it("the refetch's strip and count agree the new member in (the refetch simulation)", () => {
    const view = renderStripBoard();
    dragCardOntoStrip(cardAnchor("thr_stranger"), "thr_stranger");
    // The host executes the write and publishes: the board's next render
    // carries the member nested for real (the sidebar's data now shows
    // parentThreadId, the raw parent map follows, the map serves the rows).
    const before = scene();
    const refetched = before.threads.map((t) =>
      t.id === "thr_stranger" ? thread({ ...t, parentThreadId: "thr_fam", updatedAt: t.updatedAt }) : t,
    );
    const nested = new Map(before.nestedChildrenByParent as ReadonlyMap<string, readonly PluginSidebarThread[]>);
    nested.set("thr_fam", [
      ...(nested.get("thr_fam") ?? []),
      refetched.find((t) => t.id === "thr_stranger") as PluginSidebarThread,
    ]);
    const settled = {
      ...before,
      threads: refetched,
      nestedChildrenByParent: nested,
      rawParentOf: new Map([...before.rawParentOf, ["thr_stranger", "thr_fam"]]),
    };
    view.rerender(
      stripRerender({
        columns: buildColumns(settled.threads, "status", context, new Map(), new Set(), NOW, {}),
        nestedChildrenByParent: settled.nestedChildrenByParent,
        rawParentOf: settled.rawParentOf,
        childCountByParent: new Map([["thr_fam", 3]]),
      }),
    );
    const strip = stripOf();
    expect(strip.querySelectorAll("button[data-child-dot]")).toHaveLength(4);
    // Scoped to the family's own card: the toggle counts the folded rows
    // (3 children + 1 sub); the count chip's span reads the children (3);
    // both step with the refetch.
    const toggle = document.querySelector(
      '[data-thread-card="thr_fam"] button[data-child-threads-toggle]',
    );
    expect(toggle?.textContent).toContain("4 child threads");
    // The count chip's own span (the rounded muted shell beside the title)
    // reads the children count, not the row's recency label.
    const chip = document.querySelector(
      '[data-thread-card="thr_fam"] span.rounded-full.px-1\\.5',
    );
    expect(chip?.textContent).toBe("3");
  });

  it("the family's own member released on its own strip refuses loudly and writes nothing", () => {
    // The member's row still renders while the family sits collapsed (the
    // open child's anchor row, issue #174): drag THAT onto the home strip.
    const { props } = renderStripBoard(
      { activeThreadId: "thr_fam_c1" },
      {},
    );
    const activeRow = document.querySelector(
      '[data-child-active-row] a[data-thread-card="thr_fam_c1"]',
    );
    if (!(activeRow instanceof HTMLElement)) throw new Error("missing active child row");
    dragCardOntoStrip(activeRow, "thr_fam_c1");
    expect(props.onReparent).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
  });

  it("the family's root released on its own strip refuses loudly", () => {
    const { props } = renderStripBoard();
    dragCardOntoStrip(cardAnchor("thr_fam"), "thr_fam");
    expect(props.onReparent).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
  });

  it("a cycle drop refuses by name (a member's card onto a sub-member's... never itself)", () => {
    // Nesting thr_fam (the root) is illegal under its own descendant: the
    // reparent guard's refusal names itself on the strip target too.
    const { props } = renderStripBoard();
    dragCardOntoStrip(cardAnchor("thr_fam"), "thr_fam");
    expect(props.onReparent).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
  });

  it("dragend without a drop clears the affordance", () => {
    renderStripBoard();
    const dt = makeDataTransfer();
    const anchor = cardAnchor("thr_stranger");
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    fireEvent(stripOf(), createEvent.dragOver(stripOf(), { dataTransfer: dt }));
    expect(document.querySelector('[data-strip-nest-ghost]')).not.toBeNull();
    // The card lifecycle's dragend owns the cleanup (rankDragLifecycle(null)).
    fireEvent(anchor, createEvent.dragEnd(stripOf(), { dataTransfer: dt }));
    expect(document.querySelector('[data-strip-nest-ghost]')).toBeNull();
  });

  it("dot-marked drags keep their home rules: no strip-nest affordance for them", () => {
    renderStripBoard();
    const dt = makeDataTransfer();
    // A dot drag STARTS from a dot button; its payload reads dot-marked.
    const source = document.querySelector('button[data-child-dot="thr_fam_c1"]');
    if (!(source instanceof HTMLElement)) throw new Error("missing dot");
    fireEvent.dragStart(source, { dataTransfer: dt });
    dt.setData("application/x-focus-board-dot", "");
    fireEvent(stripOf(), createEvent.dragOver(stripOf(), { dataTransfer: dt }));
    expect(document.querySelector('[data-strip-nest-ghost]')).toBeNull();
    expect(document.querySelector('[data-child-dot-preview][data-strip-nest=""]')).toBeNull();
  });

  it("an unidentified payload at drop refuses loudly and writes nothing", () => {
    const { props } = renderStripBoard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_stranger"), { dataTransfer: dt });
    dt.setData("text/focus-board-id", "thr_ghost");
    fireEvent(stripOf(), createEvent.dragOver(stripOf(), { dataTransfer: dt }));
    fireEvent(stripOf(), createEvent.drop(stripOf(), { dataTransfer: dt }));
    expect(props.onReparent).not.toHaveBeenCalled();
    expect(refusalBanner().textContent).toContain("Reorder refused");
  });

  it("no reparent write wired keeps the strip unclaimed for card drags", () => {
    renderStripBoard({ onReparent: undefined });
    const dt = makeDataTransfer();
    fireEvent.dragStart(cardAnchor("thr_stranger"), { dataTransfer: dt });
    fireEvent(stripOf(), createEvent.dragOver(stripOf(), { dataTransfer: dt }));
    // The strip itself claims nothing: no affordance, and the card's own
    // handlers (surface-level behaviors) stay in charge.
    expect(document.querySelector('[data-strip-nest-ghost]')).toBeNull();
    expect(document.querySelector('[data-child-dot-preview][data-strip-nest=""]')).toBeNull();
  });
});

function stripRerender(overrides: Partial<BoardProps> = {}): React.ReactElement {
  const state = { ...scene() };
  const props = {
    columns: buildColumns(state.threads, "status", context, new Map(), new Set(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    collapsedFamilyIds: new Set(["thr_fam"]),
    rawParentOf: state.rawParentOf,
    rankStore: {},
    onRankMove: vi.fn(),
    onReparent: vi.fn().mockResolvedValue(undefined),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return <Board {...props} />;
}

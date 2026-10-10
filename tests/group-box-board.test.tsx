// @vitest-environment jsdom
// The decided family-box design (thread storage: reports/feature-group-
// mockups.html) pinned on the Board seam: members render inside ONE dashed
// container li, whose label rides the container's top margin (inside the
// scrollport at any position — the first per-card fragment attempt
// truncated the label at the list's top edge, observed 2026-10-09). A group
// of one KEEPS its box — the solitary outline is the drag-into target, and
// a group hides only when its last candidate leaves.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<string, { groupId: string; name: string }>,
) {
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf,
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

describe("the family box renders as one container around its members", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    [
      "thr_a",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
    [
      "thr_b",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
  ]);

  it("ONE box li carries the member card slots inside", () => {
    renderBoard(members, boxes);
    const box = document.querySelector('[data-group-box="grp_1"]');
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(2);
    // Exactly one box container for the pair, holding exactly two slots.
    expect(document.querySelectorAll('[data-group-box="grp_1"]')).toHaveLength(1);
    for (const id of ["thr_a", "thr_b"]) {
      expect(box?.querySelector(`[data-rank-slot="${id}"]`)).not.toBeNull();
    }
  });

  it("the group's name is secondary text on the box container", () => {
    renderBoard(members, boxes);
    const label = document.querySelector('[data-group-box-label="grp_1"]');
    expect(label?.textContent).toBe("Auth rework");
  });

  it("a lone member keeps its box: one dashed container, its label, one card slot", () => {
    const solo = thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 });
    renderBoard(
      [solo],
      new Map([["thr_a", { groupId: "grp_1", name: "Auth rework", members: [solo] }]]),
    );
    // The solitary box is the drag-into target: the group stays visible (and
    // joinable) until its last member is gone.
    const box = document.querySelector('[data-group-box="grp_1"]');
    expect(box).not.toBeNull();
    expect(box?.querySelectorAll('[data-group-box-member="grp_1"]')).toHaveLength(1);
    expect(document.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe(
      "Auth rework",
    );
  });

  it("an unassigned card renders with no box decoration", () => {
    renderBoard(members, new Map());
    expect(document.querySelector('[data-group-box]')).toBeNull();
  });

  it("a member alone in its column (its box split) renders plain there", () => {
    // Two members, but only one of them is in any column of this board:
    // the split pair renders as two plain cards, never a box of one.
    renderBoard(
      [thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 })],
      boxes,
    );
    expect(document.querySelector('[data-group-box]')).toBeNull();
  });
});

describe("click-to-rename on the group box label", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    [
      "thr_a",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
    [
      "thr_b",
      { groupId: "grp_1", name: "Auth rework", members: members },
    ],
  ]);

  function renderRenamableBoard(onRenameGroup: (groupId: string, name: string) => void) {
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
      onRankMove: () => {},
      groupBoxOf: boxes,
      onRenameGroup,
      projectNameFor: () => "",
      repoBaseFor: () => null,
      onOpenThread: () => {},
      onNewTask: () => {},
      onDropDone: () => {},
      onDropUnread: () => {},
      onDropPinned: () => {},
      menuActionsFor: () => [],
    } as unknown as BoardProps;
    render(<Board {...props} />);
  }

  it("clicking the label swaps it for a text input pre-filled with the current name", () => {
    renderRenamableBoard(vi.fn());
    const label = document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement;
    expect(label).not.toBeNull();
    fireEvent.click(label);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Auth rework");
  });

  it("Enter commits the new name through onRenameGroup and restores the label", () => {
    const onRenameGroup = vi.fn();
    renderRenamableBoard(onRenameGroup);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Auth v2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameGroup).toHaveBeenCalledTimes(1);
    expect(onRenameGroup).toHaveBeenCalledWith("grp_1", "Auth v2");
    // The label is back (still the old name — the caller's refetch settles it).
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
    expect(document.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe("Auth rework");
  });

  it("Enter commits a trimmed name; whitespace-only names do not commit", () => {
    const onRenameGroup = vi.fn();
    renderRenamableBoard(onRenameGroup);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    let input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameGroup).not.toHaveBeenCalled();
    // A blank commit leaves the editor OPEN (fix-up possible, nothing lost).
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).not.toBeNull();
    fireEvent.change(input, { target: { value: "  Search v2  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRenameGroup).toHaveBeenCalledWith("grp_1", "Search v2");
  });

  it("Escape cancels the edit and keeps the old label", () => {
    const onRenameGroup = vi.fn();
    renderRenamableBoard(onRenameGroup);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "nope" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRenameGroup).not.toHaveBeenCalled();
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
    expect(document.querySelector('[data-group-box-label="grp_1"]')?.textContent).toBe("Auth rework");
  });
});

describe("delete from the label editor (arm → confirm)", () => {
  const members = [
    thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", status: "active", updatedAt: NOW - 2000 }),
  ];
  const boxes = new Map([
    ["thr_a", { groupId: "grp_1", name: "Auth rework", members }],
    ["thr_b", { groupId: "grp_1", name: "Auth rework", members }],
  ] as const);

  function renderEditor(onDeleteGroup: (groupId: string) => void, onRenameGroup = vi.fn()) {
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
      onRankMove: () => {},
      groupBoxOf: boxes,
      onRenameGroup,
      onDeleteGroup,
      projectNameFor: () => "",
      repoBaseFor: () => null,
      onOpenThread: () => {},
      onNewTask: () => {},
      onDropDone: () => {},
      onDropUnread: () => {},
      onDropPinned: () => {},
      menuActionsFor: () => [],
    } as unknown as BoardProps;
    render(<Board {...props} />);
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
  }

  it("the editor hosts the ungroup control; the first click only arms it", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const trash = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    expect(trash).not.toBeNull();
    fireEvent.click(trash);
    expect(onDeleteGroup).not.toHaveBeenCalled();
    // The armed state is visible on the same control.
    expect(trash.getAttribute("data-armed")).toBe("true");
  });

  it("the second click deletes and closes the editor", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const trash = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    fireEvent.click(trash);
    fireEvent.click(trash);
    expect(onDeleteGroup).toHaveBeenCalledTimes(1);
    expect(onDeleteGroup).toHaveBeenCalledWith("grp_1");
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
  });

  it("the control reads Ungroup — threads stay — never a card delete", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const control = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    expect(control.textContent).toContain("Ungroup all members");
    fireEvent.click(control);
    expect(control.textContent).toContain("Ungroup");
    expect(control.textContent).not.toContain("Delete");
    expect(control.title).toContain("threads stay");
    expect(onDeleteGroup).not.toHaveBeenCalled();
  });

  it("Escape (or a re-opened edit) disarms; the armed control never deletes without a second click", () => {
    const onDeleteGroup = vi.fn();
    renderEditor(onDeleteGroup);
    const trash = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    fireEvent.click(trash);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onDeleteGroup).not.toHaveBeenCalled();
    // Re-opening starts UNARMED again (no leaked armed state).
    fireEvent.click(document.querySelector('[data-group-box-label="grp_1"]') as HTMLButtonElement);
    const fresh = document.querySelector('[data-group-label-delete="grp_1"]') as HTMLButtonElement;
    expect(fresh.getAttribute("data-armed")).toBe("false");
  });
});

describe("drop-to-join: the box container takes a dragged card into the group", () => {
  const solo = thread({ id: "thr_solo", status: "active", updatedAt: NOW - 5000 });
  const other = thread({ id: "thr_free", status: "active", updatedAt: NOW - 1000 });
  const boxes = new Map([
    ["thr_solo", { groupId: "grp_1", name: "Auth rework", members: [solo] }],
  ]);

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

  function renderJoinableBoard(
    onJoinGroup: ((threadId: string, groupId: string) => void) | undefined,
  ) {
    const props = {
      groupBy: "status" as const,
      columns: buildColumns([solo, other], "status", context, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf: boxes,
      onJoinGroup,
      projectNameFor: () => "",
      repoBaseFor: () => null,
      onOpenThread: () => {},
      onNewTask: () => {},
      onDropDone: () => {},
      onDropUnread: () => {},
      onDropPinned: () => {},
      menuActionsFor: () => [],
    } as unknown as BoardProps;
    render(<Board {...props} />);
  }

  function dragFromCardToBox(fromId: string, groupId: string) {
    const anchor = document.querySelector(`[data-thread-card="${fromId}"] a[draggable]`);
    if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${fromId}`);
    const box = document.querySelector(`[data-group-box="${groupId}"]`);
    if (!(box instanceof HTMLElement)) throw new Error(`missing box ${groupId}`);
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(box, { dataTransfer: dt });
    fireEvent(box, over);
    const drop = createEvent.drop(box, { dataTransfer: dt });
    fireEvent(box, drop);
    return over;
  }

  it("dragging an unassigned card over the box claims the drop (preventDefault)", () => {
    renderJoinableBoard(vi.fn());
    const anchor = document.querySelector('[data-thread-card="thr_free"] a[draggable]') as HTMLElement;
    const box = document.querySelector('[data-group-box="grp_1"]') as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(box, { dataTransfer: dt });
    fireEvent(box, over);
    expect(over.defaultPrevented).toBe(true);
  });

  it("the drop joins the group through onJoinGroup and clears the hover ring", () => {
    const onJoinGroup = vi.fn();
    renderJoinableBoard(onJoinGroup);
    dragFromCardToBox("thr_free", "grp_1");
    expect(onJoinGroup).toHaveBeenCalledTimes(1);
    expect(onJoinGroup).toHaveBeenCalledWith("thr_free", "grp_1");
  });

  it("dropping a card already in this group does not reassign it", () => {
    const onJoinGroup = vi.fn();
    renderJoinableBoard(onJoinGroup);
    dragFromCardToBox("thr_solo", "grp_1");
    expect(onJoinGroup).not.toHaveBeenCalled();
  });

  it("without onJoinGroup wired, a drop on the container does nothing (no crash)", () => {
    renderJoinableBoard(undefined);
    const anchor = document.querySelector('[data-thread-card="thr_free"] a[draggable]') as HTMLElement;
    const box = document.querySelector('[data-group-box="grp_1"]') as HTMLElement;
    const dt = makeDataTransfer();
    fireEvent.dragStart(anchor, { dataTransfer: dt });
    const over = createEvent.dragOver(box, { dataTransfer: dt });
    expect(() => fireEvent(box, over)).not.toThrow();
    const drop = createEvent.drop(box, { dataTransfer: dt });
    expect(() => fireEvent(box, drop)).not.toThrow();
    // No join promise was ever shown, and no join write exists to fire.
    expect(document.querySelector("[data-group-box-join-hover]")).toBeNull();
  });
});
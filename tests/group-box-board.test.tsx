// @vitest-environment jsdom
// The decided family-box design (thread storage: reports/feature-group-
// mockups.html) pinned on the Board seam: members render inside ONE dashed
// container li, whose label rides the container's top margin (inside the
// scrollport at any position — the first per-card fragment attempt
// truncated the label at the list's top edge, observed 2026-10-09). A lone
// member renders a plain card with no box of one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
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

  it("a single member renders as a plain card: no box, no label", () => {
    const solo = thread({ id: "thr_a", status: "active", updatedAt: NOW - 1000 });
    renderBoard(
      [solo],
      new Map([["thr_a", { groupId: "grp_1", name: "Auth rework", members: [solo] }]]),
    );
    expect(document.querySelector('[data-group-box]')).toBeNull();
    expect(document.querySelector('[data-group-box-label]')).toBeNull();
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
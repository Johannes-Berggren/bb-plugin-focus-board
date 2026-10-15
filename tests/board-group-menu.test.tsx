// @vitest-environment jsdom
// The group box's own right-click menu ("the group's context menu"): the
// dashed family box is not just a decoration and a drop target — it names
// the group's surface actions, and it must not swallow the member cards'
// own menus. Wiring lives in components/board.tsx; the DOM contract is
// pinned here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns, filterThreads } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: readonly PluginSidebarThread[],
  groupBoxOf: ReadonlyMap<string, { groupId: string; name: string; members: readonly PluginSidebarThread[] }>,
  options: {
    onNewThreadInGroup?: (groupId: string) => void;
    onRenameGroup?: (groupId: string, name: string) => void;
    onDeleteGroup?: (groupId: string) => void;
    onZoomToGroup?: (groupId: string) => void;
    menuActionsFor?: BoardProps["menuActionsFor"];
  } = {},
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
    menuActionsFor: options.menuActionsFor ?? (() => []),
    onNewThreadInGroup: options.onNewThreadInGroup,
    onRenameGroup: options.onRenameGroup,
    onDeleteGroup: options.onDeleteGroup,
    onZoomToGroup: options.onZoomToGroup,
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

const members = [
  thread({ id: "thr_a", displayTitle: "First task", status: "active", updatedAt: NOW - 1000 }),
  thread({ id: "thr_b", displayTitle: "Second task", status: "active", updatedAt: NOW - 2000 }),
];
const groupBoxOf = new Map<
  string,
  { groupId: string; name: string; members: readonly PluginSidebarThread[] }
>([
  ["thr_a", { groupId: "grp_auth", name: "Auth rework", members }],
  ["thr_b", { groupId: "grp_auth", name: "Auth rework", members }],
]);

function openGroupMenu() {
  fireEvent.contextMenu(screen.getByText("Auth rework"));
}

const menus = () => screen.queryAllByRole("menu");

describe("right-click on the group box", () => {
  it("opens one group menu naming the group, with all four entries", () => {
    renderBoard(members, groupBoxOf, {
      onNewThreadInGroup: () => {},
      onZoomToGroup: () => {},
      onRenameGroup: () => {},
      onDeleteGroup: () => {},
    });
    openGroupMenu();
    const open = menus();
    expect(open).toHaveLength(1);
    const text = open[0].textContent ?? "";
    expect(text).toContain("Auth rework");
    expect(text).toContain("New thread in group…");
    expect(text).toContain("Zoom to group");
    expect(text).toContain("Rename group…");
    expect(text).toContain("Ungroup all members");
    expect(text).not.toContain("Open thread");
  });

  it("New thread in group… reports the group id", () => {
    const onNewThreadInGroup = vi.fn();
    renderBoard(members, groupBoxOf, { onNewThreadInGroup });
    openGroupMenu();
    fireEvent.click(screen.getByText("New thread in group…"));
    expect(onNewThreadInGroup).toHaveBeenCalledWith("grp_auth");
  });

  it("Zoom to group reports the group id and closes the menu", () => {
    const onZoomToGroup = vi.fn();
    renderBoard(members, groupBoxOf, { onZoomToGroup });
    openGroupMenu();
    fireEvent.click(screen.getByText("Zoom to group"));
    expect(onZoomToGroup).toHaveBeenCalledWith("grp_auth");
    expect(menus()).toHaveLength(0);
  });

  it("Zoom to group writes the existing group filter, which keeps only that group's threads", () => {
    // The handler mirrors the app's wiring: the existing group-restrict set
    // to exactly the boxed group, never a second filter state. (The app's
    // own zoom additionally switches the view to the Group board — that
    // wiring lives app-side and is pinned in tests/app-zoom-to-group-view.)
    const filter: { projects: Set<string>; providers: Set<string>; states: Set<string>; groups?: Set<string> } = {
      projects: new Set(),
      providers: new Set(),
      states: new Set(),
    };
    const stranger = thread({ id: "thr_z", displayTitle: "Stray thread", status: "active", updatedAt: NOW - 3000 });
    renderBoard([...members, stranger], groupBoxOf, {
      onZoomToGroup: (groupId) => {
        filter.groups = new Set([groupId]);
      },
    });
    openGroupMenu();
    fireEvent.click(screen.getByText("Zoom to group"));
    expect(filter.groups).toEqual(new Set(["grp_auth"]));
    // The same predicate the toolbar's group dropdown feeds keeps only
    // the zoomed group: the stranger's bucket misses and drops.
    const kept = filterThreads(
      [...members, stranger],
      filter,
      new Map([["thr_a", "grp_auth"], ["thr_b", "grp_auth"]]),
      NOW,
    );
    expect(kept.map((t) => t.id)).toEqual(["thr_a", "thr_b"]);
  });

  it("Rename group… opens the label editor", () => {
    renderBoard(members, groupBoxOf, { onRenameGroup: () => {} });
    openGroupMenu();
    fireEvent.click(screen.getByText("Rename group…"));
    expect(screen.getByLabelText("Rename group, was Auth rework")).toBeTruthy();
  });

  it("Ungroup all members arms first, confirms on the second click", () => {
    const onDeleteGroup = vi.fn();
    renderBoard(members, groupBoxOf, { onDeleteGroup });
    openGroupMenu();
    // First click arms the entry in place — no write yet.
    fireEvent.click(screen.getByText("Ungroup all members"));
    expect(onDeleteGroup).not.toHaveBeenCalled();
    // The menu stays open for the confirm.
    expect(menus()).toHaveLength(1);
    fireEvent.click(screen.getByText(/click again/i));
    expect(onDeleteGroup).toHaveBeenCalledWith("grp_auth");
    expect(menus()).toHaveLength(0);
  });
});

describe("the member card keeps its own menu", () => {
  it("a right-click on a member card opens the card's menu only", () => {
    renderBoard(members, groupBoxOf, {
      onNewThreadInGroup: () => {},
      onRenameGroup: () => {},
      onDeleteGroup: () => {},
      menuActionsFor: () => [{ id: "card-act", label: "Card action", icon: "Pin", run: () => {} }],
    });
    fireEvent.contextMenu(screen.getByText("First task"));
    const open = menus();
    expect(open).toHaveLength(1);
    const text = open[0].textContent ?? "";
    expect(text).toContain("Card action");
    expect(text).not.toContain("New thread in group…");
  });
});

describe("without any group wiring the box offers no menu", () => {
  it("right-click on the box label opens nothing", () => {
    renderBoard(members, groupBoxOf);
    openGroupMenu();
    expect(menus()).toHaveLength(0);
  });

  it("an unwired zoom never offers the entry (the other actions may stay)", () => {
    renderBoard(members, groupBoxOf, { onRenameGroup: () => {} });
    openGroupMenu();
    expect(menus()).toHaveLength(1);
    expect(screen.queryByText("Zoom to group")).toBeNull();
    expect(screen.getByText("Rename group…")).toBeTruthy();
  });
});
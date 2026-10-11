// @vitest-environment jsdom
// The board reports attention to the caller: hovering a card (standalone or
// nested row) fires onAttentionEnter with the thread's id, and moving the
// pointer away fires onAttentionLeave for it. The caller pins the placed
// card through the attention freeze while those reports are live — see
// tests/attention-freeze.test.ts for the pin model itself.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { ParentLaneBoard } from "../components/parent-lane-board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function renderBoard(
  threads: readonly PluginSidebarThread[],
  handlers: {
    onAttentionEnter: (threadId: string) => void;
    onAttentionLeave: (threadId: string) => void;
  },
  nested: ReadonlyMap<string, readonly PluginSidebarThread[]> = new Map(),
) {
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: nested,
    doneChildrenByParent: new Map(),
    childCountByParent: new Map(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onAttentionEnter: handlers.onAttentionEnter,
    onAttentionLeave: handlers.onAttentionLeave,
    menuActionsFor: () => [],
  } as unknown as BoardProps;
  render(<Board {...props} />);
}

describe("the board reports card attention", () => {
  it("hovering a standalone card reports it; moving away releases it", () => {
    const onAttentionEnter = vi.fn();
    const onAttentionLeave = vi.fn();
    renderBoard([thread({ id: "thr_a", status: "active", updatedAt: NOW - 5000 })], {
      onAttentionEnter,
      onAttentionLeave,
    });
    const card = document.querySelector('[data-thread-card="thr_a"]');
    expect(card).not.toBeNull();
    fireEvent.mouseEnter(card!);
    expect(onAttentionEnter).toHaveBeenCalledWith("thr_a");
    fireEvent.mouseLeave(card!);
    expect(onAttentionLeave).toHaveBeenCalledWith("thr_a");
  });

  it("hovering a nested child row reports the child too", () => {
    const onAttentionEnter = vi.fn();
    const onAttentionLeave = vi.fn();
    const parent = thread({ id: "thr_parent", status: "active", updatedAt: NOW - 5000 });
    const child = thread({ id: "thr_child", parentThreadId: "thr_parent", updatedAt: NOW - 9000 });
    renderBoard(
      [parent, child],
      { onAttentionEnter, onAttentionLeave },
      new Map([["thr_parent", [child]]]),
    );
    const row = document.querySelector('[data-thread-card="thr_child"]');
    expect(row).not.toBeNull();
    fireEvent.mouseEnter(row!);
    expect(onAttentionEnter).toHaveBeenCalledWith("thr_child");
    fireEvent.mouseLeave(row!);
    expect(onAttentionLeave).toHaveBeenCalledWith("thr_child");
  });

  it("hovering a parent-lane board cell reports it too", () => {
    const onAttentionEnter = vi.fn();
    const onAttentionLeave = vi.fn();
    const parent = thread({ id: "p1", status: "idle", updatedAt: NOW - 5000 });
    const child = thread({ id: "p1c", parentThreadId: "p1", status: "idle", updatedAt: NOW - 9000 });
    const lane = {
      id: "p1",
      parent,
      label: parent.displayTitle,
      childCount: 1,
      rows: [{ id: "idle", label: "Idle", threads: [child] }],
    };
    const props = {
      lanes: [lane],
      activeThreadId: null,
      doneIds: new Set<string>(),
      dimmedIds: new Set<string>(),
      childrenByParent: new Map([["p1", [child]]]),
      projectNameFor: () => "",
      repoBaseFor: () => null,
      parentLaneOrder: "recency" as const,
      onParentLaneOrderChange: () => {},
      onOpenThread: () => {},
      onNewTask: () => {},
      menuActionsFor: () => [],
      onAttentionEnter,
      onAttentionLeave,
    } as unknown as Parameters<typeof ParentLaneBoard>[0];
    render(<ParentLaneBoard {...props} />);
    const cell = document.querySelector('[data-thread-card="p1c"]');
    expect(cell).not.toBeNull();
    fireEvent.mouseEnter(cell!);
    expect(onAttentionEnter).toHaveBeenCalledWith("p1c");
    fireEvent.mouseLeave(cell!);
    expect(onAttentionLeave).toHaveBeenCalledWith("p1c");
  });
});
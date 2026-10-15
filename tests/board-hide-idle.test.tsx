// @vitest-environment jsdom
// Board-level idle-children wiring, the collapse-wiring pattern one fold over:
// the board hands each family card the caller's hide-idle set with the fold
// key (live parent id, Done projection `done:<parent id>`) and reports toggle
// gestures back with the same key, so persistence stays in the app layer.
// Without the props, cards fall back to their local (unpersisted) state.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { assembleBoard } from "../components/nesting";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function family(): { parent: PluginSidebarThread; children: PluginSidebarThread[] } {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: NOW - 5000 }),
    children: [
      thread({ id: "thr_c1", parentThreadId: "thr_parent", displayTitle: "Idle child", updatedAt: NOW - 4000 }),
      thread({ id: "thr_c2", parentThreadId: "thr_parent", displayTitle: "Working child", status: "active", updatedAt: NOW - 3000 }),
    ],
  };
}

function renderBoard(overrides: Partial<BoardProps> = {}) {
  const { parent, children } = family();
  const props = {
    columns: buildColumns([parent], "status", context, new Map(), new Set(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map([["thr_parent", children]]),
    childCountByParent: new Map([["thr_parent", children.length]]),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

/** The idle-children filter button, by its aria label. */
function idleToggle(hidden: boolean): HTMLElement {
  const button = document.querySelector(
    `button[data-idle-children-toggle][aria-label="${hidden ? "Show idle child threads" : "Hide idle child threads"}"]`,
  );
  if (!(button instanceof HTMLElement)) throw new Error("missing idle-children toggle");
  return button;
}

function row(id: string): HTMLElement | null {
  return document.querySelector(`[data-thread-card="${id}"]`);
}

afterEach(cleanup);

describe("Board idle-children wiring", () => {
  it("clicking the idle toggle reports the family hidden with its parent id", () => {
    const onFamilyHideIdleChange = vi.fn();
    renderBoard({ hideIdleFamilyIds: new Set<string>(), onFamilyHideIdleChange });
    fireEvent.click(idleToggle(false));
    expect(onFamilyHideIdleChange).toHaveBeenCalledWith("thr_parent", true);
  });

  it("a hidden family reports the un-hide gesture with the same parent id", () => {
    const onFamilyHideIdleChange = vi.fn();
    renderBoard({ hideIdleFamilyIds: new Set(["thr_parent"]), onFamilyHideIdleChange });
    fireEvent.click(idleToggle(true));
    expect(onFamilyHideIdleChange).toHaveBeenCalledWith("thr_parent", false);
  });

  it("a family in the persisted set renders without its idle rows", () => {
    renderBoard({ hideIdleFamilyIds: new Set(["thr_parent"]) });
    expect(row("thr_c1")).toBeNull();
    expect(row("thr_c2")).not.toBeNull();
  });

  it("a Done projection folds its idle state under its own fold key, not the live card's", () => {
    const parent = thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: NOW - 5000 });
    const liveChild = thread({
      id: "thr_c1",
      parentThreadId: "thr_parent",
      displayTitle: "Idle child",
      updatedAt: NOW - 4000,
    });
    const doneChild = thread({
      id: "thr_d1",
      parentThreadId: "thr_parent",
      displayTitle: "Done child",
      updatedAt: NOW - 2000,
      status: "idle",
    });
    const assembly = assembleBoard(
      [parent, liveChild, doneChild],
      "status",
      context,
      new Map(),
      new Set(["thr_d1"]),
      NOW,
    );
    // The Done card's own idle row hides; the live card keeps its rows.
    renderBoard({
      columns: assembly.columns,
      nestedChildrenByParent: assembly.nestedChildrenByParent,
      childCountByParent: assembly.childCountByParent,
      doneChildrenByParent: assembly.doneChildrenByParent,
      hideIdleFamilyIds: new Set(["done:thr_parent"]),
    });
    expect(row("thr_d1")).toBeNull();
    expect(row("thr_c1")).not.toBeNull();
  });
});
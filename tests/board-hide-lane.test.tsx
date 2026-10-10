// @vitest-environment jsdom
// The board's hide-a-lane affordance (Project view): hovering a project
// column's header shows a hide icon where the sweep pill sits on sweepable
// lanes (no sweep kind applies to a project lane, so the slot is free). Two
// clicks — icon → armed "Hide" → write — and a report banner explains the
// lane can be restored from the Project filter. The hover itself is CSS
// (group-hover opacity); the tests pin the structural contract.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns, type LaneHideOutcome } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = {
  projects: [
    { id: "p1", name: "One" },
    { id: "p2", name: "Two" },
  ],
  providers: [],
};

type BoardProps = Parameters<typeof Board>[0];

function projectBoard(
  threads: readonly PluginSidebarThread[],
  options: { onHideLane?: () => LaneHideOutcome } = {},
) {
  const props = {
    columns: buildColumns(threads, "project", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "project" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "",
    repoBaseFor: () => null,
    statusFor: () => null,
    linkedIssuesFor: () => [],
    validatedHrefs: {} as never,
    onOpenThread: () => {},
    onNewTask: () => {},
    onClosePane: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    ...options,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

function hideButtons(): HTMLElement[] {
  return [...document.querySelectorAll('[data-hide-lane]')].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

describe("hide-a-lane: the Project view's hover affordance on the sweep slot", () => {
  it("every project lane header carries the hide icon; fixed lanes carry none", () => {
    const threads = [
      thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2000 }),
      thread({ id: "thr_c", projectId: "p1", isPinned: true }),
      thread({ id: "thr_d", projectId: "p1", updatedAt: NOW - 3000 }),
    ];
    projectBoard(threads, { onHideLane: () => ({ kind: "hidden" }) });
    const buttons = hideButtons();
    expect(buttons).toHaveLength(2); // Pinned and Done lanes are never hideable
    // A hide button's header is its lane's column: ids ride the DOM.
    const lanes = buttons.map((button) =>
      button.closest("[data-column-id]")?.getAttribute("data-column-id"),
    );
    expect(lanes.sort()).toEqual(["p1", "p2"]);
  });

  it("no hide affordance off the Project view, even when wired", () => {
    const threads = [
      thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", updatedAt: NOW - 2000 }),
    ];
    const props = {
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
      onHideLane: () => ({ kind: "hidden" }) as const,
    } as unknown as BoardProps;
    render(<Board {...props} />);
    expect(hideButtons()).toHaveLength(0);
  });

  it("unwired, the Project view renders no hide button (the gesture cannot write)", () => {
    projectBoard([
      thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2000 }),
    ]);
    expect(hideButtons()).toHaveLength(0);
  });

  it("the usual two clicks: icon arms, the second click writes the filter lane out", () => {
    const onHideLane = vi.fn((): LaneHideOutcome => ({ kind: "hidden" }));
    projectBoard(
      [
        thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 }),
        thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2000 }),
      ],
      { onHideLane },
    );
    const buttons = hideButtons();
    expect(buttons).toHaveLength(2);
    const first = buttons[0];
    fireEvent.click(first);
    // Armed, nothing written.
    expect(first.getAttribute("data-hide-lane-armed")).toBe("");
    expect(onHideLane).not.toHaveBeenCalled();
    // Second click confirms.
    fireEvent.click(first);
    expect(onHideLane).toHaveBeenCalledTimes(1);
    expect(onHideLane).toHaveBeenCalledWith(expect.any(String));
    // The disarm and the report ride the same click.
    expect(first.getAttribute("data-hide-lane-armed")).toBeNull();
    const report = document.querySelector('[data-testid="lane-hide-notice"]');
    expect(report).not.toBeNull();
    expect(report?.getAttribute("role")).toBe("status");
    expect(report?.textContent).toContain("Restore it from the Project filter");
  });

  it("Escape while armed disarms without writing the filter", () => {
    const onHideLane = vi.fn((): LaneHideOutcome => ({ kind: "hidden" }));
    projectBoard(
      [
        thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 }),
        thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2000 }),
      ],
      { onHideLane },
    );
    const first = hideButtons()[0];
    fireEvent.click(first);
    fireEvent.keyDown(first, { key: "Escape" });
    expect(first.getAttribute("data-hide-lane-armed")).toBeNull();
    expect(onHideLane).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lane-hide-notice"]')).toBeNull();
  });

  it("a refused hide reports why instead of pretending the lane went away", () => {
    const onHideLane = vi.fn(
      (): LaneHideOutcome => ({ kind: "refused", reason: "sole-lane" }),
    );
    projectBoard(
      [thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 })],
      { onHideLane },
    );
    const button = hideButtons()[0];
    fireEvent.click(button);
    fireEvent.click(button);
    const report = document.querySelector('[data-testid="lane-hide-notice"]');
    expect(report).not.toBeNull();
    expect(report?.textContent).not.toContain("Restore it from the Project filter");
    expect(report?.textContent).toContain("stays");
  });

  it("the report self-expires — a dead banner must not squat on the board", () => {
    vi.useFakeTimers();
    try {
      projectBoard(
        [
          thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - 1000 }),
          thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2000 }),
        ],
        { onHideLane: () => ({ kind: "hidden" }) },
      );
      const button = hideButtons()[0];
      fireEvent.click(button);
      fireEvent.click(button);
      expect(document.querySelector('[data-testid="lane-hide-notice"]')).not.toBeNull();
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      expect(document.querySelector('[data-testid="lane-hide-notice"]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
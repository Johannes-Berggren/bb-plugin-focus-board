// @vitest-environment jsdom
// The Group view's hide-a-lane affordance, mirrored on the Project view's
// landed pattern: hovering a group column's header shows the eye-off icon at
// the sweep slot; two clicks — icon → armed "Hide" → write — and a report
// banner names the restore path ("Restore it from the Group filter"). Pinned
// and Done lanes never carry one (board furniture). The hover itself is CSS;
// the tests pin the structural contract.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns, type LaneHideOutcome } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;

type BoardProps = Parameters<typeof Board>[0];

const groupContext = {
  projects: [],
  providers: [],
  groupsByThread: new Map<string, string>([
    ["thr_a", "grp_a"],
    ["thr_b", "grp_b"],
    ["thr_free", "none"],
  ]),
  groupNames: new Map<string, string>([
    ["grp_a", "Alpha"],
    ["grp_b", "Beta"],
  ]),
};

/** Threads whose assignments yield three group lanes (Alpha, Beta) plus a
 *  No-group lane, with pinned and done furniture on the side. */
function groupThreads(): PluginSidebarThread[] {
  return [
    thread({ id: "thr_a", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", updatedAt: NOW - 2000 }),
    thread({ id: "thr_free", updatedAt: NOW - 3000 }),
    thread({ id: "thr_pin", isPinned: true }),
    thread({ id: "thr_done" }),
  ];
}

function groupBoard(
  options: { onHideLane?: (columnId: string) => LaneHideOutcome } = {},
): void {
  const doneIds = new Set<string>(["thr_done"]);
  const props = {
    groupBy: "group" as const,
    columns: buildColumns(groupThreads(), "group", groupContext, new Map(), doneIds, NOW, {}),
    activeThreadId: null,
    doneIds,
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf: new Map(),
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
  render(<Board {...props} />);
}

function hideButtons(): HTMLElement[] {
  return [...document.querySelectorAll("[data-hide-lane]")].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

describe("the Group view's hide-a-lane affordance", () => {
  it("every group-bucket lane header carries the hide icon; fixed lanes carry none", () => {
    groupBoard({ onHideLane: () => ({ kind: "hidden" }) });
    const buttons = hideButtons();
    expect(buttons).toHaveLength(3); // Pinned and Done lanes are never hideable
    const lanes = buttons.map((button) =>
      button.closest("[data-column-id]")?.getAttribute("data-column-id"),
    );
    expect(lanes.sort()).toEqual(["grp_a", "grp_b", "none"]);
  });

  it("no hide affordance off the Group view, even when wired", () => {
    const doneIds = new Set<string>();
    const props = {
      groupBy: "status" as const,
      columns: buildColumns([
        thread({ id: "thr_a", updatedAt: NOW - 1000 }),
        thread({ id: "thr_free", updatedAt: NOW - 2000 }),
      ], "status", groupContext, new Map(), doneIds, NOW, {}),
      activeThreadId: null,
      doneIds,
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
      onHideLane: () => ({ kind: "hidden" }) as const,
    } as unknown as BoardProps;
    render(<Board {...props} />);
    expect(hideButtons()).toHaveLength(0);
  });

  it("unwired, the Group view renders no hide button (the gesture cannot write)", () => {
    groupBoard();
    expect(hideButtons()).toHaveLength(0);
  });

  it("the usual two clicks: icon arms, the second click writes the lane's group out of the Group filter", () => {
    const onHideLane = vi.fn((columnId: string): LaneHideOutcome => ({ kind: "hidden" }));
    groupBoard({ onHideLane });
    const button = hideButtons()[0];
    const lane = button.closest("[data-column-id]")?.getAttribute("data-column-id");
    fireEvent.click(button);
    // Armed, nothing written.
    expect(button.getAttribute("data-hide-lane-armed")).toBe("");
    expect(onHideLane).not.toHaveBeenCalled();
    // Second click confirms.
    fireEvent.click(button);
    expect(onHideLane).toHaveBeenCalledTimes(1);
    expect(onHideLane).toHaveBeenCalledWith(lane);
    // The disarm and the report ride the same click.
    expect(button.getAttribute("data-hide-lane-armed")).toBeNull();
    const report = document.querySelector('[data-testid="lane-hide-notice"]');
    expect(report).not.toBeNull();
    expect(report?.getAttribute("role")).toBe("status");
    expect(report?.textContent).toContain("Restore it from the Group filter");
  });

  it("Escape while armed disarms without writing the filter", () => {
    const onHideLane = vi.fn((): LaneHideOutcome => ({ kind: "hidden" }));
    groupBoard({ onHideLane });
    const button = hideButtons()[0];
    fireEvent.click(button);
    fireEvent.keyDown(button, { key: "Escape" });
    expect(button.getAttribute("data-hide-lane-armed")).toBeNull();
    expect(onHideLane).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="lane-hide-notice"]')).toBeNull();
  });

  it("a refused hide reports why instead of pretending the lane went away", () => {
    const onHideLane = vi.fn(
      (): LaneHideOutcome => ({ kind: "refused", reason: "sole-lane" }),
    );
    groupBoard({ onHideLane });
    const button = hideButtons()[0];
    fireEvent.click(button);
    fireEvent.click(button);
    const report = document.querySelector('[data-testid="lane-hide-notice"]');
    expect(report).not.toBeNull();
    expect(report?.textContent).not.toContain("Restore it from the Group filter");
    expect(report?.textContent).toContain("stays");
  });

  it("the report self-expires — a dead banner must not squat on the board", () => {
    vi.useFakeTimers();
    try {
      groupBoard({ onHideLane: () => ({ kind: "hidden" }) });
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
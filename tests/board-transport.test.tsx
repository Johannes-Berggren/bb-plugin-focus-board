// @vitest-environment jsdom
// The transport dissolve: a card relocating between lanes wipes out in its
// old lane (its slot stays put until the wipe finishes, then collapses) and
// wipes in at its new lane (the slot is present from wipe-in's first frame,
// so the lane reflows when the wipe starts). Pinned at the Board seam: the
// column diff the planner sees and the phases the timers advance.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import {
  TRANSPORT_WIPE_IN_MS,
  TRANSPORT_WIPE_OUT_MS,
  TRANSPORT_COLLAPSE_MS,
} from "../components/card-transport";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function boardProps(groupBy: "status" | "none", threads: readonly PluginSidebarThread[]) {
  return {
    groupBy,
    columns: buildColumns(threads, groupBy, context, new Map(), new Set<string>(), NOW, {}),
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
  } as unknown as BoardProps;
}

describe("a card relocating between lanes plays the transport dissolve", () => {
  it("the old lane keeps the card in place while it wipes, the new lane reflows as the wipe-in starts", async () => {
    vi.useFakeTimers();
    const before = [
      thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const after = [
      thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_b", isUnread: true, updatedAt: NOW - 2000 }),
    ];
    const { rerender } = render(<Board {...boardProps("status", before)} />);
    rerender(<Board {...boardProps("status", after)} />);

    // Old lane: a ghost holds the slot (aria-hidden, inert to clicks) while
    // the wipe-out runs.
    const oldLane = document.querySelector('[data-column-id="unread"]');
    expect(oldLane).not.toBeNull();
    const ghost = oldLane?.querySelector("[data-transport-out]");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-transport-out")).toBe("wiping-out");
    expect(ghost?.getAttribute("aria-hidden")).toBe("true");
    expect(ghost?.className).toContain("pointer-events-none");

    // New lane: the card is present in the flow from wipe-in's first frame —
    // its neighbors reflow NOW, not after the wipe lands.
    const newLane = document.querySelector('[data-column-id="pinned"]');
    expect(newLane).not.toBeNull();
    const arrival = newLane?.querySelector("[data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    expect(arrival?.getAttribute("style")).toContain("opacity");

    // Wipe-in finishes first: the arriving slot drops its hiding styles and
    // the transport attribute (the card is an ordinary card again).
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_IN_MS + 5);
    });
    expect(document.querySelector('[data-transport-arrival]')).toBeNull();
    expect(newLane?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();

    // Wipe-out finishes NEXT: the old slot's wipe is done, the collapse
    // closes its reserved space.
    expect(
      oldLane?.querySelector('[data-transport-out="collapsing"]'),
    ).toBeNull();
    expect(oldLane?.querySelector("[data-transport-out]")).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_OUT_MS - TRANSPORT_WIPE_IN_MS + 5);
    });
    const collapsing = oldLane?.querySelector('[data-transport-out="collapsing"]');
    expect(collapsing).not.toBeNull();
    expect(collapsing?.getAttribute("style")).toContain("max-height");

    // Collapse finished: the ghost slot is gone entirely (the old lane is
    // laid out as if the card had never stayed).
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_COLLAPSE_MS + 5);
    });
    expect(oldLane?.querySelector("[data-transport-out]")).toBeNull();
  });

  it("a same-commit batch bigger than the cap is a plain reflow, not a wall of wipes", () => {
    vi.useFakeTimers();
    const before = Array.from({ length: 15 }, (_, index) =>
      thread({ id: `thr_${index}`, isUnread: true, updatedAt: NOW - index - 1 }),
    );
    // All 15 flip to Pinned in one commit: a batch this whole (a
    // multi-select gesture, a sweep confirm) reads as a curation wave, not a
    // card relocating its home lane, so the board reflows instead of
    // dissolving every card at once.
    const after = Array.from({ length: 15 }, (_, index) =>
      thread({ id: `thr_${index}`, isPinned: true, pinnedAt: 1, pinSortKey: index, updatedAt: NOW - index - 1 }),
    );
    const { rerender } = render(<Board {...boardProps("status", before)} />);
    rerender(<Board {...boardProps("status", after)} />);
    expect(document.querySelector("[data-transport-out]")).toBeNull();
  });

  it("a grouping change re-derives every lane at once and reads as a view switch (no transports)", () => {
    vi.useFakeTimers();
    const before = [thread({ id: "thr_a", isUnread: true, updatedAt: NOW - 1000 })];
    const after = [thread({ id: "thr_a", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 })];
    const { rerender } = render(<Board {...boardProps("status", before)} />);
    rerender(<Board {...boardProps("none", after)} />);
    expect(document.querySelector("[data-transport-out]")).toBeNull();
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
  });
});
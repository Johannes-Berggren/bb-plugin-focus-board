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
import type { GroupBoxMap } from "../components/group-boxes";
import {
  TRANSPORT_WIPE_IN_MS,
  TRANSPORT_COLLAPSE_MS,
  TRANSPORT_SPARK_COUNT,
} from "../components/card-transport";
import { thread } from "./thread-fixture";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const NOW = 10_000_000;
const context = { projects: [], providers: [] };

type BoardProps = Parameters<typeof Board>[0];

function boardProps(
  groupBy: "status" | "none",
  threads: readonly PluginSidebarThread[],
  groupBoxOf?: GroupBoxMap,
) {
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
    ...(groupBoxOf !== undefined ? { groupBoxOf } : {}),
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

    // New lane: the card is in the flow from wipe-in's first frame — the
    // SLOT is clipped shut and opens via the grow animation, while the FADE
    // lives on the card wrapper INSIDE the slot: the amber glint layer sits
    // outside that fade and stays fully visible for the whole arrival
    // (the glints must not inherit the card's dissolve opacity).
    const newLane = document.querySelector('[data-column-id="pinned"]');
    expect(newLane).not.toBeNull();
    const arrival = newLane?.querySelector("[data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    expect(arrival?.getAttribute("style")).not.toContain("opacity");
    expect(arrival?.getAttribute("style")).toContain("max-height");
    expect(arrival?.getAttribute("style")).toContain("overflow");
    const fade = arrival?.querySelector("[data-transport-fade]");
    expect(fade ?? null).not.toBeNull();
    expect(fade?.getAttribute("style")).toContain("opacity");
    expect(fade?.getAttribute("style")).toContain("opacity: 0");
    // The glint layer rides the slot, not the fade: full brightness for the
    // entire arrival sequence.
    expect(
      arrival?.querySelector("[data-transport-sparks]")?.closest("[data-transport-fade]") ?? null,
    ).toBeNull();

    // The shimmer: BOTH sweeps carry the spark field — the dissolving ghost
    // and the materializing arrival each render one layer of glints. Departure
    // keeps the silver field rising (out tone); the arrival wears amber and
    // descends (in tone): departing is up, arriving is down.
    expect(document.querySelectorAll("[data-transport-sparks]")).toHaveLength(2);
    const arrivalSparks = arrival?.querySelector("[data-transport-sparks]");
    const ghostSparks = ghost?.querySelector("[data-transport-sparks]");
    expect(arrivalSparks ?? null).not.toBeNull();
    expect(arrivalSparks?.getAttribute("data-transport-spark-tone")).toBe("in");
    expect(ghostSparks?.getAttribute("data-transport-spark-tone")).toBe("out");
    // The palettes: the arrival's amber beam versus the ghost's kept silver
    // (jsdom normalizes the hex literals to rgb()).
    expect(arrivalSparks?.querySelector("[data-transport-spark]")?.style.background).toContain(
      "rgb(253, 230, 138)",
    );
    expect(ghostSparks?.querySelector("[data-transport-spark]")?.style.background).toContain(
      "rgb(186, 230, 253)",
    );
    expect(arrival?.querySelectorAll("[data-transport-spark]")).toHaveLength(
      TRANSPORT_SPARK_COUNT,
    );
    expect(ghost?.querySelectorAll("[data-transport-spark]")).toHaveLength(
      TRANSPORT_SPARK_COUNT,
    );

    // Wipe-in finishes first: the arriving slot drops its hiding styles and
    // the transport attribute (the card is an ordinary card again).
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_IN_MS + 5);
    });
    expect(document.querySelector('[data-transport-arrival]')).toBeNull();
    expect(newLane?.querySelector('[data-thread-card="thr_a"]')).not.toBeNull();
    // The arrival's spark layer goes with it: no glints ever sit on a
    // settled card. The fade wrapper goes with it too: the card renders
    // bare again.
    expect(newLane?.querySelector("[data-transport-sparks]")).toBeNull();
    expect(newLane?.querySelector("[data-transport-fade]")).toBeNull();

    // The wipes are symmetric (equal durations): when the arrival settles,
    // the old slot's wipe is done too, and the collapse is already closing
    // its reserved space.
    const collapsing = oldLane?.querySelector('[data-transport-out="collapsing"]');
    expect(collapsing).not.toBeNull();
    expect(collapsing?.getAttribute("style")).toContain("max-height");

    // Collapse finished: the ghost slot is gone entirely (the old lane is
    // laid out as if the card had never stayed).
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_COLLAPSE_MS + 5);
    });
    expect(oldLane?.querySelector("[data-transport-out]")).toBeNull();
    // The ghost's spark layer went with the ghost: the board holds no
    // leftover glints after the dissolve.
    expect(document.querySelectorAll("[data-transport-spark]")).toHaveLength(0);
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

describe("a box run relocating between lanes transports as ONE unit", () => {
  function boxScenario() {
    const before = [
      thread({ id: "thr_m1", isUnread: true, updatedAt: NOW - 1000 }),
      thread({ id: "thr_m2", isUnread: true, updatedAt: NOW - 2000 }),
      // Companion on TOP of the old lane (newest): the box's true old slot
      // is second, so a top-woven ghost cannot fake the assertion.
      thread({ id: "thr_x", isUnread: true, updatedAt: NOW }),
    ];
    const after = [
      thread({ id: "thr_m1", isPinned: true, pinnedAt: 1, pinSortKey: 1, updatedAt: NOW - 1000 }),
      thread({ id: "thr_m2", isPinned: true, pinnedAt: 2, pinSortKey: 2, updatedAt: NOW - 2000 }),
      thread({ id: "thr_x", isUnread: true, updatedAt: NOW - 3000 }),
    ];
    const m1 = before[0];
    const m2 = before[1];
    const box = { groupId: "grp_1", name: "Feature", members: [m1, m2] };
    const groupBoxOf: GroupBoxMap = new Map([
      ["thr_m1", box],
      ["thr_m2", box],
    ]);
    return { before, after, groupBoxOf };
  }

  it("the dashed container wipes out whole in the old lane and wipes in whole at the new one", async () => {
    vi.useFakeTimers();
    const { before, after, groupBoxOf } = boxScenario();
    const { rerender } = render(<Board {...boardProps("status", before, groupBoxOf)} />);
    rerender(<Board {...boardProps("status", after, groupBoxOf)} />);

    // Old lane: ONE ghost — the dashed box container itself, holding both
    // member cards — not two per-card ghosts.
    const oldLane = document.querySelector('[data-column-id="unread"]');
    expect(oldLane).not.toBeNull();
    const ghostContainer = oldLane?.querySelector(
      "[data-group-box][data-transport-ghost]",
    );
    expect(ghostContainer).not.toBeNull();
    expect(ghostContainer?.getAttribute("data-transport-out")).toBe("wiping-out");
    expect(ghostContainer?.getAttribute("aria-hidden")).toBe("true");
    expect(ghostContainer?.querySelectorAll("[data-transport-ghost]")).toHaveLength(0);
    expect(ghostContainer?.querySelector('[data-thread-card="thr_m1"]')).not.toBeNull();
    expect(ghostContainer?.querySelector('[data-thread-card="thr_m2"]')).not.toBeNull();
    // Exactly one transport ghost in the lane: the container only.
    expect(oldLane?.querySelectorAll("[data-transport-ghost]")).toHaveLength(1);
    // The box's spark layer rides INSIDE the dashed container: the whole
    // box shimmers as one shape, not one glint field per member card.
    expect(ghostContainer?.querySelector("[data-transport-sparks]")).not.toBeNull();
    // The ghost holds the box's TRUE old slot: second in the lane (thr_x's
    // slot came first before the move), not the lane top. A ghost woven at
    // the top would read as a random card dissolving, not this box leaving.
    // (toBeTruthy, not not.toBeNull(): an optional-chained undefined passes
    // the latter and would make a top-woven ghost read as "placed right".)
    expect(
      ghostContainer?.previousElementSibling?.querySelector('[data-thread-card="thr_x"]') ?? null,
    ).not.toBeNull();
    expect(ghostContainer).not.toBeNull();
    expect(ghostContainer?.previousElementSibling).not.toBeNull();

    // New lane: the box arrives as one dashed container — the SLOT li is
    // clipped shut (grow target only), and the fade lives on the dashed
    // container inside it, with the glint layer riding outside the fade.
    const newLane = document.querySelector('[data-column-id="pinned"]');
    expect(newLane?.querySelector("[data-group-box][data-transport-arrival]")).not.toBeNull();
    const arrival = newLane?.querySelector("[data-transport-arrival]");
    expect(arrival?.getAttribute("data-transport-arrival")).toBe("wiping-in");
    expect(arrival?.getAttribute("style")).not.toContain("opacity");
    expect(arrival?.getAttribute("style")).toContain("max-height");
    expect(arrival?.getAttribute("style")).toContain("overflow");
    const boxFade = arrival?.querySelector("[data-transport-fade]");
    expect(boxFade ?? null).not.toBeNull();
    expect(boxFade?.getAttribute("style")).toContain("opacity: 0");
    expect(arrival?.querySelector("[data-transport-sparks]")?.closest("[data-transport-fade]") ?? null).toBeNull();

    // Wipe-in lands: the box drops its hiding styles and is an ordinary box.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_WIPE_IN_MS + 5);
    });
    expect(document.querySelector("[data-transport-arrival]")).toBeNull();
    const settledBox = newLane?.querySelector("[data-group-box]");
    expect(settledBox?.querySelectorAll('[data-thread-card="thr_m1"], [data-thread-card="thr_m2"]')).toHaveLength(2);

    // The wipes are symmetric (equal durations): when the box un-hides, the
    // container ghost's wipe is done too (the phase rides the same container
    // li the ghost attrs sit on).
    const collapsing = oldLane?.querySelector('[data-transport-out="collapsing"]');
    expect(collapsing?.getAttribute("style")).toContain("max-height");

    // Collapse finished: the container ghost is gone entirely.
    await act(async () => {
      vi.advanceTimersByTime(TRANSPORT_COLLAPSE_MS + 5);
    });
    expect(oldLane?.querySelector("[data-transport-out]")).toBeNull();
  });

  it("a whole-box move counts as ONE unit, so a 13-member box stays under the batch cap", () => {
    vi.useFakeTimers();
    const members = Array.from({ length: 13 }, (_, index) =>
      thread({ id: `thr_m${index}`, isUnread: true, updatedAt: NOW - index - 1 }),
    );
    const box = { groupId: "grp_1", name: "Big", members };
    const groupBoxOf: GroupBoxMap = new Map(
      members.map((member) => [member.id, box]),
    );
    // A companion thread keeps the old lane alive (a lane that loses its
    // last card vanishes and plays no ghost — its own removal dominates).
    const companion = thread({ id: "thr_x", isUnread: true, updatedAt: NOW });
    const before = [...members, companion];
    const after = [
      ...members.map((member, index) => ({
        ...member,
        isUnread: false,
        isPinned: true,
        pinnedAt: index + 1,
        pinSortKey: index,
      })) as PluginSidebarThread[],
      companion,
    ];
    const { rerender } = render(<Board {...boardProps("status", before, groupBoxOf)} />);
    rerender(<Board {...boardProps("status", after, groupBoxOf)} />);
    // 13 per-card moves would exceed the cap and reflow; the collapsed unit
    // dissolves as one box instead.
    expect(document.querySelector("[data-group-box][data-transport-ghost]")).not.toBeNull();
    expect(document.querySelectorAll("[data-transport-ghost]")).toHaveLength(1);
  });
});
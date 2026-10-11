// The attention freeze model (components/attention-freeze.ts): a card or
// family the operator is attending to (hover, open pane) pins its captured
// placement, so live data churn re-sorts around it instead of moving it.
// The pin releases when attention releases (mouse out / pane close).
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  applyLaneFreezes,
  applySlotPins,
  columnPlacementOf,
  compileAttentionFreezes,
  laneCaptureOf,
  pinRowOrder,
  type AttentionCapture,
  type LaneCapture,
} from "../components/attention-freeze";
import type { BoardColumn } from "../components/grouping";
import type { ParentLane, ParentLaneRow } from "../components/parent-lanes";
import { thread } from "./thread-fixture";

function threadsFor(ids: readonly string[]): PluginSidebarThread[] {
  return ids.map((id) => thread({ id, updatedAt: 0 }));
}

function column(id: string, label: string, ids: readonly string[]): BoardColumn {
  return { id, label, threads: threadsFor(ids) };
}

function laneRow(id: string, ids: readonly string[]): ParentLaneRow {
  return { id, label: id, threads: threadsFor(ids) };
}

function lane(parentId: string, rows: readonly ParentLaneRow[]): ParentLane {
  return {
    id: parentId,
    parent: thread({ id: parentId }),
    label: parentId,
    childCount: rows.reduce((count, row) => count + row.threads.length, 0),
    rows: [...rows],
  };
}

function captureOf(
  focusId: string,
  slots: readonly (readonly [string, string, string, number])[],
  capturedAt: number,
): AttentionCapture {
  return {
    origin: "hover",
    focusId,
    slots: slots.map(([threadId, columnId, label, index]) => ({ threadId, columnId, label, index })),
    rowPin: null,
    capturedAt,
  };
}

describe("columnPlacementOf", () => {
  const columns = [column("col-a", "A", ["a", "b"]), column("col-b", "B", ["c"])];

  it("finds a thread's rendered lane and slot index", () => {
    expect(columnPlacementOf(columns, "b")).toEqual({
      threadId: "b",
      columnId: "col-a",
      label: "A",
      index: 1,
    });
    expect(columnPlacementOf(columns, "c")).toEqual({
      threadId: "c",
      columnId: "col-b",
      label: "B",
      index: 0,
    });
  });

  it("returns null for a thread no column renders", () => {
    expect(columnPlacementOf(columns, "ghost")).toBeNull();
  });
});

describe("applySlotPins", () => {
  it("pins an attended card at its captured slot when churn would move it", () => {
    const list = threadsFor(["a", "b", "c", "d"]);
    // Card d was captured sitting at index 1; churn pulled it down.
    const pinned = applySlotPins(list, new Map([["d", 1]]));
    expect(pinned.map((card) => card.id)).toEqual(["a", "d", "b", "c"]);
  });

  it("keeps relative order among several pinned cards", () => {
    const list = threadsFor(["a", "b", "c", "d"]);
    const pinned = applySlotPins(
      list,
      new Map([
        ["c", 0],
        ["d", 3],
      ]),
    );
    expect(pinned.map((card) => card.id)).toEqual(["c", "a", "b", "d"]);
  });

  it("clamps a captured index that shrank below range", () => {
    const list = threadsFor(["a", "b", "c"]);
    const pinned = applySlotPins(list, new Map([["a", 9]]));
    expect(pinned.map((card) => card.id)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op for an unknown thread id", () => {
    const list = threadsFor(["a", "b"]);
    expect(applySlotPins(list, new Map([["ghost", 0]]))).toEqual(list);
  });
});

describe("pinRowOrder", () => {
  it("pins an attended child row at its captured index", () => {
    const rows = threadsFor(["c1", "c2", "c3"]);
    const pinned = pinRowOrder(rows, new Map([["c3", 0]]));
    expect(pinned.map((card) => card.id)).toEqual(["c3", "c1", "c2"]);
  });

  it("returns the rows untouched with no pins", () => {
    const rows = threadsFor(["c1", "c2"]);
    expect(pinRowOrder(rows, new Map())).toEqual(rows);
  });
});

describe("compileAttentionFreezes", () => {
  it("unions the columns, slots, and row pins of every capture", () => {
    const older = captureOf("f1", [["f1", "col-1", "One", 2]], 100);
    const newer: AttentionCapture = {
      origin: "selection",
      focusId: "f2",
      slots: [{ threadId: "f2", columnId: "col-2", label: "Two", index: 0 }],
      rowPin: { parentId: "root", childId: "f2", index: 1 },
      capturedAt: 200,
    };
    const plan = compileAttentionFreezes([older, newer]);
    expect([...plan.columns.keys()].sort()).toEqual(["f1", "f2"]);
    expect(plan.slots.get("f1")).toBe(2);
    expect(plan.slots.get("f2")).toBe(0);
    expect(plan.stayNested.has("f2")).toBe(true);
    expect(plan.rowSlots.get("root")?.get("f2")).toBe(1);
  });

  it("the freshest capture wins a conflicting slot", () => {
    const older = captureOf("f1", [["f1", "col-1", "One", 5]], 100);
    const newer = captureOf("f1", [["f1", "col-0", "Zero", 0]], 300);
    const plan = compileAttentionFreezes([older, newer]);
    expect(plan.columns.get("f1")).toEqual({ id: "col-0", label: "Zero" });
    expect(plan.slots.get("f1")).toBe(0);
  });
});

describe("laneCaptureOf", () => {
  const lanes = [
    lane("p1", [laneRow("needs-you", []), laneRow("working", ["c1", "c2"])]),
    lane("p2", [laneRow("idle", ["c3"]), laneRow("done", ["d1"])]),
  ];

  it("captures a row card's lane, row, and slot", () => {
    expect(laneCaptureOf(lanes, "c2", { origin: "hover", capturedAt: 7 })).toEqual({
      origin: "hover",
      focusId: "c2",
      laneId: "p1",
      laneIndex: 0,
      row: { id: "working", index: 1 },
      capturedAt: 7,
    } satisfies LaneCapture);
  });

  it("captures the lane parent with no row pin", () => {
    expect(laneCaptureOf(lanes, "p2", { origin: "hover", capturedAt: 7 })).toMatchObject({
      focusId: "p2",
      laneId: "p2",
      row: null,
    });
  });

  it("returns null for a thread no lane renders", () => {
    expect(laneCaptureOf(lanes, "ghost", { origin: "hover", capturedAt: 7 })).toBeNull();
  });
});

describe("applyLaneFreezes", () => {
  it("pins an attended lane at its captured order index while other lanes churn", () => {
    // Captured state: lane p1 first.
    const captured: LaneCapture = laneCaptureOf(
      [lane("p1", [laneRow("working", ["c1"])]), lane("p2", [laneRow("working", ["c2"])])],
      "c1",
      { origin: "hover", capturedAt: 100 },
    ) as LaneCapture;
    // A later build re-sorted lanes: p2 now leads (family recency moved it).
    const after = [lane("p2", [laneRow("working", ["c2"])]), lane("p1", [laneRow("working", ["c1"])])];
    const pinned = applyLaneFreezes(after, [captured]);
    expect(pinned.map((entry) => entry.id)).toEqual(["p1", "p2"]);
  });

  it("keeps the attended row card in its captured row and slot", () => {
    // Captured: card c1 in lane p1, the idle-today row, slot 0.
    const captured: LaneCapture = laneCaptureOf(
      [lane("p1", [laneRow("idle-today", ["c1", "x"]), laneRow("working", [])])],
      "c1",
      { origin: "hover", capturedAt: 100 },
    ) as LaneCapture;
    // The card's state flipped while attended: the build would land it in the
    // working row instead. The pin holds the captured row and slot.
    const churned = [lane("p1", [laneRow("idle-today", ["x"]), laneRow("working", ["c1"])])];
    const pinned = applyLaneFreezes(churned, [captured]);
    expect(pinned[0]!.rows.find((row) => row.id === "idle-today")!.threads.map((card) => card.id)).toEqual([
      "c1",
      "x",
    ]);
    expect(pinned[0]!.rows.find((row) => row.id === "working")!.threads).toHaveLength(0);
  });

  it("leaves a board alone with no captures", () => {
    const list = [lane("p1", [laneRow("working", ["c1"])])];
    expect(applyLaneFreezes(list, [])).toEqual(list);
  });
});
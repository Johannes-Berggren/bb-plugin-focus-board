// The parent lane view's attention freeze: a lane the operator attends to
// (hover, open pane) pins its lane order slot and the attended card's row
// placement, so family recency churn re-sorts around the attended lane
// instead of moving it.
import { describe, expect, it } from "vitest";
import { buildParentLanes, type ParentLane } from "../components/parent-lanes";
import { applyLaneFreezes, laneCaptureOf, type LaneCapture } from "../components/attention-freeze";
import { thread } from "./thread-fixture";

const NOW = 10 * 24 * 60 * 60 * 1000;

function rowOf(lane: ParentLane, threadId: string): ParentLane["rows"][number] | null {
  return lane.rows.find((row) => row.threads.some((card) => card.id === threadId)) ?? null;
}

describe("parent lane attention freeze", () => {
  it("pins the attended lane's order slot while other families churn", () => {
    // Two families; family p1 leads on recency.
    const before = [
      thread({ id: "p1", updatedAt: 5000 }),
      thread({ id: "p1c", parentThreadId: "p1", updatedAt: 4000 }),
      thread({ id: "p2", updatedAt: 3000 }),
      thread({ id: "p2c", parentThreadId: "p2", updatedAt: 2000 }),
    ];
    const lanes = buildParentLanes(before, new Set<string>(), NOW, new Map());
    expect(lanes.map((lane) => lane.id)).toEqual(["p1", "p2"]);
    // The operator hovers a card in the FIRST lane.
    const captured = laneCaptureOf(lanes, "p1c", { origin: "hover", capturedAt: 0 }) as LaneCapture;
    expect(captured).toMatchObject({ laneId: "p1", laneIndex: 0 });

    // Later, family p2 receives the freshest touch anywhere: its lane is now
    // first and p1 slides over.
    const after = [
      thread({ id: "p2", updatedAt: 5000 }),
      thread({ id: "p2c", parentThreadId: "p2", updatedAt: 4000 }),
      thread({ id: "p1", updatedAt: 3000 }),
      thread({ id: "p1c", parentThreadId: "p1", updatedAt: 2000 }),
    ];
    const churned = buildParentLanes(after, new Set<string>(), NOW, new Map());
    expect(churned.map((lane) => lane.id)).toEqual(["p2", "p1"]);
    const pinned = applyLaneFreezes(churned, [captured]);
    expect(pinned.map((lane) => lane.id)).toEqual(["p1", "p2"]);
  });

  it("keeps an attended row card in its captured row and slot while the lane churns", () => {
    // Family p1 with two idle children (an idle-bucket row); the operator
    // hovers idle2.
    const before = [
      thread({ id: "p1", updatedAt: 5000 }),
      thread({ id: "idle1", parentThreadId: "p1", updatedAt: 2000 }),
      thread({ id: "idle2", parentThreadId: "p1", updatedAt: 1000 }),
    ];
    const lanes = buildParentLanes(before, new Set<string>(), NOW, new Map());
    const captured = laneCaptureOf(lanes, "idle2", { origin: "selection", capturedAt: 0 }) as LaneCapture;
    expect(captured.row).not.toBeNull();
    expect(captured.row!.index).toBe(1);

    // Fresh activity makes idle2 outrank idle1 in the same row: it would
    // slide up past idle1 (its own recency floats it to slot 0).
    const after = [
      thread({ id: "p1", updatedAt: 5000 }),
      thread({ id: "idle1", parentThreadId: "p1", updatedAt: 2000 }),
      thread({ id: "idle2", parentThreadId: "p1", updatedAt: 9000 }),
    ];
    const churned = buildParentLanes(after, new Set<string>(), NOW, new Map());
    const churnedLane = churned.find((lane) => lane.id === "p1")!;
    const churnedRow = rowOf(churnedLane, "idle2")!;
    expect(churnedRow.threads.findIndex((card) => card.id === "idle2")).toBe(0);

    // The pin holds idle2's captured slot in its captured row.
    const pinned = applyLaneFreezes(churned, [captured]);
    const pinnedLane = pinned.find((lane) => lane.id === "p1")!;
    const pinnedRow = pinnedLane.rows.find((row) => row.id === captured.row!.id)!;
    expect(pinnedRow.threads.findIndex((card) => card.id === "idle2")).toBe(1);
    expect(pinnedRow.threads).toHaveLength(2);
  });

  it("returns an attended row card that drifted into another row", () => {
    // Family p1, two children; the operator hovers the working child. The
    // churn would land a flipped state in the needs-you row — the pin
    // returns the card to the captured row and slot.
    const before = [
      thread({ id: "p1", updatedAt: 5000 }),
      thread({ id: "c1", parentThreadId: "p1", updatedAt: 4000 }),
      thread({ id: "c2", parentThreadId: "p1", updatedAt: 3000, status: "active", hasPendingInteraction: true }),
    ];
    const lanes = buildParentLanes(before, new Set<string>(), NOW, new Map());
    const capturedRowId = rowOf(lanes.find((lane) => lane.id === "p1")!, "c1")!.id;
    const captured = laneCaptureOf(lanes, "c1", { origin: "hover", capturedAt: 0 }) as LaneCapture;

    // c1's state flips (unread) on its own: the build re-buckets the card
    // into the unread row — a drifted card. (A fresh attention flip would
    // un-nest the child into its own card entirely; unread drifts the row.)
    const after = [
      thread({ id: "p1", updatedAt: 5000 }),
      thread({ id: "c1", parentThreadId: "p1", updatedAt: 4000, isUnread: true }),
      thread({ id: "c2", parentThreadId: "p1", updatedAt: 3000, hasPendingInteraction: true }),
    ];
    const churned = buildParentLanes(after, new Set<string>(), NOW, new Map());
    const churnedLane: ParentLane = churned.find((lane) => lane.id === "p1")!;
    const churnedRow = rowOf(churnedLane, "c1")!;
    expect(churnedRow.id).not.toBe(capturedRowId);

    const pinned = applyLaneFreezes(churned, [captured]);
    const pinnedLane = pinned.find((lane) => lane.id === "p1")!;
    const pinnedRow = pinnedLane.rows.find((row) => row.id === capturedRowId)!;
    expect(pinnedRow.threads.findIndex((card) => card.id === "c1")).toBe(captured.row!.index);
  });

  it("leaves a board alone with no captures", () => {
    const lanes = buildParentLanes(
      [thread({ id: "p1", updatedAt: 5000 }), thread({ id: "c1", parentThreadId: "p1", updatedAt: 4000 })],
      new Set<string>(),
      NOW,
      new Map(),
    );
    expect(applyLaneFreezes(lanes, [])).toEqual(lanes);
  });
});
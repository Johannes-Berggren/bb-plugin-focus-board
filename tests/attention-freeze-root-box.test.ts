// The attention capture under the split default (issue #86): a capture on a
// nested family child pins the family root's card, and NOTHING ELSE — the
// old "pin the whole group box" pass is gone, because the group renders
// across lanes on purpose now. A half-frozen group is the intended render,
// not a defect: the attended card holds its own placement while the group's
// other members re-place freely.
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  captureColumnAttention,
  type AttentionSlot,
} from "../components/attention-freeze";

function threadsFor(ids: readonly string[]): PluginSidebarThread[] {
  return ids.map((id) => ({ id, updatedAt: 0 }) as unknown as PluginSidebarThread);
}

// The same board the pre-split test froze: the family root is a
// chat-imagegen member, four group siblings sit in Working, and the attended
// child nests under the root. The capture must leave the four siblings out.
const input = {
  parent: false,
  view: "status" as const,
  assembly: {
    columns: [
      { id: "unread", label: "Unread", threads: threadsFor(["thr_parent"]) },
      {
        id: "working",
        label: "Working",
        threads: threadsFor(["thr_zimage", "thr_relay_split", "thr_improve_ux", "thr_relay_service"]),
      },
    ],
    nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>([
      ["thr_parent", threadsFor(["thr_child"])],
    ]),
    doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
  },
  parentOf: new Map<string, string>([["thr_child", "thr_parent"]]),
};

const capturedAt = 1_000;

function slotIds(slots: readonly AttentionSlot[]): readonly string[] {
  return slots.map((slot) => slot.threadId);
}

describe("captureColumnAttention under the split default (no box pinning)", () => {
  it("a child of a family root that renders inside a group pins only the root's card", () => {
    const capture = captureColumnAttention("thr_child", input, "selection", capturedAt);
    expect(capture).not.toBeNull();
    expect(capture!.rowPin).toEqual({ parentId: "thr_parent", childId: "thr_child", index: 0 });
    // The root card only — the group's other members stay free to re-place
    // (each in its own lane, per the split default).
    expect(slotIds(capture!.slots)).toEqual(["thr_parent"]);
    expect(capture!.slots[0]!.columnId).toBe("unread");
    expect(capture!.slots[0]!.index).toBe(0);
  });

  it("an attended member card of a split group holds its OWN placement only", () => {
    const capture = captureColumnAttention("thr_relay_split", input, "hover", capturedAt);
    expect(capture).not.toBeNull();
    expect(capture!.rowPin).toBeNull();
    expect(slotIds(capture!.slots)).toEqual(["thr_relay_split"]);
    expect(capture!.slots[0]!.columnId).toBe("working");
    expect(capture!.slots[0]!.index).toBe(1);
  });
});
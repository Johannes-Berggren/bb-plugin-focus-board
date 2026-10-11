// The attention capture's group-box unity rule (components/attention-freeze's
// captureColumnAttention): a capture on a nested family child pins the family
// root's card — and, when the root renders inside a feature-group box, EVERY
// member of that box. Only the root would freeze while the box's other
// members re-lane on the next status change, splitting the box across lanes
// (reproduced live 2026-10-10: a pane opened on "Add model to lightbox bar"
// froze its family parent's card in Unread while the chat-imagegen box
// re-laned to Working without it).
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  captureColumnAttention,
  type AttentionSlot,
} from "../components/attention-freeze";

function threadsFor(ids: readonly string[]): PluginSidebarThread[] {
  return ids.map((id) => ({ id, updatedAt: 0 }) as unknown as PluginSidebarThread);
}

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
  // The family root is a chat-imagegen member; the attended child is not.
  groupBoxOf: new Map<string, { groupId: string; name: string; members: readonly PluginSidebarThread[] }>([
    [
      "thr_parent",
      {
        groupId: "g1",
        name: "chat-imagegen",
        members: threadsFor(["thr_parent", "thr_zimage", "thr_relay_split", "thr_improve_ux", "thr_relay_service"]),
      },
    ],
  ]),
};

const capturedAt = 1_000;

function slotIds(slots: readonly AttentionSlot[]): readonly string[] {
  return slots.map((slot) => slot.threadId);
}

describe("captureColumnAttention's root group-box unity", () => {
  it("a child of a boxed family root pins the WHOLE root's box", () => {
    const capture = captureColumnAttention("thr_child", input, "selection", capturedAt);
    expect(capture).not.toBeNull();
    expect(capture!.rowPin).toEqual({ parentId: "thr_parent", childId: "thr_child", index: 0 });
    // The root card plus every box member — the root alone is a split box.
    expect(new Set(slotIds(capture!.slots))).toEqual(
      new Set(["thr_parent", "thr_zimage", "thr_relay_split", "thr_improve_ux", "thr_relay_service"]),
    );
    // Each member pins at its own rendered placement (the parent stays in
    // Unread's slot 0, the box members in Working where the board had them).
    for (const slot of capture!.slots) {
      expect(slot.columnId).toBe(slot.threadId === "thr_parent" ? "unread" : "working");
    }
  });

  it("a child of a root outside any box still pins just the root card", () => {
    const bare = {
      ...input,
      groupBoxOf: new Map<string, { groupId: string; name: string; members: readonly PluginSidebarThread[] }>(),
    };
    const capture = captureColumnAttention("thr_child", bare, "hover", capturedAt);
    expect(capture).not.toBeNull();
    expect(slotIds(capture!.slots)).toEqual(["thr_parent"]);
  });
});

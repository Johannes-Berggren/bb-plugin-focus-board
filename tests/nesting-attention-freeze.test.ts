// The attention freeze applied through board assembly (assembleBoard): a card
// or family the operator attends to (hover, open pane) pins the rendered
// placement captured at attention time, and wins over every placement rule
// (family R4 overrides and group-box overrides included) while attended.
// Releasing attention returns the card to the live placement rules.
import { describe, expect, it } from "vitest";
import { assembleBoard } from "../components/nesting";
import { columnFor, type GroupingContext } from "../components/grouping";
import type { AttentionFreezePlan } from "../components/attention-freeze";
import { thread } from "./thread-fixture";

const NOW = 10 * 24 * 60 * 60 * 1000;
const context: GroupingContext = { projects: [], providers: [] };

function fixture(id: string, fields: Parameters<typeof thread>[0] = {}) {
  return thread({ id, updatedAt: NOW - 1000, ...fields });
}

/** The rendered placement of a thread in the assembled board. */
function placementOf(
  assembly: ReturnType<typeof assembleBoard>,
  threadId: string,
): { columnId: string; index: number; nestedIndex: number | null } | null {
  const columns = assembly.columns;
  for (const column of columns) {
    const index = column.threads.findIndex((card) => card.id === threadId);
    if (index !== -1) return { columnId: column.id, index, nestedIndex: null };
  }
  for (const [parentId, rows] of assembly.nestedChildrenByParent) {
    const index = rows.findIndex((card) => card.id === threadId);
    if (index !== -1) return { columnId: parentId, index, nestedIndex: index };
  }
  return null;
}

describe("attention freeze through board assembly", () => {
  it("pins an attended card's slot while sibling activity re-sorts the column", () => {
    const first = [
      fixture("s1", { updatedAt: 100 }),
      fixture("s2", { updatedAt: 200 }),
      fixture("s3", { updatedAt: 300 }),
    ];
    const base = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW);
    // The operator attends to s1, the bottom card of the column.
    const captured = placementOf(base, "s1");
    expect(captured).toMatchObject({ columnId: "proj_a", index: 2 });

    // s1 itself receives activity — the churn that would vault it to the top.
    const churned = [
      fixture("s1", { updatedAt: 600 }),
      fixture("s2", { updatedAt: 200 }),
      fixture("s3", { updatedAt: 300 }),
    ];
    const moved = assembleBoard(churned, "project", context, new Map(), new Set<string>(), NOW);
    expect(placementOf(moved, "s1")).toMatchObject({ index: 0 });

    const plan: AttentionFreezePlan = {
      columns: new Map([["s1", { id: captured!.columnId, label: "proj_a" }]]),
      slots: new Map([["s1", captured!.index]]),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(churned, "project", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "s1")).toEqual(captured);
  });

  it("attention wins over a family lane override while the family is attended", () => {
    const quiet = [fixture("p", { updatedAt: 5000 }), fixture("c", { parentThreadId: "p", updatedAt: 4000 })];
    const base = assembleBoard(quiet, "status", context, new Map(), new Set<string>(), NOW);
    const quietColumnId = placementOf(base, "p")!.columnId;

    // The child turning unread lifts the whole family into the unread lane
    // (R4). An attention FLIP would instead un-nest the child — the lift
    // intentionally excludes attention members — so unread drives the lane.
    const attended = [
      fixture("p", { updatedAt: 5000 }),
      fixture("c", { parentThreadId: "p", updatedAt: 4000, isUnread: true }),
    ];
    const live = assembleBoard(attended, "status", context, new Map(), new Set<string>(), NOW);
    const liveColumnId = placementOf(live, "p")!.columnId;
    expect(liveColumnId).not.toBe(quietColumnId);

    // Attending to the family's parent card pins the family's quiet lane.
    const plan: AttentionFreezePlan = {
      columns: new Map([["p", { id: quietColumnId, label: quietColumnId }]]),
      slots: new Map(),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(attended, "status", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "p")!.columnId).toBe(quietColumnId);
  });

  it("attention wins over a group-box lane override while the member is attended", () => {
    const threads = [fixture("m1", { updatedAt: 5000 }), fixture("m2", { updatedAt: 4000 })];
    const boxOverrides = new Map([
      ["m1", { id: "proj_b", label: "proj_b" }],
      ["m2", { id: "proj_b", label: "proj_b" }],
    ]);
    const live = assembleBoard(threads, "project", context, new Map(), new Set<string>(), NOW, {
      nestingEnabled: false,
      extraColumnOverrides: boxOverrides,
    });
    expect(placementOf(live, "m1")!.columnId).toBe("proj_b");

    const plan: AttentionFreezePlan = {
      columns: new Map([["m1", { id: "proj_a", label: "proj_a" }]]),
      slots: new Map(),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const pinned = assembleBoard(threads, "project", context, new Map(), new Set<string>(), NOW, {
      nestingEnabled: false,
      extraColumnOverrides: boxOverrides,
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "m1")!.columnId).toBe("proj_a");
  });

  it("an attended nested child stays nested and keeps its row slot", () => {
    const quiet = [
      fixture("p", { updatedAt: 5000 }),
      fixture("c1", { parentThreadId: "p", updatedAt: 4000 }),
      fixture("c2", { parentThreadId: "p", updatedAt: 3000 }),
    ];
    const base = assembleBoard(quiet, "status", context, new Map(), new Set<string>(), NOW);
    expect(placementOf(base, "c1")).toMatchObject({ nestedIndex: 0 });

    // c2 (not c1) goes attention: it must un-nest normally (the control).
    const churned = [
      fixture("p", { updatedAt: 5000 }),
      fixture("c1", { parentThreadId: "p", updatedAt: 4000 }),
      fixture("c2", { parentThreadId: "p", updatedAt: 3000, hasPendingInteraction: true }),
    ];
    // The operator is attending to c1 (a nested row): c1 stays anchored.
    const plan: AttentionFreezePlan = {
      columns: new Map(),
      slots: new Map(),
      stayNested: new Set(["c1"]),
      rowSlots: new Map([["p", new Map([["c1", 0]])]]),
    };
    const pinned = assembleBoard(churned, "status", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(pinned, "c1")).toMatchObject({ nestedIndex: 0 });
  });

  it("recapture of a pin already applied reproduces the pinned placement (idempotent)", () => {
    const first = [fixture("s1", { updatedAt: 100 }), fixture("s2", { updatedAt: 200 })];
    const base = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW);
    const captured = placementOf(base, "s1")!;
    const plan: AttentionFreezePlan = {
      columns: new Map([["s1", { id: captured.columnId, label: captured.columnId }]]),
      slots: new Map([["s1", captured.index]]),
      stayNested: new Set(),
      rowSlots: new Map(),
    };
    const again = assembleBoard(first, "project", context, new Map(), new Set<string>(), NOW, {
      attentionFreeze: plan,
    });
    expect(placementOf(again, "s1")).toEqual(captured);
  });

  it("the natural column lookup the capture reads agrees with the rendered lane", () => {
    const threads = [fixture("s1", { updatedAt: NOW })];
    expect(columnFor(threads[0]!, "project", context, NOW).id).toBe("proj_a");
  });
});
// The lane-move transport planner: the board diffs each commit's lane map
// against the previous one and plans a dissolve-wipe per relocated card.
// These tests pin the planner's rules on pure data (no rendering), so the
// board's only job is feeding it snapshots.
//
// @vitest-environment jsdom
// (jsdom for the one DOM test — firstRealCard's ghost skip; the rest is pure
// data and runs fine either way)
import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  laneSignature,
  planLaneTransports,
  collapseRunTransports,
  runUnits,
  firstRealCard,
  insertGhostSlots,
  TRANSPORT_WIPE_OUT_MS,
  TRANSPORT_WIPE_IN_MS,
  TRANSPORT_COLLAPSE_MS,
  TRANSPORT_EASE,
  ghostCollapseKeyframes,
  wipeInKeyframes,
  wipeOutKeyframes,
  TRANSPORT_BATCH_CAP,
} from "../components/card-transport";
import { thread } from "./thread-fixture";

function columnOf(id: string, threads: readonly PluginSidebarThread[]) {
  return { id, label: id, threads, cards: [] };
}

/** A two-member box shared by both member threads (the GroupBoxMap shape). */
function groupBoxOf(...members: PluginSidebarThread[]) {
  const box = { groupId: "grp_1", name: "Feature", members };
  return new Map(members.map((member) => [member.id, box]));
}

function moveOf(
  threadId: string,
  fromIndex: number,
  fromColumnId: string,
  toColumnId: string,
) {
  return {
    threadId,
    thread: thread({ id: threadId, displayTitle: `${threadId} Before` }),
    fromColumnId,
    fromIndex,
    toColumnId,
  };
}

describe("laneSignature", () => {
  it("maps each thread id to its lane", () => {
    const a = thread({ id: "thr_a" });
    const signature = laneSignature([columnOf("unread", [a])]);
    expect(signature.get("thr_a")).toBe("unread");
  });

  it("joins a thread's lanes (Done projection renders the same id twice) sorted", () => {
    const a = thread({ id: "thr_a" });
    const signature = laneSignature([
      columnOf("unread", [a]),
      columnOf("done", [a]),
    ]);
    expect(signature.get("thr_a")).toBe("done|unread");
  });
});

describe("planLaneTransports", () => {
  const from = columnOf("unread", [thread({ id: "thr_a" }), thread({ id: "thr_b" })]);

  it("plans a move when a thread relocates from one lane to another", () => {
    const a = thread({ id: "thr_a" });
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map([["thr_a", thread({ id: "thr_a" })]]),
      [columnOf("pinned", [a])],
    );
    expect(moves.map((move) => move.threadId)).toEqual(["thr_a"]);
    expect(moves[0]).toMatchObject({
      fromColumnId: "unread",
      toColumnId: "pinned",
      fromIndex: 0,
    });
  });

  it("plans nothing when every thread kept its lane", () => {
    const a = thread({ id: "thr_a" });
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map([["thr_a", a]]),
      [columnOf("unread", [a])],
    );
    expect(moves).toEqual([]);
  });

  it("plans nothing for a brand-new card (no wipe-in without an old lane)", () => {
    const newcomer = thread({ id: "thr_new" });
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map(),
      [columnOf("unread", [...from.threads, newcomer])],
    );
    expect(moves).toEqual([]);
  });

  it("plans nothing when a card left the board entirely (no destination lane)", () => {
    const moves = planLaneTransports(
      laneSignature([from]),
      new Map([["thr_b", thread({ id: "thr_b" })]]),
      [columnOf("unread", [thread({ id: "thr_b" })])],
    );
    expect(moves.map((move) => move.threadId)).toEqual([]);
  });

  it("plans nothing for multiplicity changes (a projection card gaining or losing its second lane)", () => {
    const a = thread({ id: "thr_a" });
    // Before: one lane. After: the same id in two lanes — a projection
    // card popped into existence, it did not move.
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [a])]),
      new Map([["thr_a", a]]),
      [columnOf("unread", [a]), columnOf("done", [a])],
    );
    expect(moves).toEqual([]);
    // And the reverse: a projection disappearing leaves the live card where
    // it was — the id's lane signature narrowed, nothing moved.
    const reverse = planLaneTransports(
      laneSignature([columnOf("unread", [a]), columnOf("done", [a])]),
      new Map([["thr_a", a]]),
      [columnOf("unread", [a])],
    );
    expect(reverse).toEqual([]);
  });

  it("reports the TRUE old slot index, read off the PREVIOUS columns even though the card already left the old lane", () => {
    const a = thread({ id: "thr_a" });
    const b = thread({ id: "thr_b" });
    const c = thread({ id: "thr_c" });
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [a, b, c])]),
      new Map([["thr_c", c]]),
      [columnOf("unread", [a, b]), columnOf("pinned", [c])],
      [columnOf("unread", [a, b, c])],
    );
    expect(moves.map((move) => move.threadId)).toEqual(["thr_c"]);
    expect(moves[0].fromIndex).toBe(2);
  });

  it("reports the previous thread snapshot so the ghost renders pre-move visuals", () => {
    const before = thread({ id: "thr_a", displayTitle: "Before" });
    const after = thread({ id: "thr_a", displayTitle: "After" });
    const moves = planLaneTransports(
      laneSignature([columnOf("unread", [before])]),
      new Map([["thr_a", before]]),
      [columnOf("done", [after])],
    );
    expect(moves[0].thread.displayTitle).toBe("Before");
  });
});

describe("runUnits", () => {
  it("maps a box run's members (≥ two in one column) to one unit keyed by group id", () => {
    const m1 = thread({ id: "thr_m1" });
    const m2 = thread({ id: "thr_m2" });
    const units = runUnits(
      [columnOf("unread", [m1, m2]), columnOf("pinned", [thread({ id: "thr_x" })])],
      groupBoxOf(m1, m2),
    );
    expect([...units.keys()]).toEqual(["grp_1"]);
    expect(units.get("grp_1")).toEqual({
      groupId: "grp_1",
      name: "Feature",
      columnId: "unread",
      memberIds: ["thr_m1", "thr_m2"],
    });
  });

  it("keeps a group-of-one a unit (the live board keeps its dashed container)", () => {
    const m1 = thread({ id: "thr_m1" });
    const units = runUnits([columnOf("unread", [m1])], groupBoxOf(m1));
    expect(units.get("grp_1")?.memberIds).toEqual(["thr_m1"]);
  });

  it("drops a split box (a lone multi-member-box member renders plain, no unit)", () => {
    const m1 = thread({ id: "thr_m1" });
    const m2 = thread({ id: "thr_m2" });
    const units = runUnits(
      [columnOf("unread", [m1]), columnOf("pinned", [m2])],
      groupBoxOf(m1, m2),
    );
    expect(units.size).toBe(0);
  });

  it("reads member order off the column's own display order, not the plan's", () => {
    const m1 = thread({ id: "thr_m1" });
    const m2 = thread({ id: "thr_m2" });
    const units = runUnits(
      [columnOf("unread", [m2, m1])],
      groupBoxOf(m1, m2),
    );
    expect(units.get("grp_1")?.memberIds).toEqual(["thr_m2", "thr_m1"]);
  });
});

describe("collapseRunTransports", () => {
  const prevUnits = new Map([
    ["grp_1", { groupId: "grp_1", name: "Feature", columnId: "unread", memberIds: ["thr_m1", "thr_m2"] }],
  ]);
  const nextUnits = new Map([
    ["grp_1", { groupId: "grp_1", name: "Feature", columnId: "pinned", memberIds: ["thr_m1", "thr_m2"] }],
  ]);
  const prevThreads = new Map([
    ["thr_m1", thread({ id: "thr_m1", displayTitle: "M1 Before" })],
    ["thr_m2", thread({ id: "thr_m2", displayTitle: "M2 Before" })],
  ]);

  it("folds a box's lockstep member moves into ONE run transport carrying pre-move snapshots", () => {
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned"), moveOf("thr_m2", 1, "unread", "pinned")],
      prevUnits,
      nextUnits,
      prevThreads,
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      threadId: "grp_1",
      boxName: "Feature",
      fromColumnId: "unread",
      toColumnId: "pinned",
      fromIndex: 0,
      thread: { displayTitle: "M1 Before" },
    });
    expect(result[0].members?.map((member) => member.displayTitle)).toEqual([
      "M1 Before",
      "M2 Before",
    ]);
  });

  it("keeps per-thread transports when only part of a box moved (a split, not a unit)", () => {
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned")],
      prevUnits,
      nextUnits,
      prevThreads,
    );
    expect(result.map((transport) => transport.threadId)).toEqual(["thr_m1"]);
    expect(result[0].members).toBeUndefined();
  });

  it("keeps per-thread transports when the box's membership changed while it moved", () => {
    const changed = new Map([
      ["grp_1", { groupId: "grp_1", name: "Feature", columnId: "pinned", memberIds: ["thr_m2", "thr_m1"] }],
    ]);
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned"), moveOf("thr_m2", 1, "unread", "pinned")],
      prevUnits,
      changed,
      prevThreads,
    );
    expect(result.map((transport) => transport.threadId).sort()).toEqual(["thr_m1", "thr_m2"]);
  });

  it("falls back to per-thread transports when a member has no pre-move snapshot", () => {
    const result = collapseRunTransports(
      [moveOf("thr_m1", 0, "unread", "pinned"), moveOf("thr_m2", 1, "unread", "pinned")],
      prevUnits,
      nextUnits,
      new Map([["thr_m1", prevThreads.get("thr_m1")!]]),
    );
    expect(result.map((transport) => transport.threadId).sort()).toEqual(["thr_m1", "thr_m2"]);
  });

  it("counts a collapsed unit as ONE transport, so a 13-member box stays under the batch cap", () => {
    const memberIds = Array.from({ length: 13 }, (_, index) => `thr_m${index}`);
    const members = memberIds.map((id) => thread({ id }));
    const prevThirteen = new Map([
      ["grp_1", { groupId: "grp_1", name: "Big", columnId: "unread", memberIds }],
    ]);
    const nextThirteen = new Map([
      ["grp_1", { groupId: "grp_1", name: "Big", columnId: "pinned", memberIds }],
    ]);
    const snapshots = new Map(members.map((member) => [member.id, member]));
    const result = collapseRunTransports(
      memberIds.map((id, index) => moveOf(id, index, "unread", "pinned")),
      prevThirteen,
      nextThirteen,
      snapshots,
    );
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(13);
    expect(TRANSPORT_BATCH_CAP).toBeGreaterThan(1);
  });
});

describe("insertGhostSlots", () => {
  const ghost = {
    threadId: "thr_moved",
    thread: thread({ id: "thr_moved" }),
    fromColumnId: "unread",
    toColumnId: "pinned",
    fromIndex: 1,
  };

  it("injects the ghost between the runs its old card slot sat in", () => {
    const entries = insertGhostSlots(
      [
        { kind: "single" as const, thread: thread({ id: "thr_0" }) },
        { kind: "single" as const, thread: thread({ id: "thr_1" }) },
      ],
      [ghost],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["run", "ghost", "run"]);
  });

  it("counts a box run as one slot per member (fromIndex indexes the lane's card slots)", () => {
    const entries = insertGhostSlots(
      [
        {
          kind: "box" as const,
          box: {
            groupId: "grp_1",
            name: "Feature",
            members: [thread({ id: "thr_m1" }), thread({ id: "thr_m2" })],
          },
        },
        { kind: "single" as const, thread: thread({ id: "thr_2" }) },
      ],
      [{ ...ghost, fromIndex: 2 }],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["run", "ghost", "run"]);
  });

  it("clamps a stale fromIndex (the old lane reflowed between) to the lane's end", () => {
    const entries = insertGhostSlots(
      [{ kind: "single" as const, thread: thread({ id: "thr_0" }) }],
      [{ ...ghost, fromIndex: 7 }],
    );
    expect(entries.map((entry) => entry.kind)).toEqual(["run", "ghost"]);
  });
});

describe("firstRealCard", () => {
  it("skips transport ghosts when looking a card up by id in DOM order", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <ul data-column-id="unread"><li data-transport-ghost="" data-transport-out="wiping">
        <div data-thread-card="thr_a">ghost</div>
      </li></ul>
      <ul data-column-id="pinned"><li><div data-thread-card="thr_a">real</div>
        <div data-thread-card="thr_a">dup</div></li></ul>`;
    const found = firstRealCard(host, "thr_a");
    expect(found?.parentElement?.parentElement?.getAttribute("data-column-id")).toBe("pinned");
  });
});

describe("transport constants", () => {
  it("wipe-out ends the old slot's visibility before the collapse, arrival lands first", () => {
    expect(TRANSPORT_WIPE_OUT_MS).toBeGreaterThan(TRANSPORT_WIPE_IN_MS);
    expect(TRANSPORT_COLLAPSE_MS).toBeGreaterThan(0);
  });

  it("wipes ease in (slight acceleration, not a linear or decelerating sweep)", () => {
    expect(TRANSPORT_EASE).toContain("cubic-bezier");
  });

  it("a batch switch larger than the cap stays a plain reflow", () => {
    // Reassignment: planning a batch the size of a grouping change would
    // dissolve the whole board; the cap exists so those re-derivations read
    // as view switches.
    expect(TRANSPORT_BATCH_CAP).toBeGreaterThan(0);
    expect(TRANSPORT_BATCH_CAP).toBeLessThan(20);
  });
});

describe("wipe keyframes", () => {
  it("wipe-out starts fully visible and ends hidden, sweeping from the top edge", () => {
    const frames = wipeOutKeyframes();
    expect(String(frames[0].clipPath)).toContain("inset(0%");
    expect(String(frames[frames.length - 1].clipPath)).toContain("inset(100%");
    expect(frames[frames.length - 1].opacity).toBe(0);
    // The dissolve's read: the bloom strengthens all the way to the end —
    // a sweep without a strong growing bloom reads as a plain wipe.
    expect(String(frames[frames.length - 1].filter)).toContain("blur(10px)");
  });

  it("wipe-in is the mirror: hidden top edge opening to full visibility", () => {
    const frames = wipeInKeyframes();
    expect(String(frames[0].clipPath)).toContain("inset(100%");
    expect(Number(frames[frames.length - 1].opacity)).toBe(1);
    expect(String(frames[0].filter)).toContain("blur(7px)");
  });

  it("the collapse closes the ghost's height and borrows nothing extra from the layout", () => {
    // The ghost's final margins must exactly cancel the flex gap it leaves
    // behind, so removing the node after the animation changes nothing.
    const frames = ghostCollapseKeyframes(120, 6);
    expect(frames[0].maxHeight).toBe("120px");
    expect(frames[frames.length - 1].maxHeight).toBe("0px");
    expect(frames[frames.length - 1].marginTop).toBe("-3px");
    expect(frames[frames.length - 1].marginBottom).toBe("-3px");
  });

  it("the collapse starts from the ghost's real margins, so a box container's own top margin dissolves smoothly", () => {
    // A box ghost's container carries a 6px top margin of its own; the
    // collapse must eat that smoothly (6px → borrowed halves), never jump.
    const frames = ghostCollapseKeyframes(120, 6, "6px", "0px");
    expect(frames[0].marginTop).toBe("6px");
    expect(frames[0].marginBottom).toBe("0px");
    expect(frames[frames.length - 1].marginTop).toBe("-3px");
    expect(frames[frames.length - 1].marginBottom).toBe("-3px");
  });
});
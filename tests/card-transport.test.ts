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
  });

  it("wipe-in is the mirror: hidden top edge opening to full visibility", () => {
    const frames = wipeInKeyframes();
    expect(String(frames[0].clipPath)).toContain("inset(100%");
    expect(Number(frames[frames.length - 1].opacity)).toBe(1);
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
});
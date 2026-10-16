// Two-window rank_move semantics: a stale window's drop must not rewrite the
// fresh window's arrangement.
//
// The multi-window safety investigation (thr_ig573wb9ha, issue #246) showed
// the shape: rank_move carries the dropping window's whole displayed order
// (`visibleIds`), and the head of the resulting stored order is derived from
// that list. A second window holding a stale view therefore rewrites cards it
// never touched, and the fresh window's drag visibly reverts (the cross-window
// edition of #232's "the card falls back"). The write lock (#243) serializes
// the writes; it cannot save an arrangement computed from a stale view.
//
// These tests speak server-level: two `rank_move` calls standing in for two
// windows, the second one sending the stale `visibleIds`. The fix replaces
// the head-rewrite write with per-card fractional ranks; these are the
// behavior pins any implementation must satisfy.
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/done-fake-host";

type Rpc = Awaited<ReturnType<typeof setup>>;

type Move = {
  columnKey: string;
  threadId: string;
  beforeId: string | null;
  toEnd?: boolean;
  visibleIds: string[];
};

const moveWindow = async (rpc: Rpc, args: Move): Promise<string[]> => {
  const result = (await rpc.callRpc("rank_move", {
    toEnd: false,
    ...args,
  })) as { order: string[] };
  return result.order;
};

/**
 * Seed a,b,c,d ranked in `columnKey`, top to bottom, by real moves. Each
 * id lands directly in front of the previous one, so seeding runs
 * bottom-up (d first, alone; then c before d, and so on) — `beforeId`
 * means "land in front of", so a top-down seed would reverse the order.
 */
async function seedFourRanked(rpc: Rpc, columnKey = "pinned"): Promise<void> {
  const view = ["a", "b", "c", "d"];
  for (let i = view.length - 1; i >= 0; i--) {
    await rpc.callRpc("rank_move", {
      columnKey,
      threadId: view[i] as string,
      beforeId: view[i + 1] ?? null,
      toEnd: false,
      visibleIds: view,
    });
  }
}

/** The pinned column's stored order via the rank_list projection. */
const listOrders = async (rpc: Rpc) =>
  ((await rpc.callRpc("rank_list", null)) as {
    orders: Record<string, string[]>;
  }).orders;

const rankChangedCount = (rpc: Rpc): number =>
  rpc.harness.inspection.realtimeSignals.filter(
    (signal) => (signal as { channel: string }).channel === "rank-changed",
  ).length;

describe("two windows moving in the same lane, the second with a stale view", () => {
  it("a stale window's drop does not demote the fresh window's moved card", async () => {
    // Issue #246's acceptance sketch, server-level. Window A drops c between
    // a and b; then window B — which never saw A's landing — drops d before b
    // with its stale visibleIds (which still shows c below b).
    //
    // Anchor semantics: B's drop must honor the anchor against the server's
    // fresh state — d lands directly above b, whose fresh predecessor is
    // A's moved c. Rewriting the head from B's stale list instead demotes c
    // to position 4 (a, d, b, c — A's drag visibly reverting on its board).
    const rpc = await setup();
    await seedFourRanked(rpc);
    const afterA = await moveWindow(rpc, {
      columnKey: "pinned",
      threadId: "c",
      beforeId: "b",
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(afterA).toEqual(["a", "c", "b", "d"]);
    const afterB = await moveWindow(rpc, {
      columnKey: "pinned",
      threadId: "d",
      beforeId: "b",
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(afterB).toEqual(["a", "c", "d", "b"]);
  });

  it("a stale window's melt-drop keeps the fresh window's arrangement", async () => {
    // A moves a below every other card. B's stale drop of d "before a" is
    // already satisfied in the fresh state (d sits directly above a), so it
    // melts: a, b, c, and d all keep where A left them. Rewriting the head
    // from B's stale view instead drags d above b (d, b, c, a).
    const rpc = await setup();
    await seedFourRanked(rpc);
    const afterA = await moveWindow(rpc, {
      columnKey: "pinned",
      threadId: "a",
      beforeId: null,
      toEnd: true,
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(afterA).toEqual(["b", "c", "d", "a"]);
    const afterB = await moveWindow(rpc, {
      columnKey: "pinned",
      threadId: "d",
      beforeId: "a",
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(afterB).toEqual(["b", "c", "d", "a"]);
  });

  it("a drop that changes nothing server-side skips the write and the publish", async () => {
    const rpc = await setup();
    await seedFourRanked(rpc);
    await rpc.callRpc("rank_move", {
      columnKey: "pinned",
      threadId: "d",
      beforeId: "c",
      toEnd: false,
      visibleIds: ["a", "b", "c", "d"],
    });
    const before = await listOrders(rpc);
    const signalsBefore = rankChangedCount(rpc);
    await rpc.callRpc("rank_move", {
      columnKey: "pinned",
      threadId: "c",
      beforeId: null,
      toEnd: true,
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(await listOrders(rpc)).toEqual(before);
    expect(rankChangedCount(rpc)).toBe(signalsBefore);
  });
});
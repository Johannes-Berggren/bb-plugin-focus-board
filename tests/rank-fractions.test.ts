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
// windows, the second one sending the stale `visibleIds`. The fix stores
// per-card fractional ranks and writes only the fragments a move must touch
// (lib/rank-fractions.ts); the module-level pins live in
// tests/rank-fraction-model.test.ts.
import { describe, expect, it } from "vitest";
import { setup } from "./helpers/done-fake-host";
import { RANK_KV_KEY } from "../lib/rank";

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

/** The stored fraction map of one column, read raw from the KV row. */
const fractionRowOf = async (rpc: Rpc, columnKey: string): Promise<Record<string, number>> => {
  const row = (await rpc.kv.get(RANK_KV_KEY)) as Record<
    string,
    Record<string, number> | string[]
  >;
  const column = row[columnKey];
  if (column !== undefined && !Array.isArray(column)) return column;
  expect(column).toBeUndefined(); // a fraction-shaped read must not find lists here
  return {};
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
    const fractionsA = await fractionRowOf(rpc, "pinned");
    const afterB = await moveWindow(rpc, {
      columnKey: "pinned",
      threadId: "d",
      beforeId: "b",
      visibleIds: ["a", "b", "c", "d"],
    });
    expect(afterB).toEqual(["a", "c", "d", "b"]);
    // Fragment-level: B's write may touch only d's rank. Every other card
    // carries the fraction A's move left it with — each card carries its
    // own rank, and a move writes only the fragments it must.
    const fractionsB = await fractionRowOf(rpc, "pinned");
    for (const id of ["a", "b", "c"]) {
      expect(fractionsB[id]).toBe(fractionsA[id]);
    }
    expect(fractionsB.d).not.toBe(fractionsA.d);
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

  it("a legacy list row survives rank_list as a view and converts only when a write lands", async () => {
    // The migration story, server-level: the pre-upgrade row is an ordered
    // list. Reading must not rewrite it (rank_list is read-only); the first
    // rank write under this build converts the row losslessly to fractions
    // (order preserved), and the projection never changes across either.
    const rpc = await setup();
    await rpc.kvSet(RANK_KV_KEY, {
      pinned: ["thr_x", "thr_y", "thr_z"],
      done: ["thr_done_a"],
    });
    expect((await listOrders(rpc)).pinned).toEqual(["thr_x", "thr_y", "thr_z"]);
    // rank_list does not write: the row is still the legacy lists.
    const raw = (await rpc.kv.get(RANK_KV_KEY)) as Record<string, unknown>;
    expect(Array.isArray(raw.pinned)).toBe(true);
    // First write: the row converts; the derived order is preserved.
    await moveWindow(rpc, {
      columnKey: "pinned",
      threadId: "thr_w",
      beforeId: "thr_y",
      visibleIds: ["thr_x", "thr_y", "thr_z"],
    });
    const converted = (await rpc.kv.get(RANK_KV_KEY)) as Record<string, unknown>;
    expect(Array.isArray(converted.pinned)).toBe(false);
    // The whole row converts in one write: the untouched done arm converts
    // with it, losslessly.
    expect(Array.isArray(converted.done)).toBe(false);
    const orders = await listOrders(rpc);
    expect(orders.pinned).toEqual(["thr_x", "thr_w", "thr_y", "thr_z"]);
    expect(orders.done).toEqual(["thr_done_a"]);
  });
});
// Whole-row KV write serialization tests.
//
// Ranks serialize through an in-process lock (tests/rank-concurrent.test.ts,
// the 1.0 hardening fix), but three more stores ride read-merge-write cycles
// over one KV row with no lock: the done index, the sweep keep flags, and
// the groups registry. Two windows (or a window plus the CLI) firing two
// writers at the same instant can interleave read A → read B → write A →
// write B, and the later write — computed from the ORIGINAL row — silently
// erases the first writer's change. These tests pin what serialization must
// guarantee: two queuing writers land both of their changes, because each
// reads the row only after the previous writer's write landed.
//
// The gate holds BOTH writers inside their kv.set before either writes, so
// the interleaving is deterministic, never a timing coin flip.
import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { GROUPS_KV_KEY } from "../lib/group-metadata";

type Deferred = { promise: Promise<void>; release: () => void };

function deferred(): Deferred {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function setup(): Promise<{
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
  kvGet: (key: string) => Promise<unknown>;
  gateNextSet: (key: string) => Deferred;
}> {
  const store = new Map<string, unknown>();
  const host = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => [],
        getPluginMetadata: async () => ({}),
        updatePluginMetadata: async (args: { threadId: string }) => args,
      },
    },
  });
  const kv = host.bb.storage.kv;
  const rawGet = kv.get.bind(kv);
  const rawSet = kv.set.bind(kv);
  // Unlike tests/rank-concurrent.test.ts, gated sets are NOT consumed: both
  // writers of an interleaved pair must be able to park. Each call to
  // gateNextSet queues one gate; the writers consume them in start order.
  const gates = new Map<string, Deferred[]>();
  kv.get = (async (key: string) => rawGet(key)) as typeof kv.get;
  kv.set = (async (key: string, value: unknown) => {
    const queue = gates.get(key);
    if (queue !== undefined && queue.length > 0) {
      const gate = queue.shift()!;
      await gate.promise;
    }
    await rawSet(key, value);
  }) as typeof kv.set;
  await plugin(host.bb);
  return {
    callRpc: (method, input) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
    kvGet: async (key) => (await rawGet(key)) as unknown,
    gateNextSet: (key) => {
      const gate = deferred();
      const queue = gates.get(key) ?? [];
      queue.push(gate);
      gates.set(key, queue);
      return gate;
    },
  };
}

describe("interleaved whole-row KV writers", () => {
  it("two interleaved sweep_keep_set keeps on different threads both land", async () => {
    const { callRpc, kvGet, gateNextSet } = await setup();
    await callRpc("sweep_keep_set", { threadId: "t1", keep: true });

    const gateA = gateNextSet("sweep-keep-flags");
    const keepA = callRpc("sweep_keep_set", { threadId: "t2", keep: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const gateB = gateNextSet("sweep-keep-flags");
    const keepB = callRpc("sweep_keep_set", { threadId: "t3", keep: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Both reads happened before either write: the row still holds only t1.
    // The gates hold writer A inside its set, and writer B — no lock — has
    // already read the t1-only row and parked inside its own set.
    const held = (await kvGet("sweep-keep-flags")) as Record<string, true>;
    expect(Object.keys(held)).toEqual(["t1"]);

    gateA.release();
    await keepA;
    gateB.release();
    await keepB;

    // B ran on A's landed state, so B's intent compounds instead of erasing.
    // Without serialization, B's write — computed from the t1-only row —
    // silently erased A's t2 keep (the red run of this suite).
    const stored = (await kvGet("sweep-keep-flags")) as Record<string, true>;
    expect(Object.keys(stored).sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("two interleaved done_set marks on different threads both reach the done index", async () => {
    const { callRpc, kvGet, gateNextSet } = await setup();
    await callRpc("done_set", { threadId: "t1", done: true });

    const gateA = gateNextSet("done-index");
    const doneA = callRpc("done_set", { threadId: "t2", done: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const gateB = gateNextSet("done-index");
    const doneB = callRpc("done_set", { threadId: "t3", done: true });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const held = (await kvGet("done-index")) as string[];
    expect(held).toEqual(["t1"]);

    gateA.release();
    await doneA;
    gateB.release();
    await doneB;

    const index = (await kvGet("done-index")) as string[];
    expect(index.sort()).toEqual(["t1", "t2", "t3"]);
  });

  it("two interleaved group_create calls both land in the registry", async () => {
    const { callRpc, kvGet, gateNextSet } = await setup();

    const gateA = gateNextSet(GROUPS_KV_KEY);
    const createA = callRpc("group_create", { name: "Alpha" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const gateB = gateNextSet(GROUPS_KV_KEY);
    const createB = callRpc("group_create", { name: "Beta" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await kvGet(GROUPS_KV_KEY)).toBeUndefined();

    gateA.release();
    await createA;
    gateB.release();
    await createB;

    const row = (await kvGet(GROUPS_KV_KEY)) as Record<
      string,
      { name: string }
    >;
    expect(Object.values(row).map((record) => record.name).sort()).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});
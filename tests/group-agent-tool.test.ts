// The focus_board_group_set agent tool (issue #84), mirroring the
// link tool's pattern: registerTool + instructions nudge + CLI fallback.
// Red-first against the unregistered tool.
import { describe, expect, it } from "vitest";
import type { FakePluginHost, FakePluginHarness } from "@get-bb/plugin-sdk/testing";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { GROUP_METADATA_KEY, GROUPS_KV_KEY, parseGroupsStore } from "../lib/group-metadata";

type GroupAgentTestHost = {
  host: FakePluginHost;
  harness: FakePluginHarness;
  meta: Map<string, { [key: string]: unknown }>;
  kv: Map<string, unknown>;
  callRpc: (method: string, input?: unknown) => Promise<unknown>;
};

export async function setup(opts: { threads?: string[] } = {}): Promise<GroupAgentTestHost> {
  const metaStore = new Map<string, { [key: string]: unknown }>();
  const kv = new Map<string, unknown>();
  const liveIds = opts.threads ?? ["thr_a"];
  const host = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async (args?: { archived?: boolean; limit?: number }) =>
          (args?.archived === true ? [] : liveIds).map((id) => ({ id })),
        get: async (args: { threadId: string }) => ({ id: args.threadId, projectId: "proj_test" }),
        getPluginMetadata: async (args: { threadId: string }) =>
          (metaStore.get(args.threadId) ?? {}) as never,
        updatePluginMetadata: async (args: {
          threadId: string;
          set?: Record<string, unknown>;
          remove?: string[];
        }) => {
          const current = { ...(metaStore.get(args.threadId) ?? {}) };
          if (args.set) Object.assign(current, args.set);
          for (const key of args.remove ?? []) delete current[key];
          metaStore.set(args.threadId, current);
          return current as never;
        },
      },
    },
  });
  Object.defineProperty(host.bb.storage, "kv", {
    value: {
      get: async (key: string) => kv.get(key) ?? null,
      set: async (key: string, value: unknown) => {
        kv.set(key, value);
        return value;
      },
    },
  });
  await plugin(host.bb as never);
  return {
    host: host as FakePluginHost,
    harness: host.harness,
    meta: metaStore,
    kv,
    callRpc: (method, input) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
  };
}

function groupIdOf(meta: Map<string, { [key: string]: unknown }>, threadId: string): string | undefined {
  const record = meta.get(threadId)?.[GROUP_METADATA_KEY] as
    | { groupId?: string }
    | undefined;
  return record?.groupId;
}

describe("focus_board_group_set registration", () => {
  it("registers the group tool alongside the link tool", async () => {
    const { harness } = await setup();
    expect(
      harness.inspection.registrations.agentTools.map((tool) => tool.name),
    ).toContain("focus_board_group_set");
  });
});

describe("focus_board_group_set assignment", () => {
  it("assigns the calling thread to a group by exact name and signals", async () => {
    const { harness, callRpc, meta } = await setup({ threads: ["thr_test"] });
    await callRpc("group_create", { name: "BV-INC-10" });
    const result = await harness.callAgentTool(
      "focus_board_group_set",
      { group: "BV-INC-10" },
      { threadId: "thr_test" },
    );
    expect(result.isError).toBeFalsy();
    expect(groupIdOf(meta, "thr_test")).toBeTruthy();
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "group-changed",
      payload: { threadId: "thr_test" },
    });
  });

  it("assigns by group id too", async () => {
    const { harness, callRpc, meta, kv } = await setup({ threads: ["thr_test"] });
    await callRpc("group_create", { name: "BV-INC-10" });
    const groups = parseGroupsStore(kv.get(GROUPS_KV_KEY));
    const id = Object.keys(groups)[0]!;
    await harness.callAgentTool(
      "focus_board_group_set",
      { group: id },
      { threadId: "thr_test" },
    );
    expect(groupIdOf(meta, "thr_test")).toBe(id);
  });

  it("targets another thread when threadId is passed", async () => {
    const { harness, callRpc, meta } = await setup({ threads: ["thr_test", "thr_other"] });
    await callRpc("group_create", { name: "BV-INC-10" });
    await harness.callAgentTool("focus_board_group_set", {
      group: "BV-INC-10",
      threadId: "thr_other",
    });
    expect(groupIdOf(meta, "thr_other")).toBeTruthy();
  });

  it("reports the move when the thread already sat in another group", async () => {
    const { harness, callRpc, kv, meta } = await setup({ threads: ["thr_test", "thr_holder"] });
    await callRpc("group_create", { name: "G1" });
    await callRpc("group_create", { name: "G2" });
    const groups = parseGroupsStore(kv.get(GROUPS_KV_KEY)) as Record<string, { name: string }>;
    const from = Object.keys(groups).find((id) => groups[id].name === "G1")!;
    const to = Object.keys(groups).find((id) => groups[id].name === "G2")!;
    // Both groups get their members metadata-side (an RPC assign runs the
    // GC, which would prune either group while it waits for its member).
    meta.set("thr_test", { group: { groupId: from } });
    meta.set("thr_holder", { group: { groupId: to } });
    const result = await harness.callAgentTool(
      "focus_board_group_set",
      { group: "G2" },
      { threadId: "thr_test" },
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("G1");
  });

  it("an unknown group is an error telling the agent the doors", async () => {
    const { harness } = await setup({ threads: ["thr_test"] });
    const result = await harness.callAgentTool("focus_board_group_set", {
      group: "Nope",
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("group list");
    expect(JSON.stringify(result.content)).toContain("group create");
  });

  it("re-setting the same group reports no change (idempotent)", async () => {
    const { harness, callRpc } = await setup({ threads: ["thr_test"] });
    await callRpc("group_create", { name: "BV-INC-10" });
    await harness.callAgentTool(
      "focus_board_group_set",
      { group: "BV-INC-10" },
      { threadId: "thr_test" },
    );
    const signals = harness.inspection.realtimeSignals.filter(
      (signal) => signal.channel === "group-changed",
    );
    const result = await harness.callAgentTool(
      "focus_board_group_set",
      { group: "BV-INC-10" },
      { threadId: "thr_test" },
    );
    expect(result.isError).toBeFalsy();
    expect(JSON.stringify(result.content)).toContain("nothing changed");
    expect(
      harness.inspection.realtimeSignals.filter(
        (signal) => signal.channel === "group-changed",
      ).length,
    ).toBe(signals.length);
  });
});
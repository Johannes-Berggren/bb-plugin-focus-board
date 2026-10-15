import { describe, expect, it } from "vitest";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { setup } from "./helpers/done-fake-host";
import { ERROR_ACK_METADATA_KEY } from "../lib/error-ack-metadata";

// The test scaffolding is shared with the done-RPC suites (a fake host with
// an in-memory metadata namespace and the same threads.list stub). The ack
// record lives beside done's record in the board's own plugin-metadata
// namespace, so the same harness drives both contracts.
function errorAckRecordOf(
  meta: Map<string, JsonValue>,
  threadId: string,
): { ackedAt: string } | undefined {
  const namespace = meta.get(threadId) as Record<string, JsonValue> | undefined;
  return namespace?.[ERROR_ACK_METADATA_KEY] as
    | { ackedAt: string }
    | undefined;
}

function ackCalls(host: Awaited<ReturnType<typeof setup>>["host"]) {
  return host.harness.inspection.sdk.callsTo("threads.updatePluginMetadata");
}

describe("error_ack_set over plugin metadata", () => {
  it("acknowledging stamps { ackedAt } into the thread's board-metadata namespace", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: true });
    const record = errorAckRecordOf(meta, "thr_a");
    expect(typeof record?.ackedAt).toBe("string");
    expect(Number.isNaN(Date.parse(record!.ackedAt))).toBe(false);
  });

  it("acknowledging publishes error-ack-changed with { threadId, acked: true }", async () => {
    const { callRpc, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: true });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "error-ack-changed",
      payload: { threadId: "thr_a", acked: true },
    });
  });

  it("clearing publishes error-ack-changed with acked: false", async () => {
    const { callRpc, harness } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: false });
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "error-ack-changed",
      payload: { threadId: "thr_a", acked: false },
    });
  });

  it("re-acking refreshes ackedAt (idempotent re-stamp)", async () => {
    const { callRpc, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: true });
    const first = errorAckRecordOf(meta, "thr_a")!;
    await new Promise((r) => setTimeout(r, 5));
    await callRpc("error_ack_set", { threadId: "thr_a", acked: true });
    const second = errorAckRecordOf(meta, "thr_a")!;
    expect(Date.parse(second.ackedAt)).toBeGreaterThan(Date.parse(first.ackedAt));
  });

  it("clearing issues remove: [\"errorAck\"]", async () => {
    const { callRpc, host } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: false });
    const args = ackCalls(host)[0][0] as { threadId: string; remove?: string[] };
    expect(args.threadId).toBe("thr_a");
    expect(args.remove).toEqual([ERROR_ACK_METADATA_KEY]);
  });

  it("clearing on a never-acked thread still publishes (the sweep path clears)", async () => {
    const { callRpc, harness, meta } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: false });
    expect(errorAckRecordOf(meta, "thr_a")).toBeUndefined();
    expect(harness.inspection.realtimeSignals).toContainEqual({
      channel: "error-ack-changed",
      payload: { threadId: "thr_a", acked: false },
    });
  });

  it("error_ack_set echoes { threadId, acked }", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    expect(
      await callRpc("error_ack_set", { threadId: "thr_a", acked: true }),
    ).toEqual({ threadId: "thr_a", acked: true });
    expect(
      await callRpc("error_ack_set", { threadId: "thr_a", acked: false }),
    ).toEqual({ threadId: "thr_a", acked: false });
  });
});

describe("error_acks_list over plugin metadata", () => {
  it("returns ids of live threads carrying the ack record, sorted", async () => {
    const { callRpc } = await setup({ threads: ["thr_c", "thr_a", "thr_b"] });
    await callRpc("error_ack_set", { threadId: "thr_b", acked: true });
    await callRpc("error_ack_set", { threadId: "thr_a", acked: true });
    const result = (await callRpc("error_acks_list")) as {
      ackIds: string[];
      records: Record<string, { ackedAt: string }>;
    };
    expect(result.ackIds).toEqual(["thr_a", "thr_b"]);
    expect(Object.keys(result.records).sort()).toEqual(["thr_a", "thr_b"]);
    for (const id of result.ackIds) {
      expect(Number.isNaN(Date.parse(result.records[id].ackedAt))).toBe(false);
    }
  });

  it("omits threads outside the live list and threads without a record", async () => {
    const { callRpc } = await setup({ threads: ["thr_a"] });
    await callRpc("error_ack_set", { threadId: "thr_gone", acked: true });
    const result = (await callRpc("error_acks_list")) as { ackIds: string[] };
    expect(result.ackIds).toEqual([]);
  });
});
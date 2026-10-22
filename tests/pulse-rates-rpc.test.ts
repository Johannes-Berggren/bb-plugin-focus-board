// The pulse_rates RPC (issue #279) at the server boundary: it answers the
// sampler's rates, and the CALL is what turns the sampler on. The lazy half is
// the point of the test — a plugin whose board nobody has open must register no
// event subscription and read no thread's context.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";

const TOKEN_EVENT = "thread/tokenUsage/updated";
const NOISE_EVENT = "item/agentMessage/delta";
const T0 = 1_000_000;

interface SubscribeArgs {
  event: string;
  callback: (event: unknown) => void;
}

function makeHost() {
  let usage = 1000;
  const contextCalls: string[] = [];
  const subscribeCalls: SubscribeArgs[] = [];
  const unsubscribes: number[] = [];
  const host = createFakePluginHost({
    pluginId: "focus-board",
    sdk: {
      threads: {
        list: async () => [],
        getPluginMetadata: async () => ({}) as never,
        updatePluginMetadata: async () => ({}) as never,
        context: async ({ threadId }: { threadId: string }) => {
          contextCalls.push(threadId);
          return { usage: { estimated: false, modelContextWindow: 200_000, usedTokens: usage } } as never;
        },
      },
      subscribe: ((args: SubscribeArgs) => {
        subscribeCalls.push(args);
        return () => {
          unsubscribes.push(subscribeCalls.indexOf(args));
        };
      }) as never,
    },
  });
  return {
    host,
    setUsage: (value: number) => {
      usage = value;
    },
    contextCalls,
    subscribeCalls,
    unsubscribes,
    callRpc: (method: string, input?: unknown) =>
      host.harness.callRpc(method, input) as Promise<unknown>,
  };
}

/** Fire a thread-changed event at the plugin's own subscriber. */
function fire(host: ReturnType<typeof makeHost>, id: string, eventTypes: string[]): void {
  const subscriber = host.subscribeCalls.at(-1);
  if (subscriber === undefined) throw new Error("the plugin never subscribed");
  subscriber.callback({ entity: "thread", id, changes: [], metadata: { eventTypes } });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("pulse_rates", () => {
  it("registers no thread subscription until a board asks, and only one ever", async () => {
    const h = makeHost();
    await plugin(h.host.bb as never);
    expect(h.subscribeCalls).toHaveLength(0);
    await h.callRpc("pulse_rates", null);
    expect(h.subscribeCalls).toHaveLength(1);
    expect(h.subscribeCalls[0]?.event).toBe("thread:changed");
    await h.callRpc("pulse_rates", null);
    expect(h.subscribeCalls).toHaveLength(1);
  });

  it("answers an empty map before anything is measurable, never a fabricated zero", async () => {
    const h = makeHost();
    await plugin(h.host.bb as never);
    const answer = (await h.callRpc("pulse_rates", null)) as {
      rates: Record<string, number>;
      generatedAt: number;
    };
    expect(answer.rates).toEqual({});
    expect(typeof answer.generatedAt).toBe("number");
  });

  it("reads a thread's context on a token-usage event and reports tokens per second", async () => {
    const h = makeHost();
    await plugin(h.host.bb as never);
    await h.callRpc("pulse_rates", null);

    fire(h, "thr_a", [TOKEN_EVENT]);
    await flush();
    expect(h.contextCalls).toEqual(["thr_a"]);

    // Four seconds later, past the sampler's per-thread gap.
    vi.setSystemTime(T0 + 4000);
    h.setUsage(2000);
    fire(h, "thr_a", [TOKEN_EVENT]);
    await flush();

    const answer = (await h.callRpc("pulse_rates", null)) as { rates: Record<string, number> };
    // 1000 tokens over 4 seconds.
    expect(answer.rates.thr_a).toBeCloseTo(250, 9);
  });

  it("ignores an event whose types are not token usage", async () => {
    const h = makeHost();
    await plugin(h.host.bb as never);
    await h.callRpc("pulse_rates", null);
    fire(h, "thr_a", [NOISE_EVENT]);
    await flush();
    expect(h.contextCalls).toEqual([]);
  });

  it("reads nothing before the first poll, even though it is subscribed", async () => {
    const h = makeHost();
    await plugin(h.host.bb as never);
    // No poll yet, so no subscription exists and nothing can have been read.
    expect(h.subscribeCalls).toHaveLength(0);
    expect(h.contextCalls).toEqual([]);
  });

  it("unsubscribes on dispose", async () => {
    const h = makeHost();
    await plugin(h.host.bb as never);
    await h.callRpc("pulse_rates", null);
    expect(h.subscribeCalls).toHaveLength(1);
    await h.host.harness.dispose();
    expect(h.unsubscribes).toEqual([0]);
  });
});

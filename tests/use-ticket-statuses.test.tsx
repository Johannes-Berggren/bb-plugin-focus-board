// @vitest-environment jsdom
// Issue #92: a ticket chip's status dot froze at whatever the first fetch
// saw — the refetch ran only when the visible ref set changed, so a PR
// merging (same ref, new state in the plugin's cache) never reached the
// chip. The hook must also refetch on a poll interval and on window
// focus: change the mocked cache state between two ticks with the ref
// set unchanged and the dot has to update.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useTicketStatuses, type TrackerStatusRpc } from "../hooks/use-ticket-statuses";

const REF_KEY = "o/r#91";
const REF = 91;
const POLL_MS = 30_000;

/** Mutable fake plugin cache behind a controllable rpc mock. */
function makeRpcMock() {
  const cache: Record<number, { kind: string; state: string }> = {
    [REF]: { kind: "pull", state: "OPEN" },
  };
  const resolvers: Array<(v: { statuses: Record<number, { kind: string; state: string }> }) => void> = [];
  const calls: Array<{ repo: string; numbers: number[] }> = [];
  const rpc: TrackerStatusRpc = {
    call: (_method, input) => {
      calls.push(input);
      return new Promise((resolve) => {
        resolvers.push((state) => resolve({ statuses: { ...state } }));
      });
    },
  };
  const settleAll = async (): Promise<void> => {
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve(cache);
    });
  };
  return { rpc, cache, calls, resolvers, settleAll };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useTicketStatuses refreshing behavior (issue #92)", () => {
  it("a cache state change between two ticks updates the statuses with the ref set unchanged", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await mock.settleAll();
    expect(result.current).toEqual({
      "o/r": { [REF]: { kind: "pull", state: "OPEN" } },
    });

    // The PR merges: only the cache changes, the ref set is identical.
    mock.cache[REF] = { kind: "pull", state: "MERGED" };

    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 5);
    });
    await mock.settleAll();
    expect(result.current).toEqual({
      "o/r": { [REF]: { kind: "pull", state: "MERGED" } },
    });
  });

  it("refetches when the window regains focus, ref set unchanged", async () => {
    const mock = makeRpcMock();
    renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await mock.settleAll();
    const callsAfterFirstFetch = mock.calls.length;

    mock.cache[REF] = { kind: "pull", state: "CLOSED" };
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await mock.settleAll();
    expect(mock.calls.length).toBe(callsAfterFirstFetch + 1);
  });

  it("an interval tick skips while a fetch is still in flight (no overlapping calls)", async () => {
    const mock = makeRpcMock();
    renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    expect(mock.calls.length).toBe(1);
    // Leave the first call unsettled; tick the interval.
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 5);
    });
    expect(mock.calls.length).toBe(1);
  });

  it("an empty ref set clears statuses and never calls the RPC", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: "" } },
    );
    expect(result.current).toEqual({});
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS + 5);
    });
    expect(mock.calls.length).toBe(0);
  });

  it("a visible-ref key change still refetches with the new refs (pre-existing behavior)", async () => {
    const mock = makeRpcMock();
    mock.cache[REF] = { kind: "pull", state: "MERGED" };
    const { rerender } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await mock.settleAll();
    expect(mock.calls[0]).toEqual({ repo: "o/r", numbers: [REF] });

    rerender({ k: "o/r#91,o/r#92" });
    await mock.settleAll();
    expect(mock.calls[1]).toEqual({ repo: "o/r", numbers: [91, 92] });
  });

  it("a key change back to the empty set clears statuses", async () => {
    const mock = makeRpcMock();
    const { rerender, result } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await mock.settleAll();
    expect(result.current).not.toEqual({});

    rerender({ k: "" });
    expect(result.current).toEqual({});
  });

  it("unmount stops the poll interval (no calls after cleanup)", async () => {
    const mock = makeRpcMock();
    const { unmount } = renderHook(
      ({ k }: { k: string }) => useTicketStatuses({ rpc: mock.rpc, visibleRefKey: k }),
      { initialProps: { k: REF_KEY } },
    );
    await mock.settleAll();
    const callsAtUnmount = mock.calls.length;
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(POLL_MS * 3);
    });
    expect(mock.calls.length).toBe(callsAtUnmount);
  });
});
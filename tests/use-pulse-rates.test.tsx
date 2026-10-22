// @vitest-environment jsdom
// The client half of the working-dot pulse (issue #279): one poll for the whole
// board's rate map, and nothing at all while the document is hidden. The cost
// bound the operator set lives here, so the behavior is pinned: no stacked
// calls, no fetch while hidden, no blink back to the base pulse when one poll
// fails.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { PULSE_RATE_POLL_MS, usePulseRates, type PulseRatesRpc } from "../hooks/use-pulse-rates";

type Answer = { rates: Record<string, number>; generatedAt: number };

function makeRpcMock() {
  const calls: Array<null> = [];
  const settle: Array<{
    resolve: (value: Answer) => void;
    reject: (error: unknown) => void;
  }> = [];
  const rpc: PulseRatesRpc = {
    call: (_method, input) => {
      calls.push(input);
      return new Promise<Answer>((resolve, reject) => settle.push({ resolve, reject }));
    },
  };
  const answerAll = async (answer: Answer): Promise<void> => {
    await act(async () => {
      for (const entry of settle.splice(0)) entry.resolve(answer);
    });
  };
  const rejectAll = async (error: unknown = new Error("transport")): Promise<void> => {
    await act(async () => {
      for (const entry of settle.splice(0)) entry.reject(error);
    });
  };
  return { rpc, calls, settle, answerAll, rejectAll };
}

/** Force `document.hidden` for a test, restoring on teardown. */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
}

beforeEach(() => {
  vi.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  setHidden(false);
});

describe("usePulseRates", () => {
  it("fetches once on mount and exposes the rates as a map", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(() => usePulseRates({ rpc: mock.rpc }));
    expect(mock.calls).toHaveLength(1);
    await mock.answerAll({ rates: { thr_a: 12.5 }, generatedAt: 1 });
    expect(result.current.get("thr_a")).toBe(12.5);
    expect(result.current.size).toBe(1);
  });

  it("polls on the interval", async () => {
    const mock = makeRpcMock();
    renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: {}, generatedAt: 1 });
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS + 5);
    });
    expect(mock.calls).toHaveLength(2);
  });

  it("fetches nothing while the document is hidden", async () => {
    const mock = makeRpcMock();
    setHidden(true);
    renderHook(() => usePulseRates({ rpc: mock.rpc }));
    expect(mock.calls).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS * 3);
    });
    expect(mock.calls).toHaveLength(0);
  });

  it("catches up on visibilitychange, then keeps polling", async () => {
    const mock = makeRpcMock();
    setHidden(true);
    renderHook(() => usePulseRates({ rpc: mock.rpc }));
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mock.calls).toHaveLength(1);
    await mock.answerAll({ rates: { thr_a: 1 }, generatedAt: 1 });
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS + 5);
    });
    expect(mock.calls).toHaveLength(2);
  });

  it("does not refetch on visibilitychange to hidden", async () => {
    const mock = makeRpcMock();
    renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: {}, generatedAt: 1 });
    const before = mock.calls.length;
    setHidden(true);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mock.calls).toHaveLength(before);
  });

  it("refetches on window focus", async () => {
    const mock = makeRpcMock();
    renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: {}, generatedAt: 1 });
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mock.calls).toHaveLength(2);
  });

  it("never stacks calls: a tick while one is in flight is skipped", async () => {
    const mock = makeRpcMock();
    renderHook(() => usePulseRates({ rpc: mock.rpc }));
    // The first call is deliberately left unsettled.
    expect(mock.calls).toHaveLength(1);
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS + 5);
    });
    expect(mock.calls).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mock.calls).toHaveLength(1);
  });

  it("keeps the last good rates when a poll fails", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: { thr_a: 7 }, generatedAt: 1 });
    expect(result.current.get("thr_a")).toBe(7);
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS + 5);
    });
    await mock.rejectAll();
    expect(result.current.get("thr_a")).toBe(7);
  });

  it("a poll that answers an empty map clears the rates honestly", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: { thr_a: 7 }, generatedAt: 1 });
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS + 5);
    });
    await mock.answerAll({ rates: {}, generatedAt: 2 });
    expect(result.current.size).toBe(0);
  });

  it("stops the interval and the listeners on unmount", async () => {
    const mock = makeRpcMock();
    const { unmount } = renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: {}, generatedAt: 1 });
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS * 3);
    });
    expect(mock.calls).toHaveLength(1);
  });

  it("keeps one stable map identity while the rates are unchanged", async () => {
    const mock = makeRpcMock();
    const { result } = renderHook(() => usePulseRates({ rpc: mock.rpc }));
    await mock.answerAll({ rates: { thr_a: 7 }, generatedAt: 1 });
    const first = result.current;
    await act(async () => {
      vi.advanceTimersByTime(PULSE_RATE_POLL_MS + 5);
    });
    await mock.answerAll({ rates: { thr_a: 7 }, generatedAt: 2 });
    // Same content: the identity must survive, or every poll would re-render
    // every card that reads a rate.
    expect(result.current).toBe(first);
  });
});

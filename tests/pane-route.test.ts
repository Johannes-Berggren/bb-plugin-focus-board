// The pane route effect's decision, as a pure map (lib/pane-route): every
// route settle the pane's URL can produce reads in one test.
import { describe, it, expect } from "vitest";
import { paneRouteAction } from "../lib/pane-route";

describe("pane route actions", () => {
  it("the echo of the board's own open push settles and keeps the capture", () => {
    expect(paneRouteAction("thr_a", "thr_a")).toEqual({ kind: "settle-open" });
  });

  it("a subPath the board did not push adopts the URL's thread", () => {
    expect(paneRouteAction("thr_a", "thr_b")).toEqual({ kind: "adopt", threadId: "thr_a" });
    expect(paneRouteAction("thr_a", null)).toEqual({ kind: "adopt", threadId: "thr_a" });
  });

  it("an external close (no pane in the URL, a push still pending) settles closed", () => {
    expect(paneRouteAction(null, "thr_a")).toEqual({ kind: "settle-close" });
  });

  it("a close push settles closed and releases the pin", () => {
    expect(paneRouteAction(null, null)).toEqual({ kind: "settle-close" });
  });
});
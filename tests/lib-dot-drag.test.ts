// The dot-drag mark: a drag the collapsed strip's dots started carries its
// own drag type so every NON-strip drop surface — column floors, column
// headers, card surfaces — can recognise and refuse it in one check. A dot
// drag never leaves the hierarchy (issue #249, goal 3): un-parking a member
// is the explicit morph gesture of a LATER cut, never a side effect of
// releasing over the floor.
//
// Kept beside the rank lib: lib/rank.ts already owns the drag-type
// conventions (RANK_DRAG_TYPE_PREFIX, DRAG_ID_KEY) this gesture rides.
import { describe, expect, it } from "vitest";
import { DOT_DRAG_TYPE, isDotDrag } from "../lib/rank";

describe("the dot-drag mark", () => {
  it("is a custom type name a browser may lowercase safely", () => {
    // Browsers lowercase custom drag type names; the constant must already
    // read as its own lowered form so the round trip is identity.
    expect(DOT_DRAG_TYPE).toBe(DOT_DRAG_TYPE.toLowerCase());
  });

  it("a dot drag's types carry the mark", () => {
    const types = ["text/focus-board-id", DOT_DRAG_TYPE];
    expect(isDotDrag(types)).toBe(true);
  });

  it("an ordinary card drag's or row drag's types do not carry it", () => {
    expect(
      isDotDrag(["application/x-focus-board-rank:idle:idle", "text/focus-board-id"]),
    ).toBe(false);
    expect(isDotDrag([])).toBe(false);
  });

  it("the mark gives no lane: any lane's isLaneDrag still refuses it", () => {
    // The type names no rank key, so isLaneDrag — the gate every floor and
    // card handler reads first — can never authorise a dot drag. The guard
    // is structural; the check pins the shape that keeps it true.
    expect(isDotDrag([DOT_DRAG_TYPE])).toBe(true);
    expect(typeof DOT_DRAG_TYPE.startsWith).toBe("function");
    expect(DOT_DRAG_TYPE.startsWith("application/x-focus-board-rank:")).toBe(false);
  });
});

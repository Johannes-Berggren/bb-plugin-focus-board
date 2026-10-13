// @vitest-environment jsdom
// The board-geometry reader behind the wallpaper viewport: the real panel
// box ([data-focus-board-panel]) becomes a fraction-space the preview paints
// at scale, with the visible lanes ([data-column-id]) and cards
// ([data-thread-card]) as translucent silhouettes. No layout is invented:
// everything comes from getBoundingClientRect at read time.
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { measureBoardGeometry, useBoardGeometry } from "../components/wallpaper-viewport";

afterEach(() => {
  cleanup();
  for (const leftover of Array.from(document.body.querySelectorAll("[data-focus-board-panel]"))) {
    leftover.remove();
  }
});

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left, top, width, height,
    right: left + width, bottom: top + height, x: left, y: top,
    toJSON: () => rect(left, top, width, height),
  } as DOMRect;
}

function stubRects(
  elements: Array<[Element, DOMRect]>,
): void {
  for (const [element, box] of elements) {
    Object.defineProperty(element, "getBoundingClientRect", { value: () => box, configurable: true });
  }
}

afterEach(cleanup);

describe("measureBoardGeometry (pure reader)", () => {
  it("reads the panel's aspect and lane/card rects as fractions of the panel box", () => {
    const panel = document.createElement("div");
    const laneA = document.createElement("div");
    laneA.setAttribute("data-column-id", "working");
    const laneB = document.createElement("div");
    laneB.setAttribute("data-column-id", "done");
    const card = document.createElement("div");
    card.setAttribute("data-thread-card", "thr_1");
    panel.append(laneA, laneB, card);
    stubRects([
      [panel, rect(10, 20, 200, 100)],
      [laneA, rect(10, 20, 100, 100)],
      [laneB, rect(110, 20, 100, 100)],
      [card, rect(20, 30, 80, 40)],
    ]);
    expect(measureBoardGeometry(panel)).toEqual({
      aspect: 2,
      lanes: [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { x: 0.5, y: 0, w: 0.5, h: 1 },
      ],
      cards: [{ x: 0.05, y: 0.1, w: 0.4, h: 0.4 }],
    });
  });

  it("returns null without a panel and for a zero-size panel", () => {
    expect(measureBoardGeometry(null)).toBeNull();
    const invisible = document.createElement("div");
    stubRects([[invisible, rect(0, 0, 0, 0)]]);
    expect(measureBoardGeometry(invisible)).toBeNull();
  });

  it("reads nothing when the panel paints no lanes or cards yet", () => {
    const panel = document.createElement("div");
    stubRects([[panel, rect(0, 0, 400, 300)]]);
    expect(measureBoardGeometry(panel)).toEqual({ aspect: 4 / 3, lanes: [], cards: [] });
  });
});

describe("useBoardGeometry (panel-backed hook)", () => {
  it("measures the mounted panel and re-measures on window resize", () => {
    const panel = document.createElement("div");
    panel.setAttribute("data-focus-board-panel", "");
    const lane = document.createElement("div");
    lane.setAttribute("data-column-id", "working");
    panel.append(lane);
    stubRects([[panel, rect(0, 0, 300, 150)], [lane, rect(0, 0, 300, 150)]]);
    document.body.append(panel);
    function Probe() {
      const geometry = useBoardGeometry();
      return <div data-testid="probe">{geometry === null ? "null" : JSON.stringify(geometry)}</div>;
    }
    const view = render(<Probe />);
    expect(JSON.parse(view.getByTestId("probe").textContent ?? "")).toEqual({
      aspect: 2,
      lanes: [{ x: 0, y: 0, w: 1, h: 1 }],
      cards: [],
    });
    // The window resize path re-measures: shrink the stubbed panel and fire.
    stubRects([[panel, rect(0, 0, 150, 150)], [lane, rect(0, 0, 150, 150)]]);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(JSON.parse(view.getByTestId("probe").textContent ?? "")).toEqual({
      aspect: 1,
      lanes: [{ x: 0, y: 0, w: 1, h: 1 }],
      cards: [],
    });
    panel.remove();
  });

  it("settles on null geometry when no panel exists (standalone surfaces)", () => {
    function Probe() {
      const geometry = useBoardGeometry();
      return <div data-testid="probe">{geometry === null ? "null" : "present"}</div>;
    }
    const view = render(<Probe />);
    expect(view.getByTestId("probe").textContent).toBe("null");
  });
});
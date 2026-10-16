// @vitest-environment jsdom
// The family card's nested child list grows with the family; past a handful
// of rows it must cap its height and scroll instead of stretching the card
// (and the whole lane) toward the sky. jsdom does no layout, so the tests
// pin the contract through the classes the cap is written with.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NESTED_ROWS_SCROLL_THRESHOLD, ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

const parent = thread({ id: "p", displayTitle: "Parent" });

function children(count: number) {
  return Array.from({ length: count }, (_, index) =>
    thread({ id: `c${index}`, parentThreadId: "p", displayTitle: `Child ${index}` }),
  );
}

function renderCard(rowCount: number) {
  render(
    <ThreadCard
      thread={parent}
      stateDot={null}
      isActive={false}
      isDone={false}
      childThreads={children(rowCount)}
      childCount={rowCount}
      onOpen={() => {}}
      onOpenThread={() => {}}
    />,
  );
}

function rowsContainer(): HTMLElement {
  const el = document.querySelector("[data-nested-rows]");
  if (!(el instanceof HTMLElement)) throw new Error("missing nested rows container");
  return el;
}

describe("the family card's nested child list", () => {
  afterEach(cleanup);

  it(`renders at natural height with ${NESTED_ROWS_SCROLL_THRESHOLD} rows or fewer`, () => {
    renderCard(NESTED_ROWS_SCROLL_THRESHOLD);
    const container = rowsContainer();
    expect(container.className).not.toContain("overflow-y-auto");
    expect(container.className).not.toContain("max-h-");
  });

  it("caps and scrolls the list when the family has more rows than the threshold", () => {
    renderCard(NESTED_ROWS_SCROLL_THRESHOLD + 1);
    const container = rowsContainer();
    expect(container.className).toContain("overflow-y-auto");
    expect(container.className).toContain("max-h-");
  });

  // The cap's inner scroll can rest between rows (a trackpad or wheel stop
  // lands mid-glyph), and when it does the first visible row reads sliced at
  // the container's top edge with no scrollbar to explain the cut (operator
  // report: "the selector still gets clipped"). Mandatory vertical snapping
  // pins every rest to a row's top, so the capped list never shows a cut row
  // where it rests. jsdom does no layout; the contract is again the classes.
  it("snaps its capped scroll to whole rows so the rest never slices a row", () => {
    renderCard(NESTED_ROWS_SCROLL_THRESHOLD + 1);
    expect(rowsContainer().className).toContain("snap-y");
    expect(rowsContainer().className).toContain("snap-mandatory");
    for (const li of rowsContainer().querySelectorAll(":scope > ul > li")) {
      expect(li.className).toContain("snap-start");
    }
    // The cap must stay the only rest constraint: a small family renders
    // natural height with no snap machinery at all.
    cleanup();
    renderCard(NESTED_ROWS_SCROLL_THRESHOLD);
    expect(rowsContainer().className).not.toContain("snap-y");
  });

  it("the capped sub-row tier snaps to whole rows the same way", () => {
    // (threshold + 1) grandchildren under one child = the sub-row tier caps.
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "The child" });
    const grandkids = children(NESTED_ROWS_SCROLL_THRESHOLD + 1).map((g) =>
      thread({
        id: `g-${g.id}`,
        parentThreadId: "c",
        displayTitle: `Grandchild ${g.id}`,
      }),
    );
    render(
      <ThreadCard
        thread={parent}
        stateDot={null}
        isActive={false}
        isDone={false}
        childThreads={[child]}
        grandchildThreadsByParent={new Map([["c", grandkids]])}
        onOpen={() => {}}
        onOpenThread={() => {}}
      />,
    );
    const subRows = document.querySelector("[data-child-sub-rows]");
    if (!(subRows instanceof HTMLElement)) throw new Error("missing sub-row container");
    expect(subRows.className).toContain("overflow-y-auto");
    expect(subRows.className).toContain("snap-y");
    expect(subRows.className).toContain("snap-mandatory");
    for (const li of subRows.querySelectorAll(":scope > li")) {
      expect(li.className).toContain("snap-start");
    }
  });
});

describe("the child rows' sub-row tier (issue #120)", () => {
  afterEach(cleanup);

  it("a child row nests its own children as indented sub-rows under it", () => {
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "The child" });
    const gc = thread({ id: "g1", parentThreadId: "c", displayTitle: "The grandchild" });
    render(
      <ThreadCard
        thread={parent}
        stateDot={null}
        isActive={false}
        isDone={false}
        childThreads={[child]}
        grandchildThreadsByParent={new Map([["c", [gc]]])}
        onOpen={() => {}}
        onOpenThread={() => {}}
      />,
    );
    const rows = rowsContainer();
    const subRows = document.querySelector("[data-child-sub-rows]");
    expect(subRows).not.toBeNull();
    // The sub-row lives under its parent row's container, not as a sibling
    // of it — the "New child thread…" promise on a child card.
    const childRow = rows.querySelector('[data-thread-card="c"]');
    expect(childRow).not.toBeNull();
    expect(childRow?.nextElementSibling?.contains(subRows as Node) ?? false).toBe(true);
    expect(rows.textContent).toContain("The grandchild");
    // The fold's count names what folding hides: rows plus their sub-rows.
    const toggle = document.querySelector('[aria-label="Collapse subthreads"]');
    expect(toggle?.textContent?.trim()).toBe("2 child threads");
  });

  it("a collapsed family folds the sub-row tier with the rest of the rows", () => {
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "The child" });
    const gc = thread({ id: "g1", parentThreadId: "c", displayTitle: "The grandchild" });
    render(
      <ThreadCard
        thread={parent}
        stateDot={null}
        isActive={false}
        isDone={false}
        isCollapsed
        childThreads={[child]}
        grandchildThreadsByParent={new Map([["c", [gc]]])}
        onOpen={() => {}}
        onOpenThread={() => {}}
      />,
    );
    expect(document.querySelector("[data-nested-rows]")).toBeNull();
    expect(document.querySelector("[data-child-sub-rows]")).toBeNull();
  });

  it("a childless child row renders no sub-row list", () => {
    renderCard(1);
    expect(document.querySelector("[data-child-sub-rows]")).toBeNull();
  });
});

// Issue #192: the family card's nested rows must respect the card's right
// gutter. The child-thread section indents its content 12px on the left
// (`ml-3`) but kept no right inset, so the rows' boxes (border included) ran
// flush against the card's right edge — 0px right inset against a 21px left
// inset — and the card's right gutter read as consumed. jsdom does no
// layout, so the contract is pinned through the section's mirrored margin
// classes.
describe("the family card's right gutter (issue #192)", () => {
  afterEach(cleanup);

  it("the child-thread section insets its rows on the right as it does on the left", () => {
    renderCard(2);
    const section = document.querySelector("[data-child-thread-section]");
    if (!(section instanceof HTMLElement)) throw new Error("missing child-thread section");
    expect(section.className).toContain("ml-3");
    expect(section.className).toContain("mr-3");
  });
});

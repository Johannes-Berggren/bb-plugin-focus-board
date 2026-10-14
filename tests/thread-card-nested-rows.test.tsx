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

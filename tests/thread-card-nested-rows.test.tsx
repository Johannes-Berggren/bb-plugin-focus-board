// @vitest-environment jsdom
// The family card's nested child list grows with the family; past a handful
// of rows it folds to a whole number of rows and hands the rest to a Show
// all control, instead of capping by pixels and scrolling (which sliced the
// last row and hid the rest behind an invisible scrollbar). jsdom does no
// layout, so the tests pin the contract through the rendered rows and the
// handle's markup.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { FAMILY_ROWS_BEFORE_FOLD, ThreadCard } from "../components/thread-card";
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

/** The child id of every rendered row, in render order (child rows and sub-rows alike). */
function rowThreadIds(): string[] {
  return Array.from(
    document.querySelectorAll("[data-nested-rows] a[data-thread-card]"),
  ).map((node) => node.getAttribute("data-thread-card") ?? "");
}

/** The rows list's Show all / Show fewer handle, or null when every row fits. */
function showAllHandle(): HTMLElement | null {
  const button = document.querySelector("[data-show-all-rows]");
  return button instanceof HTMLElement ? button : null;
}

describe("the family card's rows fold on whole rows", () => {
  // The fold replaces the old pixel cap (`max-h-64` + overflow scroll): a
  // pixel cap cannot end on a row boundary, so the list always sliced its
  // last row and hid the rest behind an invisible (overlay) scrollbar with
  // no affordance. The fold shows a whole number of rows and hands the rest
  // to a Show all control.
  afterEach(cleanup);

  it(`renders every row with ${FAMILY_ROWS_BEFORE_FOLD} rows or fewer, no handle`, () => {
    renderCard(FAMILY_ROWS_BEFORE_FOLD);
    expect(rowThreadIds()).toHaveLength(FAMILY_ROWS_BEFORE_FOLD);
    expect(showAllHandle()).toBeNull();
  });

  it("folds past the threshold: whole rows only, no pixel cap, and a Show all handle", () => {
    renderCard(FAMILY_ROWS_BEFORE_FOLD + 1);
    const container = rowsContainer();
    // No slicing is possible: the list carries no height cap and no scroll.
    expect(container.className).not.toContain("max-h-");
    expect(container.className).not.toContain("overflow-y-auto");
    expect(rowThreadIds()).toHaveLength(FAMILY_ROWS_BEFORE_FOLD);
    const handle = showAllHandle();
    expect(handle).not.toBeNull();
    expect(handle?.textContent).toContain(`Show all ${FAMILY_ROWS_BEFORE_FOLD + 1}`);
  });

  it("the handle reveals every row, then folds them back", () => {
    renderCard(FAMILY_ROWS_BEFORE_FOLD + 1);
    fireEvent.click(showAllHandle() as HTMLElement);
    expect(rowThreadIds()).toHaveLength(FAMILY_ROWS_BEFORE_FOLD + 1);
    expect(showAllHandle()?.textContent).toContain("Show fewer");
    fireEvent.click(showAllHandle() as HTMLElement);
    expect(rowThreadIds()).toHaveLength(FAMILY_ROWS_BEFORE_FOLD);
  });

  it("the fold budget spans both tiers: a child's own sub-rows count against it", () => {
    // One child with six sub-rows is seven rows: the fold shows the child and
    // four of its sub-rows, and the handle names all seven.
    const child = thread({ id: "c", parentThreadId: "p", displayTitle: "The child" });
    const grandkids = Array.from({ length: FAMILY_ROWS_BEFORE_FOLD + 1 }, (_, index) =>
      thread({
        id: `g${index}`,
        parentThreadId: "c",
        displayTitle: `Grandchild ${index}`,
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
    const ids = rowThreadIds();
    expect(ids).toHaveLength(FAMILY_ROWS_BEFORE_FOLD);
    expect(ids[0]).toBe("c");
    expect(showAllHandle()?.textContent).toContain(`Show all ${FAMILY_ROWS_BEFORE_FOLD + 2}`);
    fireEvent.click(showAllHandle() as HTMLElement);
    expect(rowThreadIds()).toHaveLength(FAMILY_ROWS_BEFORE_FOLD + 2);
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

// @vitest-environment jsdom
// Families are a projection: a live family's active card stays in its
// attention lane while its done portion renders as a second card — the
// family's projection card — in the Done column, with the done children
// nested under it. The projection card carries the Done treatment (dimmed)
// and refuses to join a Done sweep: it is not a done thread.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import { thread } from "./thread-fixture";

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

function renderAssembly(
  threads: PluginSidebarThread[],
  doneIds: ReadonlySet<string>,
  overrides: Partial<BoardProps> = {},
) {
  const assembly = assembleBoard(threads, "status", context, new Map(), doneIds, NOW);
  const props = {
    columns: assembly.columns,
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds,
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

function doneColumn(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-column-id="done"]');
  if (el === null) throw new Error("missing Done column");
  return el;
}

/** The family's projection card — the parent's card inside the Done column. */
function projectionCard(): HTMLElement {
  const el = doneColumn().querySelector<HTMLElement>('[data-thread-card="p"]');
  if (el === null) throw new Error("missing projection card");
  return el;
}

describe("the Done column's family projection card", () => {
  afterEach(cleanup);

  const parent = thread({ id: "p", displayTitle: "Family parent", updatedAt: NOW - 2 * 60 * 60 * 1000 });
  const doneChild = thread({
    id: "d",
    parentThreadId: "p",
    displayTitle: "Done child",
    updatedAt: NOW - 60 * 60 * 1000,
  });
  const doneIds = new Set(["d"]);

  it("renders the parent's card in the Done column with the done child nested under it", () => {
    renderAssembly([parent, doneChild], doneIds);
    const column = doneColumn();
    // The projection card is the parent's, and the child row lives inside it.
    expect(projectionCard().textContent).toContain("Family parent");
    expect(column.querySelector('[data-thread-card="d"]')).not.toBeNull();
    // The done child renders exactly once — as the nested row, never also as
    // a standalone Done card.
    expect(column.querySelectorAll('[data-thread-card="d"]').length).toBe(1);
  });

  it("the projection's done rows carry their own done sub-rows (issue #120)", () => {
    // The depth cap's sub-row tier reaches the Done space: a done child's
    // done grandchild renders as an indented sub-row under that child's row
    // inside the projection, never as a root-level Done sibling.
    const doneGc = thread({
      id: "g",
      parentThreadId: "d",
      displayTitle: "Done grandchild",
      updatedAt: NOW - 90 * 60 * 1000,
    });
    const doneIds = new Set(["d", "g"]);
    renderAssembly([parent, doneChild, doneGc], doneIds);
    const column = doneColumn();
    const rows = column.querySelector("[data-nested-rows]");
    expect(rows).not.toBeNull();
    expect(rows?.querySelector('[data-thread-card="d"]')).not.toBeNull();
    const subRows = column.querySelector("[data-child-sub-rows]");
    expect(subRows).not.toBeNull();
    expect(subRows?.querySelector('[data-thread-card="g"]')).not.toBeNull();
    expect(column.querySelectorAll('[data-thread-card="g"]').length).toBe(1);
  });

  it("carries the Done treatment (dimmed) like every other card in the column", () => {
    renderAssembly([parent, doneChild], doneIds);
    expect(projectionCard().className).toContain("opacity-50");
  });

  it("refuses to join a Done sweep: a projection card is not a done thread", () => {
    const onSweepToggle = vi.fn();
    renderAssembly([parent, doneChild], doneIds, {
      sweepCandidatesFor: () => [],
      armedSweep: { columnId: "done", threadIds: [] },
      onSweepArm: vi.fn(),
      onSweepDisarm: vi.fn(),
      onSweepToggle,
    });
    fireEvent.click(projectionCard().querySelector("a[draggable]") as HTMLElement);
    const refusal = document.querySelector('[data-testid="sweep-refusal"]');
    expect(refusal?.textContent ?? "").toContain("not a done thread");
    expect(onSweepToggle).not.toHaveBeenCalled();
  });
});

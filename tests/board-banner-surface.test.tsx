// @vitest-environment jsdom
// [REDWORK] Alert-banner surface contrast (issue #233). The board's banners
// (the rank refusal, the sweep notice, the browser reveal notice, the lane
// hide report, the pinned nest receipt, the sweep refusal) once painted
// translucent tinted surfaces (`bg-amber-500/10`, `bg-destructive/10`), so
// with a wallpaper behind the board the wallpaper showed through the very
// surface that carries the banner's text — with a photographic wallpaper the
// text becomes illegible (10% of the tint over a busy photo).
//
// The contract, matched on the context-menu popover's precedent (the menu
// moved to a full-strength surface, PR #221): EVERY banner surface is opaque
// in both themes — an opaque light surface and an opaque dark surface under
// the existing text colors — so the text carries its contrast on its own, not
// through luck of what sits behind the board. jsdom resolves no compiled CSS,
// so the assertions read the class tokens the surfaces are styled with: the
// opaque pair present, the translucent token gone.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import { buildColumns, type LaneHideOutcome } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

const HOUR = 3_600_000;

/** The opaque surface pair (light, dark) each banner family must style with,
 *  and the translucent token that must be gone from every banner. */
const SURFACE = {
  amber: {
    required: ["bg-amber-50", "dark:bg-amber-950"],
    translucent: "bg-amber-500/10",
  },
  destructive: {
    required: ["bg-red-50", "dark:bg-red-950", "dark:text-red-400"],
    translucent: "bg-destructive/10",
  },
};

function tokensOf(testId: string): string[] | null {
  const banner = document.querySelector(`[data-testid="${testId}"]`);
  if (!(banner instanceof HTMLElement)) return null;
  return banner.className.split(" ");
}

function expectOpaque(testId: string, family: keyof typeof SURFACE): void {
  const tokens = tokensOf(testId);
  expect(tokens, `banner ${testId} is not on screen`).not.toBeNull();
  for (const token of SURFACE[family].required) {
    expect(tokens, `banner ${testId} lacks its surface token ${token}`).toContain(token);
  }
  expect(tokens, `banner ${testId} still styles its surface with the translucent ${SURFACE[family].translucent}`).not.toContain(
    SURFACE[family].translucent,
  );
}

function renderBoard(threads: PluginSidebarThread[], overrides: Partial<BoardProps> = {}) {
  const props = {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<string, readonly PluginSidebarThread[]>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    rankStore: {},
    onRankMove: vi.fn(),
    onDropDone: vi.fn(),
    onDropUnread: vi.fn(),
    onDropPinned: vi.fn(),
    menuActionsFor: () => [],
    ...overrides,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

/** The ranked slot element a card renders inside — zone math lives here. */
function cardSlot(id: string): HTMLElement {
  const slot = document.querySelector(`[data-rank-slot="${id}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing rank slot ${id}`);
  return slot;
}

/** The card's draggable anchor (board-reparent suite's selector). */
function cardAnchor(id: string): HTMLElement {
  const anchor = document.querySelector(`[data-thread-card="${id}"] a[draggable]`);
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${id}`);
  return anchor;
}

/** jsdom rects are 0×0; give the slot a 300px-tall box so thirds are real. */
function withRect(slot: HTMLElement, height = 300): void {
  slot.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 100, bottom: height, width: 100, height }) as DOMRect;
}

/**
 * The full drag of `fromId` onto `targetId`'s slot at `clientY` (forced:
 * jsdom applies no clientY to drag events), the board-reparent suite's
 * gesture.
 */
function dragOnto(fromId: string, targetId: string, clientY: number): void {
  const payload = new Map<string, string>();
  const types: string[] = [];
  const transfer = {
    get types() {
      return [...types];
    },
    setData(type: string, value: string) {
      if (!types.includes(type)) types.push(type);
      payload.set(type, value);
    },
    getData(type: string) {
      return payload.get(type) ?? "";
    },
    effectAllowed: "move",
    dropEffect: "none",
  };
  fireEvent.dragStart(cardAnchor(fromId), { dataTransfer: transfer });
  const slot = cardSlot(targetId);
  withRect(slot);
  const over = createEvent.dragOver(slot, { dataTransfer: transfer });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(slot, over);
  const drop = createEvent.drop(slot, { dataTransfer: transfer });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(slot, drop);
}

function hideButtons(): HTMLElement[] {
  return [...document.querySelectorAll("[data-hide-lane]")].filter(
    (el): el is HTMLElement => el instanceof HTMLElement,
  );
}

describe("every alert banner carries an opaque surface in both themes", () => {
  it("the sweep notice paints an opaque surface (no translucent tint)", () => {
    renderBoard([thread({ id: "thr_a", updatedAt: NOW - HOUR })], {
      sweepNotice: { message: "Sweep archived 3 threads from Working." },
      onDismissSweepNotice: () => {},
    });
    expectOpaque("sweep-notice", "amber");
  });

  it("the browser reveal notice paints an opaque surface (no translucent tint)", () => {
    renderBoard([thread({ id: "thr_a", updatedAt: NOW - HOUR })], {
      browserNotice: { message: 'No controlled browser tab belongs to the thread "Test thread".' },
      onDismissBrowserNotice: () => {},
    });
    expectOpaque("browser-reveal-notice", "amber");
  });

  it("the lane hide report paints an opaque surface (no translucent tint)", () => {
    renderBoard(
      [
        thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - HOUR }),
        thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2 * HOUR }),
      ],
      {
        groupBy: "project",
        columns: buildColumns(
          [
            thread({ id: "thr_a", projectId: "p1", updatedAt: NOW - HOUR }),
            thread({ id: "thr_b", projectId: "p2", updatedAt: NOW - 2 * HOUR }),
          ],
          "project",
          { projects: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }], providers: [] },
          new Map(),
          new Set<string>(),
          NOW,
          {},
        ),
        projectNameFor: () => "",
        statusFor: () => null,
        onHideLane: (): LaneHideOutcome => ({ kind: "hidden" }),
      },
    );
    const button = hideButtons()[0];
    fireEvent.click(button);
    fireEvent.click(button);
    expectOpaque("lane-hide-notice", "amber");
  });

  it("the pinned nest receipt paints an opaque surface (no translucent tint)", async () => {
    const onReparent = vi.fn().mockResolvedValue(undefined);
    renderBoard([
      thread({ id: "thr_a", isPinned: true, updatedAt: NOW - 2 * HOUR }),
      thread({ id: "thr_b", isPinned: true, updatedAt: NOW - HOUR }),
    ], { onReparent });
    // The middle third of thr_b's slot nests thr_a under it; the pinned
    // child keeps its own card, so the receipt posts (invisible-placement
    // contract, app-pin-drag-rank suite's shape).
    dragOnto("thr_a", "thr_b", 150);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-testid="nest-notice"]')).not.toBeNull();
    });
    expectOpaque("nest-notice", "amber");
  });

  it("the rank refusal paints an opaque surface (no translucent tint)", () => {
    renderBoard([thread({ id: "thr_a", updatedAt: NOW - HOUR })]);
    // The card's own slot: every edge resolves to no move, and the board
    // refuses loudly (reportRefusal).
    dragOnto("thr_a", "thr_a", 60);
    const banner = document.querySelector('[data-testid="rank-error-banner"]');
    expect(banner).not.toBeNull();
    expectOpaque("rank-error-banner", "destructive");
  });

  it("the sweep refusal paints an opaque surface (no translucent tint)", () => {
    // The Done column's family projection card refuses a sweep toggle: not a
    // done thread (done-projection suite's shape).
    const parent = thread({ id: "p", displayTitle: "Family parent", updatedAt: NOW - 2 * HOUR });
    const doneChild = thread({
      id: "d",
      parentThreadId: "p",
      displayTitle: "Done child",
      updatedAt: NOW - HOUR,
    });
    const assembly = assembleBoard([parent, doneChild], "status", context, new Map(), new Set(["d"]), NOW);
    renderBoard([parent, doneChild], {
      columns: assembly.columns,
      nestedChildrenByParent: assembly.nestedChildrenByParent,
      doneChildrenByParent: assembly.doneChildrenByParent,
      childCountByParent: assembly.childCountByParent,
      sweepCandidatesFor: () => [],
      armedSweep: { columnId: "done", threadIds: [] },
      onSweepArm: vi.fn(),
      onSweepDisarm: vi.fn(),
      onSweepToggle: vi.fn(),
    });
    const projection = document
      .querySelector('[data-column-id="done"]')
      ?.querySelector<HTMLElement>('[data-thread-card="p"] a[draggable]');
    expect(projection).not.toBeNull();
    fireEvent.click(projection as HTMLElement);
    expectOpaque("sweep-refusal", "destructive");
  });
});
// @vitest-environment jsdom
// The reported gestures (issues #219, 2026-10-15/16): pinned cards dragged
// over other pinned cards behaved incoherently — a self-anchored no-op here,
// an invisible re-parent there, a jump on a third release. The full app runs
// here (real app.tsx against the fake host), so the menu-pin's deferred
// write, the attention machinery, and the drop's RPC all pass through the
// production paths. jsdom does not apply `clientY` to drag events, so each
// event's Y is forced onto its own object (the board-reparent suite's
// pattern), and the slots get stubbed 300px rects so the zone thirds are
// real: top third reorders above, middle third nests (with a receipt when
// the placement rules keep the child's card on its own), bottom third
// reorders below.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
  seedFakeThreads,
  seedFakeRanks,
  fakeRankOrders,
  fakeRpcCalls,
  resetFakeRpcCalls,
  stubRankMoveFailure,
  landWrites,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Protected-mode payload stand-in (jsdom has no DataTransfer): types
 *  readable throughout, getData dark until the drop/dragend phase. */
function protectedTransfer(): {
  transfer: DataTransferLike;
  read: () => void;
  write: () => void;
} {
  const payload = new Map<string, string>();
  const types: string[] = [];
  const reading = { on: false };
  const transfer = {
    get types() {
      return [...types];
    },
    setData(type: string, value: string) {
      if (!types.includes(type)) types.push(type);
      payload.set(type, value);
    },
    getData(type: string) {
      return reading.on ? (payload.get(type) ?? "") : "";
    },
    effectAllowed: "move",
    dropEffect: "none",
    setDragImage: () => {},
  } as unknown as DataTransferLike;
  return {
    transfer,
    // drop/dragend phase
    read: () => { reading.on = true; },
    // after dragstart, before drop
    write: () => { reading.on = false; },
  };
}

interface DataTransferLike {
  readonly types: string[];
  setData(type: string, value: string): void;
  getData(type: string): string;
  effectAllowed: string;
  dropEffect: string;
}

/** jsdom rects are 0×0; give the slot a 300px-tall box so thirds are real. */
function stubSlotRects(): void {
  for (const slot of document.querySelectorAll("li[data-rank-slot]")) {
    if (!(slot instanceof HTMLElement)) continue;
    slot.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 300, bottom: 300, width: 300, height: 300 }) as DOMRect;
  }
}

function fixtureThreads() {
  const now = Date.now();
  const t = (
    id: string,
    displayTitle: string,
    patch: Partial<{
      isPinned: boolean;
      parentThreadId: string | null;
      updatedAt: number;
    }> = {},
  ) => ({
    id,
    status: "idle",
    isUnread: false,
    isArchived: false,
    isHidden: false,
    hasPendingInteraction: false,
    projectId: "proj_a",
    providerId: "pi",
    displayTitle,
    updatedAt: now - 2 * HOUR,
    ...patch,
  });
  return [
    // Pinned lane members: pin_new (newest, the lane's head), then the
    // family parent, then pin_old.
    t("thr_pin_new", "Pinned newest", { isPinned: true, updatedAt: now - 1 * HOUR }),
    t("thr_pin_old", "Pinned older", { isPinned: true, updatedAt: now - 6 * HOUR }),
    // The family parent the operator pins mid-session, and its live children.
    t("thr_family", "Family parent", { updatedAt: now - 3 * HOUR }),
    t("thr_family_c1", "Family child one", { parentThreadId: "thr_family", updatedAt: now - 3 * HOUR }),
    t("thr_family_c2", "Family child two", { parentThreadId: "thr_family", updatedAt: now - 4 * HOUR }),
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeRanks({});
  resetFakeRpcCalls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Top-level card ids in a column, in displayed order. */
function columnCardIds(columnId: string): string[] {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (section === null) return [];
  const slots = [...section.querySelectorAll("li[data-rank-slot]")];
  return slots.map((slot) => slot.getAttribute("data-rank-slot") ?? "");
}

/** The card's draggable anchor — the element a native drag starts on. */
function rankAnchor(threadId: string): HTMLElement {
  const anchor = document.querySelector(
    `li[data-rank-slot="${threadId}"] a[draggable]`,
  );
  if (anchor === null) throw new Error(`missing ranked anchor for ${threadId}`);
  return anchor as HTMLElement;
}

/** Pin thr_family via its card menu (the deferred write), land it, stub rects. */
async function pinTheFamilyParent(): Promise<string[]> {
  const familyCard = document.querySelector('[data-thread-card="thr_family"]');
  if (familyCard === null) throw new Error("family parent card not found");
  fireEvent.contextMenu(familyCard as HTMLElement);
  const pinItem = await waitFor(() => {
    const items = [...document.querySelectorAll("button")].filter(
      (button) => button.textContent?.trim() === "Pin",
    );
    expect(items.length).toBeGreaterThan(0);
    return items[0];
  });
  fireEvent.click(pinItem);
  await act(async () => {
    landWrites();
  });
  await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_family"));
  stubSlotRects();
  return columnCardIds("pinned");
}

/**
 * The whole drag of thr_family onto `targetId`'s slot at `clientY` on the
 * stubbed 300px box: top third = above it, middle = nest zone, bottom third
 * = below it. jsdom ignores clientY on drag events; force it.
 */
function dragFamilyOnto(targetId: string, clientY: number): void {
  const familyAnchor = rankAnchor("thr_family");
  const slot = document.querySelector(`li[data-rank-slot="${targetId}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing slot ${targetId}`);
  const { transfer, read, write } = protectedTransfer();
  // dragstart may read back what it wrote; mid-flight the payload is dark.
  read();
  fireEvent.dragStart(familyAnchor, { dataTransfer: transfer });
  expect([...transfer.types].some((type) => type.includes("focus-board-rank"))).toBe(true);
  write();
  const over = createEvent.dragOver(slot, { dataTransfer: transfer });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(slot, over);
  read();
  const drop = createEvent.drop(slot, { dataTransfer: transfer });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(slot, drop);
  fireEvent.dragEnd(familyAnchor, { dataTransfer: transfer });
}

/** The attention the pointer carries: mouseEnter on the card's container. */
function hoverCard(threadId: string): void {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId} to hover`);
  fireEvent.mouseEnter(card as HTMLElement);
}

/** The board must rest at this order across renders, not just one. */
async function expectStays(expected: readonly string[]): Promise<void> {
  for (const wait of [30, 120, 250]) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, wait));
    });
    const now = columnCardIds("pinned");
    console.log(
      `STAYS@${wait}ms pinned=${JSON.stringify(now)} ranks=${JSON.stringify(fakeRankOrders())} rpc=${JSON.stringify(
        fakeRpcCalls().filter((c) => c.method === "rank_move" || c.method === "thread_reparent").map((c) => `${c.method} ${JSON.stringify(c.args ?? {})}`),
      )}`,
    );
    expect(now).toEqual([...expected]);
  }
}

/**
 * The whole drag of `fromId`'s card onto `targetId`'s slot at `clientY` on
 * the stubbed 300px box (any card, not just the family).
 */
function dragCardOnto(fromId: string, targetId: string, clientY: number): { dropAllowed: boolean; over: boolean } {
  const sourceAnchor = rankAnchor(fromId);
  const slot = document.querySelector(`li[data-rank-slot="${targetId}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing slot ${targetId}`);
  const { transfer, read, write } = protectedTransfer();
  read();
  fireEvent.dragStart(sourceAnchor, { dataTransfer: transfer });
  expect([...transfer.types].some((type) => type.includes("focus-board-rank"))).toBe(true);
  write();
  const over = createEvent.dragOver(slot, { dataTransfer: transfer });
  Object.defineProperty(over, "clientY", { value: clientY });
  fireEvent(slot, over);
  read();
  const drop = createEvent.drop(slot, { dataTransfer: transfer });
  Object.defineProperty(drop, "clientY", { value: clientY });
  fireEvent(slot, drop);
  fireEvent.dragEnd(sourceAnchor, { dataTransfer: transfer });
  return { dropAllowed: drop.defaultPrevented, over: over.defaultPrevented };
}

describe("pinned cards dragged over other pinned cards", () => {
  it("a release on the card directly above's bottom third refuses loudly (own slot)", async () => {
    // The report's exact shape: T14 sits directly below Overview; every
    // release on Overview's lower band resolves to the card's own slot. The
    // shipped product wrote a self-anchored rank_move here (nothing moved,
    // nothing said); the shipped convention that replaced it jumped the card
    // ABOVE the hover — the flip-flop. The band refuses with a banner now.
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();
    expect(columnCardIds("pinned")).toEqual(["thr_pin_new", "thr_family", "thr_pin_old"]);

    const drag2 = dragFamilyOnto("thr_pin_new", 250);

    await vi.waitFor(() => {
      expect(document.body.textContent).toMatch(/resolved to no move/);
    });
    expect(columnCardIds("pinned")).toEqual(["thr_pin_new", "thr_family", "thr_pin_old"]);
    expect(fakeRankOrders()["pinned"]).toBeUndefined();
    // No write of any kind: the gesture resolved to no move.
    expect(fakeRpcCalls().map((call) => call.method)).not.toContain("rank_move");
    expect(fakeRpcCalls().map((call) => call.method)).not.toContain("thread_reparent");
  });

  it("a release on the card directly above's top third takes its slot (to the top)", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();

    dragFamilyOnto("thr_pin_new", 60);

    // The family parent leads the Pinned lane (the report's "top position").
    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_family")).toBe(0));
    expect(fakeRankOrders()["pinned"]).toContain("thr_family");
    expect(fakeRpcCalls().map((call) => call.method)).toContain("rank_move");
  });

  it("a release on the card directly below's bottom third lands below it (the down card lands)", async () => {
    // The report's other shape: T14 ABOVE Overview, dragged DOWN. The
    // release on Overview's bottom band anchors on the card below Overview —
    // or, when Overview is the lane's tail, appends — and the card lands
    // directly below Overview.
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();

    dragFamilyOnto("thr_pin_old", 250);

    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_family")).toBe(2));
    expect(fakeRankOrders()["pinned"]).toEqual(["thr_pin_new", "thr_pin_old", "thr_family"]);
    expect(fakeRpcCalls().map((call) => call.method)).toContain("rank_move");
  });

  it("a middle-third drop of a pinned card onto a pinned card nests, with a receipt", async () => {
    // The follow-up report: the operator nests pinned families deliberately
    // (dropping the card on the hovered card's face). The nest zone stays
    // offered for every legal pair — and the placement rules keep the
    // pinned child's card on its own card, so the write's receipt posts
    // visibly and names the undo.
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();

    dragFamilyOnto("thr_pin_new", 150);

    await waitFor(() =>
      expect(fakeRpcCalls().map((call) => call.method)).toContain("thread_reparent"),
    );
    expect(fakeRpcCalls().map((call) => call.method)).not.toContain("rank_move");
    await vi.waitFor(() => {
      const notice = document.querySelector('[data-testid="nest-notice"]');
      expect(notice).not.toBeNull();
      expect(notice!.textContent).toMatch(/pinned card/);
      expect(notice!.textContent).toMatch(/Make Top-Level/);
    });
  });

  it("a solo drag's rank_move payload is plain JSON: no unitIds member at all", async () => {
    // Issue #240: onRankMove built the args with
    // `unitIds: ... ? [...unitIds] : undefined` — an object literal member
    // SET to undefined, which is an own property whose value JSON has no
    // equivalent. The host's input validation walks it as a JSON value and
    // rejects: "rpc input at $input.unitIds is not a JSON value" — so every
    // SOLO drag was rejected at the bridge while boxed drags (real arrays)
    // passed. The payload must omit the member entirely when there is no
    // unit.
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();
    resetFakeRpcCalls();

    // The family is a solo card in the pinned lane (pinned members never
    // box); its drag to the head's top half is an ordinary solo rank_move.
    hoverCard("thr_family");
    dragCardOnto("thr_family", "thr_pin_new", 60);

    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_family")).toBe(0));
    const moves = fakeRpcCalls().filter((call) => call.method === "rank_move");
    expect(moves.length).toBe(1);
    const args = moves[0]!.args as Record<string, unknown>;
    expect(Object.keys(args)).not.toContain("unitIds");
    // And the write is JSON through and through (the host's walk).
    expect(JSON.parse(JSON.stringify(args))).toEqual(args);
    expect(document.querySelector('[data-testid="rank-save-error"]')).toBeNull();
  });

  it("the fake host serves seeded rank orders through rank_list", async () => {
    // The fixture's contract: rank_list returns the seeded store, exactly
    // what a real host refetch returns. A duplicate `case "rank_list"` label
    // made the seeded branch unreachable and the app render recency order
    // instead; a seeded order deviating from recency fails on that copy.
    seedFakeRanks({ pinned: ["thr_pin_old", "thr_pin_new"] });
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toEqual(["thr_pin_old", "thr_pin_new"]));
  });
  it("a card the pointer hovers drags, lands, and a second card beneath it lands without snapping back", async () => {
    // Issue #232, the live report's order: a first drag to the top lands and
    // sticks; the next card under it is dragged the same way and, on the
    // operator's board, showed the landing briefly then fell back. The
    // pointer rests on each card before and after the drop (the hover the
    // attention freeze captures), so this drives the freeze and the rank
    // write in the same turn.
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();
    await expectStays(["thr_pin_new", "thr_family", "thr_pin_old"]);

    // First drag: the family (the middle card) onto the lane head's top
    // half — it takes the top slot and must stick.
    hoverCard("thr_family");
    dragCardOnto("thr_family", "thr_pin_new", 60);
    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_family")).toBe(0));
    await expectStays(["thr_family", "thr_pin_new", "thr_pin_old"]);

    // Second drag: the next card under the first (thr_pin_new) onto the
    // first card's face top half — its landing is the lane head.
    hoverCard("thr_pin_new");
    dragCardOnto("thr_pin_new", "thr_family", 60);
    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_pin_new")).toBe(0));
    await expectStays(["thr_pin_new", "thr_family", "thr_pin_old"]);
  });

  it("a rejected rank_move surfaces the rejection instead of silently reverting", async () => {
    // Issue #232: the operator's host served rank RPCs from a foreign
    // plugin instance whose server rejected rank_move ("rpc input
    // validation failed", logged twice at the operator's drags). The
    // board's failure path `.catch(() => refetchRanks())` reverted the
    // optimistic landing with NO message — the card showed its landing
    // briefly, then fell back, and the operator could not tell a write was
    // lost. The rejection must surface.
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    await pinTheFamilyParent();
    stubRankMoveFailure("rpc input validation failed");
    resetFakeRpcCalls();
    try {
      hoverCard("thr_pin_old");
      dragCardOnto("thr_pin_old", "thr_pin_new", 60);

      await vi.waitFor(() => {
        expect(document.body.textContent).toMatch(/rpc input validation failed/);
      });
      // The rejection reached the host: the rpc went out, and the failure
      // is the banner, not a silent revert.
      expect(fakeRpcCalls().map((call) => call.method)).toContain("rank_move");
      // The banner paints the full-strength destructive pair (the #234
      // contract), never the translucent tint.
      const banner = document.querySelector('[data-testid="rank-save-error"]');
      expect(banner).not.toBeNull();
      const tokens = (banner as HTMLElement).className.split(" ");
      for (const token of ["bg-red-50", "dark:bg-red-950", "dark:text-red-400"]) {
        expect(tokens).toContain(token);
      }
      expect(tokens).not.toContain("bg-destructive/10");
    } finally {
      stubRankMoveFailure(null);
    }
  });
});

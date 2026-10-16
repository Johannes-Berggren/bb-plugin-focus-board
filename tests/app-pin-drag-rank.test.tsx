// @vitest-environment jsdom
// The reported gesture (2026-10-15): a family parent is PINNED (the card
// menu's Pin), it lands in the Pinned lane, the operator then drags it to the
// TOP of that lane — and the drop appears to do nothing until the board is
// reloaded. The defect this pins: a release on the top card's MIDDLE third is
// the nest zone, and for the newly pinned card the nest write renders
// invisibly (a pinned child stands alone) — the reorder never happens and no
// refusal announces, while the write re-parents the card silently. The full
// app runs here (real app.tsx against the fake host), so the menu-pin's
// deferred write, the attention machinery, and the drop's RPC all pass
// through the production paths.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
  seedFakeThreads,
  seedFakeRanks,
  fakeRankOrders,
  fakeRpcCalls,
  resetFakeRpcCalls,
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

/** 300px slot boxes so the zone thirds (top/middle/bottom) are real. */
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
    // Pre-pinned lane members: one older, one newer (recency order = new first).
    t("thr_pin_new", "Pinned newest", { isPinned: true, updatedAt: now - 1 * HOUR }),
    t("thr_pin_old", "Pinned older", { isPinned: true, updatedAt: now - 5 * HOUR }),
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

/**
 * Pin thr_family from its card menu (the deferred host write), land the
 * write, and return the pinned lane's order.
 */
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

/** The whole drag onto `targetId`'s slot at `clientY` (rects are stubbed). */
function dragFamilyOnto(targetId: string, clientY: number): void {
  const familyAnchor = rankAnchor("thr_family");
  const { transfer, read, write } = protectedTransfer();
  // dragstart may read back what it wrote; mid-flight the payload is dark.
  read();
  fireEvent.dragStart(familyAnchor, { dataTransfer: transfer });
  expect([...transfer.types].some((type) => type.includes("focus-board-rank"))).toBe(true);
  write();
  const slot = document.querySelector(`li[data-rank-slot="${targetId}"]`);
  if (!(slot instanceof HTMLElement)) throw new Error(`missing slot ${targetId}`);
  slot.getBoundingClientRect = () =>
    ({ top: 0, left: 0, right: 300, bottom: 300, width: 300, height: 300 }) as DOMRect;
  const point = {
    bubbles: true,
    cancelable: true,
    dataTransfer: transfer,
    clientX: 50,
    clientY,
  };
  fireEvent.dragOver(slot, point);
  read();
  fireEvent.drop(slot, point);
  fireEvent.dragEnd(familyAnchor, { dataTransfer: transfer });
}

describe("a newly pinned family parent dragged to the top of the Pinned lane", () => {
  it("a drop on the top card's middle third reorders instead of a silent nest", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    const before = await pinTheFamilyParent();
    const topCardId = before.find((id) => id !== "thr_family");
    expect(topCardId).toBeDefined();

    // y=150 of a 300px box: the middle third — the nest zone. For a card
    // whose nest renders invisibly (a pinned child stands alone), this drop
    // must rank, not re-parent.
    dragFamilyOnto(topCardId as string, 150);

    // The drop must rank, never re-parent: the pinned child's nest renders
    // invisibly, so the zone reads as the edge split and the reorder lands.
    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_family")).toBe(0));
    expect(fakeRankOrders()["pinned"]).toContain("thr_family");
    expect(
      fakeRpcCalls()
        .filter((call) => call.method === "rank_move" || call.method === "thread_reparent")
        .map((call) => call.method),
    ).toEqual(["rank_move"]);
  });

  it("a drop on the top card's top third writes the rank and leads the lane", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);
    await waitFor(() => expect(columnCardIds("pinned")).toContain("thr_pin_new"));
    const before = await pinTheFamilyParent();
    const topCardId = before.find((id) => id !== "thr_family");

    dragFamilyOnto(topCardId as string, 60);

    await waitFor(() => expect(columnCardIds("pinned").indexOf("thr_family")).toBe(0));
    expect(fakeRankOrders()["pinned"]).toContain("thr_family");
  });
});
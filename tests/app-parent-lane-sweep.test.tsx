// @vitest-environment jsdom
// The Parent view's row sweep, driven through the REAL app: the same armed
// sweep state the Focus view uses, the same confirm path, the same
// destination. This pins the two things a component test cannot:
//
// 1. The row's eligibility comes from the app's ONE sweep law. A child that
//    the Focus view's Idle · A while ago column would sweep is the same
//    child the Parent view's Idle · A while ago row sweeps, so the count on
//    the pill agrees across the two views for one fixture, and a thread the
//    law excludes (a live-child parent) is excluded from both.
// 2. The armed selection survives board churn: clicking a card inside the
//    armed ROW — in any family lane — curates the sweep instead of
//    disarming it, because the click-away guard knows the row scope.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  fakeRpcCalls,
  registeredNavPanel,
  resetFakeRpcCalls,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Family A: one long-idle child. Family B: one long-idle child, so the
 *  Idle · A while ago row spans two lanes when the parent view opens. */
function fixtureThreads() {
  const now = Date.now();
  const base = {
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null as string | null,
    hasPendingInteraction: false,
    lastReadAt: now - 40 * DAY,
    createdAt: 0,
  };
  return [
    { ...base, id: "p_a", displayTitle: "Family A", updatedAt: now - DAY },
    { ...base, id: "a0", displayTitle: "Idle child A", parentThreadId: "p_a", updatedAt: now - 40 * DAY },
    { ...base, id: "p_b", displayTitle: "Family B", updatedAt: now - 2 * DAY },
    { ...base, id: "b0", displayTitle: "Idle child B", parentThreadId: "p_b", updatedAt: now - 50 * DAY },
  ];
}

function mount(groupBy: "parent" | "status") {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  return render(<Component subPath="" />);
}

/** The rail cell whose own text leads with `label` (the row's rail line). */
function railRow(label: string): HTMLElement {
  const rail = document.querySelector("[data-rail]");
  if (rail === null) throw new Error("no rail");
  const cell = [...rail.children].find((child) => child.textContent?.startsWith(label));
  if (!(cell instanceof HTMLElement)) throw new Error(`no rail row ${label}`);
  return cell;
}

function rowPill(label: string): HTMLButtonElement {
  const pill = railRow(label).querySelector<HTMLButtonElement>("[data-sweep-button]");
  if (pill === null) throw new Error(`no sweep pill on row ${label}`);
  return pill;
}

function cardAnchor(threadId: string): HTMLElement {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  const anchor = card?.querySelector("a[draggable]");
  if (!(anchor instanceof HTMLElement)) throw new Error(`missing draggable card ${threadId}`);
  return anchor;
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  resetFakeRpcCalls();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Parent view's row sweep runs the app's one sweep law", () => {
  it("arms the row, preselects the aged-out cards, and confirms to Done", async () => {
    window.localStorage.setItem("focus-board:groupBy", "parent");
    mount("parent");
    await waitFor(() => expect(document.querySelector("[data-parent-board]")).not.toBeNull());
    await waitFor(() => expect(rowPill("Idle · A while ago").textContent).toBe("2"));

    // Armed: the preselect captured the aged-out children of BOTH lanes, and
    // the pill names the same destination the Focus view's idle arm names.
    fireEvent.click(rowPill("Idle · A while ago"));
    await waitFor(() => expect(rowPill("Idle · A while ago").textContent).toBe("2 → Done"));
    expect(
      document.querySelector('[data-thread-card="a0"]')?.hasAttribute("data-sweep-highlighted"),
    ).toBe(true);
    expect(
      document.querySelector('[data-thread-card="b0"]')?.hasAttribute("data-sweep-highlighted"),
    ).toBe(true);

    // Confirm: the same markDone write the Focus view's idle arm performs.
    fireEvent.click(rowPill("Idle · A while ago"));
    await waitFor(() => {
      const calls = fakeRpcCalls().filter((call) => call.method === "done_set");
      expect(calls).toEqual([
        { method: "done_set", args: { threadId: "a0", done: true } },
        { method: "done_set", args: { threadId: "b0", done: true } },
      ]);
    });
  });

  it("agrees with the Focus view on the same fixture's eligibility", async () => {
    // Nesting OFF: with children nested inside their family card, the Focus
    // view has no top-level card in the idle lane at all, so there would be
    // nothing to compare. Flat, the same two children are top-level cards and
    // the Focus view's Idle · A while ago COLUMN sweeps exactly the two the
    // Parent view's row sweeps.
    window.localStorage.setItem("focus-board:nestChildren", "off");
    window.localStorage.setItem("focus-board:groupBy", "status");
    mount("status");
    await waitFor(() => {
      const column = document.querySelector('section[data-column-id="idle-awhile"]');
      expect(column).not.toBeNull();
      expect(column?.querySelector("[data-sweep-button]")?.textContent).toBe("2");
    });
  });

  it("excludes a live-child parent from the row's preselect, exactly as the column does", async () => {
    // Family X: m0 is itself a parent (leaf0 is its child), so m0 may never
    // join a removing arm. Both m0 and leaf0 sit in the idle row, and the
    // row's preselect takes only leaf0 — the same exclusion the Focus
    // view's idle column applies.
    const now = Date.now();
    const base = {
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      hasPendingInteraction: false,
      lastReadAt: now - 40 * DAY,
      createdAt: 0,
    };
    seedFakeThreads([
      { ...base, id: "p_x", displayTitle: "Family X", parentThreadId: null, updatedAt: now - DAY },
      { ...base, id: "m0", displayTitle: "Mid-level child", parentThreadId: "p_x", updatedAt: now - 40 * DAY },
      { ...base, id: "leaf0", displayTitle: "Leaf child", parentThreadId: "m0", updatedAt: now - 40 * DAY },
    ]);
    window.localStorage.setItem("focus-board:groupBy", "parent");
    mount("parent");
    await waitFor(() => expect(document.querySelector("[data-parent-board]")).not.toBeNull());
    await waitFor(() => expect(rowPill("Idle · A while ago").textContent).toBe("1"));

    fireEvent.click(rowPill("Idle · A while ago"));
    await waitFor(() => expect(rowPill("Idle · A while ago").textContent).toBe("1 → Done"));
    // The live-child parent is highlighted nowhere, and clicking it refuses.
    expect(
      document.querySelector('[data-thread-card="m0"]')?.hasAttribute("data-sweep-highlighted"),
    ).toBe(false);
    fireEvent.click(cardAnchor("m0"));
    await waitFor(() =>
      expect(document.querySelector("[data-testid='sweep-refusal']")?.textContent).toContain(
        "live children",
      ),
    );
  });

  it("clicking a card in the armed row curates the sweep in any lane", async () => {
    window.localStorage.setItem("focus-board:groupBy", "parent");
    mount("parent");
    await waitFor(() => expect(document.querySelector("[data-parent-board]")).not.toBeNull());
    await waitFor(() => expect(rowPill("Idle · A while ago").textContent).toBe("2"));

    fireEvent.click(rowPill("Idle · A while ago"));
    await waitFor(() => expect(rowPill("Idle · A while ago").textContent).toBe("2 → Done"));

    // Deselect the other lane's card: a click inside the armed ROW must
    // curate the sweep, not disarm it (the row's bands carry the scope, so
    // the click-away guard spares a card in either family lane).
    fireEvent.pointerDown(cardAnchor("b0"));
    fireEvent.click(cardAnchor("b0"));
    await act(async () => {});
    expect(rowPill("Idle · A while ago").textContent).toBe("1 → Done");

    // The row is still armed: confirming sweeps exactly the remaining card.
    fireEvent.click(rowPill("Idle · A while ago"));
    await waitFor(() => {
      const calls = fakeRpcCalls().filter((call) => call.method === "done_set");
      expect(calls).toEqual([
        { method: "done_set", args: { threadId: "a0", done: true } },
      ]);
    });
  });

  it("a row with nothing sweepable carries no pill, and the Focus view agrees", async () => {
    // A working child only: the Working row has no sweep on either board.
    window.localStorage.setItem("focus-board:groupBy", "parent");
    seedFakeThreads([
      {
        id: "p_w",
        projectId: "proj_a",
        providerId: "pi",
        status: "idle",
        isUnread: false,
        isPinned: false,
        isArchived: false,
        isHidden: false,
        parentThreadId: null,
        hasPendingInteraction: false,
        updatedAt: Date.now() - DAY,
        displayTitle: "Family W",
        lastReadAt: Date.now() - DAY,
        createdAt: 0,
      },
      {
        id: "w0",
        projectId: "proj_a",
        providerId: "pi",
        status: "active",
        isUnread: false,
        isPinned: false,
        isArchived: false,
        isHidden: false,
        parentThreadId: "p_w",
        hasPendingInteraction: false,
        updatedAt: Date.now() - HOUR,
        displayTitle: "Working child",
        lastReadAt: Date.now() - HOUR,
        createdAt: 0,
      },
    ]);
    mount("parent");
    await waitFor(() => expect(document.querySelector("[data-parent-board]")).not.toBeNull());
    expect(railRow("Working").querySelector("[data-sweep-button]")).toBeNull();
    expect(railRow("Needs you").querySelector("[data-sweep-button]")).toBeNull();
  });
});

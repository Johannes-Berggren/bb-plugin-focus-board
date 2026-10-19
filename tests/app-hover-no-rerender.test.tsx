// @vitest-environment jsdom
// Mobile performance regression guard for the hover path (issue #186's frontend
// half; measured on a phone viewport at github.com/cristoslc/bb-plugin-focus-board
// issue #186's comment). Hovering a card is an ATTENTION capture, and on the
// shipped code that capture went through app state: attentionEnter wrote
// `hoverCaptures`, which the assembly re-ran against — so one pointer landing
// on a card rebuilt the whole board and re-rendered ~70% of the cards on
// screen. On a phone that measured 335 ThreadCard renders per hover enter
// (478-card board) and dropped hover to 4-13fps, while idle held 60fps.
//
// The fix: a hover is not board state. The capture lives in a ref and pins the
// card at the next data-driven rebuild, so a hover renders zero cards. These
// two tests pin the invariant (a hover renders no cards) and the behavior it
// must not break (a hovered card still holds its placement when its data
// churns).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

// Count ThreadCard renders without changing behavior: wrap the real component.
// The wrapper is a plain function component (NOT memoized), so it is invoked
// whenever the board re-renders a card — the count is board-driven renders,
// which is what these tests measure. It renders the real card as an element
// rather than calling it, because the card is itself a memo component now
// (issue #186): calling a memo object as a function is not a component.
const cardRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("../components/thread-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../components/thread-card")>();
  const Real = actual.ThreadCard;
  return {
    ...actual,
    ThreadCard: (props: Parameters<typeof Real>[0]) => {
      cardRenders.count += 1;
      return <Real {...props} />;
    },
  };
});

import "../app";
import { registeredNavPanel, seedFakeThreads } from "./helpers/app-fake-sdk";

const MINUTE = 60_000;
// The board buckets idle lanes by age against the real clock, so fixtures
// anchor to Date.now() (a fixed past constant lands in "A while ago").
const NOW = Date.now();

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads(updatedAtByid: Record<string, number>): Record<string, unknown>[] {
  return Object.entries(updatedAtByid).map(([id, updatedAt]) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId: null,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle: id,
    lastReadAt: updatedAt,
    createdAt: 0,
  }));
}

function mountApp(): void {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
}

function card(threadId: string): HTMLElement {
  const el = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (el === null) throw new Error(`missing card ${threadId}`);
  return el as HTMLElement;
}

function columnCardIds(columnId: string): string[] {
  const section = document.querySelector(`section[data-column-id="${columnId}"]`);
  if (section === null) return [];
  return [...section.querySelectorAll("[data-thread-card]")]
    .filter((el) => el.parentElement?.closest("[data-thread-card]") === null)
    .map((el) => (el instanceof HTMLElement ? el.getAttribute("data-thread-card") : ""));
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  cardRenders.count = 0;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("hovering a card does not rebuild the board", () => {
  it("a hover enter renders zero cards", async () => {
    seedFakeThreads(fixtureThreads({ thr_a: NOW - 30 * MINUTE, thr_b: NOW - 20 * MINUTE }) as never);
    mountApp();
    await waitFor(() => expect(columnCardIds("idle-recent")).toContain("thr_b"));

    // Settle: the mount's own renders are not the subject.
    await waitFor(() => expect(cardRenders.count).toBeGreaterThan(0));
    cardRenders.count = 0;

    fireEvent.mouseEnter(card("thr_b"));

    // The capture is recorded, so the ramp has nothing to reconcile: no card
    // re-renders. On the shipped code this was every card in the board.
    expect(cardRenders.count).toBe(0);
  });

  it("a hovered card still holds its placement when its data churns", async () => {
    seedFakeThreads(fixtureThreads({ thr_a: NOW - 10 * MINUTE, thr_b: NOW - 50 * MINUTE }) as never);
    mountApp();
    await waitFor(() => expect(columnCardIds("idle-recent")).toContain("thr_b"));
    // thr_a (newer) leads the lane; the attended card starts below it.
    expect(columnCardIds("idle-recent")).toEqual(["thr_a", "thr_b"]);

    // Attend to the lower card; its placement is captured.
    fireEvent.mouseEnter(card("thr_b"));

    // thr_b receives the freshest activity anywhere: without the freeze it
    // would vault to the top of the lane.
    seedFakeThreads(fixtureThreads({ thr_a: NOW - 10 * MINUTE, thr_b: NOW }) as never);

    // The attended card keeps the placement the operator was pointing at.
    await waitFor(() => expect(cardRenders.count).toBeGreaterThan(0));
    expect(columnCardIds("idle-recent")).toEqual(["thr_a", "thr_b"]);

    // On release the live rule resumes: thr_b floats to the top.
    fireEvent.mouseLeave(card("thr_b"));
    seedFakeThreads(fixtureThreads({ thr_a: NOW - 10 * MINUTE, thr_b: NOW + 5 * MINUTE }) as never);
    await waitFor(() => expect(columnCardIds("idle-recent")).toEqual(["thr_b", "thr_a"]));
  });
});

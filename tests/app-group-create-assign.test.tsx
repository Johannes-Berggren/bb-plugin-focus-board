// @vitest-environment jsdom
// The create & assign gesture: the card menu's Group… picker, a NEW name
// typed into the picker's field, "Create & assign". The write pair goes out
// (`group_create`, then `group_set` with the returned id) — and the board
// must reflect the result from the gesture itself, because realtime signals
// are ephemeral: the SDK documents that a signal "may fail to deliver", and
// the screenshot harness runs with no realtime traffic at all. A gesture
// that only shows its own result when an echo happens to arrive leaves the
// operator's card unboxed and the picker's list without the new group —
// reported as "no new group created, thread not assigned to any group".
// The fake SDK below replaces the whole realtime channel with silence, so
// this suite fails while the picker bets on the echo and passes when the
// acting client self-settles from the group_create response (the same
// optimistic pattern rename/delete already use).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import { registeredNavPanel, seedFakeGroups, seedFakeThreads } from "./helpers/app-fake-sdk";

const HOUR = 3_600_000;

/** jsdom has no ResizeObserver; the board's fit effects need one to exist. */
class StubResizeObserver {
  constructor(private cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  return [
    {
      id: "thr_fresh",
      projectId: "proj_a",
      providerId: "pi",
      status: "idle",
      isUnread: true,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Fresh thread",
      lastReadAt: null,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeGroups({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function cardInGroupBox(threadId: string): { boxed: boolean; labels: string[] } {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  return {
    boxed: card.closest("[data-group-box]") !== null,
    labels: [...document.querySelectorAll("[data-group-box]")].map((box) => box.textContent ?? ""),
  };
}

/** The gesture end to end, from a closed board to the settled state. */
async function runCreateAndAssignGesture(name: string) {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  const card = await waitFor(() => {
    const el = document.querySelector('[data-thread-card="thr_fresh"]');
    if (el === null) throw new Error("card not mounted yet");
    return el as HTMLElement;
  });
  fireEvent.contextMenu(card);
  const menuEntry = await waitFor(() => {
    const entries = [...screen.queryAllByRole("menuitem")];
    const entry = entries.find((el) => el.textContent?.trim().startsWith("Group…"));
    if (entry === undefined) throw new Error("Group… entry not open yet");
    return entry as HTMLElement;
  });
  fireEvent.click(menuEntry);
  const nameInput = (await screen.findByLabelText("New group name")) as HTMLInputElement;
  fireEvent.change(nameInput, { target: { value: name } });
  fireEvent.click(screen.getByText("Create & assign"));
}

describe("card menu → Group… → type a new name → Create & assign", () => {
  it("the board boxes the card with the new group without any realtime echo", async () => {
    await runCreateAndAssignGesture("Probe Group");
    // The group_set write lands in a later commit, like every host bridge.
    await act(async () => {});
    await waitFor(() => {
      const state = cardInGroupBox("thr_fresh");
      // The failing observation, verbatim from the operator's report path:
      // both writes land, yet the board never boxes the card.
      expect(state.boxed).toBe(true);
      expect(state.labels.some((label) => label.includes("Probe Group"))).toBe(true);
    });
    // And the picker, reopened, lists the new group (the operator's second
    // observation: "no new group created" — the list stayed stale). The
    // assigned card's entry is labeled "Change group…" now.
    fireEvent.contextMenu(document.querySelector('[data-thread-card="thr_fresh"]') as HTMLElement);
    fireEvent.click(
      (await waitFor(() => {
        const entry = [...screen.queryAllByRole("menuitem")].find((el) =>
          el.textContent?.trim().startsWith("Change group…"),
        );
        if (entry === undefined) throw new Error("Change group… entry not open yet");
        return entry as HTMLElement;
      })) as HTMLElement,
    );
    await screen.findByLabelText("New group name");
    expect(
      (document.querySelector("[data-group-dialog]")?.textContent ?? "").includes("Probe Group"),
    ).toBe(true);
  });
});
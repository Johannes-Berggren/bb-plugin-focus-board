// @vitest-environment jsdom
// Zoom to group (the group box context menu's entry) is a landing gesture,
// not a filter chip write: choosing it must land the operator ON the Group
// board — the view that shows group boxes — restricted to exactly that
// group. The first cut only wrote the filter while leaving the view alone,
// so on the Attention view the zoom read as a silent chip flip with the
// board staying put (review feedback on #175, operator's words: "this was
// supposed to switch from Attention board to Group board"). This suite
// mounts the real app against the fake SDK and pins both writes: the view
// switch (the board lands on the Group view, the group's own column) and
// the restrict (the filter surface's existing groups set).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
      id: "thr_zoom_one",
      projectId: "proj_a",
      providerId: "pi",
      status: "active",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - HOUR,
      displayTitle: "Zoomed member one",
      lastReadAt: now - 2 * HOUR,
      createdAt: 0,
    },
    {
      id: "thr_zoom_two",
      projectId: "proj_a",
      providerId: "pi",
      status: "active",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 2 * HOUR,
      displayTitle: "Zoomed member two",
      lastReadAt: now - 2 * HOUR,
      createdAt: 0,
    },
    {
      id: "thr_stray",
      projectId: "proj_a",
      providerId: "pi",
      status: "active",
      isUnread: false,
      isPinned: false,
      isArchived: false,
      isHidden: false,
      parentThreadId: null,
      hasPendingInteraction: false,
      updatedAt: now - 3 * HOUR,
      displayTitle: "Ungrouped stray",
      lastReadAt: now - 3 * HOUR,
      createdAt: 0,
    },
  ];
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
  seedFakeGroups(
    { grp_zoom: { name: "Zoom group", createdAt: new Date().toISOString() } },
    { thr_zoom_one: "grp_zoom", thr_zoom_two: "grp_zoom" },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderedCardIds(): string[] {
  return [...document.querySelectorAll("[data-thread-card]")].map((el) =>
    el.getAttribute("data-thread-card"),
  );
}

/** The group view's own column id IS the group id (columnFor "group"). */
function groupSection(): Element | null {
  return document.querySelector('section[data-column-id="grp_zoom"]');
}

describe("group context menu → Zoom to group, from the default Attention view", () => {
  it("the board lands on the Group view, restricted to the boxed group", async () => {
    const Component = registeredNavPanel.component;
    if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
    render(<Component subPath="" />);

    // Baseline: the default (Attention) view carries all three cards, the
    // two members inside the group's dashed box.
    await waitFor(() => {
      const ids = renderedCardIds();
      if (!ids.includes("thr_zoom_one") || !ids.includes("thr_stray")) {
        throw new Error("board not mounted yet");
      }
    });
    expect(groupSection()).toBeNull();

    // The gesture: right-click the box's own surface (the label bubbles up
    // to the container's guarded handler), choose the zoom entry.
    const label = document.querySelector('[data-group-box-label="grp_zoom"]') as HTMLElement;
    fireEvent.contextMenu(label);
    fireEvent.click(screen.getByText("Zoom to group"));

    // The view switch: the persisted groupBy write reads "group", and the
    // board renders the Group view's own column for the group.
    await waitFor(() =>
      expect(window.localStorage.getItem("focus-board:groupBy")).toBe("group"),
    );
    await waitFor(() => expect(groupSection()).not.toBeNull());

    // The restrict: the group set rides the filter surface's existing key,
    // and the stray's card left the board with it.
    expect(window.localStorage.getItem("focus-board:filter:groups")).toBe(
      JSON.stringify(["grp_zoom"]),
    );
    expect(renderedCardIds()).not.toContain("thr_stray");
    expect(renderedCardIds()).toContain("thr_zoom_one");
  });
});
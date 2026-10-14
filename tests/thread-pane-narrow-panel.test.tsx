// @vitest-environment jsdom
// [REDWORK] The pane on a squeezed panel: the pane's compact (cover-the-
// board) behavior keys off the WINDOW media query only, so a desktop bb
// window that squeezes the plugin panel itself (a narrowed bb panel, a
// docked window) keeps the side-by-side pane alive. The stored pane width
// (default 480px) then overruns the panel: the board flexes away to
// nothing and the pane's header paints past the panel's right edge (the
// toolbar behind it squashing to a sliver). The pane now measures its row:
//
// 1. A window-compact pane keeps the fixed (window-scoped) sheet.
// 2. A desktop pane whose row measures below the sheet threshold covers
//    the board as a PANEL-scoped sheet (absolute inset-0), never the
//    host's own chrome.
// 3. At or above the threshold the side-by-side pane persists, with its
//    stored width clamped to the row so it can never jut past the panel.
// 4. Without ResizeObserver (jsdom hosts, old embeds) nothing changes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import {
  CompactViewportOverrideProvider,
} from "../components/ui/hooks/use-compact-viewport";
import { PANE_SHEET_MAX_PANEL_WIDTH } from "../components/thread-pane";

const noop = () => {};

vi.mock("@get-bb/plugin-sdk/app", () => ({
  ThreadChat: () => null,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

vi.mock("../components/pending-interaction-card", () => ({
  PendingInteractionCard: () => null,
}));

vi.mock("../components/decided-questions-card", () => ({
  DecidedQuestionsCard: () => null,
}));

/** ResizeObserver stub: records each (callback, target) pair; the test
 *  fires callbacks by hand. jsdom has no ResizeObserver at all. */
class StubResizeObserver {
  static instances: { callback: ResizeObserverCallback; target: Element | null }[] = [];
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element): void {
    StubResizeObserver.instances.push({ callback: this.cb, target });
  }
  unobserve(): void {}
  disconnect(): void {}
}

function fireWidth(target: Element, width: number): void {
  const instance = StubResizeObserver.instances.find((x) => x.target === target);
  if (instance === undefined) throw new Error("no ResizeObserver observed the row");
  const entry = { contentRect: { width } } as unknown as ResizeObserverEntry;
  act(() => {
    instance.callback([entry], instance.callback as unknown as ResizeObserver);
  });
}

function paneRow(): HTMLElement {
  const element = document.querySelector("[data-repro-pane-row]");
  if (element === null) throw new Error("pane row wrapper not found");
  return element as HTMLElement;
}

function renderPane({ compact = false }: { compact?: boolean } = {}) {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: compact },
      // The row wrapper stands in for the app shell's board+pane flex row;
      // the pane measures this element (its parentElement).
      createElement(
        "div",
        { "data-repro-pane-row": "", style: { display: "flex" } },
        createElement(ThreadPane, {
          thread: {
            id: "thr_test",
            displayTitle: "Test thread",
            status: "idle",
            isUnread: false,
            isPinned: false,
          },
          isArchived: false,
          isDone: false,
          onToggleDone: noop,
          onToggleArchived: noop,
          onTogglePinned: noop,
          onToggleUnread: noop,
          onRename: async () => {},
          onMaximize: noop,
          onClose: noop,
          escStopsRunningThread: false,
        }),
      ),
    ),
  );
}

function paneAside(): HTMLElement {
  const aside = document.querySelector('aside[role="complementary"]');
  if (aside === null) throw new Error("pane aside not found");
  return aside as HTMLElement;
}

describe("ThreadPane on a narrow panel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it("a row narrower than the sheet threshold covers the board as a panel-scoped sheet", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderPane();
    fireWidth(paneRow(), 250);
    const aside = paneAside();
    // Panel-scoped sheet: absolute within the panel, never fixed to the
    // window (the desktop sheet must not swallow the host's chrome).
    expect(aside.className).toContain("absolute inset-0");
    expect(aside.className).toContain("z-30");
    expect(aside.className).not.toContain("fixed inset-0");
    // A sheet carries no side-by-side width.
    expect(aside.style.width).toBe("");
  });

  it("at or above the threshold the side-by-side pane persists at its stored width", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderPane();
    fireWidth(paneRow(), PANE_SHEET_MAX_PANEL_WIDTH);
    const aside = paneAside();
    expect(aside.className).toContain("relative");
    expect(aside.className).not.toContain("absolute");
    expect(aside.style.width).toBe("480px");
  });

  it("the boundary pins exactly: one pixel below the threshold is a sheet", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderPane();
    fireWidth(paneRow(), PANE_SHEET_MAX_PANEL_WIDTH - 1);
    expect(paneAside().className).toContain("absolute inset-0");
  });

  it("the side-by-side width clamps to the row, so the pane can never jut past the panel", () => {
    window.localStorage.setItem("focus-board:paneWidth", "800");
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderPane();
    fireWidth(paneRow(), 700);
    // Stored 800 cannot exceed the 700px row; the clamp keeps it inside.
    expect(Number.parseInt(paneAside().style.width, 10)).toBeLessThanOrEqual(700);
  });

  it("the window compact mode still wins: a fixed window sheet, even on a wide row", () => {
    vi.stubGlobal("ResizeObserver", StubResizeObserver);
    renderPane({ compact: true });
    fireWidth(paneRow(), 900);
    const aside = paneAside();
    expect(aside.className).toContain("fixed inset-0");
    expect(aside.className).not.toContain("absolute inset-0");
  });

  it("without ResizeObserver nothing changes: the side-by-side pane as before", () => {
    renderPane();
    const aside = paneAside();
    expect(aside.className).toContain("relative");
    expect(aside.style.width).toBe("480px");
  });
});
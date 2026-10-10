// @vitest-environment jsdom
// [REDWORK] Regression test for the offscreen banner bug: Board renders its
// four alert banners (rank error, sweep notice, browser reveal notice, sweep
// refusal) as in-flow children of the horizontally scrolling board container
// ([data-columns-board] carries overflow-x-auto). The banners therefore live
// in the board's scrollable coordinate space instead of being bound to the
// viewport: once the column row overflows and the operator scrolls right,
// the banner — its message included — is horizontally offscreen with no way
// to read or dismiss it without scrolling back.
//
// The contract: a visible banner MUST NOT be a descendant of the horizontal
// scroll container. Banners pinned above the scroll surface follow the
// viewport even when the columns extend past it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

afterEach(cleanup);

const NOW = 10_000_000;
const context = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

type BoardProps = Parameters<typeof Board>[0];

const BANNER_IDS = [
  "rank-error-banner",
  "sweep-notice",
  "browser-reveal-notice",
  "sweep-refusal",
] as const;

function renderBoard(props: Partial<BoardProps>) {
  const threads: PluginSidebarThread[] = [thread({ id: "thr_a", updatedAt: NOW - 5000 })];
  const full = {
    columns: buildColumns(threads, "status", context, new Map(), new Set<string>(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<number, never>(),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: () => {},
    onNewTask: () => {},
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    ...props,
  } as unknown as BoardProps;
  render(<Board {...full} />);
}

describe("Board banners are bound to the viewport, not the horizontal scroll", () => {
  it("a sweep notice banner renders outside the horizontal scroll container", () => {
    renderBoard({
      sweepNotice: { message: "Sweep archived 3 threads from Working." },
      onDismissSweepNotice: () => {},
      onSweepUndo: vi.fn(),
    });
    const banner = document.querySelector('[data-testid="sweep-notice"]');
    expect(banner).not.toBeNull();
    expect(banner?.closest("[data-columns-board]")).toBeNull();
  });

  it("a browser reveal notice banner renders outside the horizontal scroll container", () => {
    renderBoard({
      browserNotice: { message: 'No controlled browser tab belongs to the thread "Test thread".' },
      onDismissBrowserNotice: () => {},
    });
    const banner = document.querySelector('[data-testid="browser-reveal-notice"]');
    expect(banner).not.toBeNull();
    expect(banner?.closest("[data-columns-board]")).toBeNull();
  });

  it("no visible banner of any family is a descendant of the scroll container", () => {
    renderBoard({
      sweepNotice: { message: "Sweep archived 3 threads from Working." },
      browserNotice: { message: "Browser tab stuck hidden." },
    });
    for (const id of BANNER_IDS) {
      const banner = document.querySelector(`[data-testid="${id}"]`);
      if (banner === null) continue; // rank error / sweep refusal need live refusals; the sibling JSX block moves with the other two
      expect(banner.closest("[data-columns-board]")).toBeNull();
    }
    expect(document.querySelectorAll('[data-testid="sweep-notice"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="browser-reveal-notice"]')).toHaveLength(1);
  });

  it("the sweep notice keeps its dismiss control where the banner lands", () => {
    renderBoard({
      sweepNotice: { message: "Sweep archived 3 threads from Working." },
      onDismissSweepNotice: () => {},
    });
    const banner = document.querySelector('[data-testid="sweep-notice"]');
    expect(banner?.querySelector('button[aria-label="Dismiss sweep notice"]')).not.toBeNull();
  });
});
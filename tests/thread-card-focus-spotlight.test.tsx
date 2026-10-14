// @vitest-environment jsdom
// The focus spotlight: the mouseover spotlight (issue #123) arms its recede on
// the POINTER (`:has` a hovered card div). When the thread pane holds a thread
// open (`activeThreadId`), the user is focused on one thread whether they got
// there by hovering or by clicking INTO the card — so the same spotlight arms
// on the FOCUSED card instead: that card (and the family card whose nested
// rows contain a focused child) wears `data-focus-solid` and keeps the solid
// surface while every other card div on the board recedes. The existing dim
// systems stay in charge (a card whose life fades it keeps the marker but not
// a second surface), a transport ghost never claims the marker, and the
// marker also feeds `data-spotlight-immune` so the hover arm cannot dim the
// focused family under a pointer. The rule itself lives in
// components/card-spotlight.ts (issue #123's follow-up moved it out of the
// board roots into one injected style block).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { CARD_SURFACE_SOLID, ThreadCard } from "../components/thread-card";
import { CARD_SPOTLIGHT_RULE } from "../components/card-spotlight";
import { ParentLaneBoard } from "../components/parent-lane-board";
import { buildParentLanes } from "../components/parent-lanes";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_focus", displayTitle: "Focus card", updatedAt: 1 });
const child = thread({ id: "thr_child_focus", displayTitle: "Focus child", updatedAt: 2 });

// The parent-lane render pins scroll to the active card on mount, and its
// locator needs CSS.escape (jsdom has none) — the same jsdom stub the
// parent-lane board tests carry.
let restoreCss: () => void = () => {};
beforeAll(() => {
  const globalWithCss = globalThis as { CSS?: { escape?: unknown } };
  if (globalWithCss.CSS?.escape !== undefined) {
    restoreCss = () => {};
    return;
  }
  globalWithCss.CSS = {
    escape: (value: string) => value.replace(/[^\w-]/g, "\\$&"),
  };
  restoreCss = () => {
    delete globalWithCss.CSS;
  };
});

type Props = Partial<ComponentProps<typeof ThreadCard>>;

function renderCard(props: Props = {}) {
  render(
    <ThreadCard
      thread={base}
      stateDot={null}
      isActive={false}
      isDone={false}
      projectName="Proj"
      menuActions={[]}
      onOpen={() => {}}
      {...props}
    />,
  );
}

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_focus"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card root");
  return root;
}

function tokens(): string[] {
  return cardRoot().className.split(" ");
}

afterEach(cleanup);
afterAll(() => restoreCss());

describe("the pane-held card's focus marker (data-focus-solid)", () => {
  it("the card the thread pane holds open wears the marker, the solid surface, and the immunity", () => {
    renderCard({ activeThreadId: "thr_focus", isActive: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).toContain(CARD_SURFACE_SOLID);
    // The marker joins the never-recede set, so the hover arm cannot dim the
    // focused card while the pointer sits on another one.
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("an unfocused card (the pane holds another thread) wears neither", () => {
    renderCard({ activeThreadId: "thr_other" });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(false);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a card with no wired pane state wears neither", () => {
    renderCard({ activeThreadId: undefined });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(false);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("the family card whose nested row holds the focused child wears both and is immune", () => {
    renderCard({ childThreads: [child], activeThreadId: "thr_child_focus" });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).toContain(CARD_SURFACE_SOLID);
    // The family card is not the active card itself, so only the focus marker
    // makes it immune — the hover arm must not dim it under the pointer.
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("a pane-held done card keeps the marker but its own dim stays in charge", () => {
    // The done card's opacity-50 is its own life, not the spotlight's —
    // painting the solid surface under a faded card would just mute the fade.
    renderCard({ activeThreadId: "thr_focus", isActive: true, isDone: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a pane-held sweep-highlighted card keeps its amber read (no surface mix)", () => {
    renderCard({
      activeThreadId: "thr_focus",
      isActive: true,
      isSweepHighlighted: true,
    });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a transport ghost never claims the marker (two solid copies lie)", () => {
    renderCard({ activeThreadId: "thr_focus", isTransportGhost: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(false);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("a caller-forced family member wears the marker but not the surface", () => {
    // The parent-lane board renders a family as sibling cells, not nested
    // rows; it forces the marker on the lane's cells so the whole lane reads
    // lit. The surface stays with the focused card itself.
    renderCard({ activeThreadId: "thr_other", familySolid: true });
    expect(cardRoot().hasAttribute("data-focus-solid")).toBe(true);
    expect(tokens()).not.toContain(CARD_SURFACE_SOLID);
  });

  it("the solid surface is the scheme-aware darker mix (the #195 rule)", () => {
    expect(CARD_SURFACE_SOLID).toBe(
      "dark:bg-[color-mix(in_oklab,var(--card)_80%,black)]",
    );
  });
});

describe("the injected focus arm (one hand-written rule, one exemption list)", () => {
  it("arms on the focus marker and recedes every other card div that is not immune", () => {
    // The same arm-and-recede shape as the hover rule, keyed to
    // `data-focus-solid` instead of `:hover`: hover keeps its own escape
    // (`:not(:hover)` on a card lifts that card even under the focus arm).
    // No debounce here — a click cannot sweep, so the recede rides the card's
    // own base transition.
    const selector =
      "div[data-thread-card]:not(:hover):not([data-focus-solid]):not([data-spotlight-immune])";
    expect(CARD_SPOTLIGHT_RULE).toContain(
      `[data-columns-board]:has(div[data-focus-solid]) ${selector},`,
    );
    expect(CARD_SPOTLIGHT_RULE).toContain(
      `[data-parent-board]:has(div[data-focus-solid]) ${selector}`,
    );
  });
});

describe("the parent-lane family solid (families render as sibling cells there)", () => {
  it("every cell of the lane holding the focused thread wears the marker; other lanes never do", () => {
    // The parent-lane view renders a family as sibling mini cells, so the
    // board forces the marker on the lane's cells (familySolid): a focused
    // mini keeps its whole lane lit, not just itself.
    const NOW = 10 * 24 * 60 * 60 * 1000;
    const mk = (id: string, age: number) => {
      const parent = thread({ id, displayTitle: `Family ${id}`, updatedAt: NOW - age });
      const kids = Array.from({ length: 2 }, (_, i) =>
        thread({
          id: `${id}k${i}`,
          displayTitle: `Kid ${id}#${i}`,
          parentThreadId: id,
          status: "active",
          updatedAt: NOW - age,
        }),
      );
      return [parent, ...kids];
    };
    const lanes = buildParentLanes(
      [...mk("a", 0), ...mk("b", 60 * 60 * 1000)] as PluginSidebarThread[],
      new Set<string>(),
      NOW,
    );
    render(
      <ParentLaneBoard
        lanes={lanes}
        activeThreadId="ak0"
        doneIds={new Set()}
        dimmedIds={new Set()}
        childrenByParent={new Map()}
        projectNameFor={() => "Proj"}
        repoBaseFor={() => null}
        parentLaneOrder="recency"
        onParentLaneOrderChange={vi.fn()}
        onOpenThread={vi.fn()}
        onClosePane={vi.fn()}
        onNewTask={vi.fn()}
        menuActionsFor={() => []}
      />,
    );
    const byId = (id: string) => document.querySelector(`[data-thread-card="${id}"]`);
    // The focused cell and its lane-sibling cell are the focused family; the
    // other family never joins.
    expect(byId("ak0")?.hasAttribute("data-focus-solid")).toBe(true);
    expect(byId("ak1")?.hasAttribute("data-focus-solid")).toBe(true);
    expect(byId("bk0")?.hasAttribute("data-focus-solid")).toBe(false);
  });
});

// @vitest-environment jsdom
// Hovered-card prominence (issue #123, then the #123 follow-up): a card under
// the pointer must read MORE prominent, not less. The hover style used to swap
// the card's opaque surface (`bg-card`) for a translucent one
// (`hover:bg-accent/50`), so the hovered card let the lane background /
// wallpaper bleed through — it faded. The fix keeps the hovered surface
// opaque; the follow-up darkens it below the resting surface (mixing the card
// token toward black — `accent` only reads as MORE contrast in the light
// theme, while in the dark theme it LIGHTENED the hovered card), in the same
// spirit as the wallpaper-contrast floor: faded cards (done / dimmed /
// snoozed) get marked so a board-root spotlight can recede the OTHER cards
// without ever stacking a second dim on top of the existing scrim / opacity
// system.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  CARD_SPOTLIGHT_CLASSES,
  HOVER_SURFACE,
  ThreadCard,
} from "../components/thread-card";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_hover", displayTitle: "Hover card", updatedAt: 1 });

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
  const root = document.querySelector('[data-thread-card="thr_hover"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card root");
  return root;
}

function tokens(): string[] {
  return cardRoot().className.split(" ");
}

afterEach(cleanup);

describe("the hovered card's surface (issue #123)", () => {
  it("gains an OPAQUE hover surface — translucent accent never lands on the card", () => {
    renderCard();
    expect(tokens()).toContain("bg-card");
    expect(tokens()).toContain(HOVER_SURFACE);
    expect(tokens().some((t) => t.startsWith("hover:bg-accent"))).toBe(false);
  });

  it("the hover surface derives from the card token, DARKER than the rest state", () => {
    // Mixing `--card` toward black: the hovered surface darkens below the
    // resting surface in BOTH themes (dark: 19.5% -> ~15.6%, light: 98.5% ->
    // ~78.8%), the direction `accent` cannot deliver — accent is ink-ward, so
    // on a dark canvas it LIGHTENED the hovered card (27.5% over 19.5%).
    renderCard();
    expect(HOVER_SURFACE).toBe(
      "hover:bg-[color-mix(in_oklab,var(--card)_80%,black)]",
    );
  });

  it("keeps the ring emphasis on hover", () => {
    renderCard();
    expect(tokens()).toContain("hover:ring-border");
  });

  it("eases opacity on the card itself, so the spotlight recede fades in and out", () => {
    // The dim comes from a board-root rule that only exists while a card is
    // hovered — a transition living in that rule would vanish in the same
    // recalc as the dim it was easing, snapping the un-dim.
    renderCard();
    expect(tokens()).toContain(
      "transition-[color,background-color,border-color,outline-color,text-decoration-color,opacity,fill,stroke]",
    );
  });

  it("keeps the opaque, darker hover surface on a done card (its own dim stays in charge)", () => {
    renderCard({ isDone: true });
    expect(tokens()).toContain(HOVER_SURFACE);
    expect(tokens().some((t) => t.startsWith("hover:bg-accent"))).toBe(false);
  });
});

describe("the spotlight exemption marker (receding cards, not themselves dim)", () => {
  it("an ordinary card wears no faded marker", () => {
    renderCard();
    expect(cardRoot().hasAttribute("data-card-faded")).toBe(false);
  });

  it("a done card is marked, so the spotlight never stacks a second dim", () => {
    renderCard({ isDone: true });
    expect(cardRoot().hasAttribute("data-card-faded")).toBe(true);
  });

  it("a dimmed (filter-miss) card is marked", () => {
    renderCard({ dimmed: true });
    expect(cardRoot().hasAttribute("data-card-faded")).toBe(true);
  });

  it("a snoozed card is marked", () => {
    renderCard({ snoozeFor: () => 60_000 });
    expect(cardRoot().hasAttribute("data-card-faded")).toBe(true);
  });
});

describe("the CSS-only spotlight candidates (board-root wiring pin)", () => {
  it("the spotlight only arms while a card is hovered, and recedes only non-hovered, non-exempt cards", () => {
    // One source of truth for both board renderers: the arm (:has a hovered
    // card div) and the recede target (card divs that are NOT hovered, NOT
    // sweep-highlighted, and NOT carrying the faded marker).
    expect(CARD_SPOTLIGHT_CLASSES).toContain(
      "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:opacity-70",
    );
  });

  it("debounces the recede dim's onset, so a sweeping pointer never strobes it", () => {
    // Pure-CSS debounce: the dim's transition-delay AND its own longer ease
    // sit under the SAME arm and recede-target chain as the dim, so they only
    // apply while the rule holds. A pointer that rests 300ms starts the dim,
    // which then eases in over 300ms; a pointer that sweeps across never
    // holds the rule long enough for the dim to show. Neither exists for the
    // UN-dim — the base card transition (150ms, zero delay) applies whenever
    // the rule lets go — so releasing the spotlight stays snappy.
    expect(CARD_SPOTLIGHT_CLASSES).toContain(
      "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:delay-300",
    );
    expect(CARD_SPOTLIGHT_CLASSES).toContain(
      "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:duration-300",
    );
  });

  it("the columns board root carries the spotlight candidates", () => {
    // Rendered through the real Board the way board-sweep-select.test.tsx
    // does, so the wiring on `[data-columns-board]` can't silently drop out.
    const doneIds = new Set<string>();
    const props = {
      columns: buildColumns(
        [base] as unknown as PluginSidebarThread[],
        "status",
        { projects: [], providers: [] },
        new Map(),
        doneIds,
        1,
        {},
      ),
      groupBy: "status" as const,
      activeThreadId: null,
      doneIds,
      nestedChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
      childCountByParent: new Map<string, number>(),
      doneChildrenByParent: new Map<string, readonly PluginSidebarThread[]>(),
      dimmedIds: new Set<string>(),
      projectNameFor: () => "Proj",
      repoBaseFor: () => null,
      onOpenThread: vi.fn(),
      onClosePane: vi.fn(),
      onNewTask: vi.fn(),
      menuActionsFor: () => [],
      sweepCandidatesFor: () => [],
      onSweepArm: vi.fn(),
      onSweepDisarm: vi.fn(),
      onSweepToggle: vi.fn(),
      onSweepRangeSelect: vi.fn(),
    } as unknown as Parameters<typeof Board>[0];
    render(<Board {...props} />);
    const root = document.querySelector("[data-columns-board]");
    if (!(root instanceof HTMLElement)) throw new Error("missing columns board root");
    const classes = root.className.split(" ");
    expect(classes).toContain(
      "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:opacity-70",
    );
    expect(classes).toContain(
      "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:delay-300",
    );
    expect(classes).toContain(
      "has-[div[data-thread-card]:hover]:[&_div[data-thread-card]:not(:hover):not([data-sweep-highlighted]):not([data-card-faded])]:duration-300",
    );
  });
});
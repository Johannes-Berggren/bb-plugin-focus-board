// @vitest-environment jsdom
// Hovered-card prominence (issue #123, then the #195 light-mode follow-up): a
// card under the pointer must read MORE prominent, not less. The hover style
// used to swap the card's opaque surface (`bg-card`) for a translucent one
// (`hover:bg-accent/50`), so the hovered card let the lane background /
// wallpaper bleed through — it faded. The fix keeps the hovered surface
// opaque; the follow-up darkens it below the resting surface (mixing the card
// token toward black — `accent` only reads as MORE contrast in the light
// theme, while in the dark theme it LIGHTENED the hovered card), in the same
// spirit as the wallpaper-contrast floor: cards whose life already fades
// them (done / dimmed / snoozed) get marked so a board-root spotlight can
// recede the OTHER cards without ever stacking a second dim on top of the
// existing scrim / opacity system. The marker is `data-spotlight-immune`,
// computed by components/card-status.ts, and it covers every user-focus
// source: the pane-open card and a needs-attention card are immune too —
// focus outranks transparency.
//
// Issue #195 narrows the darkening's reach: darkening a near-white card on
// the LIGHT canvas reads as muting, not emphasis, so the darkening became a
// `dark:` media variant and the light theme's hover keeps the card's opaque
// surface untouched — the ring and the spotlight's sibling recede carry the
// emphasis there instead.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  CARD_SPOTLIGHT_RULE,
  CARD_SPOTLIGHT_STYLE_ID,
  ensureCardSpotlightStyles,
} from "../components/card-spotlight";
import { HOVER_SURFACE, ThreadCard } from "../components/thread-card";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_hover", displayTitle: "Hover card", updatedAt: 1 });

// A needs-attention thread (grouping.ts threadState → "attention"): the same
// fixture id, so `cardRoot()` still finds the card.
const attentionThread = thread({
  id: "thr_hover",
  displayTitle: "Hover card",
  updatedAt: 1,
  hasPendingInteraction: true,
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

  it("darkens the surface in the DARK theme via the dark: media variant", () => {
    // Issue #123 and its follow-up: mixing `--card` toward black keeps the
    // hovered surface OPAQUE and darker than the resting surface on the dark
    // canvas (19.5% → ~15.6%), where darkening IS the emphasis — `accent`
    // cannot deliver it (it is ink-ward, so on a dark canvas it LIGHTENED the
    // hovered card, 27.5% over 19.5%).
    renderCard();
    expect(HOVER_SURFACE).toBe(
      "dark:hover:bg-[color-mix(in_oklab,var(--card)_80%,black)]",
    );
  });

  it("the LIGHT theme's hover never darkens the card (darkening reads as muting there)", () => {
    // Issue #195: the theme-blind mix graying a near-white card
    // (98.5% → ~78.8%) reads as muting, not emphasis. The light hover keeps
    // the card's opaque `bg-card` surface untouched and the `hover:ring-border`
    // ring plus the spotlight's sibling recede carry the emphasis — the same
    // design point the done cards' opaque-surface lesson makes.
    renderCard();
    expect(tokens().some((t) => t.startsWith("hover:bg-"))).toBe(false);
    expect(tokens().some((t) => t.startsWith("hover:bg-accent"))).toBe(false);
    expect(tokens()).toContain("bg-card");
    expect(tokens()).toContain("hover:ring-border");
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

describe("the spotlight immunity marker (focus outranks transparency)", () => {
  it("an ordinary card wears no immunity marker", () => {
    renderCard();
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(false);
  });

  it("a done card is marked, so the spotlight never stacks a second dim", () => {
    renderCard({ isDone: true });
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("a dimmed (filter-miss) card is marked", () => {
    renderCard({ dimmed: true });
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("a snoozed card is marked", () => {
    renderCard({ snoozeFor: () => 60_000 });
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("a pane-open (active) card is marked — the open pane never fades", () => {
    renderCard({ isActive: true });
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("a needs-attention card is marked — the amber state never fades", () => {
    renderCard({ thread: attentionThread });
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });

  it("a sweep-highlighted card is marked (the pointer reads the selection)", () => {
    renderCard({ isSweepHighlighted: true });
    expect(cardRoot().hasAttribute("data-spotlight-immune")).toBe(true);
  });
});

describe("the injected spotlight rule (one hand-written rule, one exemption list)", () => {
  it("injects the rule once per document, however many boards mount", () => {
    ensureCardSpotlightStyles();
    ensureCardSpotlightStyles();
    const styles = document.querySelectorAll(`#${CARD_SPOTLIGHT_STYLE_ID}`);
    expect(styles.length).toBe(1);
    const style = styles[0];
    if (!(style instanceof HTMLStyleElement)) throw new Error("not a style element");
    expect(style.textContent).toBe(CARD_SPOTLIGHT_RULE);
  });

  it("arms on a hovered card div and recedes every other card div that is not immune", () => {
    // One selector pair covers both board roots, so the exemption list —
    // hovered (CSS-native) plus the immunity marker — is stated exactly once.
    const selector =
      "div[data-thread-card]:not(:hover):not([data-spotlight-immune])";
    expect(CARD_SPOTLIGHT_RULE).toContain(
      `[data-columns-board]:has(div[data-thread-card]:hover) ${selector},`,
    );
    expect(CARD_SPOTLIGHT_RULE).toContain(
      `[data-parent-board]:has(div[data-thread-card]:hover) ${selector}`,
    );
  });

  it("debounces the recede dim's onset, so a sweeping pointer never strobes it", () => {
    // Pure-CSS debounce: a pointer that rests 300ms starts the dim, which
    // then eases in over 300ms. The UN-dim rides the card's own base
    // transition (150ms, zero delay), so releasing the spotlight stays snappy.
    expect(CARD_SPOTLIGHT_RULE).toContain("opacity: 0.7");
    expect(CARD_SPOTLIGHT_RULE).toContain("transition-delay: 300ms");
    expect(CARD_SPOTLIGHT_RULE).toContain("transition-duration: 300ms");
  });

  it("the columns board root dropped the compiled spotlight classes; the style element arrives with the board", () => {
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
    expect(root.className.split(" ").some((cls) => cls.startsWith("has-["))).toBe(false);
    expect(document.getElementById(CARD_SPOTLIGHT_STYLE_ID)).not.toBeNull();
  });
});
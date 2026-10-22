// @vitest-environment jsdom
// The working dot's rate pulse (issue #279) at the board level: a collapsed
// child tree's `working` dot carries the period derived from that thread's
// token burn, an unmeasured thread still pulses at the base period, and the
// other states are untouched. Both surfaces are covered, because both are
// "a collapsed tree painted as status dots": the ThreadCard's child-dot strip
// and the folded family box's member dots.
//
// The gate integration is pinned here too: a pulsing dot rides the same
// visible-only IntersectionObserver the attention treatment uses, so an
// off-screen working dot holds still instead of burning the compositor.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Board } from "../components/board";
import { buildColumns } from "../components/grouping";
import { assembleBoard } from "../components/nesting";
import {
  DOT_PULSE_ATTR,
  DOT_PULSE_STYLE_ID,
  DOT_PULSE_STYLE_TEXT,
} from "../components/dot-pulse";
import { PULSE_BASE_PERIOD_MS } from "../lib/pulse-rate";
import { sameCardProps } from "../components/thread-card";
import { thread } from "./thread-fixture";

type BoardProps = Parameters<typeof Board>[0];
const NOW = 10_000_000;
const CONTEXT = { projects: [{ id: "p1", name: "One" }], providers: [{ id: "pi" }] };

/** A controllable IntersectionObserver, fresh per call so each test gets its
 *  own registry (the gate revalidates against the constructor's identity). */
function stubObserver() {
  const observed = new Set<Element>();
  class StubIntersectionObserver {
    observe(element: Element) {
      observed.add(element);
    }
    unobserve(element: Element) {
      observed.delete(element);
    }
    disconnect() {
      observed.clear();
    }
    takeRecords() {
      return [];
    }
    constructor(_cb: IntersectionObserverCallback) {
      void _cb;
    }
  }
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  return { observed };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById(DOT_PULSE_STYLE_ID)?.remove();
});

/** A parent with one working child and one idle child, folded into the strip. */
function family() {
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: NOW - 5000 }),
    children: [
      thread({
        id: "thr_fast",
        parentThreadId: "thr_parent",
        displayTitle: "Fast child",
        status: "active",
        updatedAt: NOW - 4000,
      }),
      thread({
        id: "thr_idle",
        parentThreadId: "thr_parent",
        displayTitle: "Idle child",
        status: "idle",
        updatedAt: NOW - 3000,
      }),
    ],
  };
}

function renderStrip(pulseRateFor: (threadId: string) => number | undefined) {
  const built = family();
  const assembly = assembleBoard(
    [built.parent, ...built.children],
    "status",
    CONTEXT,
    new Map(),
    new Set(),
    NOW,
  );
  const props = {
    columns: buildColumns([built.parent], "status", CONTEXT, new Map(), new Set(), NOW, {}),
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    collapsedFamilyIds: new Set(["thr_parent"]),
    dimmedIds: new Set<string>(),
    projectNameFor: () => "One",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onClosePane: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    pulseRateFor,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

function stripGlyph(id: string): HTMLElement {
  const glyph = document.querySelector(`[data-child-dot="${id}"] [data-child-dot-glyph]`);
  if (!(glyph instanceof HTMLElement)) throw new Error(`missing strip glyph for ${id}`);
  return glyph;
}

function renderFoldedBox(pulseRateFor: (threadId: string) => number | undefined) {
  const members = [
    thread({ id: "thr_a", displayTitle: "A", status: "active", updatedAt: NOW - 1000 }),
    thread({ id: "thr_b", displayTitle: "B", status: "idle", updatedAt: NOW - 2000 }),
  ];
  const groupBoxOf = new Map([
    ["thr_a", { groupId: "grp_auth", name: "Auth", members }],
    ["thr_b", { groupId: "grp_auth", name: "Auth", members }],
  ]);
  const props = {
    groupBy: "status" as const,
    columns: buildColumns(members, "status", CONTEXT, new Map(), new Set<string>(), NOW, {}),
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: new Map(),
    doneChildrenByParent: new Map(),
    childCountByParent: new Map<string, number>(),
    dimmedIds: new Set<string>(),
    rankStore: {},
    onRankMove: () => {},
    groupBoxOf,
    collapsedGroupIds: new Set(["grp_auth"]),
    onGroupCollapsedChange: () => {},
    projectNameFor: () => "",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onNewTask: vi.fn(),
    onDropDone: () => {},
    onDropUnread: () => {},
    onDropPinned: () => {},
    menuActionsFor: () => [],
    pulseRateFor,
  } as unknown as BoardProps;
  return render(<Board {...props} />);
}

describe("the collapsed strip's working dot", () => {
  it("pulses at the period its measured rate maps to", () => {
    stubObserver();
    renderStrip(() => 4);
    // Reference rate 1 maps to the base period; 4 tokens/s is 4x faster.
    expect(stripGlyph("thr_fast").getAttribute(DOT_PULSE_ATTR)).toBe("550");
    expect(stripGlyph("thr_fast").style.getPropertyValue("--dot-pulse-period")).toBe("550ms");
  });

  it("an unmeasured working dot keeps the base period instead of freezing", () => {
    stubObserver();
    renderStrip(() => undefined);
    expect(stripGlyph("thr_fast").getAttribute(DOT_PULSE_ATTR)).toBe(String(PULSE_BASE_PERIOD_MS));
  });

  it("an idle dot carries no rate pulse at all", () => {
    stubObserver();
    renderStrip(() => 4);
    expect(stripGlyph("thr_idle").hasAttribute(DOT_PULSE_ATTR)).toBe(false);
    expect(stripGlyph("thr_idle").style.getPropertyValue("--dot-pulse-period")).toBe("");
  });

  it("the pulsing glyph is observed by the visible-only gate", () => {
    const stub = stubObserver();
    renderStrip(() => 4);
    expect(stub.observed.has(stripGlyph("thr_fast"))).toBe(true);
    // The idle dot animates nothing, so nothing observes it.
    expect(stub.observed.has(stripGlyph("thr_idle"))).toBe(false);
  });
});

describe("the folded family box's member dots", () => {
  it("a working member's dot pulses at its own rate, an idle member's does not", () => {
    stubObserver();
    renderFoldedBox((id) => (id === "thr_a" ? 4 : undefined));
    const dots = document.querySelectorAll("[data-collapsed-group-dot]");
    expect(dots).toHaveLength(2);
    const a = dots[0] as HTMLElement;
    const b = dots[1] as HTMLElement;
    expect(a.getAttribute(DOT_PULSE_ATTR)).toBe("550");
    expect(b.hasAttribute(DOT_PULSE_ATTR)).toBe(false);
  });

  it("both a working and an attention member dot ride the visible-only gate", () => {
    const stub = stubObserver();
    const members = [
      thread({ id: "thr_a", displayTitle: "A", status: "active", updatedAt: NOW - 1000 }),
      thread({
        id: "thr_b",
        displayTitle: "B",
        status: "active",
        hasPendingInteraction: true,
        updatedAt: NOW - 2000,
      }),
    ];
    const groupBoxOf = new Map([
      ["thr_a", { groupId: "grp_auth", name: "Auth", members }],
      ["thr_b", { groupId: "grp_auth", name: "Auth", members }],
    ]);
    const props = {
      groupBy: "status" as const,
      columns: buildColumns(members, "status", CONTEXT, new Map(), new Set<string>(), NOW, {}),
      activeThreadId: null,
      doneIds: new Set<string>(),
      nestedChildrenByParent: new Map(),
      doneChildrenByParent: new Map(),
      childCountByParent: new Map<string, number>(),
      dimmedIds: new Set<string>(),
      rankStore: {},
      onRankMove: () => {},
      groupBoxOf,
      collapsedGroupIds: new Set(["grp_auth"]),
      onGroupCollapsedChange: () => {},
      projectNameFor: () => "",
      repoBaseFor: () => null,
      onOpenThread: vi.fn(),
      onNewTask: vi.fn(),
      onDropDone: () => {},
      onDropUnread: () => {},
      onDropPinned: () => {},
      menuActionsFor: () => [],
      pulseRateFor: () => 2,
    } as unknown as BoardProps;
    render(<Board {...props} />);
    const dots = [...document.querySelectorAll("[data-collapsed-group-dot]")];
    expect(dots).toHaveLength(2);
    for (const dot of dots) expect(stub.observed.has(dot)).toBe(true);
    // The attention member keeps its own amber pulse and takes no rate period;
    // the working member takes the rate period and no amber pulse.
    const dotFor = (title: string): HTMLElement => {
      const found = dots.find((dot) => dot.getAttribute("title")?.startsWith(title));
      if (!(found instanceof HTMLElement)) throw new Error(`missing dot for ${title}`);
      return found;
    };
    const working = dotFor("A ");
    const attention = dotFor("B ");
    expect(working.getAttribute(DOT_PULSE_ATTR)).toBe("1100");
    expect(working.className).not.toContain("motion-safe:animate-pulse");
    expect(attention.hasAttribute(DOT_PULSE_ATTR)).toBe(false);
    expect(attention.className).toContain("motion-safe:animate-pulse");
  });
});

describe("the dot-pulse stylesheet", () => {
  it("is injected once, idempotently, under a stable id, and states the exact rule", () => {
    stubObserver();
    renderStrip(() => 4);
    const sheet = document.getElementById(DOT_PULSE_STYLE_ID);
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toBe(DOT_PULSE_STYLE_TEXT);
    // Opacity only: no layout property may ride this animation.
    expect(DOT_PULSE_STYLE_TEXT).toContain("opacity");
    expect(DOT_PULSE_STYLE_TEXT).not.toMatch(/width|height|transform|filter/);
    // It respects the motion preference the way `motion-safe:` does.
    expect(DOT_PULSE_STYLE_TEXT).toContain("prefers-reduced-motion: no-preference");
    cleanup();
    renderStrip(() => 4);
    expect(document.querySelectorAll(`#${DOT_PULSE_STYLE_ID}`)).toHaveLength(1);
  });
});

describe("the card comparator's rate probe", () => {
  it("a rate change for a foreign id does not repaint the card, a member's does", () => {
    const built = family();
    const cardProps = (pulseRateFor: (threadId: string) => number | undefined) =>
      ({
        thread: built.parent,
        childThreads: built.children,
        pulseRateFor,
      }) as unknown as Parameters<typeof sameCardProps>[0];
    // Two content-identical lookups hold the memo even though their identities
    // differ (the app rebuilds the callback per render).
    expect(sameCardProps(cardProps(() => 4), cardProps(() => 4))).toBe(true);
    // A change that only moves a foreign thread's rate is invisible here: the
    // card paints none of that thread's dots.
    expect(
      sameCardProps(
        cardProps((id) => (id === "thr_elsewhere" ? 1 : 4)),
        cardProps((id) => (id === "thr_elsewhere" ? 9 : 4)),
      ),
    ).toBe(true);
    // A change on a thread this card paints must repaint it.
    expect(
      sameCardProps(
        cardProps((id) => (id === "thr_fast" ? 4 : undefined)),
        cardProps((id) => (id === "thr_fast" ? 9 : undefined)),
      ),
    ).toBe(false);
  });
});

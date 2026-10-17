// @vitest-environment jsdom
// The attention pulse's visible-only gate (#260): a pulsing element animates
// only while it is on screen. Off screen it keeps the static attention
// treatment (the amber border, the solid dot) and holds still, which is what
// keeps a board full of attention cards from saturating the main thread.
//
// These tests pin the module contract (one stylesheet, one registered
// observer, the parked attribute toggling on visibility) and the board
// integration (an attention card's overlay is actually observed). jsdom has no
// IntersectionObserver, so every test installs a controllable stub; the
// no-observer degradation is its own case.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  PULSE_GATE_RULE,
  PULSE_GATE_STYLE_ID,
  PULSE_PARKED_ATTR,
  attentionPulseRef,
  useAttentionPulseGate,
} from "../components/attention-pulse-gate";
import { Board } from "../components/board";
import { assembleBoard } from "../components/nesting";
import type { GroupingContext } from "../components/grouping";
import { thread } from "./thread-fixture";
import type { ReactNode } from "react";

interface StubHandle {
  observed: Set<Element>;
  deliver: (element: Element, isIntersecting: boolean) => void;
}

/**
 * Install a controllable IntersectionObserver. A FRESH class per call, since
 * the gate keeps one shared observer and revalidates it against the
 * constructor's identity: a fresh class proves the revalidation and gives each
 * test its own registry, so no test inherits another's observations.
 */
function stubObserver(): StubHandle {
  const observed = new Set<Element>();
  let callback: IntersectionObserverCallback | null = null;
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
    constructor(cb: IntersectionObserverCallback) {
      callback = cb;
    }
  }
  vi.stubGlobal("IntersectionObserver", StubIntersectionObserver);
  return {
    observed,
    deliver(element, isIntersecting) {
      if (callback === null) throw new Error("the stub never received a callback");
      callback(
        [{ target: element, isIntersecting } as unknown as IntersectionObserverEntry],
        null as unknown as IntersectionObserver,
      );
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.getElementById(PULSE_GATE_STYLE_ID)?.remove();
});

describe("the attention pulse gate", () => {
  it("injects its parked rule once, idempotently, under a stable id", () => {
    stubObserver();
    render(<GateHost />);
    const first = document.getElementById(PULSE_GATE_STYLE_ID);
    expect(first).not.toBeNull();
    expect(first?.textContent).toBe(PULSE_GATE_RULE);
    expect(PULSE_GATE_RULE).toContain(`[${PULSE_PARKED_ATTR}]`);
    expect(PULSE_GATE_RULE).toContain("animation: none !important");
    // A second mount adds no second sheet.
    render(<GateHost />);
    expect(document.querySelectorAll(`#${PULSE_GATE_STYLE_ID}`)).toHaveLength(1);
  });

  it("parks an off-screen pulse and unparks it when it scrolls back in", () => {
    const stub = stubObserver();
    const element = document.createElement("span");
    document.body.append(element);
    const cleanupRef = attentionPulseRef(element);
    expect(stub.observed.has(element)).toBe(true);
    // Off screen: parked (the animation stops through the stylesheet rule).
    stub.deliver(element, false);
    expect(element.hasAttribute(PULSE_PARKED_ATTR)).toBe(true);
    // Back on screen: unparked.
    stub.deliver(element, true);
    expect(element.hasAttribute(PULSE_PARKED_ATTR)).toBe(false);
    // The React 19 ref cleanup stops observing the unmounted node.
    if (typeof cleanupRef === "function") cleanupRef();
    expect(stub.observed.has(element)).toBe(false);
  });

  it("registers a pulse unparked, so a re-attached element starts animating", () => {
    stubObserver();
    const element = document.createElement("span");
    element.setAttribute(PULSE_PARKED_ATTR, "");
    document.body.append(element);
    attentionPulseRef(element);
    expect(element.hasAttribute(PULSE_PARKED_ATTR)).toBe(false);
  });

  it("degrades to no-op without IntersectionObserver (jsdom, old browsers)", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const element = document.createElement("span");
    document.body.append(element);
    expect(() => attentionPulseRef(element)).not.toThrow();
    expect(element.hasAttribute(PULSE_PARKED_ATTR)).toBe(false);
    render(<GateHost />);
    // No observer to construct, so no sheet is injected either.
    expect(document.getElementById(PULSE_GATE_STYLE_ID)).toBeNull();
  });

  it("observes the attention card's overlay on the board", () => {
    const stub = stubObserver();
    renderBoard([
      thread({ id: "thr_attention", hasPendingInteraction: true, updatedAt: NOW - 1000 }),
    ]);
    const overlay = document.querySelector("[data-thread-card='thr_attention'] [data-attention-pulse]");
    expect(overlay).not.toBeNull();
    expect(stub.observed.has(overlay!)).toBe(true);
    // Parked off screen, the overlay still renders (the static treatment).
    stub.deliver(overlay!, false);
    expect(overlay!.hasAttribute(PULSE_PARKED_ATTR)).toBe(true);
    expect(
      document.querySelector("[data-thread-card='thr_attention'] [data-attention-pulse]"),
    ).not.toBeNull();
  });
});

function GateHost() {
  useAttentionPulseGate();
  return null;
}

const NOW = 10_000_000;
const CONTEXT: GroupingContext = {
  projects: [{ id: "proj_a", name: "Alpha" }],
  providers: [{ id: "pi", displayName: "Pi" }],
};

function renderBoard(threads: PluginSidebarThread[]) {
  const assembly = assembleBoard(threads, "status", CONTEXT, new Map(), new Set(), NOW);
  const props = {
    columns: assembly.columns,
    groupBy: "status" as const,
    activeThreadId: null,
    doneIds: new Set<string>(),
    nestedChildrenByParent: assembly.nestedChildrenByParent,
    childCountByParent: assembly.childCountByParent,
    doneChildrenByParent: assembly.doneChildrenByParent,
    dimmedIds: new Set<string>(),
    projectNameFor: () => "Alpha",
    repoBaseFor: () => null,
    onOpenThread: vi.fn(),
    onNewTask: vi.fn(),
    menuActionsFor: () => [],
    stateDot: null as ReactNode,
  } as unknown as Parameters<typeof Board>[0];
  return render(<Board {...props} />);
}

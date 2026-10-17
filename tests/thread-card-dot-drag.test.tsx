// @vitest-environment jsdom
// Issue #249, first cut (goals 3 and 4): a dot on the collapsed strip drags
// to reorder its tier of the family. This file pins the CARD-side contract —
// the dot is the drag source, the board decides everything else through the
// `childDotDrag` wiring — and the tooltip law: the preview bubble naming the
// dragged member stays open for the whole gesture and never flips to a dot
// the drag passes over.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { DOT_DRAG_TYPE, DRAG_ID_KEY } from "../lib/rank";
import { thread } from "./thread-fixture";

/** A dataTransfer the way the board's tests use one: writable mid-drag,
 * readable at drop. */
function makeDataTransfer() {
  const payload = new Map<string, string>();
  const types: string[] = [];
  return {
    get types() {
      return [...types];
    },
    setData(type: string, value: string) {
      if (!types.includes(type)) types.push(type);
      payload.set(type, value);
    },
    getData(type: string) {
      return payload.get(type) ?? "";
    },
    effectAllowed: "none",
    dropEffect: "none",
  };
}

type CardProps = Parameters<typeof ThreadCard>[0];

type DotDragShape = {
  onDragStart: ReturnType<typeof vi.fn>;
  onDragOver: ReturnType<typeof vi.fn>;
  onDrop: ReturnType<typeof vi.fn>;
  onDragEnd: ReturnType<typeof vi.fn>;
  line?: { memberId: string; zone: "before" | "after" };
  escaped?: boolean;
};

let dotDrag: DotDragShape;

function renderGrandCard(overrides: Partial<CardProps> = {}) {
  const { parent, children, subsByParent } = grandFamily();
  dotDrag = {
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
    ...((overrides.childDotDrag as Partial<DotDragShape> | undefined) ?? {}),
  };
  const props = {
    thread: parent,
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    // The wiring rides BEFORE the overrides: a test that passes
    // childDotDrag: undefined explicitly keeps the strip unwired, plain
    // defaults come wired, and the injected dotDrag's own shape (line,
    // escaped) follows the wire.
    childDotDrag: dotDrag,
    childThreads: children,
    grandchildThreadsByParent: subsByParent,
    isCollapsed: true,
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

function grandFamily() {
  const childOne = thread({
    id: "thr_c1",
    parentThreadId: "thr_parent",
    displayTitle: "Child one",
    status: "active",
    updatedAt: 4000,
  });
  const subOne = thread({
    id: "thr_c1_s1",
    parentThreadId: "thr_c1",
    displayTitle: "Sub one",
    status: "idle",
    updatedAt: 3900,
  });
  const subTwo = thread({
    id: "thr_c1_s2",
    parentThreadId: "thr_c1",
    displayTitle: "Sub two",
    status: "idle",
    isUnread: true,
    updatedAt: 3800,
  });
  const childTwo = thread({
    id: "thr_c2",
    parentThreadId: "thr_parent",
    displayTitle: "Child two",
    status: "active",
    updatedAt: 3700,
  });
  return {
    parent: thread({ id: "thr_parent", displayTitle: "Parent", updatedAt: 5000 }),
    children: [childOne, childTwo],
    subsByParent: new Map([["thr_c1", [subOne, subTwo]]]),
  };
}

function dot(id: string): HTMLElement {
  const button = document.querySelector<HTMLElement>(`button[data-child-dot="${id}"]`);
  if (button === null) throw new Error(`missing dot for ${id}`);
  return button;
}

function previewBubble(): HTMLElement | null {
  return document.querySelector("[data-child-dot-preview]");
}

/** The collapsed strip itself, the goal-6 nest surface by its data attr. */
function dots(): HTMLElement {
  const strip = document.querySelector("[data-child-thread-dots]");
  if (!(strip instanceof HTMLElement)) throw new Error("missing child dot strip");
  return strip;
}

function bubbleTitle(): string {
  const bubble = previewBubble();
  if (bubble === null) throw new Error("no preview bubble open");
  return bubble.textContent ?? "";
}

afterEach(cleanup);

describe("an unwired strip's dots stay click-preview controls", () => {
  it("no dot becomes draggable when childDotDrag is absent", () => {
    renderGrandCard({ childDotDrag: undefined });
    for (const id of ["thr_c1", "thr_c1_s1", "thr_c2"]) {
      expect(dot(id).draggable).toBe(false);
    }
  });
});

describe("the dot is the drag source, the board owns the decision", () => {
  it("wired dots carry draggable and report the drag start to the board", () => {
    renderGrandCard();
    expect(dot("thr_c1_s2").draggable).toBe(true);
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1_s2"), { dataTransfer: dt });
    expect(dotDrag.onDragStart).toHaveBeenCalledTimes(1);
    expect(dotDrag.onDragStart).toHaveBeenCalledWith("thr_c1_s2", expect.anything());
  });

  it("dragstart writes the dropped id and the dot-drag mark into the payload", () => {
    renderGrandCard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1"), { dataTransfer: dt });
    expect(dt.getData(DRAG_ID_KEY)).toBe("thr_c1");
    expect(dt.types).toContain(DOT_DRAG_TYPE);
    expect(dt.effectAllowed).toBe("move");
  });

  it("a snoozed member's dot refuses drag at the attribute and the guard", () => {
    const snoozeFor = (threadId: string) => (threadId === "thr_c2" ? 9000 : null);
    renderGrandCard({ snoozeFor });
    expect(dot("thr_c2").draggable).toBe(false);
    const dt = makeDataTransfer();
    const start = createEvent.dragStart(dot("thr_c2"), { dataTransfer: dt });
    fireEvent(dot("thr_c2"), start);
    expect(start.defaultPrevented).toBe(true);
    expect(dt.types).not.toContain(DOT_DRAG_TYPE);
    expect(dotDrag.onDragStart).not.toHaveBeenCalled();
  });

  it("dragover, drop, dragleave, and dragend ride the wiring to the board", () => {
    const { unmount } = renderGrandCard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1"), { dataTransfer: dt });
    fireEvent.dragOver(dot("thr_c2"), { dataTransfer: dt });
    expect(dotDrag.onDragOver).toHaveBeenCalledWith("thr_c2", expect.anything());
    fireEvent.drop(dot("thr_c2"), { dataTransfer: dt });
    expect(dotDrag.onDrop).toHaveBeenCalledWith("thr_c2", expect.anything());
    fireEvent.dragLeave(dot("thr_c2"), { dataTransfer: dt });
    expect(dotDrag.onDragEnd).not.toHaveBeenCalled();
    fireEvent.dragEnd(dot("thr_c1"), { dataTransfer: dt });
    expect(dotDrag.onDragEnd).toHaveBeenCalledTimes(1);
    unmount();
  });
});

describe("the tooltip stays open for the whole dot gesture (goal 4)", () => {
  it("dragstart opens the dragged dot's own preview without a hover", () => {
    renderGrandCard();
    expect(previewBubble()).toBeNull();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1_s2"), { dataTransfer: dt });
    expect(bubbleTitle()).toContain("Sub two");
  });

  it("the dragged tooltip never flips to the dots the drag passes over", () => {
    renderGrandCard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1_s2"), { dataTransfer: dt });
    const before = bubbleTitle();
    expect(before).toContain("Sub two");
    // The drag's hover surfing must not replace the named member.
    fireEvent.mouseEnter(dot("thr_c1"));
    expect(bubbleTitle()).toContain("Sub two");
    fireEvent.mouseEnter(dot("thr_c2"));
    expect(bubbleTitle()).toContain("Sub two");
    // ...nor does a leave under the dragged dot close it mid-gesture.
    fireEvent.mouseLeave(dot("thr_c1_s2"));
    expect(bubbleTitle()).toContain("Sub two");
  });

  it("dragend closes the tooltip: the bubble goes away with the gesture", () => {
    renderGrandCard();
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1_s2"), { dataTransfer: dt });
    fireEvent.dragEnd(dot("thr_c1_s2"), { dataTransfer: dt });
    expect(previewBubble()).toBeNull();
    // And the strip's normal hover previews work again afterwards.
    fireEvent.mouseEnter(dot("thr_c1"));
    expect(bubbleTitle()).toContain("Child one");
  });
});

describe("the strip insertion line rides the wire (cut 1)", () => {
  it("the wired line paints a vertical before-marker on its dot", () => {
    renderGrandCard({
      childDotDrag: { ...dotDrag, line: { memberId: "thr_c2", zone: "before" } },
    });
    const target = dot("thr_c2");
    expect(target.className).toContain("before:w-0.5");
    expect(target.className).toContain("before:bg-ring");
    // Vertical line geometry: a full-height inset marker, not the rows' horizontal pair.
    expect(target.className).toContain("before:inset-y-0");
    expect(target.className).not.toContain("before:-top-0.5");
  });

  it("no line renders without the wiring; dots stay plain", () => {
    renderGrandCard({ childDotDrag: undefined });
    expect(dot("thr_c2").className).not.toContain("before:w-0.5");
  });
});

describe("the morph: a dot that crossed the boundary hands over with the card lit up", () => {
  // Goal 5, in-place reading (the blessed plan): once the board reports
  // `escaped`, the dragged member's family card is the in-place morph — a
  // soft amber ring plus a gentle dim on the card root, marked by a
  // data attribute the runner and the tests can find — and the pinned
  // bubble expands to the full-card surface by gaining the project and
  // branch line. The gesture's tail acts as an ordinary card drag, so no
  // dot-specific controls should light: the insertion line dies with the
  // escape.
  it("the escaped wire rings and dims the card root and marks it findable", () => {
    renderGrandCard({ childDotDrag: { ...dotDrag, escaped: true } });
    const card = document.querySelector('[data-thread-card="thr_parent"]');
    if (!(card instanceof HTMLElement)) throw new Error("missing family card root");
    expect(card.hasAttribute("data-dot-escape")).toBe(true);
    expect(card.className).toMatch(/ring-amber-500\/40/);
    expect(card.className).toMatch(/opacity-75/);
    // The morph is a promise about THE dragged member's card, not every
    // card: the unescaped render carries no marker (its own container,
    // since both cards render into this jsdom document).
    const second = renderGrandCard({ childDotDrag: { ...dotDrag, escaped: false } });
    const plain = second.container.querySelector('[data-thread-card="thr_parent"]');
    expect(plain?.hasAttribute("data-dot-escape")).toBe(false);
  });

  it("the escaped wire kills any insertion line mid-gesture", () => {
    renderGrandCard({
      childDotDrag: {
        ...dotDrag,
        escaped: true,
        line: { memberId: "thr_c2", zone: "before" },
      },
    });
    expect(dot("thr_c2").className).not.toContain("before:w-0.5");
  });

  it("the pinned bubble gains the project and branch line once the gesture reads as a card drag", () => {
    renderGrandCard({ childDotDrag: { ...dotDrag, escaped: true } });
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1_s2"), { dataTransfer: dt });
    const bubble = previewBubble();
    if (bubble === null) throw new Error("no pinned bubble after dragstart");
    expect(bubble.textContent).toContain("Sub two");
    expect(bubble.textContent).toContain("One");
  });

  it("the unescaped bubble stays the three-line preview (no project line)", () => {
    renderGrandCard({ childDotDrag: { ...dotDrag, escaped: false } });
    const dt = makeDataTransfer();
    fireEvent.dragStart(dot("thr_c1_s2"), { dataTransfer: dt });
    const bubble = previewBubble();
    if (bubble === null) throw new Error("no pinned bubble after dragstart");
    expect(bubble.textContent).not.toContain("One");
  });
});

describe("the dot field as a nest target for a card (cut 4, goal 6)", () => {
  // A CARD dragged into a collapsed family's strip collapses into tooltip
  // plus dot: the strip lights (ghost dot + amber ring, data-strip-nest)
  // and the pinned bubble reads the dragged card's card surface (title,
  // state, the project and branch line) at the pointer. The release write
  // is the board's; the wire only reports the hover.
  it("the hovered strip lights, grows a ghost dot, and previews the dragged card", () => {
    renderGrandCard({
      stripNestHover: { member: thread({ id: "thr_card_drag", displayTitle: "Dragged card", isUnread: true, updatedAt: 100, projectId: "p1" }), x: 300, y: 200 },
    });
    const strip = dots();
    expect(strip.hasAttribute("data-strip-nest-target")).toBe(true);
    expect(strip.className).toMatch(/ring-amber-500\/40/);
    expect(strip.querySelector("[data-strip-nest-ghost]")).not.toBeNull();
    const bubble = document.querySelector('[data-child-dot-preview][data-strip-nest=""]');
    if (!(bubble instanceof HTMLElement)) throw new Error("no strip-nest bubble");
    expect(bubble.textContent).toContain("Dragged card");
    // The collapsed card surface: the project and branch line rides.
    expect(bubble.textContent).toContain("One");
  });

  it("no hover is no affordance: the strip stays plain and bubbles stay dot-driven", () => {
    renderGrandCard();
    const strip = dots();
    expect(strip.hasAttribute("data-strip-nest-target")).toBe(false);
    expect(strip.querySelector("[data-strip-nest-ghost]")).toBeNull();
    expect(document.querySelector('[data-child-dot-preview][data-strip-nest=""]')).toBeNull();
    // The dot's own hover preview still works.
    fireEvent.mouseEnter(dot("thr_c1"));
    expect(bubbleTitle()).toContain("Child one");
  });

  it("a strip-nest hover never lights a dot: the ghost is the dragged card's, not a member's", () => {
    renderGrandCard({
      stripNestHover: { member: thread({ id: "thr_card_drag2", displayTitle: "Dragged two", updatedAt: 200 }), x: 10, y: 10 },
    });
    // Every member dot keeps its own identity; the ghost is outside the dot buttons.
    for (const id of ["thr_c1", "thr_c1_s1", "thr_c2"]) {
      expect(dot(id).hasAttribute("data-child-dot-active")).toBe(false);
    }
    expect(document.querySelectorAll("button[data-child-dot]")).toHaveLength(4);
  });
});

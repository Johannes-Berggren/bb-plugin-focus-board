// The attention freeze: a card or family the operator is attending to holds
// its rendered placement until attention releases.
//
// "Attending to" means the pointer hovers the card, or the card is open in
// the thread pane; "released" means the mouse moved away or the pane closed.
// While attention holds, live data churn (state flips, age buckets, family
// recency, group-box re-laning) re-sorts the board AROUND the attended
// placement instead of moving it; the board's own placement rules run again
// the moment attention releases. The codebase has been here before: the
// retired sweep gather re-sorted cards mid-gesture and was removed precisely
// because a moving card under a working pointer reads as a board that
// shuffles itself — this module is the general version of that lesson.
//
// Two capture shapes, one module:
//
// - AttentionCapture — the column board: the attended card's rendered lane
//   and slot index, its family root's card, and (when it is a nested row) its
//   row slot — plus the "does not un-nest" set for an attended child.
// - LaneCapture — the parent lane view: the attended card's lane order slot
//   and the row bucket the card sits in, since a lane's whole order there is
//   recency-derived and moves under live data.
//
// Pure module: no host, no SDK, no React. app.tsx captures at attention
// events (mouse enter/leave, pane open/close) and calls compile the plan the
// assembly consumes; the assembly applies lanes first, slots last.
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { BoardColumn, GroupBy } from "./grouping";
import type { ParentLane } from "./parent-lanes";

/** What opened a freeze: the pointer, or the open thread pane. */
export type AttentionOrigin = "hover" | "selection";

/** One pinned card's captured placement in the column board. */
export interface AttentionSlot {
  threadId: string;
  columnId: string;
  label: string;
  /** The card's slot index in that column's rendered list at capture. */
  index: number;
}

/**
 * One capture on the column board: every card the freeze pins while the
 * focus thread is attended. The slots cover the focus card itself, its
 * family root's card (the family does not re-lane while its member is
 * attended), and — for feature-group boxes — all of the box's members (a
 * half-pinned box would render split across lanes).
 */
export interface AttentionCapture {
  origin: AttentionOrigin;
  /** The thread the operator's attention is on. */
  focusId: string;
  /** The grouping the capture was taken under (a grouping switch re-lanes
   *  the board; a capture from another grouping must not pin into it). */
  view: GroupBy;
  slots: readonly AttentionSlot[];
  /** The focus renders as a nested row: pin it under this parent's rows. */
  rowPin: { parentId: string; childId: string; index: number } | null;
  /** The capture's epoch ms; the freshest capture wins a conflict. */
  capturedAt: number;
}

/**
 * One capture on the parent lane view: the lane order slot and row bucket
 * the attended card held at capture time.
 */
export interface LaneCapture {
  origin: AttentionOrigin;
  focusId: string;
  /** The lane (family root id) the card sat in. */
  laneId: string;
  /** The lane's order index in the lane list at capture. */
  laneIndex: number;
  /** The row bucket the focus card sat in; null when the focus IS the parent. */
  row: { id: string; index: number } | null;
  capturedAt: number;
}

/**
 * User-initiated placements win over the pin: strips every slot, lane claim,
 * and row pin the capture held for these thread ids. The caller re-captures
 * (or releases) once the gesture's write lands — see the recapture effect.
 */
export function stripCapturedIds(
  capture: AttentionCapture,
  removedIds: ReadonlySet<string>,
): AttentionCapture {
  const slots = capture.slots.filter((slot) => !removedIds.has(slot.threadId));
  const rowPin =
    capture.rowPin !== null && removedIds.has(capture.rowPin.childId) ? null : capture.rowPin;
  if (slots.length === capture.slots.length && rowPin === capture.rowPin) return capture;
  return { ...capture, slots: slots as readonly AttentionSlot[], rowPin };
}

/**
 * Deep equality of captures, ignoring the capture timestamp (a rebuild's
 * `capturedAt` always differs; equality must NOT churn state on it).
 */
export function capturesEqual(
  a: AttentionCapture | null,
  b: AttentionCapture | null,
): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a.origin !== b.origin || a.focusId !== b.focusId || a.view !== b.view) return false;
  if (a.slots.length !== b.slots.length) return false;
  for (let i = 0; i < a.slots.length; i += 1) {
    const left = a.slots[i]!;
    const right = b.slots[i]!;
    if (
      left.threadId !== right.threadId ||
      left.columnId !== right.columnId ||
      left.index !== right.index
    ) {
      return false;
    }
  }
  const leftRow = a.rowPin;
  const rightRow = b.rowPin;
  if (leftRow === null || rightRow === null) return leftRow === rightRow;
  return (
    leftRow.parentId === rightRow.parentId &&
    leftRow.childId === rightRow.childId &&
    leftRow.index === rightRow.index
  );
}

/**
 * The per-build plan the assembly consumes: attention lanes win over every
 * lane claim (family R4 overrides, group-box overrides, the pane's own
 * natural-lane capture), slots pin the final rendered lists, and
 * stayNested/rowSlots hold attended children in place.
 */
export interface AttentionFreezePlan {
  columns: ReadonlyMap<string, { id: string; label: string }>;
  slots: ReadonlyMap<string, number>;
  stayNested: ReadonlySet<string>;
  rowSlots: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export const EMPTY_ATTENTION_FREEZE: AttentionFreezePlan = {
  columns: new Map(),
  slots: new Map(),
  stayNested: new Set(),
  rowSlots: new Map(),
};

export function isAttentionFreezeEmpty(plan: AttentionFreezePlan): boolean {
  return (
    plan.columns.size === 0 &&
    plan.slots.size === 0 &&
    plan.stayNested.size === 0 &&
    plan.rowSlots.size === 0
  );
}

/**
 * Merge captures into one per-build plan. Captures may overlap (a hovered
 * open card is pinned by both origins): the freshest capture wins each
 * thread, so attention that captured after the pane reflects the latest
 * rendered placement.
 */
export function compileAttentionFreezes(
  captures: readonly AttentionCapture[],
): AttentionFreezePlan {
  const columns = new Map<string, { id: string; label: string }>();
  const slots = new Map<string, number>();
  const stayNested = new Set<string>();
  const rowSlots = new Map<string, Map<string, number>>();
  const ordered = [...captures].sort((a, b) => a.capturedAt - b.capturedAt);
  for (const capture of ordered) {
    for (const slot of capture.slots) {
      columns.set(slot.threadId, { id: slot.columnId, label: slot.label });
      slots.set(slot.threadId, slot.index);
    }
    if (capture.rowPin !== null) {
      const parentSlots = rowSlots.get(capture.rowPin.parentId);
      const pins =
        parentSlots === undefined
          ? new Map<string, number>()
          : new Map(parentSlots);
      pins.set(capture.rowPin.childId, capture.rowPin.index);
      rowSlots.set(capture.rowPin.parentId, pins);
      stayNested.add(capture.rowPin.childId);
    }
  }
  return { columns, slots, stayNested, rowSlots };
}

/** Where a thread's card renders in the assembled columns, or null. */
export function columnPlacementOf(
  columns: readonly BoardColumn[],
  threadId: string,
): AttentionSlot | null {
  for (const column of columns) {
    const index = column.threads.findIndex((thread) => thread.id === threadId);
    if (index !== -1) {
      return { threadId, columnId: column.id, label: column.label, index };
    }
  }
  return null;
}

/**
 * Where a thread's card renders on the parent lane board, or null. A lane
 * parent has no row pin — its card IS the lane header; a row card pins its
 * row bucket and slot.
 */
export function laneCaptureOf(
  lanes: readonly ParentLane[],
  threadId: string,
  options: { origin: AttentionOrigin; capturedAt: number },
): LaneCapture | null {
  for (const [laneIndex, lane] of lanes.entries()) {
    if (lane.parent.id === threadId) {
      return { ...options, focusId: threadId, laneId: lane.id, laneIndex, row: null };
    }
    for (const row of lane.rows) {
      const index = row.threads.findIndex((card) => card.id === threadId);
      if (index !== -1) {
        return {
          ...options,
          focusId: threadId,
          laneId: lane.id,
          laneIndex,
          row: { id: row.id, index },
        };
      }
    }
  }
  return null;
}

/**
 * Re-pin a rendered list: remove every pinned card, then reinsert each at
 * its captured index (ascending, clamped to the list's length). Cards the
 * board would have sorted above the pinned slot stay above — nothing but
 * the pinned cards' positions change.
 */
export function applySlotPins<T extends { id: string }>(
  threads: readonly T[],
  slots: ReadonlyMap<string, number>,
): T[] {
  if (slots.size === 0) return [...threads];
  const entries = [...slots.entries()].sort((a, b) => a[1] - b[1]);
  const rest = threads.filter((thread) => !slots.has(thread.id));
  const out = [...rest];
  for (const [threadId, index] of entries) {
    const thread = threads.find((card) => card.id === threadId);
    if (thread === undefined) continue;
    const at = Math.max(0, Math.min(index, out.length));
    out.splice(at, 0, thread);
  }
  return out;
}

/** Pin nested rows to their captured indexes (same contract as slots). */
export function pinRowOrder(
  children: readonly PluginSidebarThread[],
  slots: ReadonlyMap<string, number>,
): PluginSidebarThread[] {
  return applySlotPins(children, slots);
}

/**
 * Apply the parent lane view's freezes to a freshly built lane list: each
 * attended lane returns to its captured order index, and each attended row
 * card returns to its captured row bucket and slot. Lanes pin in captured
 * order (ascending, clamped) so several freezes keep their relative order;
 * the row restorations run against the pinned lanes.
 */
export function applyLaneFreezes(
  lanes: readonly ParentLane[],
  captures: readonly LaneCapture[],
): ParentLane[] {
  if (captures.length === 0) return [...lanes];
  const frozen = [...captures].sort((a, b) => a.laneIndex - b.laneIndex);
  const pinnedIds = new Set(frozen.map((capture) => capture.laneId));
  const rest = lanes.filter((lane) => !pinnedIds.has(lane.id));
  const out = [...rest];
  for (const capture of frozen) {
    const lane = lanes.find((entry) => entry.id === capture.laneId);
    if (lane === undefined) continue; // the lane left the board; nothing to pin
    const at = Math.max(0, Math.min(capture.laneIndex, out.length));
    out.splice(at, 0, lane);
  }
  // Row restorations: the attended card returns to its captured row and
  // slot, wherever the live build would have landed it.
  for (const capture of frozen) {
    if (capture.row === null) continue; // the focus is the lane parent
    const laneIndex = out.findIndex((entry) => entry.id === capture.laneId);
    if (laneIndex === -1) continue;
    const capturedRow = capture.row;
    const card = findCardInLane(out[laneIndex]!, capture.focusId);
    if (card === undefined) continue; // the card left its lane; nothing to pin
    const rows = out[laneIndex]!.rows.map((row) => ({ ...row, threads: [...row.threads] }));
    for (const row of rows) {
      const at = row.threads.findIndex((entry) => entry.id === capture.focusId);
      if (at !== -1) row.threads.splice(at, 1);
    }
    const target = rows.find((row) => row.id === capturedRow.id);
    if (target === undefined) continue; // unknown row id: leave the build as is
    const at = Math.max(0, Math.min(capturedRow.index, target.threads.length));
    target.threads.splice(at, 0, card);
    out[laneIndex] = { ...out[laneIndex]!, rows };
  }
  return out;
}

function findCardInLane(lane: ParentLane, threadId: string): PluginSidebarThread | undefined {
  for (const row of lane.rows) {
    const found = row.threads.find((card) => card.id === threadId);
    if (found !== undefined) return found;
  }
  return undefined;
}
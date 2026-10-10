import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { GroupRunItem } from "./group-boxes";

/**
 * The lane-transport dissolve (the Star Trek transporter wipe): when a card
 * relocates between two lanes in one commit it does not teleport-jump any
 * more. Its old lane keeps a ghost card in the exact old slot for the
 * wipe-out, then that slot's space collapses; at its new lane the card sits
 * in the flow from wipe-in's FIRST frame (neighbors reflow as the sweep
 * starts) and dissolves in top-down. Both wipes ease in slightly.
 */

/** Wipe-out: the old lane keeps the ghost this long, then collapses. */
export const TRANSPORT_WIPE_OUT_MS = 260;
/** Wipe-in: the arriving slot is unhidden before the wipe-out ends. */
export const TRANSPORT_WIPE_IN_MS = 240;
/** The old slot's reserved space closing after the wipe-out. */
export const TRANSPORT_COLLAPSE_MS = 180;

/**
 * "Slight ease-in": the sweep starts gently and accelerates into its end —
 * a fixed-velocity slide reads mechanical, and a full ease-in cubic
 * hesitates too long for a 240ms wipe.
 */
export const TRANSPORT_EASE = "cubic-bezier(0.42, 0.08, 0.6, 0.5)";

/**
 * Lane moves over this count in ONE commit (a grouping change re-deriving
 * every lane, a batch curation action) skip the dissolve entirely: a whole
 * board of wipe-outs is a view switch's reflow dressed up as an effect, and
 * reads as chaos. Small batches (a sweep confirm moving a handful of cards)
 * keep the effect.
 */
export const TRANSPORT_BATCH_CAP = 12;

/** One relocated card, planned from the previous commit's lane snapshot. */
export interface LaneTransport {
  threadId: string;
  /** The PREVIOUS thread snapshot, so the ghost renders pre-move visuals. */
  thread: PluginSidebarThread;
  fromColumnId: string;
  /** The card's slot index in its old lane (boxes count member slots). */
  fromIndex: number;
  toColumnId: string;
}

/** The old lane's ghost state: wiping, then its reserved space collapsing. */
export type TransportOutPhase = "wiping-out" | "collapsing";
/** The new lane's arrival state: the wipe, then the plain card. */
export type TransportArrivalPhase = "wiping-in" | "settled";

/** A `LaneTransport` as the board plays it: generation-stamped, phased. */
export interface TransportPlay extends LaneTransport {
  /** Bumped per plan, so a re-located card restarts its timers and its wipe. */
  gen: number;
  phase: TransportOutPhase;
  arrival: TransportArrivalPhase;
}

/** Tailwind's gap-1.5 on the card lists, in px (the static collapse end-state). */
export const TRANSPORT_ROW_GAP_PX = 6;

/** A rendered column slice. Shaped like BoardColumn, loose for test reuse. */
export interface TransportColumnLike {
  id: string;
  threads: readonly PluginSidebarThread[];
}

/**
 * One thread id → its lane signature. A thread can hold TWO cards (the Done
 * projection renders in Done while the live card stays where it was), so the
 * signature is the SORTED join of every lane holding the card ("done|unread");
 * lane sets that merely gain or lose a member are multiplicity changes, not
 * relocations, and the planner skips them.
 */
export function laneSignature(
  columns: readonly TransportColumnLike[],
): ReadonlyMap<string, string> {
  const byThread = new Map<string, string[]>();
  for (const column of columns) {
    for (const card of column.threads) {
      const lanes = byThread.get(card.id) ?? [];
      if (!lanes.includes(column.id)) lanes.push(column.id);
      byThread.set(card.id, lanes);
    }
  }
  const signature = new Map<string, string>();
  for (const [id, lanes] of byThread) signature.set(id, [...lanes].sort().join("|"));
  return signature;
}

/**
 * Diff the previous lane snapshot against the new columns and plan one
 * transport per card that moved exactly: one lane before, ONE after, different.
 * Vanishing cards (archive, filter), brand-new cards, and multiplicity
 * changes (projection cards appearing or clearing) are plain reflows — the
 * transporter effect is for relocation only.
 */
export function planLaneTransports(
  prevLaneByThread: ReadonlyMap<string, string>,
  prevThreads: ReadonlyMap<string, PluginSidebarThread>,
  columns: readonly TransportColumnLike[],
): readonly LaneTransport[] {
  const nextLaneByThread = laneSignature(columns);
  const moves: LaneTransport[] = [];
  for (const [threadId, nextLane] of nextLaneByThread) {
    const prevLane = prevLaneByThread.get(threadId);
    if (prevLane === undefined) continue; // brand-new card
    if (prevLane === nextLane) continue; // kept its lane
    if (prevLane.includes("|") || nextLane.includes("|")) continue; // multiplicity change
    const snapshot = prevThreads.get(threadId);
    if (snapshot === undefined) continue; // no ghost visuals available
    const prevColumn = columns.find((candidate) => candidate.id === prevLane);
    const fromIndex = prevColumn?.threads.findIndex((card) => card.id === threadId) ?? -1;
    moves.push({
      threadId,
      thread: snapshot,
      fromColumnId: prevLane,
      fromIndex: Math.max(fromIndex, 0),
      toColumnId: nextLane,
    });
  }
  return moves;
}

/** One render entry in a lane's card list: a display run or an injected ghost. */
export type GhostSlotEntry<T extends LaneTransport = LaneTransport> =
  | { kind: "run"; run: GroupRunItem }
  | { kind: "ghost"; ghost: T };

/**
 * Weave the old lane's ghost cards into its run list at their old card-slot
 * positions. `fromIndex` counts card slots (a box run spends one slot per
 * member); ghosts inject BEFORE the run that swallows their index, clamped
 * to the lane's end when the old lane reflowed in the meantime.
 */
export function insertGhostSlots<T extends LaneTransport>(
  columnRuns: readonly GroupRunItem[],
  ghosts: readonly T[],
): readonly GhostSlotEntry<T>[] {
  const sorted = [...ghosts].sort((a, b) => a.fromIndex - b.fromIndex);
  const entries: GhostSlotEntry<T>[] = [];
  let slot = 0;
  let next = 0;
  for (const run of columnRuns) {
    const runSlots = run.kind === "single" ? 1 : run.box.members.length;
    while (next < sorted.length && sorted[next].fromIndex <= slot) {
      entries.push({ kind: "ghost", ghost: sorted[next] });
      next += 1;
    }
    entries.push({ kind: "run", run });
    slot += runSlots;
  }
  while (next < sorted.length) {
    entries.push({ kind: "ghost", ghost: sorted[next] });
    next += 1;
  }
  return entries;
}

/**
 * The reveal and keep-in-view effects look cards up by `data-thread-card`;
 * a transport ghost renders that attribute too (it renders a real card), and
 * it sits in the OLD lane — for a forward move the ghost is DOM-first and a
 * bare `querySelector` would hand the effects a dissolving ghost instead of
 * the live card. Ghost subtrees never satisfy a lookup.
 */
export function firstRealCard(
  root: Element | null,
  threadId: string,
): HTMLElement | null {
  if (root === null) return null;
  const matches = root.querySelectorAll(`[data-thread-card]`);
  for (let index = 0; index < matches.length; index += 1) {
    const candidate = matches[index];
    if (candidate.getAttribute("data-thread-card") !== threadId) continue;
    if (candidate.closest("[data-transport-ghost]") !== null) continue;
    return candidate as HTMLElement;
  }
  return null;
}

/** Wipe-out frames: the card dematerializes top-down with a sparkle bloom. */
export function wipeOutKeyframes(): Keyframe[] {
  return [
    { clipPath: "inset(0% 0 0 0)", opacity: 1, filter: "none", offset: 0 },
    {
      clipPath: "inset(65% 0 0 0)",
      opacity: 0.85,
      filter: "blur(1.5px) brightness(1.3)",
      offset: 0.55,
    },
    {
      clipPath: "inset(100% 0 0 0)",
      opacity: 0,
      filter: "blur(4px) brightness(1.8)",
    },
  ];
}

/** Wipe-in frames: the card materializes top-down out of the beam's bloom. */
export function wipeInKeyframes(): Keyframe[] {
  return [
    {
      clipPath: "inset(100% 0 0 0)",
      opacity: 0,
      filter: "blur(3px) brightness(1.6)",
      offset: 0,
    },
    {
      clipPath: "inset(35% 0 0 0)",
      opacity: 0.9,
      filter: "blur(0.5px) brightness(1.2)",
      offset: 0.6,
    },
    { clipPath: "inset(0% 0 0 0)", opacity: 1, filter: "none" },
  ];
}

/**
 * The collapse frames: the emptied slot's reserved space closes to EXACTLY
 * the no-ghost layout. Flex `gap` still reserves spacing around a zero-height
 * item, so the margins borrow half the row gap on each side — the final
 * frame is pixel-identical to the ghost's removal, and removing the node
 * after the animation lands without a pop.
 */
export function ghostCollapseKeyframes(
  heightPx: number,
  rowGapPx: number,
): Keyframe[] {
  const gapHalf = `${-(rowGapPx / 2)}px`;
  return [
    { maxHeight: `${heightPx}px`, marginTop: "0px", marginBottom: "0px", offset: 0 },
    { maxHeight: "0px", marginTop: gapHalf, marginBottom: gapHalf },
  ];
}

/**
 * The row gap of a lane's card list in px (Tailwind's gap-1.5 = 6px; jsdom
 * computes it empty). Measured, not assumed, so a theme change to the gap
 * keeps the collapse seamless.
 */
export function cardRowGapPx(list: Element | null): number {
  if (list === null) return 6;
  const gap = getComputedStyle(list).rowGap;
  const parsed = Number.parseFloat(gap);
  return Number.isFinite(parsed) ? parsed : 6;
}
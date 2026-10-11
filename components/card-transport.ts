import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { GroupRunItem } from "./group-boxes";
import { columnRunItems } from "./group-boxes";
import type { GroupBoxMap } from "./group-boxes";

/**
 * The lane-transport dissolve (the Star Trek transporter wipe): when a card
 * relocates between two lanes in one commit it does not teleport-jump any
 * more. Its old lane keeps a ghost card in the exact old slot for the
 * wipe-out, then that slot's space collapses; at its new lane the card sits
 * in the flow from wipe-in's FIRST frame (neighbors reflow as the sweep
 * starts) and dissolves in top-down. Both wipes ease in slightly.
 */

/** Wipe-out: the old lane keeps the ghost this long, then collapses. */
export const TRANSPORT_WIPE_OUT_MS = 420;
/** Wipe-in: the arriving slot is unhidden before the wipe-out ends. */
export const TRANSPORT_WIPE_IN_MS = 380;
/** The old slot's reserved space closing after the wipe-out. */
export const TRANSPORT_COLLAPSE_MS = 200;

/**
 * "Ease-in", tuned longer at the operator's request: the sweep's first half
 * now crawls (y1 = 0), so the dissolve lingers where the card sat before
 * accelerating into its exit — a slower read than the original slight
 * curve, but still not a full ease-in cubic's hang.
 */
export const TRANSPORT_EASE = "cubic-bezier(0.5, 0, 0.6, 0.4)";

/**
 * Lane moves over this count in ONE commit (a grouping change re-deriving
 * every lane, a batch curation action) skip the dissolve entirely: a whole
 * board of wipe-outs is a view switch's reflow dressed up as an effect, and
 * reads as chaos. Small batches (a sweep confirm moving a handful of cards)
 * keep the effect.
 */
export const TRANSPORT_BATCH_CAP = 12;

/** One relocated transport unit, planned from the previous commit's snapshot. */
export interface LaneTransport {
  /**
   * The unit id: a card's thread id, or a box run's group id (the dashed
   * container transported as one piece).
   */
  threadId: string;
  /**
   * The PREVIOUS thread snapshot, so the ghost renders pre-move visuals —
   * the unit's anchor card (a run's first member).
   */
  thread: PluginSidebarThread;
  fromColumnId: string;
  /** The unit's slot index in its old lane (a box run occupies member slots). */
  fromIndex: number;
  toColumnId: string;
  /**
   * A run transport's PRE-move member snapshots, in the old column's
   * display order. Absent for single-card transports.
   */
  members?: readonly PluginSidebarThread[];
  /** A run transport's previous box name — the ghost's label. */
  boxName?: string;
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
 *
 * `prevColumns` (the PREVIOUS commit's columns) gives the card's TRUE old
 * slot: the moved card has already left its old lane in the NEXT columns,
 * so a lookup there would degrade every ghost slot to the lane top.
 */
export function planLaneTransports(
  prevLaneByThread: ReadonlyMap<string, string>,
  prevThreads: ReadonlyMap<string, PluginSidebarThread>,
  columns: readonly TransportColumnLike[],
  prevColumns?: readonly TransportColumnLike[],
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
    const prevColumn = (prevColumns ?? columns).find((candidate) => candidate.id === prevLane);
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

/**
 * A box run as ONE transport unit: the unit the lane diff tracks, so a
 * whole dashed box relocating between lanes plans a single dissolve instead
 * of one per member. Keyed by group id.
 */
export interface RunUnit {
  groupId: string;
  name: string;
  /** The column the unit's box renders in. */
  columnId: string;
  /** The members in the column's own display order (self-inclusive). */
  memberIds: readonly string[];
}

/**
 * The run units per commit, read off the columns' own display order via the
 * same walker the render path uses (one source of truth for what a box is).
 * A group id appears once — the first column that forms the run wins (a
 * box split ≥ 2 + ≥ 2 across columns is a degenerate caller state; the
 * overrides keep a box whole in one lane).
 */
export function runUnits(
  columns: readonly {
    id: string;
    threads: readonly PluginSidebarThread[];
  }[],
  groupBoxOf: GroupBoxMap,
): ReadonlyMap<string, RunUnit> {
  const units = new Map<string, RunUnit>();
  for (const column of columns) {
    for (const item of columnRunItems(column, groupBoxOf)) {
      if (item.kind !== "box") continue;
      const groupId = item.box.groupId;
      if (units.has(groupId)) continue;
      units.set(groupId, {
        groupId,
        name: item.box.name,
        columnId: column.id,
        memberIds: item.box.members.map((member) => member.id),
      });
    }
  }
  return units;
}

/**
 * Fold the per-thread moves into run transports where a box moved cleanly:
 * every member moved, all between the same two lanes, and the membership
 * (ids AND order) unchanged. Anything else — a split, a member joining or
 * leaving while the box relanes, a reordered run — stays per-thread, the
 * same way multiplicity changes stay plain reflows.
 *
 * A folded transport's `threadId` is the group id: the unit the timers, the
 * ghost slot, and the arrival map key on. `members` carries the PRE-move
 * snapshots so the ghost renders the box the board had.
 */
export function collapseRunTransports(
  moves: readonly LaneTransport[],
  prevRunUnits: ReadonlyMap<string, RunUnit> = new Map(),
  nextRunUnits: ReadonlyMap<string, RunUnit> = new Map(),
  prevThreads: ReadonlyMap<string, PluginSidebarThread> = new Map(),
): readonly LaneTransport[] {
  let result = [...moves];
  for (const [groupId, unit] of nextRunUnits) {
    const prevUnit = prevRunUnits.get(groupId);
    if (prevUnit === undefined) continue;
    if (prevUnit.memberIds.join("\u0000") !== unit.memberIds.join("\u0000")) {
      continue; // membership or order changed: not a unit relocation
    }
    const memberMoves: (LaneTransport | undefined)[] = unit.memberIds.map(
      (memberId) => {
        const move = result.find((candidate) => candidate.threadId === memberId);
        if (move === undefined) return undefined;
        if (move.fromColumnId !== prevUnit.columnId || move.toColumnId !== unit.columnId) {
          return undefined;
        }
        return move;
      },
    );
    if (memberMoves.some((move) => move === undefined)) continue;
    const members: PluginSidebarThread[] = [];
    let snapshotsComplete = true;
    for (const memberId of unit.memberIds) {
      const snapshot = prevThreads.get(memberId);
      if (snapshot === undefined) {
        snapshotsComplete = false;
        break;
      }
      members.push(snapshot);
    }
    if (!snapshotsComplete) continue; // no ghost visuals, stay per-thread
    const removeIds = new Set(unit.memberIds);
    const kept = result.filter((candidate) => !removeIds.has(candidate.threadId));
    const anchor = memberMoves[0]!;
    kept.splice(
      result.findIndex((candidate) => removeIds.has(candidate.threadId)),
      0,
      {
        threadId: groupId,
        thread: members[0]!,
        members,
        boxName: prevUnit.name,
        fromColumnId: prevUnit.columnId,
        fromIndex: anchor.fromIndex,
        toColumnId: unit.columnId,
      },
    );
    result = kept;
  }
  return result;
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

/** Wipe-out frames: the card dematerializes top-down, blooming as it fades. */
export function wipeOutKeyframes(): Keyframe[] {
  return [
    { clipPath: "inset(0% 0 0 0)", opacity: 1, filter: "none", offset: 0 },
    {
      clipPath: "inset(65% 0 0 0)",
      opacity: 0.8,
      filter: "blur(3px) brightness(1.45)",
      offset: 0.55,
    },
    {
      clipPath: "inset(100% 0 0 0)",
      opacity: 0,
      filter: "blur(10px) brightness(2.1)",
    },
  ];
}

/** Wipe-in frames: the card materializes top-down out of the beam's bloom. */
export function wipeInKeyframes(): Keyframe[] {
  return [
    {
      clipPath: "inset(100% 0 0 0)",
      opacity: 0,
      filter: "blur(7px) brightness(1.75)",
      offset: 0,
    },
    {
      clipPath: "inset(35% 0 0 0)",
      opacity: 0.9,
      filter: "blur(1.5px) brightness(1.25)",
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
  startMarginTopPx: string = "0px",
  startMarginBottomPx: string = "0px",
): Keyframe[] {
  const gapHalf = `${-(rowGapPx / 2)}px`;
  return [
    {
      maxHeight: `${heightPx}px`,
      marginTop: startMarginTopPx,
      marginBottom: startMarginBottomPx,
      offset: 0,
    },
    { maxHeight: "0px", marginTop: gapHalf, marginBottom: gapHalf },
  ];
}

/**
 * The shimmer's glint field: a transporter's beam does not wipe alone — a
 * field of glints rides the sweep, twinkling in and fading as they drift
 * upward. Deterministic per seed (same seed, same layout), so a re-render
 * mid-sweep never reshuffles the sparkle, and every glint's whole life
 * (delay + duration) fits inside its phase, so nothing keeps sparkling
 * after the transport machine moved on.
 */
export const TRANSPORT_SPARK_COUNT = 14;

/** One glint's place and life inside a phase's shimmer. */
export interface TransportSpark {
  /** Across the slot's width, in % (0..100). */
  leftPct: number;
  /** Down the slot's height, in % (0..100) — the glint's start line. */
  topPct: number;
  delayMs: number;
  durationMs: number;
  /** The upward drift in px: a glint rises as it twinkles out. */
  driftPx: number;
  widthPx: number;
  heightPx: number;
  /** The twinkle's peak opacity. */
  peak: number;
}

/** A tiny seeded LCG: the field must be identical across re-renders. */
function sparkRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shimmerSparks(
  phaseMs: number,
  count: number = TRANSPORT_SPARK_COUNT,
  seed: number = 20126,
): TransportSpark[] {
  const rng = sparkRng(seed);
  const sparks: TransportSpark[] = [];
  for (let index = 0; index < count; index += 1) {
    const durationMs = Math.max(80, Math.round(phaseMs * (0.25 + rng() * 0.3)));
    // Start late enough that the whole life ends inside the phase: a glint
    // fades out before the sweep's final frame, never after it.
    const delayMs = Math.min(
      Math.round(rng() * phaseMs * 0.55),
      Math.max(0, phaseMs - durationMs),
    );
    sparks.push({
      leftPct: 4 + rng() * 92,
      topPct: 2 + rng() * 86,
      delayMs,
      durationMs,
      driftPx: 6 + rng() * 8,
      widthPx: 1.5 + rng() * 1.5,
      heightPx: 5 + rng() * 7,
      peak: 0.55 + rng() * 0.4,
    });
  }
  return sparks;
}

/**
 * One glint's twinkle: rise to its peak, then fade while drifting upward —
 * energy leaving the card, not dust settling onto it.
 */
export function sparkKeyframes(spark: TransportSpark): Keyframe[] {
  const drift = `${spark.driftPx.toFixed(1)}px`;
  return [
    {
      opacity: 0,
      transform: `translateY(${(spark.driftPx / 2).toFixed(1)}px) scaleY(0.4)`,
      offset: 0,
    },
    { opacity: spark.peak, transform: "translateY(0px) scaleY(1)", offset: 0.45 },
    { opacity: 0, transform: `translateY(-${drift}) scaleY(0.5)` },
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

/**
 * One computed margin in px. The collapse must START from the ghost's real
 * margins: the collapsing phase's static styles are already applied when
 * the animation claims the element, and a keyframe starting at 0 would
 * jump the invisible ghost's neighbors before the smooth close begins.
 * An unreadable computed value reads as 0px (a ghost with no own margin).
 */
export function computedMarginPx(element: Element, side: "Top" | "Bottom"): string {
  const raw = getComputedStyle(element)[`margin${side}`];
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? `${parsed}px` : "0px";
}
// Rank-ordering helpers for the board's columns.
//
// This module is the WIRE/CLIENT half of the rank model: a column's manual
// order as a SPARSE, ORDERED list of thread ids (the projection every board
// surface reads and writes over RPC). Ids absent from the list are unranked
// and sort below every ranked card, in the board's derived order
// (newest-first). The list is never re-densified and never renumbered when
// a card leaves the column: a card that leaves Unread leaves a gap, and
// re-entering Unread puts it back in that gap.
//
// The STORED half is per-card fractional ranks (lib/rank-fractions.ts): the
// server derives these lists from the fraction map on every read, keeps the
// RPC wire format identical, and a rank_move writes only the fragments the
// move must touch — a stale window's `visibleIds` can no longer rewrite
// ranked cards it never aimed at. This module's move helpers
// (`applyMove`/`appendTo`/`displayAfterMove`/`displayAfterUnitMove`) are the
// shared display semantics both the client preview and the server's move op
// compose; `applyMoveVisible`/`applyUnitMoveVisible` are the client's
// OPTIMISTIC PREVIEW of a gesture. See docs/musings/2026-09-25-rank-ordering.md
// and lib/rank-fractions.ts.
//
// Pure module: no host, no SDK, no React, so the RPC layer and tests can drive
// it directly.
import type { GroupBy } from "../components/grouping";

/** The board's rank key in the plugin KV store. */
export const RANK_KV_KEY = "focus-board:rank-orders";

/** One column's sparse order: ranked thread ids, first = topmost. */
export type ColumnOrder = readonly string[];

/** columnKey → sparse order. Missing key = that column has no ranks yet. */
export type RankStore = Readonly<Record<string, ColumnOrder>>;

/**
 * The storage key for a column's order.
 *
 * Lane keys (pinned, done) are grouping-independent because those columns
 * mean the same thing under every grouping. Every other column is namespaced
 * by its grouping, so a project id that happens to be "unread" cannot collide
 * with the Attention lane's unread column.
 */
export function columnRankKey(groupBy: GroupBy, columnId: string): string {
  if (columnId === "pinned" || columnId === "done") return columnId;
  return `${groupBy}:${columnId}`;
}

/**
 * The storage key for ONE family's nested-children order — the order of the
 * child rows rendering under `parentId`'s card.
 *
 * The `child:` prefix is the collision guard: a column key is always a bare
 * lane name or `${groupBy}:${columnId}`, and no grouping is named "child",
 * so a thread id can never fork a column's order into a family's rows. A
 * parent without an id would silently mint a mystery slot; that is a caller
 * bug, not data to file under "".
 */
export const CHILD_RANK_PREFIX = "child:";

export function childRankKey(parentId: string): string {
  if (parentId === "") throw new Error("childRankKey: parent id is empty");
  return `${CHILD_RANK_PREFIX}${parentId}`;
}

/**
 * Parse a stored rank row. Absent (undefined/null) means "no ranks anywhere"
 * → empty store, which is not a failure: a fresh install has no row. A
 * present-but-malformed row THROWS (fail loud, never coerce) — a half-read
 * order silently reverts to recency and looks like the drag never saved.
 */
export function parseRankStore(raw: unknown): RankStore {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    const got = Array.isArray(raw) ? "array" : typeof raw;
    throw new Error(`rank store: expected object, got ${got}`);
  }
  const out: Record<string, string[]> = {};
  for (const [columnKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) {
      throw new Error(
        `rank store: column ${JSON.stringify(columnKey)} is not an array`,
      );
    }
    for (const id of value) {
      if (typeof id !== "string" || id === "") {
        throw new Error(
          `rank store: column ${JSON.stringify(columnKey)} has a non-string id ${JSON.stringify(id)}`,
        );
      }
    }
    // De-duplicate defensively: a repeat would make index lookups
    // order-dependent for no benefit. Built with defineProperty, never a
    // plain assignment: a column literally named "__proto__" would
    // otherwise invoke the prototype setter and silently vanish.
    Object.defineProperty(out, columnKey, {
      value: [...new Set(value as string[])],
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** The row shape written back to storage — must satisfy parseRankStore. */
export function rankRowFromStore(store: RankStore): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(store).map(([columnKey, order]) => [columnKey, [...order]]),
  );
}

/** A column's order, or an empty one when it has never been ranked. */
export function orderForColumn(
  store: RankStore,
  columnKey: string,
): ColumnOrder {
  return store[columnKey] ?? [];
}

/** True when the column has at least one ranked card. */
export function columnIsRanked(store: RankStore, columnKey: string): boolean {
  return (store[columnKey]?.length ?? 0) > 0;
}

/**
 * The drag type that marks a drag as originating in `rankKey`'s lane.
 *
 * The lane rides in the drag TYPE NAME, not in a payload value. A real browser
 * holds the drag payload write-only until the drop — `getData` returns ""
 * during `dragover` — so a handler that decides from `getData` mid-drag
 * silently sees nothing, never calls `preventDefault`, and the browser then
 * refuses the drop outright. `types` is readable for the whole drag, so the
 * lane is discoverable at exactly the moment the drop must be authorised.
 * This is the difference between a reorder that works and one that does
 * nothing at all for the operator.
 *
 * Lowercased because browsers lowercase custom drag type names.
 */
export const RANK_DRAG_TYPE_PREFIX = "application/x-focus-board-rank:";

/** Drag payload key for the moved card's id; readable at drop time. */
export const DRAG_ID_KEY = "text/focus-board-id";

/**
 * The drag type that marks a drag started on the collapsed strip's dots
 * (issue #249, goals 3 and 4).
 *
 * A dot drag is not a lane drag: it reorders one tier of ONE family and must
 * never reach the floor, header, or card drop paths — un-parenting a member
 * is the explicit morph gesture of a later cut, never a side effect of
 * releasing over a column. The mark rides the drag TYPES the same way the
 * lane marker does (readable mid-drag), and every non-strip drop surface
 * refuses any drag that carries it. Never prefixed with a key: the mark is
 * not routable, it only says "I am a dot drag".
 *
 * Lowercased because browsers lowercase custom drag type names.
 */
export const DOT_DRAG_TYPE = "application/x-focus-board-dot";

/** Does this drag carry the dot-drag mark? Safe mid-drag. */
export function isDotDrag(types: ArrayLike<string>): boolean {
  for (let i = 0; i < types.length; i++) {
    if (types[i] === DOT_DRAG_TYPE) return true;
  }
  return false;
}

export const rankDragType = (rankKey: string): string =>
  `${RANK_DRAG_TYPE_PREFIX}${rankKey.toLowerCase()}`;

/** Is this drag the one that started in `rankKey`'s lane? Safe mid-drag. */
export function isLaneDrag(
  types: ArrayLike<string>,
  rankKey: string,
): boolean {
  const wanted = rankDragType(rankKey);
  for (let i = 0; i < types.length; i++) {
    if (types[i] === wanted) return true;
  }
  return false;
}

/**
 * Append to the bottom of the order. Separate from applyMove because "drop
 * below the last card" and "drop at the top" are different intents that share
 * a null in the RPC payload.
 */
export function appendTo(order: ColumnOrder, threadId: string): string[] {
  if (threadId === "") return [...order];
  return [...order.filter((id) => id !== threadId), threadId];
}

/**
 * Place `threadId` immediately before `beforeId` in the order, or at the top
 * when `beforeId` is null. Returns a NEW order; the input is untouched.
 *
 * Only the moved card's position changes. Every other ranked card keeps its
 * relative position, and a `beforeId` that is not currently ranked still
 * anchors the insertion (the drop target is the card above the gap, not
 * necessarily a ranked one). Moving a card to where it already is returns an
 * equal order, so the caller can skip a pointless write.
 */
export function applyMove(
  order: ColumnOrder,
  threadId: string,
  beforeId: string | null,
): string[] {
  if (threadId === "" || beforeId === threadId) return [...order];
  const rest = order.filter((id) => id !== threadId);
  if (beforeId === null) return [threadId, ...rest];
  const at = rest.indexOf(beforeId);
  // An anchor that is not in the order (e.g. a filtered-out card) appends
  // rather than guessing: guessing would put the card in an arbitrary slot
  // and silently reorder on the next read.
  if (at === -1) return [...rest, threadId];
  return [...rest.slice(0, at), threadId, ...rest.slice(at)];
}

/**
 * The column's DISPLAYED order after a move: `visibleIds` rearranged, without
 * touching stored ranks. The server's fraction move op composes this display
 * math, and the board's position announcement reads the card's slot out of
 * it, so both agree with what the operator sees.
 */
export function displayAfterMove(
  visibleIds: readonly string[],
  threadId: string,
  beforeId: string | null,
  toEnd: boolean,
): string[] {
  return toEnd
    ? appendTo(visibleIds, threadId)
    : applyMove(visibleIds, threadId, beforeId);
}

/**
 * The OPTIMISTIC PREVIEW of a move, client-side (the only remaining
 * consumer): app.tsx's `onRankMove` derives the projected stored order the
 * dropping window's own view supports, so the card snaps to its slot
 * immediately and the rank-changed refetch confirms. The dropped gesture's
 * stored WRITE is the server's per-card fraction op (lib/rank-fractions.ts);
 * this helper is the preview of what the move will land as, computed from a
 * view that is genuinely fresh at gesture time — the server remains the
 * authority and corrects any race the preview could not know about.
 *
 * Place `threadId` and rank everything ABOVE the drop point.
 *
 * `visibleIds` is the order the column is currently DISPLAYED in (ranked
 * cards first, then unranked by recency). Only the moved card moves; but
 * unlike `applyMove`, every card above its new position is also written
 * into the resulting order. That is what makes a first drop into an
 * unranked column work: with only the moved card ranked, the sparse
 * comparator (`compareByRank`) still sorts it above every unranked card,
 * so "drop below the second card" would silently no-op. Ranking the cards
 * above the drop point is the smallest write that honours the intent.
 *
 * Cards BELOW the drop point keep whatever rank they had — previously
 * unranked ones stay unranked (gaps below are preserved, so the
 * never-densify property survives everywhere the operator did not
 * explicitly order), and previously ranked ones keep their rank AFTER the
 * new head rather than being silently unranked by a move they took no part
 * in. Dropping those ranks would corrupt the NEXT move: once recency and
 * rank disagree below the drop point, a later move scatters the cards the
 * earlier one demoted.
 *
 * A `toEnd` drop ranks every visible card: landing below the last card
 * means landing below the unranked ones too. Returns a NEW order; the
 * input is untouched.
 */
export function applyMoveVisible(
  order: ColumnOrder,
  visibleIds: readonly string[],
  threadId: string,
  beforeId: string | null,
  toEnd: boolean,
): string[] {
  if (threadId === "") return [...order];
  const arranged = displayAfterMove(visibleIds, threadId, beforeId, toEnd);
  const at = arranged.indexOf(threadId);
  if (at === -1) return [...order];
  const head = arranged.slice(0, at + 1);
  const headSet = new Set(head);
  return [...head, ...order.filter((id) => !headSet.has(id))];
}

/** Which half of a card the pointer was over. */
export type DropEdge = "before" | "after";

export type MoveTarget =
  | { beforeId: string; toEnd: false }
  | { beforeId: null; toEnd: true };

/**
 * Turn a hover position into a move target.
 *
 * `hoverId` is the card under the pointer, `edge` which of its two halves.
 * Dropping on the top half anchors on that card; dropping on the bottom half
 * anchors on the card below it, so the moved card lands one slot further
 * instead of landing on top of the one it was aimed past. Below the last
 * card there is no card below, so that becomes an append.
 *
 * Returns null when the drop would change nothing: hovering the dragged
 * card itself, or a release whose insertion slot already holds the dragged
 * card — the slot directly above the hovered card, when the dragged card is
 * that hover's direct upper neighbour, and the slot directly below it, when
 * the dragged card is its direct lower neighbour. The pointer promised the
 * card's own position, so the move is a no-op; the anchor an earlier version
 * produced here (the hovered card's id) INSERTED the dragged card ABOVE the
 * hover — a jump the release never promised, and the flip-flop a repeated
 * drop in the same region then never escaped (reported 2026-10-15: a pinned
 * family parent that could not be landed below its neighbour no matter how
 * the release aimed). Callers drop the event in that case rather than
 * writing a no-op move — the spurious ranks the "rank everything above the
 * drop point" rule would write for a gesture that changes nothing visible
 * are exactly the corruption a no-op must not produce.
 */
export function moveTargetFor(
  visibleIds: readonly string[],
  hoverId: string,
  edge: DropEdge,
  draggingId: string,
): MoveTarget | null {
  const at = visibleIds.indexOf(hoverId);
  if (at === -1 || hoverId === draggingId) return null;
  if (edge === "before") {
    if (at > 0 && visibleIds[at - 1] === draggingId) return null;
    return { beforeId: hoverId, toEnd: false };
  }
  const below = visibleIds[at + 1];
  // Past the last card: nothing below to anchor on.
  if (below === undefined) return { beforeId: null, toEnd: true };
  if (below === draggingId) return null;
  return { beforeId: below, toEnd: false };
}

/**
 * Id → rank index for one column. Unranked ids are absent, and the caller
 * treats absence as "sorts below every ranked card".
 */
export function rankIndex(
  order: ColumnOrder,
): ReadonlyMap<string, number> {
  return new Map(order.map((id, index) => [id, index]));
}

/**
 * Comparator factory: ranked before unranked, then by the caller's derived
 * order as the tiebreak. `derived` is the board's existing recency compare,
 * so a column with ranks still shows unranked cards newest-first underneath.
 */
export function compareByRank<T extends { id: string }>(
  order: ColumnOrder,
  derived: (a: T, b: T) => number,
): (a: T, b: T) => number {
  const index = rankIndex(order);
  return (a, b) => {
    const aRank = index.get(a.id);
    const bRank = index.get(b.id);
    if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
    // Exactly one ranked: the ranked card wins. Covers "both unranked" too,
    // since undefined === undefined falls through to the derived order.
    if (aRank !== undefined) return -1;
    if (bRank !== undefined) return 1;
    return derived(a, b);
  };
}

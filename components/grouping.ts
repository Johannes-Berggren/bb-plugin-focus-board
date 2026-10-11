import type { PluginSidebarProject, PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { TicketRef } from "../lib/tickets";
import {
  columnRankKey,
  compareByRank,
  orderForColumn,
  type ColumnOrder,
  type RankStore,
} from "../lib/rank";

export type GroupBy =
  | "none"
  | "status"
  | "recency"
  | "project"
  | "provider"
  | "machine"
  | "parent"
  | "group";

export const GROUP_BY_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "status", label: "Attention" },
  { value: "parent", label: "Parent thread" },
  { value: "group", label: "Group" },
  { value: "recency", label: "Last activity" },
  { value: "project", label: "Project" },
  { value: "provider", label: "Provider" },
  { value: "machine", label: "Machine" },
  { value: "none", label: "None" },
];

export type ThreadState = "working" | "attention" | "unread" | "idle";

export type FilterState = {
  /** Empty set means all projects; a non-empty set restricts to those ids. */
  projects: ReadonlySet<string>;
  /** Empty set means all providers; a non-empty set restricts to those ids. */
  providers: ReadonlySet<string>;
  /** Empty set means all states; a non-empty set restricts to those states. */
  states: ReadonlySet<ThreadState>;
  /** Empty or absent set means all groups; a non-empty set restricts to
   *  those buckets — group ids (including the "Unknown group" buckets of
   *  record-less assignments), or NO_GROUP_BUCKET for unassigned threads.
   *  The assignment lookup rides the filter call's `groupsByThread`, not
   *  the state. The Group view's hide gesture writes this set (the lane's
   *  group leaves the selection). */
  groups?: ReadonlySet<string>;
};

export interface BoardColumn {
  id: string;
  label: string;
  threads: PluginSidebarThread[];
}

export interface GroupingContext {
  projects: readonly PluginSidebarProject[];
  providers: readonly { id: string; displayName?: string }[];
  /** Feature-group assignments (thread id → group id), read under the "group" grouping. */
  groupsByThread?: ReadonlyMap<string, string>;
  /** Feature-group registry names (group id → name), read under the "group" grouping. */
  groupNames?: ReadonlyMap<string, string>;
}

export function threadState(thread: PluginSidebarThread): ThreadState {
  // Attention outranks working: a turn that is paused waiting on the operator
  // (a pending interaction such as a secret request, or an unread error) still
  // reports a running status, but the card belongs in "Needs you" until the
  // operator acts.
  if (thread.hasPendingInteraction || thread.indicator === "unread-error") {
    return "attention";
  }
  if (
    thread.status === "active" ||
    thread.status === "starting" ||
    thread.status === "stopping" ||
    thread.status === "pending"
  ) {
    return "working";
  }
  if (thread.isUnread) {
    return "unread";
  }
  return "idle";
}

export const THREAD_STATE_LABELS: Record<ThreadState, string> = {
  working: "Working",
  attention: "Needs you",
  unread: "Unread",
  idle: "Idle",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// Age buckets for idle threads (Attention grouping) and for all
// threads (Last activity grouping). Ordered oldest-first for lookup; the
// column orders below reverse them so boards read newest-leftmost.
const AGE_BUCKETS: { id: string; label: string; minAge: number; maxAge: number }[] = [
  { id: "awhile", label: "A while ago", minAge: 7 * DAY, maxAge: Number.POSITIVE_INFINITY },
  { id: "earlier", label: "Earlier", minAge: DAY, maxAge: 7 * DAY },
  { id: "today", label: "Today", minAge: HOUR, maxAge: DAY },
  { id: "recent", label: "Recent", minAge: 0, maxAge: HOUR },
];

// Column display order per grouping, left to right, derived from AGE_BUCKETS
// (most recent leftmost, least recent rightmost) so the board reads in order
// of attention/focus: Pinned (prepended in buildColumns), then lanes wanting
// the operator, then lanes to catch up on, then running, then recency buckets.
// Done (appended in buildColumns) trails far right.
const RECENCY_COLUMN_ORDER: readonly string[] = [...AGE_BUCKETS]
  .reverse()
  .map((bucket) => bucket.id);
export const STATUS_COLUMN_ORDER: readonly string[] = [
  "attention",
  "unread",
  "working",
  ...RECENCY_COLUMN_ORDER.map((id) => `idle-${id}`),
];

export const IDLE_BUCKETS = AGE_BUCKETS.map((bucket) => ({
  ...bucket,
  id: `idle-${bucket.id}`,
  label: `Idle · ${bucket.label}`,
}));

function ageBucketFor(
  age: number,
  buckets: typeof AGE_BUCKETS,
): { id: string; label: string } {
  const match = buckets.find((candidate) => age >= candidate.minAge && age < candidate.maxAge);
  return match ?? buckets[buckets.length - 1];
}

/**
 * Search predicate for the toolbar's filter box. Matches the thread's own
 * fields (title and every id it carries: thread, project, provider,
 * environment plus its provider, host, and the parent/owner/fork lineage
 * thread ids, section included) PLUS the two fields the card's footer line
 * renders (ThreadCard's `{projectName} · {branch}` strip): the project's
 * display name and the branch. All matches are case-insensitive. Family
 * filtering runs this over children too, so a hit on a child (title,
 * project, or branch) keeps the whole family.
 *
 * Ticket chips are searchable too: when `ticketRefsFor` is wired, the refs
 * the card's chip row shows (text refs + store links, cardTicketRefs) are
 * matched by number — "38" and "#38" both hit a #38 chip — by chip label
 * ("proj-142" hits an external label), and by full item URL.
 *
 * Feature groups are searchable: when `groupNameFor` is wired, the thread's
 * assigned feature group's name (registry + per-thread assignment) matches
 * like any other printed field — typing a group's name surfaces its member
 * cards, even the ones whose titles never mention it.
 */
export function matchesFilter(
  thread: PluginSidebarThread,
  query: string,
  projectNameFor?: (projectId: string) => string,
  ticketRefsFor?: (thread: PluginSidebarThread) => readonly TicketRef[],
  groupNameFor?: (thread: PluginSidebarThread) => string,
): boolean {
  const q = query.toLowerCase();
  const project = (projectNameFor?.(thread.projectId) ?? "").toLowerCase();
  const branch = (thread.environment?.branchName ?? thread.host?.name ?? "").toLowerCase();
  const group = (groupNameFor?.(thread) ?? "").toLowerCase();
  // Every id the thread carries (thread, project + provider, environment
  // + its provider, host, parent/owner/fork lineage, section) joins into
  // one haystack, so pasting any id a card knows about finds the card.
  const ids = [
    thread.id,
    thread.projectId,
    thread.providerId,
    thread.environment?.id ?? null,
    thread.environment?.providerId ?? null,
    thread.host?.id ?? null,
    thread.parentThreadId,
    thread.lifecycleOwnerThreadId,
    thread.sourceThreadId,
    thread.sectionId,
  ];
  const idHaystack = ids.filter((id) => id !== null).join("\n").toLowerCase();
  const chipHit = (ref: TicketRef): boolean => {
    if (ref.raw.toLowerCase().includes(q)) return true;
    if (ref.number !== undefined && (q === String(ref.number) || q === `#${ref.number}`)) {
      return true;
    }
    return ref.href !== undefined && ref.href.toLowerCase().includes(q);
  };
  return (
    thread.displayTitle.toLowerCase().includes(q) ||
    idHaystack.includes(q) ||
    (project !== "" && project.includes(q)) ||
    (branch !== "" && branch.includes(q)) ||
    (group !== "" && group.includes(q)) ||
    (ticketRefsFor !== undefined && ticketRefsFor(thread).some((ref) => chipHit(ref)))
  );
}

export function filterThreads(
  threads: readonly PluginSidebarThread[],
  filter: FilterState,
  groupsByThread?: ReadonlyMap<string, string>,
): PluginSidebarThread[] {
  return threads.filter((thread) => {
    if (filter.projects.size > 0 && !filter.projects.has(thread.projectId)) return false;
    if (filter.providers.size > 0 && !filter.providers.has(thread.providerId)) return false;
    if (filter.states.size > 0 && !filter.states.has(threadState(thread))) return false;
    if (groupFilterMisses(thread, filter, groupsByThread)) return false;
    return true;
  });
}

/** The bucket id the "No group" column uses — shared by columnFor, the
 *  filter machinery, and the toolbar's option list (sentinel value: group
 *  ids from the RPCs never collide). */
export const NO_GROUP_BUCKET = "none";

/** The thread's group-filter bucket: its feature-group assignment, or the
 *  "No group" sentinel when unassigned (or no assignment map is wired). */
export function groupBucketFor(
  thread: PluginSidebarThread,
  groupsByThread?: ReadonlyMap<string, string>,
): string {
  return groupsByThread?.get(thread.id) ?? NO_GROUP_BUCKET;
}

/**
 * The group-filter half of a thread's pass check, shared by every filter
 * entry point (filterThreads, threadPassesFilter, filterWithGroupBoxes):
 * an EMPTY (or absent — a legacy stored filter) restrict shows every
 * bucket; a non-empty restrict misses buckets outside the selection, the
 * No-group sentinel included. */
export function groupFilterMisses(
  thread: PluginSidebarThread,
  filter: FilterState,
  groupsByThread?: ReadonlyMap<string, string>,
): boolean {
  const bucket = groupBucketFor(thread, groupsByThread);
  if (filter.groups !== undefined && filter.groups.size > 0 && !filter.groups.has(bucket)) {
    return true;
  }
  return false;
}

/** The board's hide-a-lane gesture's result: the filter write that must
 *  follow, or why the click changed nothing (the report the banner carries). */
export type LaneHideOutcome =
  | { kind: "hidden" }
  | { kind: "refused"; reason: "sole-lane" | "outside-filter" };

/**
 * The project selection after hiding the lane `hiddenColumnId` names. The
 * selection holds the projects that PASS the filter; an EMPTY set shows
 * every project. So hiding a lane means:
 * - already filtered (any selection size > 1): the project leaves the set;
 * - the lane's project is the only checked one (the set is empty, or only
 *   this project): an empty result would read as "show all" — the exact
 *   opposite of the click — so the write becomes "every other KNOWN project
 *   checked, this one out" (the menu row the gesture would have produced);
 * - the project's lane already sits outside the selection, and the set has
 *   other entries: nothing to write (a bare lane can still stand on the
 *   board through box overrides). Refused.
 * Returns `null`-free: a refusal returns the reason instead.
 *
 * The algorithm is bucket-agnostic — the Group view's hide gesture runs the
 * same core over the group filter's selection and known buckets (the pinned
 * project-helpers below name the two views for their wiring).
 */
export function filterBucketsWithoutLane(
  selected: ReadonlySet<string>,
  knownBucketIds: readonly string[],
  hiddenColumnId: string,
): { kind: "hidden"; next: ReadonlySet<string> } | { kind: "refused"; reason: "sole-lane" | "outside-filter" } {
  if (!selected.has(hiddenColumnId)) {
    if (selected.size === 0) {
      const next = new Set(knownBucketIds);
      next.delete(hiddenColumnId);
      return next.size === 0
        ? { kind: "refused", reason: "sole-lane" }
        : { kind: "hidden", next };
    }
    // The lane stands without its bucket passing the filter (box
    // overrides): the gesture cannot change what it shows.
    return { kind: "refused", reason: "outside-filter" };
  }
  if (selected.size > 1) {
    const next = new Set(selected);
    next.delete(hiddenColumnId);
    return { kind: "hidden", next: next as ReadonlySet<string> };
  }
  const next = new Set(knownBucketIds);
  next.delete(hiddenColumnId);
  return next.size === 0
    ? { kind: "refused", reason: "sole-lane" }
    : { kind: "hidden", next };
}

/** The Project view's hide wiring name for the shared core (pinned by
 *  `tests/grouping.test.ts`; the Project filter's menu restores the lane). */
export const filterProjectsWithoutLane = filterBucketsWithoutLane;

/** The Group view's hide wiring name for the shared core (the Group
 *  filter's menu restores the lane). */
export const filterGroupsWithoutLane = filterBucketsWithoutLane;

/** The board's derived order: pinned first, then newest-first. This is the
 *  tiebreak under a manual rank AND the whole order for an unranked column.
 *  Exported so the nesting pass sorts a family in the same order its column
 *  does — a parent honouring a rank with children that ignore it is a lie. */
export function derivedCompare(
  a: PluginSidebarThread,
  b: PluginSidebarThread,
): number {
  const aPinned = a.isPinned ? 0 : 1;
  const bPinned = b.isPinned ? 0 : 1;
  if (aPinned !== bPinned) return aPinned - bPinned;
  return b.updatedAt - a.updatedAt;
}

function sorted(
  threads: readonly PluginSidebarThread[],
  order: ColumnOrder = [],
  derived: (a: PluginSidebarThread, b: PluginSidebarThread) => number = derivedCompare,
): PluginSidebarThread[] {
  return [...threads].sort(compareByRank(order, derived));
}

/**
 * Most recently done first: the done-children rows under a done parent's
 * card, and the parent-lane board's Done row (D9). The main board's Done
 * column does not sort this way — its default is the board's derived order
 * (activity recency), because the idle sweep stamps a fresh `doneAt` on
 * long-idle threads and a stamp-based order would vault those quiet threads
 * to the top of the column.
 */
export function doneRecencyCompare(
  doneTimes: ReadonlyMap<string, number>,
): (a: PluginSidebarThread, b: PluginSidebarThread) => number {
  return (a, b) => {
    const aDone = doneTimes.get(a.id);
    const bDone = doneTimes.get(b.id);
    if (aDone !== undefined && bDone !== undefined) return bDone - aDone;
    if (aDone !== undefined) return -1;
    if (bDone !== undefined) return 1;
    return derivedCompare(a, b);
  };
}

/**
 * Which column a thread naturally belongs to under the current grouping.
 * Single source of truth: buildColumns groups by it, and a selected thread's
 * column is frozen by remembering this value when it was selected.
 */
export function columnFor(
  thread: PluginSidebarThread,
  groupBy: GroupBy,
  context: GroupingContext,
  now: number = Date.now(),
): { id: string; label: string } {
  if (groupBy === "none") return { id: "all", label: "Threads" };
  if (groupBy === "status") {
    const state = threadState(thread);
    if (state !== "idle") return { id: state, label: THREAD_STATE_LABELS[state] };
    const age = now - thread.updatedAt;
    return ageBucketFor(age, IDLE_BUCKETS);
  }
  if (groupBy === "recency") {
    const age = now - thread.updatedAt;
    return ageBucketFor(age, AGE_BUCKETS);
  }
  // Feature groups are an assignment lookup: the column is the group the
  // thread belongs to (registry name for the label). Assignments ride the
  // optional context fields, so every other grouping is untouched.
  if (groupBy === "group") {
    const groupId = context.groupsByThread?.get(thread.id);
    if (groupId === undefined) return { id: NO_GROUP_BUCKET, label: "No group" };
    return { id: groupId, label: context.groupNames?.get(groupId) ?? "Unknown group" };
  }
  // Machine comes from the thread payload itself: the SDK resolves the host's
  // display name for us, so no context lookup is needed.
  if (groupBy === "machine") {
    return thread.host
      ? { id: thread.host.id, label: thread.host.name }
      : { id: "none", label: "No machine" };
  }
  const key = groupBy === "project" ? thread.projectId : thread.providerId;
  const label = labelFor(groupBy, key, context);
  return { id: key === "" ? "none" : key, label };
}

function labelFor(groupBy: GroupBy, key: string, context: GroupingContext): string {
  if (groupBy === "project") {
    return context.projects.find((project) => project.id === key)?.name ?? "Unknown project";
  }
  return context.providers.find((entry) => entry.id === key)?.displayName ?? key;
}

/** Column display order: fixed lanes first (where applicable), then others. */
function columnSortKey(groupBy: GroupBy, columnId: string): number {
  const fixedOrder =
    groupBy === "status"
      ? STATUS_COLUMN_ORDER
      : groupBy === "recency"
        ? RECENCY_COLUMN_ORDER
        : groupBy === "none"
          ? ["all"]
          : []
  const index = fixedOrder.indexOf(columnId);
  return index === -1 ? fixedOrder.length : index;
}

export function buildColumns(
  threads: readonly PluginSidebarThread[],
  groupBy: GroupBy,
  context: GroupingContext,
  frozenColumns: ReadonlyMap<string, { id: string; label: string }> = new Map(),
  doneIds: ReadonlySet<string> = new Set(),
  now: number = Date.now(),
  ranks: RankStore = {},
  columnOverrides: ReadonlyMap<string, { id: string; label: string }> = new Map(),
  /**
   * The attention freeze's lane pins (components/attention-freeze): the
   * rendered lane a card under attention held at capture time. These win
   * over every claim — family R4 overrides and box overrides included —
   * because an attended card MUST NOT move: the family resumes live
   * re-laning the moment attention releases.
   */
  attentionColumns: ReadonlyMap<string, { id: string; label: string }> = new Map(),
): BoardColumn[] {
  // Threads marked Done form their own column, always farthest right on the
  // Attention board and present (dimmed) on every other grouping.
  const active = threads.filter((thread) => !doneIds.has(thread.id));
  const done = threads.filter((thread) => doneIds.has(thread.id));

  // Pinned threads (bb's own pin state) lead every board in a far-left
  // column, exactly as they lead bb's own sidebar list.
  const unpinned = active.filter((thread) => !thread.isPinned);
  const pinned = active.filter((thread) => thread.isPinned);

  // A thread whose column was frozen at selection time (because it is open in
  // the pane) keeps that column UNTIL a lane of its own says otherwise: R4
  // family and group-box overrides are computed from live member states, and
  // "Family wins, always" — the family's lane priority never depends on the
  // pane. The pane freeze therefore only owns cards no family lane claims
  // (a quiet family keeps the parent's own bucket — the all-idle family
  // override is empty). The freeze remains meaningful there: state or age
  // changes must not slide the card the user is looking at.
  const assignments = new Map<string, { id: string; label: string }>();
  for (const thread of unpinned) {
    assignments.set(
      thread.id,
      attentionColumns.get(thread.id) ??
        columnOverrides.get(thread.id) ??
        frozenColumns.get(thread.id) ??
        columnFor(thread, groupBy, context, now),
    );
  }

  const buckets = new Map<string, { label: string; threads: PluginSidebarThread[] }>();
  for (const thread of unpinned) {
    const target = assignments.get(thread.id);
    if (target === undefined) continue;
    const bucket = buckets.get(target.id);
    if (bucket === undefined) {
      buckets.set(target.id, { label: target.label, threads: [thread] });
    } else {
      bucket.threads.push(thread);
    }
  }

  const columns: BoardColumn[] = [...buckets.entries()]
    .sort((a, b) => {
      const keyDiff = columnSortKey(groupBy, a[0]) - columnSortKey(groupBy, b[0]);
      if (keyDiff !== 0) return keyDiff;
      return a[1].label.localeCompare(b[1].label);
    })
    .map(([id, bucket]) => ({
      id,
      label: bucket.label,
      threads: sorted(bucket.threads, orderForColumn(ranks, columnRankKey(groupBy, id))),
    }));

  // "Working" never leaves the attention board: a board whose every thread
  // has gone idle still carries the lane, empty, where the UI reads
  // "No work in progress". Every other lane keeps the "columns exist only
  // while they hold cards" rule, so the lane is inserted where a populated
  // working bucket would sit — before the idle buckets.
  if (groupBy === "status" && !columns.some((column) => column.id === "working")) {
    const idleStart = columns.findIndex((column) => column.id.startsWith("idle-"));
    columns.splice(idleStart === -1 ? columns.length : idleStart, 0, {
      id: "working",
      label: THREAD_STATE_LABELS.working,
      threads: [],
    });
  }

  // The Pinned column renders whenever a card has entered it, at the far
  // left, before every other column.
  if (pinned.length > 0) {
    columns.unshift({
      id: "pinned",
      label: "Pinned",
      threads: sorted(pinned, orderForColumn(ranks, columnRankKey(groupBy, "pinned"))),
    });
  }

  // The Done column renders whenever a card has entered it, at the far right.
  // Default order is the board's derived order — pinned first, then most
  // recently active at top — matching every other column, rather than the
  // done stamp: the idle sweep marks long-idle threads Done with a fresh
  // stamp, and a stamp-based order would vault those quiet threads above
  // recently active ones. A stored drag order (rank key "done") rides on top
  // of that default, exactly as in every other column.
  if (done.length > 0) {
    columns.push({
      id: "done",
      label: "Done",
      threads: sorted(done, orderForColumn(ranks, columnRankKey(groupBy, "done"))),
    });
  }
  // A grouping with no buckets at all still shows the flat column.
  if (groupBy === "none" && columns.length === 0) {
    return [{ id: "all", label: "Threads", threads: [] }];
  }
  return columns;
}

// RETIRED 2026-10-01: `withSweepGather` (selected cards sorted to the top
// while a sweep is armed) is gone. With manual click-to-toggle selection,
// re-sorting on every toggle made cards jump around the column — deselecting
// sent a card back down the list mid-gesture, which read as disorienting
// shuffling. Sweep state never reorders the column now; the highlight and
// the selected count carry the blast radius.
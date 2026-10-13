# Plan: Parent-child thread nesting — `bb/sashay-parent-child-nested-cards-thr_aap36j6yz4`

*2026-09-25 · from [docs/musings/2026-09-25-parent-child-nesting.md](../musings/2026-09-25-parent-child-nesting.md) · sibling context: [docs/plans/bb-sashay-sweep-arm-then-confirm-per-column-thr_x7zz4eabg2.md](bb-sashay-sweep-arm-then-confirm-per-column-thr_x7zz4eabg2.md)*

Per operator request: implement nested cards, Jira-subissue style. Settled
points in the musing are NOT relitigated here. The musing's open design
questions are answered below as proposals.

## Verified facts this plan builds on

- `parentThreadId: string | null` and `lifecycleOwnerThreadId: string | null`
  are on the live sidebar thread schema (`bb-plugin-sdk-app.d.ts:13015`); the
  `parent-changed` realtime event exists (`bb-plugin-sdk-app.d.ts:341`), so
  re-parenting updates live through the existing `experimental_useSidebarThreads`
  stream. No new SDK surface.
- **Hidden children:** the live sidebar view DOES include hidden threads —
  `isHidden: boolean` is documented as "threads bb keeps out of its own list
  (internal helper threads a plugin spawned with `visibility: "hidden"`). The
  array includes them so a list that wants them can show them"
  (`bb-plugin-sdk-app.d.ts:17351`). The board filters `isHidden` at
  `app.tsx:174`. Decision: the board stays aligned with the sidebar's
  exclusion — hidden children never render, nested or otherwise. A parent
  whose only children are hidden renders as a plain card, no nest, no
  expander. Documented here because the musing flagged it as open.
- No sweep code exists on trunk yet (the sweep sashay `thr_x7zz4eabg2` is
  unmerged). The sweep-family rule is therefore a **contract recorded here**,
  not code in this sashay.

## Design decisions (the musing's open questions)

1. **Column placement — the hard rule first: never hide a Needs-you child.**
   In Attention grouping, a child is *promoted*: it renders as a standalone
   card in its own state's column whenever that column precedes the parent's
   column in the board's column order (`STATUS_COLUMN_ORDER` /
   `RECENCY_COLUMN_ORDER`). Concretely:
   - Needs-you child under a non-Needs-you parent → the child stands alone in
     the Needs-you column. Always visible in the column sweep. (Promoted, not
     duplicated — the family may split across columns; the columns are states
     of the same work, and the parent card still shows the child-count chip.)
   - Unread child under a Working or Idle parent → promoted to the Unread
     column. Unread child under a Needs-you parent → nests (parent outranks).
   - Working child under an Idle parent → promoted to Working. Idle child →
     always nests.
   - Needs-you child under a Needs-you parent → nests (same column anyway).
   In non-Attention groupings the columns are not state-ranked, so no
   promotion: the family stays together (decision 2 decides *where*).

2. **Cross-project / cross-machine / cross-provider children.** In Project,
   Provider, or Machine grouping, a child nests under its parent iff its axis
   key (project id / provider id / machine id) matches the parent's.
   Otherwise the child falls back to **flat rendering**: a normal independent
   card in its own axis column (it carries its own project mark / machine
   name on the card, which the existing card footer already renders). A
   cross-axis child never silently rides a grouping it doesn't belong to.
   In Recency and None groupings the family always nests together
   (recency is per-thread presentation, not a grouping boundary a child
   would violate).

3. **Depth cap: two levels, then a count.** Parent card renders its live
   children (level 1). A level-1 child that itself has live children does not
   render them; it shows a `+N more` overflow chip (N = its visible
   grandchild count) that opens the thread pane. Matches the musing's lean.

4. **Filters select families; the family renders whole.** A root family
   passes the state/project/provider filters and search when ANY of its
   visible members passes. Every visible member of a passing family renders;
   members that do not themselves match the active filters render dimmed
   (opacity), matching members render normal. Consequences:
   - A state filter of Needs-you that matches only a child surfaces the
     family — the child renders normal, the parent dimmed. The child is
     never orphaned from its context (the musing's candidate, adopted).
   - The hard rule survives filtering: the promoted-child rule (decision 1)
     is applied after family-filtering, so the Needs-you child also stands
     alone in the Needs-you column.
   - Search behaves the same way (a title/id hit on any member keeps the
     family, non-members dimmed).

5. **Sweep-family contract (for the sweep sashay; not implemented here).**
   When the sweep lands, eligibility computed at arm time MUST be
   family-aware: a thread with ≥1 live (non-archived) child is
   **never sweep-eligible** in either arm (Done or Awhile-ago), regardless
   of its own age or keep flag. Children are eligible independently of their
   parent. Archiving a family is a no-op direction the sweep never takes —
   bb's parent lifecycle notifications make child completion observable, so
   a parent's children going quiet is visible between arms. Cross-reference
   recorded; the sweep plan owns the implementation.

6. **Archived/deleted parents (orphans).** A child whose parent is not in
   the visible set (hidden, archived, deleted) renders as an ordinary
   standalone card — flat fallback, no special marking.

7. **Collapse.** Parent cards with live children show a chevron toggle and a
   child-count chip. Default expanded; collapse state is per-card,
   in-memory (component state), not persisted — the board reads at a glance
   and a stale saved collapse state would hide children across reloads.

8. **Done / pinned interplay.** A Done parent keeps its nested children
   (rendered dimmed via the existing done opacity). A pinned parent keeps
   its family with it in the Pinned column. Live children of a Done parent
   follow the promotion rule (decision 1) — Done is the board's rightmost
   lane, so any live child's state column precedes it and promotes.

## What ships

1. `components/nesting.ts` (new, pure, unit-tested):
   - `buildFamilyIndex(threads)` → parent→children and child→parent maps,
     built from the visible (non-hidden, non-archived) set. Cycle-tolerant
     (a corrupt `parentThreadId` cycle must not hang the board; cycles are
     treated as roots — defensive, bb owns the data).
   - `nestUnderParents(columns, threads, groupBy, context, now)` →
     `{ columns, childrenByParent }`: pulls nested children out of their
     column placement and attaches them under their parent; applies the
     promotion rule (decision 1) and the axis-match rule (decision 2);
     children keep in-column sort (pinned-first, newest-first).
   - `filterFamilies(threads, familyIndex, filter, searchQuery)` →
     family-aware filtering (decision 4), returning
     `{ kept: PluginSidebarThread[], dimmedIds: ReadonlySet<string> }`.
   - `grandchildCountFor(…)` → the `+N more` number (decision 3).

2. `components/grouping.ts`: export `STATUS_COLUMN_ORDER` (currently
   module-private) so nesting.ts can compare column precedence without
   duplicating the order.

3. `app.tsx`: pipeline becomes
   `visibleThreads → filterFamilies → search → buildColumns →
   nestUnderParents`; passes `childrenByParent` and `dimmedIds` to `Board`.

4. `components/board.tsx`: passes each parent's nested children into its
   `ThreadCard`; column header counts and empty-state logic count top-level
   cards only (nested children are represented on the parent's chip).

5. `components/thread-card.tsx`:
   - New optional props: `childThreads`, `dimmed`, collapse toggle.
   - Children render beneath the card body: indented compact rows (state
     dot, truncated title, relative time), each an anchor using the child's
     own `href`, click opens the pane, right-click gets the same menu
     actions as any card (`menuActionsFor`).
   - Subordinate styling: smaller text, muted, left rail indent.
   - `+N more` chip at the end of the child list (decision 3); chevron +
     count in the parent header row (decision 7).

6. Tests (`tests/nesting.test.ts`, new; `tests/grouping.test.ts` extended):
   see Test plan.

7. `README.md` one line under "What it does": parent-child nesting.

8. `docs/test-coverage-matrix.md`: new rows (below).

## Not in scope

- Spawning or re-parenting threads from the board (no card menu action;
  bb-native surfaces own parenting).
- Sweep implementation — its own sashay owns it (contract in decision 5).
- `lifecycleOwnerThreadId` — orthogonal to rendering; not read.
- Persisting collapse state.
- Rendering hidden children (decision: stay aligned with the sidebar).

## Files touched

| File | Change |
|------|--------|
| `components/nesting.ts` (new) | Family index, nesting/placement, family filtering, depth-cap count (pure) |
| `components/grouping.ts` | Export `STATUS_COLUMN_ORDER` |
| `app.tsx` | Wire family filter → columns → nesting; new props to Board |
| `components/board.tsx` | Thread children pass-through; top-level-only column counts |
| `components/thread-card.tsx` | Nested children, chevron/collapse, dimming, `+N more` chip |
| `tests/nesting.test.ts` (new) | All nesting behavior |
| `tests/grouping.test.ts` | Column-precedence export used by nesting; buildColumns unaffected |
| `docs/test-coverage-matrix.md` | Nesting rows |
| `README.md` | Nesting line |

## Test plan (RGR where contracts precede implementation)

Unit (vitest, deterministic; `now` injected where age matters):

Family index:
- Links children to parents; orphans (missing parent) become roots.
- Cycle in `parentThreadId` does not hang and yields the cycle members as
  roots.
- Hidden and archived threads are excluded from the index (caller passes the
  already-filtered visible set; a test pins that hidden children don't nest).

Attention grouping placement:
- Needs-you child under Working parent → promoted to `attention` column,
  absent from the parent's nest.
- Unread child under Working parent → promoted to `unread`.
- Working child under Idle parent → promoted to `working`.
- Idle child under any parent → nests.
- Needs-you child under Needs-you parent → nests (equal rank).
- Live child under Done parent → promoted (any state outranks done).
- Column ordering of a promoted child inside its column follows the existing
  `sorted()` order.

Axis groupings:
- Project grouping: same-project child nests; cross-project child stands
  alone in its own project column.
- Machine and Provider groupings behave by the same key-match rule.
- Recency and None groupings: family nests regardless of differing buckets.

Depth:
- Grandchildren do not render as cards; the level-1 child carries
  `+N more` with the correct count.
- A level-1 child with no grandchildren renders no chip.

Filtering:
- State filter matching only a child keeps the family; parent is dimmed,
  child is not.
- Filter matching nothing in a family drops the whole family.
- Search hit on a child keeps the family (parent dimmed).
- Family-aware filtering composes with project/provider filters.

Column accounting:
- Column header count excludes nested children; a parent with N nested
  children counts once.
- Done-column membership of a done parent unaffected by nesting.

Typecheck gate: `npx tsc --noEmit` must pass alongside `npm test`.

## Pre-test inventory (coverage matrix rows added)

| Workflow path | Blast radius | Happy | Sad | Edge | Corner |
|---------------|--------------|-------|-----|------|--------|
| Family index (`buildFamilyIndex`) | low | auto (`tests/nesting.test.ts`) | auto (orphan → root) | auto (hidden/archived excluded) | auto (cycle tolerated) |
| Nesting placement, Attention grouping (`nestUnderParents`) | low | auto | auto (equal-rank child nests) | auto (done parent, live child promotes) | auto (promoted child keeps column sort) |
| Nesting placement, axis groupings | low | auto (same-axis nests) | auto (cross-axis child standalone) | auto (recency/none always nest) | skip (pure placement) |
| Depth cap (two levels, `+N more`) | low | auto | auto (no chip when no grandchildren) | auto (count correct) | skip |
| Family-aware filter + search | low | auto (child match keeps family) | auto (no match drops family) | auto (non-matching members dimmed) | auto (promotion applied after filtering) |

## Acceptance criteria

1. A parent thread with live children renders those children indented beneath
   its card, collapsible, visually subordinate, in every grouping.
2. In Attention grouping a Needs-you (and higher-precedence-than-parent
   Unread/Working) child stands alone in its state column — never buried.
3. Cross-project/machine/provider children under those groupings render as
   standalone cards in their own axis column, with their project mark.
4. Depth is capped at two levels; deeper descendants read `+N more` and open
   the pane.
5. A filter or search matching only a child surfaces the whole family with
   non-matching members dimmed.
6. Hidden children never render (board aligned with the sidebar's exclusion).
7. Column header counts exclude nested children.
8. `npm test` and `npx tsc --noEmit` pass.
## Amendments

- 2026-09-25 (code review finding 5): the `+N more` chip is **per-child**, as
  decision 3 reads, not an aggregate at the end of the child list as "What
  ships" wording suggested. Each level-1 child row with grandchildren shows
  its own inline `+N` chip (N = `grandchildCountFor(child, …)`), and clicking
  it opens that child's pane. The end-of-list aggregate chip is removed.

## Refinement round 2 (2026-09-25, operator feedback on merged PR #3)

Three refinements from #412. The logic layer's contract (decisions 1-8,
promotion, axis-match, depth cap, family filtering) still holds; these change
the rendering surface and add two assembly-level rules.

### R1 — Full child titles (fat child rows)

ChildRow upgrades from the slim one-line row to a compact card-like row:
full title wraps over up to 2 lines (`line-clamp-2`, matching parent cards),
keeping the state dot, pane-open on click, and the same menu actions. No
branch line, no project line, no drag handle — children stay visually
subordinate to parent cards (smaller text, muted, indent rail).

### R2 — Archived children stay under the parent

- `buildFamilyIndex` now receives the **non-hidden set (archived included)**.
  The parent's own archived state still excludes the parent from columns —
  unchanged behavior for parents.
- Archived children render under the parent with an archived treatment:
  dimmed + Archive icon + "archived" label (the way the sidebar reads an
  archived thread). Clicking one opens the pane, where unarchive already
  works via the existing archived lookup.
- **Archived children never take standalone column slots** — they always
  nest under their parent regardless of grouping (the promotion rule and the
  axis-match rule apply to live children only; archived overrides both).
  An archived child whose parent is not in the non-hidden set (archived or
  deleted parent) renders nowhere — it is neither standalone (rule: never
  takes a column slot) nor nester (parent absent). Edge case: an archived
  family whose parent is archived vanishes whole.
- Hidden threads remain excluded entirely (both R2 and the original index
  contract).
- Family-aware filtering: archived members ride along with a passing family
  (rendered under the parent with their archived treatment) but **never
  contribute a match** — an archived child matching alone does not surface
  the family. Archived members land in `dimmedIds` when they do not match
  (they nearly always do not); their archived treatment stacks on top.
- Chip semantics: `childCountByParent` counts **all children in the raw
  index (archived included)** — the chip is the family size, and the
  archived rows are part of what the chevron reveals.

### R3 — "Nest child threads" toggle

- Checkbox-style toggle in the toolbar's Group control area, default ON,
  persisted in localStorage under a new key
  (`thread-board:nestChildren`, values `"on"`/`"off"`, validated like
  `readStored`). Parsing lives in a pure helper
  (`parseNestStored` in `components/preferences.ts`) so it is unit-testable
  without a DOM.
- **Nesting OFF = flat board:** every visible (non-archived) thread renders
  as a standalone card in its own column slot — no promotion logic, no
  nested rows, no chevrons, **no chips** (chip counts are meaningless when
  nothing nests), and **no `+N` chips** — deep descendants are standalone
  cards too, exactly the pre-nesting board.
- **Nesting OFF → filtering is per-thread again:** family-aware keep-and-dim
  makes no sense when families do not render together. `filterFamilies` is
  bypassed; the plain state/project/provider/search filter applies to each
  thread independently (no dimming).
- **Nesting OFF → archived children do not render.** They cannot be
  standalone (R2's never-standalone rule) and there are no nested rows to
  ride under — archived threads leave the flat board, matching bb's sidebar
  where archiving removes the thread from the list.
- Family index still builds in both modes (cheap; R2's index contract is
  mode-independent).

### Implementation surface

- `components/nesting.ts`: `buildFamilyIndex` gains archived-inclusion
  (caller contract change); `nestUnderParents`/`assembleBoard` gain an
  options argument (`nestingEnabled`, default `true`); archived children
  always-nest rule inside `childNests`; when nesting is disabled the nesting
  pass is skipped entirely (columns untouched, empty maps out).
- `app.tsx`: `visibleThreads` keeps non-hidden only (archived included) for
  the family pipeline; `searched` still feeds `assembleBoard`, which now
  internally splits archived threads out of column building. New
  `nestChildren` state + persistence; `filterFamilies` bypassed when OFF.
- `components/preferences.ts` (new, pure): `NEST_CHILDREN_KEY`,
  `parseNestStored`, `nestStoredValue`.
- `components/board-toolbar.tsx`: checkbox-style toggle button next to the
  Group dropdown.
- `components/thread-card.tsx`: fat ChildRow (line-clamp-2 title, compact
  card-like row) + archived treatment (dimmed, Archive icon, "archived"
  label); chip/chevron/`+N` suppressed when nesting is OFF (no props → no
  rows → chip hidden via existing `chipCount` gating).
- Tests: `tests/nesting.test.ts` (archived-family behavior, toggle-off
  assembly, filter interactions) + `tests/preferences.test.ts` (new;
  toggle persistence parsing) + coverage matrix rows.

### Refinement test matrix additions

| Workflow path | Blast radius | Happy | Sad | Edge | Corner |
|---------------|--------------|-------|-----|------|--------|
| Archived children nest under parent | low | auto | auto (never standalone, cross-axis too) | auto (archived parent → family vanishes) | auto (never promoted in Attention) |
| Family filter with archived members | low | auto (live match keeps archived rider) | auto (archived-only match drops family) | auto (archived rider dimmed) | skip |
| Nesting toggle OFF (assembly) | low | auto (flat, chips empty, promotion bypassed) | auto (archived children hidden) | auto (deep descendants flat) | auto (filter per-thread) |
| Nesting toggle persistence | low | auto (`parseNestStored` round-trip) | auto (invalid value → default ON) | auto (null → ON) | skip |

## Refinement round 3 (2026-10-13, independent ruleset audit)

An independent derivation (Claude Opus 5.5 thread `thr_zeyu4phivu`, reading the code
blind to this plan) reconciled the plan against the code and the derived ruleset.
This round records the decisions that landed then; decisions 1, 3, 4 and R2's
wording are superseded where the table below says so, and the drift list they
produced is now resolved.

### Decisions superseded

- **Decision 1 (promotion) is replaced by R4 and the same-space rule.** The live
  family moves as one unit into the lane of its most attention-requiring live
  member, so a higher-precedence child nests into that lane instead of
  promoting; promotion survives only where the family cannot follow. The
  nesting decision is one same-space test in four steps: done is its own space
  (a live parent's done children project, a done parent's done children nest),
  operator-intent cards stand alone (pinned, needs-you, with the attention
  freeze's stayNested holding an attended row), a done parent shares its space
  with no live child (every live child of a done root gets its own card, every
  view), and a child nests only when it shares the root's space key.
- **Decision 2 gains the feature-group axis.** Project, provider, machine, and
  the feature-group assignment are data keys a child must match; a cross-key
  child stays flat in its own lane. The group view never had a key check
  before this round (it fell into the always-nest default).
- **Decision 3's `+N more` chip is retired by flattening.** Every descendant is
  flattened onto the family root as real rows; no chip exists.
- **Decision 4 is restored to full strength: ONE keep pass.** The group-box
  filter pass (`filterWithGroupBoxes`) that ran after the family filter
  re-gated its input and dropped dimmed family members whenever any frame
  existed (a missed-search parent vanished, its stranded child re-rooted as a
  lone card, frame members dropped whole when their own box held no matcher).
  The pass is deleted; the family filter is the board's only filter rule and
  group frames can never re-gate it.
- **Decision 7 (in-memory fold) is replaced by persistence.** Fold state saves
  to localStorage per card, and a Done projection keeps its own fold entry
  (`done:<parent id>`), separate from the live card's.
- **R2 (archived children nest with an archived look) is replaced by outright
  hiding.** Archived members render nowhere; the family index drops them at
  the door.

### The freeze contract, as recorded

- Slot pins hold column AND thread (`slotPinKey`): a family's live card and its
  Done projection are two cards, and a thread-only pin moved the twin to the
  live slot's index.
- Parent-view sectioning ("By project") is a stable grouping, never a re-sort:
  the sectioning preserves the order it receives (recency sort in
  `buildParentLanes`, then the lane freeze's on-screen pins), so a frozen lane
  keeps its hold across the sectioning; sections themselves still order by
  their freshest lane.
- The precedence ladder, one statement: a user's own gesture placement, then
  the attention freeze, then the family lane, then group frames (which claim
  nothing), then the member's own data.

### Open (logged in docs/tech-debt)

The pane freeze's view-crossing half (Defect 4 in the audit: a pane capture
cleared when its view left, a stale lane capture revived on re-entry) rides the
freeze-store unification (one store, container-keyed pins, view-change
recapture), not landed here.

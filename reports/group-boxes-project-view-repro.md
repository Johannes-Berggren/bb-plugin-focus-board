---
title: Group boxes vanish on the Project view — repro + decision
status: done
owner: agent
updated: 2026-10-10
tags: [focus-board, group-boxes, bug]
---

# Group boxes do not render on the Project view

## Repro

1. Open the Focus Board with at least one feature group that has assigned members (create one via a card's Group… menu, or use existing assignments from the Group picker).
2. In the View chip menu, switch the board grouping to **Project**.
3. Look at the columns holding the group's member cards.

**Expected result (per the decided feature-group design):** each group renders its dashed outline box, with the group's name on the border and the member cards inside — exactly as the Attention view and the none/recency groupings render it. The box is the join target: dragging an unassigned card onto it (or onto a member card inside it) arms the amber join ring and the drop joins the group.

**Actual result:** the dashed group boxes are gone. Every group member renders as a plain card and the group's drop-to-join surface is unreachable. Switching the grouping to Attention (status) brings the boxes back. The group assignments themselves are intact (the Group picker still lists them) — only the render is affected.

## Root cause

`components/group-boxes.ts:45`:

```ts
const BOX_GROUPINGS: ReadonlySet<GroupBy> = new Set(["status", "none", "recency"]);
```

`planGroupBoxes` bails out at line 97 (`if (!BOX_GROUPINGS.has(groupBy))`), so a "project" grouping gets no box plan (`active: false`, empty `groupBoxOf`/`columnOverrides`), and every card renders plain. The wiring in `app.tsx` (lines ~999–1067) is grouping-agnostic: `reconcileGroupBoxPlan`, `filterWithGroupBoxes`, `assembleBoard`'s `extraColumnOverrides`, and the Board props `groupBoxOf`/`onJoinGroup` all work unchanged for any grouping that renders per-thread columns.

The module comment claims axis groupings "deactivate boxes entirely: … wrapping members from several axis columns is a placement the board cannot honour". That claim is disproven by the code: `buildColumns` (`components/grouping.ts:296–303`) already honors `columnOverrides` for *every* grouping, and the same override mechanism that pulls a status-split pair into one lane applies unchanged to project/provider/machine columns. The board can and does honor the placement.

## Boxed-behavior contract

The design doc referenced by the code (`reports/feature-group-mockups.html`) no longer exists in this worktree, the main checkout, or any git branch — the contract below is pinned from the module's own rules (`components/group-boxes.ts` header comment) and its tests (`tests/group-boxes.test.ts`, `tests/group-box-board.test.tsx`):

- A group renders a box while **at least one** of its assigned threads is visible, live, not done, and not pinned. A **group of one keeps its dashed outline** — the outline is the drag-into target.
- The whole box lands in **one column**: the lane of its most attention-needing member (state-aware under status; the freshest member's bucket under recency). Idle members tie on state; the freshest member breaks the tie.
- Box members gather **contiguously at the box run's first member's slot** in the column's display order; a lone member of a *split* multi-member box renders plain in its column.
- Member cards carry run roles (`first`/`mid`/`last`; `solo` for a group of one, which keeps the container but drags as a plain card) via the `data-group-box-*` attributes — these are the drag-unit surface and the `memberEdgeDefersToJoin` hook.
- The box surface **and** its member cards accept drop-to-join: an unassigned card joins the group; a card already in it is a no-op; a multi-member box dragged as a unit never dissolves. Same-run drags reorder instead.
- Group keep-and-dim filtering: a box passes whole when any member matches the filter or search; non-matching members dim, and a box whose every member fails drops whole.

## Fix scope decision: which groupings box

> [!IMPORTANT]
> Decision: group boxes are active under **every grouping that renders per-thread columns** — status, none, recency, **project**, **provider**, and **machine** — and stay off only under **parent** (the parent/family lane view, where the family nesting is its own unit system and a box around a family's lanes has no meaning). Implemented as an exclusion list, so any future per-thread-column grouping boxes by default.

Evidence (three progressively deeper searches before accepting the prior exclusion as intentional):

1. **Obvious — code contract.** `buildColumns` honors `columnOverrides` for all groupings (`components/grouping.ts:296–303`); `columnFor` already produces correct columns/labels for project, provider, and machine (`components/grouping.ts:221–248`). Nothing else in the plan → columns → runs → render pipeline branches on `groupBy`.
2. **Reframed — history and docs.** `git log --all -S BOX_GROUPINGS` shows the exclusion was born once, in the original feature commit 620f260, and was never revisited — no ADR (`docs/adr/` holds a single unrelated file), no plan, no later changelog bullet changes it. The referenced design mockup is gone from the repo.
3. **Adversarial — hunt for breakage.** The board's box rendering, `columnRunInfo`/`unitMoveTarget`, and drop-to-join (`memberEdgeDefersToJoin`, kept compatible here) are per-column and grouping-blind; `reconcileGroupBoxPlan` handles a frozen member by pulling the whole box to its column for any grouping. Machine grouping degrades safely for members without a host (`columnFor` → the "No machine" lane). The only genuine reason to keep parent excluded is semantic: its lanes are family projections, not thread lanes.

## Verification

- [x] Failing tests written first (plan-level: project/provider/machine box and land in the best member's column; board-level: dashed container, member slots, and run roles in project columns; parent stays excluded).
- [x] Red run captured before the fix (5 failures across the two test files: `plan.active` false, no `[data-group-box]` in the project column).
- [x] Fix: `BOX_GROUPINGS` → exclusion of `parent` only (`NO_BOX_GROUPINGS`); module comments updated.
- [x] `npm test` full suite green (1487/1487 across 99 files); `npm run typecheck` clean.
- [x] CHANGELOG bullet under `[Unreleased]` → Fixed; regenerated `lib/unreleased-changelog.generated.ts` via `npm run build`.
- [x] `docs/test-coverage-matrix.md` "Feature-group box plan + render" row updated.
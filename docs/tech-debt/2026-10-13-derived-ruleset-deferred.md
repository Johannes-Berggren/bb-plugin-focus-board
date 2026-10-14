# 2026-10-13 — Derived-ruleset refactor: the deferred stages

From the independent ruleset audit (Claude Opus 5.5 thread `thr_zeyu4phivu`) and
the operator ruleset review in thread `thr_wdg23bqem3`. The landed stages: the
one-pass filter (`C2`, fixes the vanish defect), the same-space nesting test
(`C4`, fixes the group view and done-root defects), lane-claim consolidation
(`C5-lite`, `C3-lite`), the projection fold (Defect 8), the column-and-thread
slot pins (Defect 2), and the stable Parent-view sectioning (Defect 3). The
stages below are the ones deliberately deferred; each states why and what it
rides on.

## Freeze-store unification (`C7`) + the pin helper (`C6`) + Defect 4

The app holds four freeze states (pane and hover, for the column board and the
parent view) with near-copy strip and recapture loops. One store keyed by
container plus thread would fix the two view-crossing halves of Defect 4 (a
pane capture cleared when its view left and never recaptured on return; a
stale parent-view lane capture revived stale on re-entry) and halve the
recapture code. Deferred because the recapture effect carries subtle
in-flight-claim guards (the 2026-10-13 pane-swap regression is pinned in
`tests/pane-route.test.ts`) and the fix only pays off with the store
unification; a partial fix would add a fifth code path. Do this before any
further freeze feature.

## One lane-visibility pass (`C8`)

Lane visibility is decided in three places (`buildColumns` adds the ever-present
Working lane and the None fallback, `nestUnderParents` removes drained lanes and
adds Done back for projections). One final pass after nesting would carry the
rule once. Pure refactor, no defect riding on it.

## Transport units planned directly (`C9`)

`planLaneTransports` plans per card and `collapseRunTransports` folds members
back into one frame transport when they moved together; planning the diff over
`runUnits` directly would remove the merge-after step. Deferred because the
per-thread planner is the pinned contract surface (`tests/card-transport.test.ts`)
and no defect rides on the extra pass.

## BuildColumns' retired-empty parameters (`C5` remainder)

`frozenColumns` is never non-empty (the attention freeze owns the pane's pin)
and `columnOverrides` only carries the family override. Collapsing them into one
ordered claim list would churn every `buildColumns` test call site; deferred
with the code path documented as retired-empty.

## Box existence vs card-rendered members (Defect 7 remainder)

After `C2` the only harm left from frame membership counting nested rows is
`canJoinGroup`'s plan-map fallback counting them in `members.length`. The board
passes the rendered run info on the live path; the fallback's thread is the
plan-only seam. Decide whether the fallback is reachable and delete it, or
derive it from the rendered run info; no other consumer treats a nested member
as framed.
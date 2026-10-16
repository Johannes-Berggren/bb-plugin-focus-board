# Plan: drag-driven family management on collapsed cards (the morphing cuts after the dot cut)

*Origin: issue #249 (goals 1, 2, 5, 6), written 2026-10-16 by the worker
thread thr_gi3f228k3s as the sequencing contract for the cuts the dot cut
(branch `bb/dot-drag-family-thr_gi3f228k3s`) deliberately leaves out. The dot
cut is commit c37f1bb there; this plan only describes what follows it, and the
orchestrator reviews it before the morphing cut proceeds.*

## State after the dot cut

The collapsed strip's dots drag to reorder their own tier (child dots rank
`child:<parent>`, sub-dots rank `child:<childId>`), through the existing
`rank_move` write. Dot drags carry the `application/x-focus-board-dot` mark,
and every surface outside the strip (floors, headers, card nest zones) refuses
any drag wearing it. The `childDotDrag` wiring shape on `ThreadCard`, the board
handlers, and `dotDraggingRef`/`dotDragResolvedRef` give the later cuts their
plumbing for free.

## The two morphing gestures this plan must get right

**G1 — child row drag-out to un-parent (goals 1's tier is already ranked by
the dot cut; this is goal 2).** Today a child row dragged to a column floor
already detaches (`commitUnnest`), via the lane rank type. The cut adds NO new
refusal, only hones the affordance: the floor's amber "family floor" ring is
the un-parent signal, and it already exists. The only work is explicitness —
a `docs/test-coverage-matrix.md` row refresh and, where missing, UAT steps in
`tests/manual/uat-parent-lanes.yaml` for deep members (rows of children, not
just the top tier). Low risk; small PR.

**G2 — dot drag-out with the tooltip morphing into the full card (goal 5) and
card dropped into a dot field childing (goal 6).** The design risk of the
whole issue; everything below is about this cut.

## The morph mechanics (G2)

- **Trigger:** a dot dragged past the strip's boundary (its group span, then
  the strip's own edge) transitions the gesture's marking payload from the dot
  mark to a real card drag type: the board drops the dot mark mid-gesture by
  re-sourcing the drag (the browser cannot change a drag's payload after
  dragstart, so the gesture re-declares itself as a lane/card drag the
  moment the dot leaves the strip — at that instant the tooltip's floating
  preview expands to the card's full surface, carried by the existing
  transport grammar as a `visibility` swap on the drag image, no new
  animation system).
- **The release:** from that instance on, the gesture IS a card drag; the
  existing floor detach, the header detach, and the nest-zone gap (goal 6's
  reverse childing is NOT this cut — goal 6 is a card dropped ONTO a dot
  field) resolve by today's code paths. `dotDragResolvedRef` hands
  resolution over to the card lifecycle; the dot refs clear.
- **The tooltip-to-card morph (goal 5) is the open question this plan asks
  the orchestrator to bless:** the browser draws its own drag image, so the
  visible morph has one honest implementation: at the boundary, the strip
  goes away from the drag (unmark dot), and the REAL card's slot dims with a
  soft ring, so the operator reads the dragged member's full card in place
  while the ghost follows the pointer. If the operator wants a floating
  morphed card instead, that needs a custom drag image (setDragImage on a
  rendered card clone), which is a larger surface and a step past CSS-only;
  the recommendation is in-place first.
- **Goal 6 — card dropped into a dot field:** the strip becomes a drop
  target for card drags: a card hovered over a collapsed family's strip
  collapses visually into tooltip-plus-dot (the same bubble the dots
  already render, pinned to the pointer) and writes `thread_reparent` under
  the strip's parent on release. The strip refuses foreign-family cards as
  it refuses foreign dots (the banner names the family). Reorder-while-
  childing is out of scope: the write is the existing nest path, landing
  the member last in its tier — placement then comes from a second dot
  drag, keeping the two gestures orthogonal.

## What each morphing cut must preserve

- The dot cut's four refusals stay byte-identical wherever the dot drag has
  not crossed the boundary; the refusal headers stay honest ("never leaves
  its strip" becomes "drags out through the boundary" at the boundary).
- No new store shapes; the writes ride `thread_reparent`, `rank_move` with
  the `child:` keys as today.
- The #248 strip invariant: the strip keeps painting exactly what the count
  says, before, during, and after every morph state.
- nestRendersFlat/flatNestReason honesty: a morph release the placement
  rules cannot render posts its receipt (the #231 law), never a silent
  revert.
- Red-first per behavior as each cut lands; UAT suites for the new
  real-gesture paths (drag-out morph in a new `tests/manual/uat-dot-drag.yaml`
  is the expected shape, alongside extensions to `uat-rank` and
  `uat-parent-lanes`).

## Proposed sequence

1. **Cut 2 — G1 (row drag-out un-parent, small):** coverage row + UAT steps
   for deep members; no board-shape changes expected.
2. **Cut 3 — G2's in-place morph (dot drag-out):** custom-drag-image stays a
   fallback if the in-place reading fails the operator.
3. **Cut 4 — goal 6 (card into a dot field):** the strip as a nest target
   plus the collapse-into-tooltip visual.
4. Cut 5 (optional follow-up): keyboard-only equivalents for every dot
   gesture, if the operator asks; today the keyboard path is expand-and-reorder
   through the rows.

> AGENT GENERATED CONTENT

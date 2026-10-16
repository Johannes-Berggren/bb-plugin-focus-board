# Musing: The child-dot strip when a family has grandchildren

*2026-10-16 · sidequest · origin: the operator screenshotted the AssetCALC codebase orchestrator card (bundle 1.5.1-dev): the chip read "19", the toggle read "19 child threads", and the collapsed strip painted nine dots. The investigation thread proved the mismatch is by design — the count names the fold tier (direct child rows plus their sub-rows, issue #120's chip semantics and the fold-count comment in `components/thread-card.tsx`), while the strip paints one dot per direct child only (issue #174's per-child control contract) — and the operator's direction back was "definitely need to enrich status dots, possibly grouping into families somehow … potentially including just flattening it, but in order so that grandchildren come after their parent, not at the end".*

## What the strip is today, and the contracts at stake

The collapsed strip under the fold toggle is a row of buttons, one per visible direct child. Each dot previews its child on hover or focus (title, state label, indicator label, through the portaled bubble) and opens that child's pane on click without expanding the rows (`tests/thread-card-child-dots.test.tsx`). Dot color reads the child's state from the shared `DOT_CLASS` map. There is no cap: the strip maps every `visibleChild`, and the idle-children filter (issue #172) removes dots exactly where it removes rows.

Three contracts decide whether an option below is a redesign or a break:

- **The control contract.** A dot is an affordance for one thread: hover to preview, click to open. Any new dots (sub-dots, cluster members) inherit the same affordances, because dots that preview nothing are decoration, and decoration does not earn pixels in a strip this small.
- **The count contract.** The chip and the "N child threads" label both name the fold tier: what the card's rows region carries, rows plus sub-rows. Any strip that paints fewer dots than the label counts re-opens the exact reading the operator just tripped over. Any strip that paints more paints dots the label does not name.
- **The filter contract.** The idle filter applies in both views and must never hide a dot whose thread is not idle. A sub-dot tier renders under the same rule.

The strip is a control surface, not a proportional visualization, but the operator's complaint shows the surface cannot disagree with the number above it without reading as a lie. Every option below is judged first on that count-dots agreement, then on width at 19-plus members, then on what it costs the two contracts.

## Option A: do nothing

The count stays tier-wide, dots stay direct-tier. Honest under the code's own comments, and the investigation closes with nothing changed. But the reading that tripped the operator recurs on every orchestration board the moment a family nests, because deep orchestration is the board's normal traffic. Rejected as the standing answer; it survives only as today's baseline to measure the others against.

## Option B: a "+N sub-rows" tail on the strip

After the last child dot, when the label counts more than the strip paints, an inert muted marker closes the row: a dim 4px bar-glyph or a tiny "+10" text chip (DOM-level sketch: `<span data-child-dots-tail aria-hidden className="size-1 rounded-full bg-muted-foreground/40" />`, or `<span data-child-dots-tail className="text-[10px] text-muted-foreground/50 tabular-nums">+10</span>` sitting in the same flex row).

One conditional inside the strip's map (render the tail when `visibleRowCount` exceeds `visibleChildren.length`). Keep the contracts: the tail is not a thread, so it takes no click, no preview, and no idle filtering — it exists to name the difference. Cost: one element and one suite case. This is the cheapest path that makes the count and the strip reconcile, and it composes with any other option below as the fallback for oversized families. Weakness: it confesses the gap instead of showing the threads, so a sub-thread that wants the operator (working, unread) is still invisible until the card expands. That is a real miss for an orchestration board, where the grandchildren are exactly the tier that goes busy in the background.

## Option C: flatten the strip, family-ordered

The operator's proposal, taken whole: every visible family member gets a dot — child first, then that child's sub-children immediately after it, then the next child, never appending the sub-tier at the end. Generations distinguish by size and spacing: child dots keep today's `size-1.5` glyph, sub-dots drop to `size-1`, and the flex row's gap widens between family groups (a `gap-2.5` between groups versus `gap-1` inside one). DOM-level sketch per family:

```
<span data-child-dot-group="thr_c1" className="flex items-center gap-1">
  <button data-child-dot="thr_c1" ... > <span data-child-dot-glyph className="size-1.5 ..." /> </button>
  <button data-child-dot="thr_c1_s1" ... > <span data-child-dot-glyph className="size-1 ..." /> </button>
  <button data-child-dot="thr_c1_s2" ... > <span data-child-dot-glyph className="size-1 ..." /> </button>
</span>
```

Order derives, never stores: within a family, children order as the expanded rows order them (urgent children float first, then the derived order), and sub-children follow their parent's position. No new rank, the same rule the rows themselves use, so the strip and the expanded rows agree member for member, in order.

Count-dots agreement: exact, which is the option's main claim. The label's number names what the dots now paint, member for member, including under the idle filter (a hidden idle member drops its dot wherever it sits in the chain). The control contract survives fully: every dot previews and opens its thread as a child dot does today, a sub-dot's pane is the grandchild's pane, and the preview bubble gains nothing it must have but gains the option to say which family the dot belongs to (see option F). Width: nineteen members at glyph plus gap land near 230px, well inside the strip's `max-w-full`; wrap (already `flex-wrap`) takes families to a second line whole, since groups are indivisible spans, so a line break never splits a family. Weakness: the hierarchy is a whisper. Size plus a wider gap is readable but it is a convention the eye learns, not geometry it sees, and a board member scanning for "which sub-threads belong to Child 1" leans on hover. That weakness is the case for option D.

## Option D: clustered families (the child's dot leading its sub-dots)

Same member set and order as option C, drawn as a per-family cluster instead of homogeneous flattening: each child's dot opens a capsule containing its sub-dots, so the strip reads as one cluster per child (DOM-level sketch: the option C group span gains a `rounded-full bg-muted/50 px-1` capsule background; sub-dots keep the `size-1` glyph and the capsule's padding supplies the indent).

What the capsule buys over C: the family boundary is visible without hover, at the cost of one background tint per group. Two risks temper it. The capsule backgrounds stack visual noise on a strip that already wraps, and a tinted capsule reads as its own control — an operator expecting the pill to be clickable reaches for it (mitigate by keeping the tint near-invisible, `bg-muted/30` to `/50`, and giving the capsule no hover surface of its own; the family's dot inside, which already opens its pane, carries the affordance). Judgment: the capsule is what C's size-and-gap cue should grow into if the convention does not read on a real board; start with C and reserve D as its louder sibling, decided by a screenshot mock rather than in this musing.

## Option E: a sub-dot row underneath

Each child's sub-dots move off the horizontal strip: either a smaller second strip row under the first (every visible sub-dot painted, doubling vertical budget for wide families — exactly the height the family collapse was built to buy away), or hover-only plumbing where a child's sub-dots surface while its dot is hovered (a two-step control that a hand and a pointer both have to chase, and that the keyboard path can only match by making the row surface on focus too, which reintroduces the same height problem whenever focus lands on a family with subs). The precedent nearby is the active child's listing row (`data-child-active-row`), but that renders one thread the pane holds open, not one row per family. Weakest option: it pays the height the fold exists to remove and complicates the hover contract the most. Rejected.

## Option F: hover enrichment ("N sub-threads" in the preview bubble)

No new dots; the preview bubble of a child that carries sub-rows grows one line ("3 sub-threads", from `grandchildThreadsByParent`, already a prop into the card). Cheapest change in the whole space, keeps every contract, and it answers a directly operational question — "is this child done because its own subs are done?" — for anything hovering a dot. Alone it does nothing about count-dots agreement, which is why this musing treats it as a companion to B or C, not a standing answer. With C it layers naturally: the bubble gains the line exactly when the parent's dot has sub-dots beside it.

## Recommendation

Take option C, family-ordered flattening, with the sub-count line of F folded into the preview bubble at the same time. Reasons: it is the only option that makes the count and the strip agree exactly (the operator's complaint is then structurally impossible instead of patched), it keeps the control contract untouched (a dot remains one thread with preview and click, wherever it sits in the depth), it derives its order from the rows' own ordering with no new stored rank, and its width wraps by whole families when a family runs long. D is the escalation if the size-plus-gap convention fails a screenshot test on a real board; B is the cheap patch to reach for if the strip or its preview proves too noisy to keep at 19-plus members and the board chooses to preserve the direct-tier strip instead. E stays rejected: vertical budget is what the fold buys, and nothing in this space is worth selling it back.

Standing rules the eventual implementation should carry:

- The strip paints from the same rendered tier the label counts: one dot per visible member, family-ordered, direct children first in row order and each child's subs immediately following it.
- Every dot is a control: hover or focus previews, click opens that thread's pane. No dot exists to decorate.
- Generation is drawn by glyph size within a family (`size-1.5` direct, `size-1` sub) plus the wider between-family gap; no color difference for depth.
- The idle filter applies per member in both views; a hidden member's dot drops with its row, wherever the member sits in the family.
- Count-dots agreement is a testable invariant: strip dot count equals the label's count, under the filter and without it.

## Open questions

- Depth: the card's rows region carries two tiers (`grandchildThreadsByParent` maps a direct child to its children), while the chip's family walk in `components/nesting.ts` recurses through the whole family. A third-tier thread counts on the chip today but renders in no row and no dot strip. Option C should paint from the tier the card renders, which would leave the third-tier discrepancy where it already is, or the card should grow the tier prop when a real board carries one. Neither is answered here.
- Does the count label keep the singular reading ("19 child threads") when it names a tier that includes sub-rows, or does the eventual implementation relabel to "19 threads in family"? The label wording is issue #172's contract; option C does not need to touch it, but a relabel decision rides the same surface.
- The done projection: a done parent's family renders a separate strip in the done projection. Whether C's family-ordered flattening applies there unchanged is a follow-on to decide with the same test surface.
- Where a family group wraps onto a second line, should the group's parent dot stay with its subs (a group can be `flex-wrap`-proof with `flex-nowrap` inside) — the sketch above pins "families never split across lines", which caps a single group at one line's width; a family wider than the card needs a stated rule.

## Test surface

`tests/thread-card-child-dots.test.tsx` carries the strip contract (per-member dots, family order, glyph-size classes, preview content, click routes to `onOpenThread`) and would grow the sub-dot cases plus the count-dots agreement invariant. `tests/thread-card-idle-children.test.tsx` would add the filter's effect on sub-dots. The screenshot harness in `scripts/screenshot` would take the visual confirmation of cluster gaps and glyph sizes at a 19-member fixture. `docs/test-coverage-matrix.md`'s child-dot row updates when the behavior lands.
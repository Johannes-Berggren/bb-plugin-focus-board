# Parent-Child Attention Hint

## Problem
When a parent thread has children, we need to subtly indicate that the parent is carrying attention-stage children without making the parent itself appear to be that status. The parent's own colored sidebar should remain primary.

## Current Layout
- Parent card: Left border `ACCENT_CLASS[threadState(thread)]` (vertical accent)
- Children rows: Standard rows with perpendicular status dots and child-specific styling
- Collapsed dot strip: Horizontal dot row per child

## Proposed Solution: Child-State Ring vs Parent Card

We'll add a wide, low-opacity ring behind (or around) the parent accent that tracks the "most attention-seeking child" - brightens when any child needs attention, otherwise stays dormant.

### Implementation Options

#### Option A: Ring behind the accent (lowest visual intrusion)

```tsx
// In ThreadCard, after defining ACCENT_CLASS, add:
const PARENT_CHILD_BG_CLASS: Record<NonNullable<DotClass>[keyof DotClass], string> = {
  working: "bg-blue-500/6",
  attention: "bg-amber-500/6",
  unread: "bg-emerald-500/6",
  muted: "bg-transparent",
};

// In parent card className:
className={cn(
  ...existing parent classes...
  // The attention-seeking child ring (behind, over wallpaper if present)
  hasAttentionChildren && "before:ring-2 before:ring-attention-500/10 before:inset-0 before:-z-5 before:rounded-md"
)}
```

Pros:
- Minimal intrusion; only visible when a child needs attention
- Background placement avoids z-index fights with the scrim
- Respects parent idle → stays dormant unless a child pulls it in

Cons:
- Ring depends on the attention-seeking child, not all children; dimmer children don't contribute

#### Option B: Ring around card with full child influence

```tsx
const ACCENT_CLASS: Record<string, string> = { … };

// On each child, track if it needs attention:
const mostAttentionChild = useMemo(() => {
  const attentionChildren = childThreads.filter(c => threadState(c) === "attention");
  return attentionChildren.length > 0 ? "attention" : undefined;
}, [childThreads]);

// Parent card gets:
className={cn(
  ...existing...
  mostAttentionChild === "attention" && "before:ring-2 before:bg-amber-500/12 before:inset-0 before:rounded-md before:border-amber-500/6"
)}
```

Pros:
- All attention children contribute to the ring
- Consistent with the board-level attention pulse (also amber)

Cons:
- Slightly stronger visual; may feel closer to the board pulse than ideal

#### Option C: Horizontal track inside the accent stripe

```tsx
const ACCENT_CLASS: Record<string, string> = { … };

// Add a secondary horizontal line overlay within the vertical accent:
className={cn(
  ...existing...
  hasAttentionChildren && (
    <div className="absolute inset-y-0 left-0 w-4.5 bg-amber-500/20" style={{ clipPath: "polygon(0 0, 100% 50%, 0% 100%)" }} />
  )
)}
```

Pros:
- Clearly within the accent's domain (parent's color space)
- Each child's status could mark its own horizontal pixel, but for now a uniform strip indicates "children need attention"

Cons:
- Requires bleeding into the accent; may confuse about parent vs children

## Selected Approach: Option A (Ring behind accent)

Rationale:
1. **Non-intrusive**: Only appears when needed (child attention)
2. **Parent-agnostic**: Doesn't color-code based on children's status; just flags "there's child attention"
3. **Subtle**: 8-10% opacity ring is visible at a glance but doesn't scream
4. **Simple**: Rendered via Tailwind utilities, no new CSS files

## Implementation Steps

1. Create `PARENT_CHILD_BG_CLASS` mapping from child statuses (or toggle based on hasAttentionChildren prop)
2. Add `hasAttentionChildren` boolean to parent card rendering if not already computed
3. Insert the `before:ring-2 before:ring-attention-500/10` class in the parent's className
4. Update tests to verify the ring appears/disappears with attention children
5. Verify on both wallpaper-on and wallpaper-off backgrounds

## Edge Cases

- **Multiple attention children**: Ring remains amber; accumulating children doesn't ramp brightness (distinguish from "more children" vs "more attention")
- **Done children**: Done children aren't attention-seekers, so ring doesn't appear under Done parents (handled by `hasAttentionChildren` filter)
- **Screendown + wallpaper**: Ring is drawn behind scrim (`before:-z-5`), over wallpaper
- **Idle parent with attention children**: Parent starts transparent but the ring appears (correct - parent is being pulled into attention by its children)

## Related Code

- `ACCENT_CLASS` definition (line ~45 in thread-card.tsx)
- Parent card className construction (lines ~755-780)
- Child row rendering (lines ~820-885)
- Collapsed dot strip (around line 885)
- `DOT_CLASS` constant references child status (line ~543)

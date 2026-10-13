# Parent-Child Attention Hint (Alternatives)

## Problem
Ambiguous: Amber/amber-500 is the "Needs you" lane marker, not a universal attention signal. Don't color children over parent's lane color.

## Constraints
- Don't use amber unless card is visually in "Needs you" lane (by parenting direction or location)
- Don't overwrite parent's primary lane status
- Subtle elevation, no hierarchy confusion
- Use sat, opacity, brightness, stacking

## Alternative Experiments

### Option 1: Parent Accent Brightness Bump (per-lane)

```tsx
// Map child attention into parent lane's color space
const childLaneColor: Record<string, keyof DotClass> = {
  working:   "working",   // blue
  attention: "working",   // same lane as parent
  unread:    "unread",    // emerald
  idle:      "working",   // borrow working for idle attention hint
};

// In ACCENT_CLASS:
const ACCENT_CLASS: Record<string, string> = {
  working: "bg-blue-500/70",     // normal
  attention: "bg-amber-500/80",  // needs you lane itself
  unread: "bg-emerald-500/70",   // normal
  idle: "bg-transparent",
};

// Add child attention variant (different opacity level):
const ACCENT_CHILD_ATTENTION_CLASS: Record<keyof DotClass, string> = {
  working: "bg-blue-500/90",   // brighter when children need attention
  attention: "bg-amber-500/90", // no change (already needs you)
  unread: "bg-emerald-500/90",
  idle: "bg-blue-500/70",      // borrow blue for idle parent + child attention
};
```

**Result**: 
- Parent stays its lane color; just brighter when children pull it into attention space
- Reads: "parent is aware through children"
- Consistent with lane perception: parent’s lane doesn't change, just intensity bumps

**Pros**: 
- Respects lane colors; no amber/orange trespass without parent being in that lane
- Natural brightness as cardinal visual cue
- Low visual weight; just a transparency bump

**Cons**:
- Still family-level parity; doesn’t loudly say "children are in needs you" unless parent is already there

---

### Option 2: Horizontal Attentive Line at Bottom of Card

```tsx
// Add a helper that returns a conditional horizontal bar at the bottom of the parent card
const AttentionChildLine = ({ state, hasAttentionChildren }: { state: string; hasAttentionChildren: boolean }) =>
  hasAttentionChildren ? (
    <div
      className={`h-px w-3/4 rounded-full opacity-6 ${state === "attention" ? "bg-amber-500" : state === "unread" ? "bg-emerald-500" : "bg-blue-500"}`}
    />
  ) : null;
```

**Placement**: 
- At the bottom edge, immediately below the body text
- Behind other content: `absolute bottom-0`

**Result**: 
- Simple flag: "children need attention" when contact
- Doesn’t touch accent stripe, so parent’s own lane clarity intact

**Pros**:
- Lane-independent: works with all lanes doesn’t confuse lane assignment
- Clearly below the card’s visual center; doesn't distract from reading
- Low visual weight; just a thin faint line

**Cons**:
- Not lane-informed: same faint line for parent working vs unread vs idle
- May read more like a decorative flair than a status cue

---

### Option 3: Tint on Parent Accent Stripe (Stacked Opacity)

```tsx
// Keep both layers: base accent + attention-child tint
// In parent className:
className={cn(
  ACCENT_CLASS[threadState(thread)] ?? "bg-transparent",
  hasAttentionChildren && "border-[4px] bg-blue-500/20", // for working; emerald-500/20 for unread
)}
```

**Result**:
- Parent accent stripe receives a full-height-colored overlay when children need attention
- Base opacity 40%, overlay 60% → visible brightness change without lane shift

**Pros**:
- Reuses existing accent infrastructure
- Lane fidelity maintained; just brightness change
- Works independently of layout positioning

**Cons**:
- Slightly more complex rendering
- Might feel less "elevating" and more "adding"

---

### Option 4: Child Count + Status Badge (Thin Variations)

```tsx
// Enhance the existing chipCount area with a conditional status hint:
<div className="mt-1 flex shrink-0 items-start gap-1 pl-1.5">
  <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">
    {childCount}
  </span>
  {hasAttentionChildren && (
    <span className="shrink-0 rounded-sm bg-orange-400/10 text-[10px] text-orange-400/70">
      ⚠
    </span>
  )}
</div>
```

**Result**:
- Existing child count badge gets a small ALERT badge when children need attention
- Orange badge (distinct from lane amber) to flag "children are in needs you lane"
- Positioned at bottom-right of card, below body

**Pros**:
- Uses card adjacency: badge is clearly before/after text area
- Separately colored hint: neutral/muted for count, attention color for hint
- Clear separation between "how many" and "what state"

**Cons**:
- Limited to counts > 0; doesn't add anything for parents with 0 children
- May clutter when card has lots of chips

---

### Option 5: Heavier Card Corner Accent (Bottom-Right)

```tsx
// Add a small corner accent in the parent lane, but boosted when children need attention:
<div
  className={cn(
    "absolute bottom-2 right-2 size-2 rounded-full transition-transform",
    ACCENT_CLASS[threadState(thread)] ?? "bg-transparent",
    hasAttentionChildren && "scale-150 opacity-75"
  )}
/>
```

**Result**:
- Subtle dot in bottom-right (outside primary reading area)
- Scales up and brightens when attention children present

**Pros**:
- Low impact on main card layout
- Scales provide immediate visual feedback
- Don’t interfere with lane color perception

**Cons**:
- Small UI surface; might not be well-aligned (clickable area could clash with card behavior)

---

### Option 6: Billboard-shaped Ring behind accent (no amber cross-lane)

```tsx
// Wide, billboard-style ring around the parent card, but color-matched to parent lane:
<div
  className={cn(
    "relative",
    hasAttentionChildren && (
      <span
        className="absolute -inset-2 rounded-md"
        style={{
          opacity: 0.08,
          backgroundColor: getLaneColor(thread),
        }}
      />
    )
  )}
>
  {/* Parent card */}
</div>

// Helper to pull lane color (without using ACCENT_CLASS which is for background):
const getLaneColor = (thread: PluginSidebarThread) => {
  const state = threadState(thread);
  switch (state) {
    case "working": return "#3b82f6";   // blue-500
    case "attention": return "#f59e0b"; // amber-500
    case "unread": return "#10b981";    // emerald-500
    default: return "transparent";
  }
};
```

**Result**:
- Billboard-shaped ring behind the card, matching parent’s own lane color
- Subtle 8% opacity: visible hint without noise
- Combines behind-the-card placement + lane color fidelity

**Pros**:
- Very subtle; ring-area is out of the way
- No amber cross-lane; respects lane semantics
- Works whether parent is in attention lane or not

**Cons**:
- Billboard ring might encroach on adjacent cards in narrow columns

---

## Recommended Approach: Option 6 (Billboard Ring) + Option 2 (Horizontal Line) as Fallback

**Primary: Option 6 (Billboard Ring behind card, lane-colored)**
- Lane-faithful: ring uses parent's lane color, not amber
- Minimal intrusion: placed behind, far from main content
- Works at any lane: working/unread/attention/idle all get an appropriate hue
- Visual clarity: ring says "something behind this card is active" without decoding lane

**Fallback: Option 2 (Horizontal line at bottom)**
- When the billboard ring is eliminated, use the line for lane-independent hint
- Simple: just `h-px rounded-full opacity-5`
- Positioned below body: stays out of way of row details

---

## Implementation Sketch (Option 6 - Billboard Ring)

```tsx
// 1. Add helper to pull lane color (outside ACCENT_CLASS for tint usage):
const LANE_COLOR: Record<string, string> = {
  working: "#3b82f6",   // blue-500
  attention: "#f59e0b", // amber-500
  unread: "#10b981",    // emerald-500
  idle: "#94a3b8",      // slate-400 (idle)
};

// 2. Compute child attention flag:
const hasAttentionChildren = useMemo(() => {
  if (childThreads.length === 0) return false;
  const attentionChildren = childThreads.filter(t => threadState(t) === "attention");
  return attentionChildren.length > 0;
}, [childThreads]);

// 3. In parent card JSX:
<div className="relative">
  {/* Child attention ring (behind) */}
  {hasAttentionChildren ? (
    <span
      data-child-attention-ring=""
      className="pointer-events-none absolute -inset-2 rounded-md transition-opacity"
      style={{
        opacity: 0.08,
        backgroundColor: LANE_COLOR[threadState(thread)],
      }}
      aria-hidden
    />
  ) : null}

  {/* Parent card body */}
  <div className="relative border-l-[3px]" style={{ borderColor: ACCENT_CLASS[threadState(thread)] }}>
    {/* Parent content */}
  </div>

  {/* Optional: horizontal line at bottom if ring feels too subtle */}
  {hasAttentionChildren && (
    <div
      aria-hidden
      className="absolute bottom-0 left-1/2 -translate-x-1/2 mb-1 h-px w-3/4 rounded-full opacity-4"
      style={{ backgroundColor: LANE_COLOR[threadState(thread)] }}
    />
  )}
</div>
```

### Visual Behavior

| Parent Lane | Child Attention | Ring appears? | Ring Opacity | Ring Hue |
|---|---|---|---|---|
| working | yes | yes | 8% | blue |
| working | no | no | null | - |
| attention | yes | yes | 8% | amber |
| unread | yes | yes | 8% | emerald |
| idle | yes | yes | 8% | slate (borrow from idle) |
| idle | no | no | null | - |

---

## Alternative: Brightening the Parent Accent Only

If you prefer to change the accent rather than add a ring:

```tsx
const ACCENT_CLASS: Record<string, string> = {
  working: "bg-blue-500/70",
  attention: "bg-amber-500/80",
  unread: "bg-emerald-500/70",
  idle: "bg-transparent",
};

const ACCENT_BRIGHTENED: Record<string, string> = {
  working: "bg-blue-500/90",
  attention: "bg-amber-500/95",
  unread: "bg-emerald-500/90",
  idle: "bg-blue-500/70", // borrow blue for idle with child attention
};

// In parent card where accent stripe is rendered:
<div
  className="absolute inset-y-0 left-0 w-[3px]"
  style={{ backgroundColor: hasAttentionChildren ? ACCENT_BRIGHTENED[threadState(thread)] ?? ACCENT_CLASS[threadState(thread)] : undefined }}
  aria-hidden
/>
```

**Effect**: 
- Accent stays vertical, same shape, just brighter (0.9 vs 0.7 opacity)
- No new UI surface; simple color swap

**Trade-off**: 
- Might be harder to perceive if the card is already busy with other UI elements
- Less distinct than additive ring

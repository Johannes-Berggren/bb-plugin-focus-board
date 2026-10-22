# Plan: a working dot's pulse tracks the thread's token burn rate

*Origin: operator request in thread `thr_hqhmxftj3r` ("Animate active status dots"), written 2026-10-22 on branch `bb/animate-active-status-dots-thr_hqhmxftj3r` (based on `dev` at b97f71b, the folded family box merge). Reference behavior: the Activity Overview plugin's burn-rate pulse, shipped in thread `thr_s5vbtjtgwe`.*

## The request

When a collapsed child tree is painted as a row of status dots, the blue `working` dots should pulse, and the pulse should be paced by that thread's token consumption over the last interval. The operator named the reference implementation and set one hard constraint: the feature must not add latency through animation, polling, or anything similar, and that constraint has to be measured, not asserted.

## What the dots are today

`threadState(thread, errorAcks?)` in `components/grouping.ts` answers `working | attention | unread | idle`. Two surfaces paint threads as bare dots:

1. `components/thread-card.tsx` `stripDot()` — the collapsed card's child strip, one `<button data-child-dot>` per member, its glyph a `<span data-child-dot-glyph>` sized `size-1.5` (child) or `size-1` (sub-child).
2. `components/board.tsx` `renderCollapsedBoxRun()` — the folded family box, one `<span data-collapsed-group-dot>` per member inside the `data-collapsed-group-dots` button.

Both paint `DOT_CLASS[state]` and today animate only `attention` dots (`motion-safe:animate-pulse`). Only the strip's attention glyph is wired to the visible-only gate (`attentionPulseRef`); the folded box's dots are not gated at all.

## Design

### Pure math: `lib/pulse-rate.ts`

The period mapping and the burn-rate derivation are pure functions, mirroring the reference band exactly so the feel matches: `PULSE_REFERENCE_RATE = 1` token/s, `PULSE_MAX_PERIOD_MS = 2200`, `PULSE_MIN_PERIOD_MS = 220`, `PULSE_BASE_PERIOD_MS = 2200`. A 10x rate is exactly 10x faster, the band spans 10x, and the base period (the unmeasured rate) sits at the band's slow end.

- `pulsePeriodMs(rate: number | null, opts?)`: `null` is the honest unmeasured state and holds the base period; a measured `<= 0` also holds the slow end (never a freeze or a strobe); a non-finite rate throws (`RangeError`), because a `NaN` that silently becomes "base pulse" hides a broken producer.
- `burnRate(samples, nowMs, windowMs): number | null`: keeps only samples inside the window, needs at least two, sums only positive deltas (a context shrink is a compaction, not negative burn), and returns tokens per second. Fewer than two fresh readings is `null`, the honest "cannot measure yet".

### Sampler: `lib/thread-pulse.ts`

A factory, `createThreadPulseTracker({ now, readUsedTokens, ... })`, with the clock and the token read injected (the `createTrackerFreshnessJudge` shape). It owns the per-thread sample ring and the demand lease.

- `noteEvent(threadId, eventTypes)`: a sample is taken only when the event carries `thread/tokenUsage/updated` or `thread/contextWindowUsage/updated`, only when the demand lease is fresh, and only when the per-thread minimum gap (`SAMPLE_MIN_GAP_MS = 3000`) has passed. Every other event costs one array lookup.
- `rates(now)`: `Record<threadId, number>`, dropping rings with no reading inside `SAMPLE_SPAN_MS` (one hour) and never inventing a zero for a thread it cannot measure.
- `beginDemand(now)` / the lease: `DEMAND_TTL_MS = 60_000`, refreshed by every `pulse_rates` call. No board open, no call, no sampling. This is the answer to the operator's "no polling when nobody is looking" constraint, and it is the one place this design departs from the reference, which samples unconditionally.
- `SAMPLE_RING_CAP = 600` bounds each ring.

### Server wiring: `server.ts`

One module-scope tracker behind the RPC, one `bb.sdk.subscribe({ event: "thread:changed", callback })` registered at plugin init (the callback is the `noteEvent` call, disposed through `bb.onDispose`), and one new RPC:

```
pulse_rates: { input: z.null(), output: { rates: z.record(z.string(), z.number()), generatedAt: z.number() } }
```

The handler calls `beginDemand(now)` and returns `rates(now)`. No new realtime channel: the client's poll is the only refresh path, which keeps the wire quiet and the cost bounded and measurable.

### Client hook: `hooks/use-pulse-rates.ts`

The `use-ticket-statuses.ts` shape. Poll `PULSE_RATE_POLL_MS = 20_000`; skip while `document.hidden`; refetch on `visibilitychange` to visible and on window focus; an in-flight guard so a slow call cannot stack; keep the last good map on failure (a dropped poll must not blink the dots back to base); clear on unmount. Returns `ReadonlyMap<string, number>`.

### Rendering: the pulse

A small client module `components/dot-pulse.ts` owns the animation, and reuses the existing visible-only gate for the cost bound.

- `@keyframes focus-board-dot-pulse { 50% { opacity: 0.55 } }`, inside `@media (prefers-reduced-motion: no-preference)` so the treatment respects the motion preference the way `motion-safe:` does.
- `[data-dot-pulse] { animation: focus-board-dot-pulse var(--dot-pulse-period) ease-in-out infinite; }`, injected once under `DOT_PULSE_STYLE_ID`.
- The dot carries `data-dot-pulse={String(period)}` (the test/probe handle) and `style={{ "--dot-pulse-period": `${period}ms` }}`.
- A pulsing working glyph rides the same `attentionPulseRef` the attention glyph already rides, so off-screen dots park through the existing `[data-pulse-parked] { animation: none !important; }` rule. The folded family box's dots gain that ref too, which they never had.

Opacity only, no layout, no `will-change`: the same reasoning as #260.

### Plumbing and memoization

`pulseRateFor?: (threadId: string) => number | undefined` is a per-id lookup prop, exactly the `statusFor`/`snoozeFor` precedent. `app.tsx` builds it with `useCallback` over the rates map and threads it into `Board` and `ParentLaneBoard`; both pass it to `ThreadCard`. `sameCardProps` probes it by result over `cardSetIds(next)`, so a poll that moves one thread's rate repaints only the cards that paint that thread, and a poll that changes nothing repaints nothing.

### Scope

Both collapsed-dot surfaces: the collapsed strip (child and sub-child dots) and the folded family box's member dots. The expanded nested `ChildRow` dot stays static, because it is not a collapsed tree; widening to it is a separate decision if the operator wants every working dot to breathe.

## Tests (red first, per behavior)

- `tests/pulse-rate.test.ts`: base period for `null`; exact 10x rate/period ratio at the band's ends; clamping for a spread of rates including `1e9`; measured `0` holds the slow end; non-finite throws; `burnRate` needs two readings, ignores out-of-window samples and compactions, and returns tokens per second.
- `tests/thread-pulse.test.ts`: samples only on the two token event types; skips while the demand lease is stale; honors the minimum gap; `rates` drops expired rings and omits unmeasurable threads; `beginDemand` refreshes the lease.
- `tests/use-pulse-rates.test.tsx` (jsdom, fake timers): polls on mount and on the interval; skips a hidden document; refetches on visibility; keeps the last good map when a call rejects; a slow call does not stack.
- `tests/working-dot-pulse.test.tsx` (jsdom): a working child dot in the collapsed strip carries `data-dot-pulse` with the rate-derived period and is observed by the gate; an unmeasured working dot carries the base period; an idle or attention dot carries no rate pulse; the folded family box's working member dot does the same.
- `tests/thread-card-memo.test.tsx`: a rate change for an id the card paints re-renders it; a rate change for a foreign id does not.
- `docs/test-coverage-matrix.md` row.

## Performance testing (the operator's hard constraint)

The measurement, not an argument:

- `scripts/screenshot/mock-sdk.tsx` gains `?workpulse=N` (N collapsed families of working members) and a mocked `pulse_rates` answering a spread of rates, so the probe drives the real components.
- New `scripts/screenshot/probe-working-dot-pulse.mjs` at a CPU throttle: idle fps, dropped frames and long tasks for N = 0, 50, 200 with the gate on, against the same board with the gate's stylesheet removed (the control that shows what the gate buys). Evidence to `docs/screenshots/probe-working-dot-pulse/evidence.json`, with a pre-change `evidence-before.json` from the same board before the pulse lands.
- Re-run `probe-pulse-visible.mjs` to confirm the attention path's numbers do not regress.
- One long-task check on the poll itself: the 20s poll's handler work, and the fact that a poll with an unchanged rate map repaints nothing (asserted in the memo test rather than measured in the browser).

## Landing

Issue first (feature request), then one PR to `dev` carrying the code, tests, changelog bullets under `#### Cards` (or a new `#### Status dots` surface), and the coverage-matrix row. `npm test`, `npm run typecheck`, `npm run build`. No `npm run uat` change: the dots' controls behave identically.

# Plan: per-card fractional ranks (multi-window rank moves stop rewriting the head)

Thread: thr_2swwkxd8v5, worker of the multi-window safety investigation
(thr_ig573wb9ha). Follows PR #243 (write serialization) and the parent's model
context: `lib/rank.ts`, `docs/musings/2026-09-25-rank-ordering.md`, `server.ts`
`rank_move`.

## Problem

A `rank_move` RPC carries the whole displayed order (`visibleIds`) plus the
drop target. `applyMoveVisible` (lib/rank.ts) derives the resulting order's
HEAD segment from the client's `visibleIds` and keeps the stored order's cards
below the head. A second bb window holding a stale view of the lane therefore
rewrites the arrangement of every head card when it drops: window A's drag
lands briefly, then B's later drop (or refetch) reverts it to B's stale
arrangement. The server's write serialization (PR #243, `withKvWriteLock`)
means no write is lost; what is lost is window A's *arrangement* — the #232
shape ("the card falls back"), cross-window edition.

The bug lives in one line of architecture: the WRITE is derived from what the
client SEES, not from what the server HOLDS. Any stale-enough `visibleIds`
rearranges cards the moving window never touched.

## Design decision: pure per-card fractional ranks; ordered id lists become a derived projection

Storage under `focus-board:rank-orders` changes shape:

- Before: `columnKey → ordered id list` (sparse; gaps ARE the never-densify
  property: a card that leaves stays where it was in the list and re-enters
  back into the gap).
- After: `columnKey → { threadId → fractional rank }`. The column's order is
  DERIVED by sorting the map's entries by fraction (ascending). Unranked cards
  sort below every ranked one in the board's recency order, exactly as before.

This is the mandate's "instead of" fork, argued:

- **One source of truth.** "List in addition to fractions" means every move
  must keep two representations consistent; the list would re-introduce the
  head-rewrite write shape as a synchronizer, which is the bug itself.
- **Never-densify survives MORE naturally, not less.** With the list model, a
  card that leaves a column keeps its slot only because the list omits
  nothing but keeps position implicitly; a card that re-enters must find its
  old neighbors (its gap) via list membership. With a fraction, the GAP IS THE
  VALUE: leave/re-enter preserves the fraction untouched, so the card returns
  to its exact old spot between the same fraction bounds. Proven below by a
  leave-and-return test against the store.
- **The wire format does not change.** `rank_list` output and `rank_move`
  output stay `columnKey → ordered id list`. The server derives those lists
  from the fraction map on every response. Clients (grouping.ts, nesting.ts,
  board.tsx) keep `RankStore = Record<columnKey, string[]>` and never see a
  fraction; `orderForColumn`, `rankIndex`, `compareByRank` keep their
  signatures and are fed the derived list. The projection is server-derived
  on read, never client-written, so it is a view, not a second truth.

### The move math (anchor-fresh, per-fragment)

`rank_move` computes everything from the SERVER's fresh state plus the
gesture's anchor:

- classified rankeds: the column map's ids, sorted by fraction
  → `freshDisplay = [ranked...sorted, ...visibleIds minus ranked...]`
  (`visibleIds` remains in the RPC contract ONLY to name/order the unranked
  remainder — the server does not derive column membership or recency; see
  judgment below).
- the abstract move applies on `freshDisplay` (`applyMove` / `appendTo`
  semantics; `displayAfterUnitMove` for family boxes) → `arranged`.
- head = `arranged[0..at]` (through the moved card, or the unit's last member).
  **Ranked head cards keep their stored fractions, whatever the client's
  `visibleIds` said.** This is the anti-rewrite guarantee.
- Cards in the head that are unranked get minted fractions, in arranged
  order, positioned between their neighbors' bounds. Because the display
  puts every ranked card before every unranked one, minting only fires when:
  1. the anchor card is unranked (the unranked cards above the drop point
     plus the dragged card are minted upward from the last ranked fraction);
  2. `toEnd` (the whole visible tail mints above the last ranked fraction);
  3. a unit move densifies unranked cards above the unit block.
  When the anchor is already ranked and the dragged card is ranked, the ONLY
  fragment written is the dragged card's midpoint
  `(prevNeighbor, anchor)` — the per-card write, realized.
- Ends: top-of-column insert mints below the first fraction; bottom (`toEnd`,
  missing anchor) mints above the last. When a midpoint degenerates
  (floating-point: `mid <= lower || mid >= upper`), the column rebases once —
  every ranked fraction re-spread evenly over (0,1) under the write lock,
  preserving order — and the mint retries on the fresh bounds.
- Fractions live in (0,1). Ties never occur from minting or migration, and
  every write is serialized, but a hand-edited KV row can produce one; the
  derived sort is stable, so ties keep row order. Documented, not defended
  further.

### Staleness semantics (the deliberate interpretation)

The anchor is authoritative; stale slot deltas are not. Window B's
"drop X before Y" is honored against Y's CURRENT neighborhood: X lands
directly above where Y now sits, computed from stored fractions. If window A
meanwhile moved other cards, those arrangements survive; B's card is placed
relative to its anchor, which is the only fact B's gesture carries that is
still meaningful. A drop whose anchor move is already satisfied server-side
is a no-op (skipped write, no `rank-changed` publish) — a stale gesture melts
instead of reverting anyone. This changes today's behavior where a stale
`visibleIds` rewrites the head; it is the fix.

### Unit (family) moves

`applyUnitMoveVisible` gains a fraction twin. The unit lands contiguous at its
drop point in `arranged`; its members' fractions are re-minted as a
contiguous block between the block's neighbors' bounds (server-fresh internal
order: ranked members sorted by fraction, unranked in `visibleIds` order).
Unranked cards above the drop point densify exactly as the standing rule
requires. The block re-minting rewrites only the unit's fragments — a unit is
what moved, so that is its own write.

### Judgment call: `visibleIds` stays in the RPC contract

The mandate asks whether it can leave. It cannot cheaply: the server would
have to derive column membership (status/pinned/done/project/idle buckets)
and recency order to reconstruct the display, duplicating `grouping.ts`'s
bucket logic or shipping it server-side — drift-prone duplication for no
safety gain, because the fix does not come from trusting `visibleIds` less;
it comes from never using it to MOVE ranked cards. It still drives no-op
detection client-side (`moveTargetFor`), the announcement text, unit moves'
membership, and the unranked-remainder order for densify minting. A stale
`visibleIds` can now only be *ignored* where the server holds better data.

## Migration

- `parseRankStore` becomes the wire/client parse and stays exactly as is
  (lists, fail loud). A NEW `parseFractionRankStore` reads the KV row and
  accepts BOTH shapes forever: legacy `columnKey → string[]` converts
  losslessly on read (each id minted `(i+1)/(n+1)` in (0,1), preserving the
  observed order); `columnKey → {id → finite number}` passes through; NaN,
  non-finite, non-number, non-string-id, or any other shape THROWS (fail
  loud, same contract as `parseRankStore` — a present-but-malformed row never
  coerces to "no ranks").
- Lossless: the legacy list's order is fully recoverable from the minted
  fractions (strictly increasing), and vice versa; no row data is dropped.
  The conversion is idempotent.
- Timing: rows convert on read inside the rank write path; any write after an
  upgrade persists the fraction shape (`fractionRowFromStore`). A row a
  downgraded build would read must still parse — legacy acceptance stays
  forever, so a fraction-then-legacy dance cannot wedge. `rank_list` never
  writes; a rank-free install stays a rank-free install until a real move.
- `rank-concurrent`'s raw-KV assertions move onto `rank_list` projections or
  fragment assertions; the serialization guarantees they pin do not change.

## Properties consciously preserved (mandate, against the musings doc)

1. **Never-densify / leave-a-gap:** a card's fraction is untouched by other
   cards' moves and by the card's own absence; re-entry restores its old
   spot. Sharper than the list version: no "gap" bookkeeping to keep honest.
2. **Ranked-before-unranked with recency tiebreak below:** `compareByRank`
   unchanged, fed the derived list.
3. **Head densify on first drop** (musings postscript): unchanged in intent —
   unranked cards above the drop point rank together; implemented as minted
   fractions rather than head-list rewrite.
4. **No-op moves skip write and publish** (rank-rpc): now detected on the
   derived ranked order, immune to fraction drift.
5. **Fail-loud parsing:** both shapes; malformed still throws, verbatim
   contract extended, never loosened.
6. **One write per gesture under `withKvWriteLock`:** the lock remains the
   crash-safe backstop; per-card fragments make concurrent moves
   arrangement-preserving in addition to serialized.

## Units

1. **Plan + issue** — this doc, then the feature-request issue on GitHub
   (problem-first: cross-window #232 shape), linked to this thread.
2. **RED: tests/rank-fractions.test.ts** — the sharpest red first: two moves
   from two windows (second with stale `visibleIds`), asserting the first
   move's arrangement survives and only the second's card fragment changes;
   today the stale head rewrite demotes the first move's card. Plus: anchor
   midpoint math (ends, top, bottom, degenerate→rebase), unranked-anchor
   densify, unit move, migration losslessness, leave-and-return gap property,
   malformed-throw contract.
3. **GREEN: lib/rank-fractions.ts** — fraction store types, dual-shape parse,
   mint/midpoint/rebase, `fractionsAfterMove`, `fractionsAfterUnitMove`,
   derived list projection. **server.ts** — readRanks/writeRanks over
   fractions, rank_move uses the new math (same RPC input/output contract,
   same no-op skip + publish), rank_list derives lists.
4. **Suites migrated consciously** — rank-rpc (raw-KV expectations),
   rank-concurrent (fragment-level pins), rank.test.ts (the list
   `applyMoveVisible` regression tests re-homed onto the fraction model;
   display helpers `applyMove`/`appendTo`/`moveTargetFor`/`displayAfterMove`
   unchanged), rank-unit-move, property-parsers (dual-shape parse +
   round-trips), property-rank (fraction laws added),
   scripts/screenshot/mock-sdk.tsx `rank_move` (must call the REAL new
   server-side functions, per its own comment).
5. **Docs** — musings postscript section describing the fraction model and
   why the wire stays lists; test-coverage-matrix rank rows; `[Unreleased]`
   changelog bullets under the standing surfaces.

## Gates

`npm test`, `npm run typecheck`, `npm run build`, `npm run gates`, and
`npm run uat -- tests/manual/uat-rank.yaml` (build first; `CHROME_PATH` if
nonstandard) plus the other uat suites the board drag paths touch. Rebase
onto `origin/dev`, open as DRAFT PR (`--base dev`, filled template, AGENT
GENERATED CONTENT signature, no merge by agents). No version bump, no
`main`, no published-changelog edits.

## Scope discipline

Diff stays inside the rank pipeline: `lib/rank.ts` (wire/client shape
unchanged; only dead-code decisions), new `lib/rank-fractions.ts`,
`server.ts` rank handlers, `scripts/screenshot/mock-sdk.tsx`, tests, docs.
Nothing in `app.tsx`, `components/preferences.ts`, or preference persistence
(sibling thread's surface).

## Residual risks stated up front (to prove or leave unproven honestly)

- Floating-point midpoint exhaustion is bounded by the rebase fallback, but
  the exact insert budget before a rebase is empirical, not proven; a rebase
  is safe (order-preserving, locked) so the residual risk is only write
  amplification, not correctness.
- `visibleIds` unranked-remainder order can be stale in a way that mints
  unranked densify cards in a slightly wrong relative order if recency
  reordering raced the drop; ranked cards always sort first, so ranked
  arrangement can never be corrupted — worst case is recency-order drift
  among newly-minted cards, self-correcting on the next refetch. Left honest.
- Two windows writing to the same column via DIFFERENT bb plugin processes
  (if bb ever serves one board from two host processes) is outside the
  in-process lock's model — pre-existing limitation of #243, unchanged here.
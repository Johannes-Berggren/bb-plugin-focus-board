# Sashay: Clear error — card context menu for acknowledged error cards

Thread: thr_957u7wffx6. Issue: #157 ([Feature]: Clear error context menu to
dismiss an acknowledged error card from Needs you), owner comment "lgtm,
ship it".

## Problem

`threadState()` (`components/grouping.ts`) sends a card to Needs you on five
signals. The error signals (`status: "error"`, `indicator: "unread-error"`,
`indicator: "queued-failed"`, `queuedWork: "failed"`) have no dismissal: 24 of
278 live threads on this board carry `status: "error"`, all claiming
attention. bb itself has no acknowledge verb (`bb thread update` writes
title/parent/section/model/reasoning/visibility only; a new turn is the only
native path off `status: "error"`).

## Design (unchanged from #157's recommendation)

- **Ack record:** per-thread plugin metadata key `"errorAck"` →
  `{ ackedAt: ISO-8601 }`, namespace `thread-board` (SDK defaults `pluginId`),
  mirroring the done record (`lib/done-metadata.ts`).
- **Realtime + RPC:** `error-ack-changed` publishes `{ threadId, acked }`;
  RPCs `error_acks_list` (live-thread scan, like `pin_parks_list`) and
  `error_ack_set` (`{ threadId, acked }`, idempotent re-ack refreshes
  `ackedAt`). Plugin metadata writes emit no thread realtime event, which is
  the reason the board already has its per-state publish pattern.
- **Grouping:** `threadState(thread, errorAcks?)` — the ack skips only the
  `status === "error"` arm. Pending interaction is never ackable: a wait for
  the operator needs a real answer, and `lib/interaction-sync.ts` would fight
  a fake clear. The menu offers "Clear error" when attention is present, not
  interaction-driven, and not already acked.
- **Staleness — a new error must not be masked:** the ack ride is dropped
  when the thread's status is no longer `error` (a new turn started). The
  board sweeps it client-side (pure helper `staleErrorAckIds(threads, acks)`
  in `lib/error-ack.ts`) and clears the record via RPC; the server does not
  watch turns. Known accepted window: an error arriving on an acked thread
  while every board panel is closed stays masked until the next panel sees
  the stale ack drop. bb's own thread view keeps showing the error either way.

## Units

1. **Metadata + RPC** (`lib/error-ack-metadata.ts`, `server.ts`,
   `tests/error-ack-rpc.test.ts` — mirror done): record parse (fail loud),
   set/clear writes, `error-ack-changed` publish, `error_acks_list` over live
   threads.
2. **Grouping** (`components/grouping.ts`, `components/parent-lanes.ts`,
   `components/nesting.ts`, `lib/sweep.ts`, board renderers): `errorAcks`
   threaded beside `doneIds`; acked `status: "error"` reads as idle
   everywhere (lanes, dots, nesting, sweep, child-dot strips).
3. **Menu + wiring** (`lib/card-menu.ts`, `app.tsx`,
   `tests/card-menu.test.ts`): "Clear error" entry in the state group when
   the card's attention comes from error signals; optimistic local ack;
   RPC write; realtime refetch; stale-ack sweep.
4. **Docs:** coverage matrix row, `[Unreleased]` changelog bullet.

## Gates

- `npm test` and `npm run typecheck` green before PR; `npm run build` for the
  bundle.
- Coverage-matrix row: Clear error (metadata record, grouping override, menu
  entry, stale sweep).
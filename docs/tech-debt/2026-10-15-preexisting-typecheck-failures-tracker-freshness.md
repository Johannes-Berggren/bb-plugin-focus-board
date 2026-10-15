# 2026-10-15 — Pre-existing typecheck failures on dev (the #187 freshness layer's `updatedAtMs` seam)

`tsc --noEmit` fails on the pristine dev baseline (proven by stashing all working changes and re-running; 4 errors with nothing pending). They ride the ticket-chip freshness work of issue #187 (commit `238268a`, merged through pull request #202) and are multi-file, so they are logged here instead of patched inside a behavior thread.

## The errors

1. `server.ts(2147,70)` — `tracker_status` maps `decision.statuses` down to `{ kind, state }`, but the RPC's result type requires the full `GitHubItemStatus`.
2. `server.ts(2148,62)` — same handler, one call site passing four arguments where three are expected.
3. `components/board.tsx(2958,27)` — a `(repo, number) => GitHubItemStatus | undefined` prop slot receives a supplier that returns `{ kind, state }` without `updatedAtMs`.
4. `components/parent-lane-board.tsx(908,27)` — the same narrowed supplier in the parent view.

## Why it smells like more than a type slip

`lib/tracker-refresh.ts`'s freshness sort reads `updatedAtMs` (`source.updatedAtMs === null ? -Infinity : source.updatedAtMs + OPEN_CONFIRM_MS`). If the server really strips the field in flight (error 1), a `undefined` reaches that read and the sum degrades to `NaN` instead of holding the intended fallback — that would change which chips re-verify first. Two readings are possible: either a shared type widening left the server's shape stale, or the runtime path is genuinely dropping the field. Both are one investigation away.

## Suggested disposition

One dedicated thread: verify at runtime whether `statuses` carries `updatedAtMs` on the wire (the `tracker_status` RPC is trivially capturable in the screenshot harness), then either restore the field hand-off or correct the types so they name the shape actually shipped. Do this before anything else leans on the freshness sort's ordering.
// Error-acknowledgment helpers for the board's Clear-error action.
//
// An acknowledged error is per-thread plugin metadata in the board's own
// namespace: key "errorAck" → { ackedAt: ISO-8601 string }. Absent key = the
// card's error signals still demand attention. These helpers are pure — no
// host, no SDK — so the RPC layer and tests can drive them without a bb host
// (the contract `lib/done-metadata.ts` holds for its siblings).
import type { JsonValue } from "@get-bb/plugin-sdk";

/**
 * The board's error-ack key inside its thread plugin-metadata namespace.
 * A record's presence silences the board's error-signal attention for that
 * thread only; bb's own thread view is untouched.
 */
export const ERROR_ACK_METADATA_KEY = "errorAck";

/** The record shape: key "errorAck" → { ackedAt: ISO-8601 }. */
export type ErrorAckRecord = { ackedAt: string };

/**
 * Parse a metadata value into an ErrorAckRecord.
 *
 * Absent (undefined) and null mean "not acknowledged" → null. A malformed
 * present value throws (fail loud, never coerce): the acknowledgment must
 * round-trip exactly between board, RPC, and any later CLI, so a wrong shape
 * is a bug to surface, not data to paper over.
 */
export function parseErrorAckRecord(
  value: JsonValue | undefined,
): ErrorAckRecord | null {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    const got = Array.isArray(value) ? "array" : typeof value;
    throw new Error(`errorAck metadata: expected object, got ${got}`);
  }
  const obj = value as { [key: string]: JsonValue };
  const ackedAt = obj["ackedAt"];
  if (typeof ackedAt !== "string" || Number.isNaN(Date.parse(ackedAt))) {
    throw new Error(
      `errorAck metadata: invalid ackedAt ${JSON.stringify(ackedAt)}`,
    );
  }
  if (Object.keys(obj).length > 1) {
    throw new Error(
      `errorAck metadata: unexpected keys ${JSON.stringify(Object.keys(obj))}`,
    );
  }
  return { ackedAt };
}

/**
 * Stamp a fresh ack record: ackedAt = now. An idempotent re-ack refreshes
 * the stamp (matching the done re-mark contract).
 */
export function stampErrorAck(now: Date): ErrorAckRecord {
  return { ackedAt: now.toISOString() };
}

/**
 * Which acked threads have gone stale: the ack's ride ends when the thread
 * no longer sits in `status: "error"` — a new turn started (working, idle,
 * or errored afresh), so a later error must claim attention on its own and
 * not inherit an acknowledgment given to a previous turn. Feed this list's
 * ids to `error_ack_set` with `acked: false`.
 */
export function staleErrorAckIds(
  threads: readonly { id: string; status: string }[],
  ackIds: ReadonlySet<string>,
): string[] {
  const stale: string[] = [];
  for (const id of ackIds) {
    const thread = threads.find((row) => row.id === id);
    if (thread === undefined) continue;
    if (thread.status !== "error") stale.push(id);
  }
  return stale;
}
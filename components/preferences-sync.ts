import { useEffect, useRef } from "react";

/**
 * Cross-window localStorage propagation. A second bb window's panel is a
 * second document over the same localStorage: its writes fire a `storage`
 * event in every OTHER document of the origin (never in the writing one),
 * and until these listeners existed the board learned nothing from them —
 * its next whole-set write-back erased the other window's fields. Entries
 * name the keys whose local state must hydrate on a remote write; handlers
 * receive the event's `oldValue`/`newValue` raw payload and parse through
 * the same tolerant readers the mount path uses. Errors inside a handler
 * degrade like every other storage access (the board keeps working without
 * propagation).
 */
export interface RemoteStoredKey {
  key: string;
  onRemoteChange: (oldRaw: string | null, newRaw: string | null) => void;
}

export function useCrossWindowStorage(entries: readonly RemoteStoredKey[]): void {
  const entriesRef = useRef(entries);
  // Keep the latest entries per render so handlers see fresh closures while
  // the listener itself attaches exactly once per mount.
  useEffect(() => {
    entriesRef.current = entries;
  });
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      // A null key means the whole storage area was cleared remotely — a
      // wipe resets to defaults, and no keyed hydration has anything to say.
      if (event.key === null) return;
      const entry = entriesRef.current.find((candidate) => candidate.key === event.key);
      if (entry === undefined) return;
      try {
        entry.onRemoteChange(event.oldValue, event.newValue);
      } catch {
        // Propagation is a convenience; the board works without it.
      }
    };
    try {
      window.addEventListener("storage", onStorage);
    } catch {
      // Embedded contexts without a real window keep their storage silent.
      return;
    }
    return () => {
      window.removeEventListener("storage", onStorage);
    };
  }, []);
}
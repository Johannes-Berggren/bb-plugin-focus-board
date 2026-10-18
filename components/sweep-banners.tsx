import { Icon } from "@/components/ui/icon";
import {
  type SweepDestination,
  type SweepNotice,
} from "../lib/sweep";

/**
 * How long a sweep banner stays before it leaves on its own. Generous,
 * because "fail loud" loses to "vanish before it was read"; the dismiss
 * control clears the same state earlier. Shared so both boards' sweep
 * banners expire on the same clock.
 */
export const SWEEP_BANNER_DISMISS_MS = 10_000;

/**
 * A finished sweep's report, on every board that can start one: the amber
 * row the Focus view's column sweeps and the Parent view's row sweeps both
 * paint, with the same optional Undo. Extracted so the two boards cannot
 * grow different wording or different undo semantics for one gesture.
 *
 * Undo is OFFERED, never automatic: a cancelled run leaves the button here
 * for a deliberate second click.
 */
export function SweepNoticeBanner({
  notice,
  onUndo,
  onDismiss,
}: {
  notice: SweepNotice;
  onUndo?: (threadIds: readonly string[], destination: SweepDestination) => void;
  onDismiss?: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="sweep-notice"
      className="mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-amber-500/40 bg-amber-50 dark:bg-amber-950 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400"
    >
      <p className="min-w-0">{notice.message}</p>
      <span className="flex shrink-0 items-center gap-0.5">
        {notice.undo !== undefined && notice.undo.ids.length > 0 ? (
          <button
            type="button"
            data-sweep-undo=""
            onClick={() => {
              const undo = notice.undo;
              if (undo !== undefined) onUndo?.(undo.ids, undo.destination);
            }}
            aria-label={
              notice.undo.destination === "done"
                ? `Undo the sweep: mark ${notice.undo.ids.length} threads not Done again`
                : `Undo the sweep: restore ${notice.undo.ids.length} archived threads`
            }
            className="rounded px-1.5 py-0.5 font-medium underline decoration-dotted underline-offset-2 transition-colors hover:bg-amber-500/10 hover:text-amber-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-600 dark:hover:text-amber-400"
          >
            Undo
          </button>
        ) : null}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss sweep notice"
          title="Dismiss"
          className="rounded p-0.5 text-amber-700/70 transition-colors hover:bg-amber-500/10 hover:text-amber-700 focus-visible:outline focus-visible:outline-1 focus-visible:outline-amber-600 dark:text-amber-400/70 dark:hover:text-amber-400"
        >
          <Icon name="X" className="size-3" aria-hidden />
        </button>
      </span>
    </div>
  );
}

/**
 * A card that may never join the armed sweep (a live-child parent, or a
 * family's Done projection) says so on screen instead of doing nothing when
 * the operator clicks it.
 */
export function SweepRefusalBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      data-testid="sweep-refusal"
      className="mx-3 mb-1 flex items-center justify-between gap-2 rounded border border-destructive/40 bg-red-50 dark:bg-red-950 px-2 py-1 text-[11px] text-destructive dark:text-red-400"
    >
      <p className="min-w-0">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss sweep refusal"
        title="Dismiss"
        className="shrink-0 rounded p-0.5 text-destructive/70 dark:text-red-400/70 transition-colors hover:bg-destructive/10 hover:text-destructive dark:hover:text-red-400 focus-visible:outline focus:outline-1 focus-visible:outline-destructive"
      >
        <Icon name="X" className="size-3" aria-hidden />
      </button>
    </div>
  );
}

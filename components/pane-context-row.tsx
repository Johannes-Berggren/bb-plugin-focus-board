import { useEffect, useState, type RefObject } from "react";
import { Icon } from "@/components/ui/icon";
import type { PaneContextInfo } from "@/lib/pane-context";
import { cn } from "@/lib/utils";

// Why this exists: bb's own thread page passes both an `environmentSummary`
// and a `compactEnvironmentSummary` to its promptbox, and on a narrow
// container the promptbox renders only the compact one. The embedded
// `ThreadChat` the SDK hands plugin panels never receives a compact
// summary at all (host bundle 0.46.1, PluginThreadChat), so the thread
// pane's compose area shows nothing where the main view shows the project
// + checkout context. Until bb closes that gap, the pane detects the host
// row inside the chat DOM and paints its own line when it is not there.

/**
 * Does the host's `ThreadChat` paint a composer-context row (project chip,
 * environment chip, checkout chip, or the compact "Thread details …"
 * button) inside this DOM root? Probes the exact signatures bb 0.46.1's
 * promptbox bundle emits: `[data-option-display]` chips whose sr-only
 * label reads "Project: " / "Environment: " (the same markup the model and
 * provider pickers use, so foreign chips must not match), the full row's
 * `[data-promptbox-hide-branch-compact]` checkout chip, and the compact
 * `Thread details: …` button. Signatures drift silently on bb upgrades —
 * if this ever reads stale, the pane falls back to a duplicate-free guess:
 * the row would show a second context line under the host's own, cheap to
 * notice, not a missing-context regression.
 */
export function composerContextVisible(root: HTMLElement | null): boolean {
  if (root === null) return false;
  if (root.querySelector(`button[aria-label^="Thread details:"]`) !== null) return true;
  if (root.querySelector("[data-promptbox-hide-branch-compact]") !== null) return true;
  for (const chip of Array.from(root.querySelectorAll("[data-option-display]"))) {
    const text = (chip.textContent ?? "").trim();
    if (text.startsWith("Project:") || text.startsWith("Environment:")) return true;
  }
  return false;
}

/** How long the chat DOM must stay quiet before an empty probe counts as
 * "the host is not painting context here". ThreadChat resolves its
 * environment and project queries asynchronously, so an immediate probe
 * after mount would see nothing and flash the fallback before the host
 * row lands. */
const PROBE_SETTLE_MS = 150;

/**
 * True when the given chat root has settled without the host's context
 * row. The root is observed for mutations (query resolutions, thread
 * switches, pane resizes), and each burst of activity schedules one probe
 * after the settle window.
 */
export function usePaneContextRowMissing(
  chatRootRef: RefObject<HTMLElement | null>,
  threadId: string,
): boolean {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const root = chatRootRef.current;
    setMissing(false);
    if (root === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const probe = () => {
      timer = null;
      setMissing(!composerContextVisible(root));
    };
    const schedule = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(probe, PROBE_SETTLE_MS);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
    // The mount itself may paint the composer once and go quiet; the
    // settle probe still runs even with zero later mutations.
    schedule();
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [chatRootRef, threadId]);
  return missing;
}

/**
 * The pane's fallback composer-context line: project, then the checkout's
 * branch, else the environment's plain name — the same order of importance
 * bb's compact chip uses.
 */
export function PaneContextRow({ info }: { info: PaneContextInfo }) {
  const describe = info.branchLabel ?? info.environmentLabel;
  return (
    <div
      data-testid="pane-context-row"
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1.5 border-t border-border/50",
        "px-3 py-1.5 text-xs text-muted-foreground",
      )}
      title={`${info.projectLabel}${describe === null ? "" : ` · ${describe}`}`}
    >
      <Icon name="Folder" className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">{info.projectLabel}</span>
      {describe !== null ? (
        <>
          {info.branchLabel !== null ? (
            <Icon name="GitBranch" className="size-3.5 shrink-0" aria-hidden />
          ) : (
            <span aria-hidden>·</span>
          )}
          <span className="min-w-0 truncate">{describe}</span>
        </>
      ) : null}
    </div>
  );
}
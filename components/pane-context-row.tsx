import { useEffect, useRef, useState, type RefObject } from "react";
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

/** One matched host-context element, with enough paint state to tell a
 *  visible chip from a hidden one (the checkout chip is display:none inside
 *  the promptbox shell by CSS, always, in bb 0.46.1). */
export interface PaneProbeMatch {
  /** Which probe signature matched. */
  signature: "context-chip" | "thread-details-button" | "checkout-chip";
  /** Computed css display of the element. */
  display: string;
  /** Bounding rect (0 when the element paints nothing). */
  width: number;
  height: number;
  /** First bytes of the element's HTML, one line. */
  snippet: string;
}

export interface PaneProbeEvent {
  threadId: string;
  at: number;
  missing: boolean;
  composerFound: boolean;
  footerFound: boolean;
  footerHtml: string | null;
  matches: PaneProbeMatch[];
}

function matchOf(element: Element, signature: PaneProbeMatch["signature"]): PaneProbeMatch {
  const el = element instanceof HTMLElement ? element : null;
  const rect = el !== null ? el.getBoundingClientRect() : { width: 0, height: 0 };
  return {
    signature,
    display: el !== null ? getComputedStyle(el).display : "unknown",
    width: rect.width,
    height: rect.height,
    snippet: (el !== null ? el.outerHTML : (element as Node).textContent ?? "")
      .replace(/\s+/g, " ")
      .slice(0, 300),
  };
}

/** Every host-context element inside this DOM root, with paint state — the
 *  probe's detail twin used for the debug captures. */
export function composerContextMatches(root: HTMLElement | null): PaneProbeMatch[] {
  if (root === null) return [];
  const matches: PaneProbeMatch[] = [];
  const details = root.querySelector(`button[aria-label^="Thread details:"]`);
  if (details !== null) matches.push(matchOf(details, "thread-details-button"));
  for (const chip of Array.from(root.querySelectorAll("[data-promptbox-hide-branch-compact]"))) {
    matches.push(matchOf(chip, "checkout-chip"));
  }
  for (const chip of Array.from(root.querySelectorAll("[data-option-display]"))) {
    const text = (chip.textContent ?? "").trim();
    if (text.startsWith("Project:") || text.startsWith("Environment:")) {
      matches.push(matchOf(chip, "context-chip"));
    }
  }
  return matches;
}

/** Does the host's `ThreadChat` paint a composer-context row (project chip,
 *  environment chip, checkout chip, or the compact "Thread details …"
 *  button) inside this DOM root? Probes the exact signatures bb 0.46.1's
 *  promptbox bundle emits: `[data-option-display]` chips whose sr-only
 *  label reads "Project: " / "Environment: " (the same markup the model and
 *  provider pickers use, so foreign chips must not match), the full row's
 *  `[data-promptbox-hide-branch-compact]` checkout chip, and the compact
 *  `Thread details: …` button. Signatures drift silently on bb upgrades —
 *  if this ever reads stale, the pane falls back to a duplicate-free guess:
 *  the row would show a second context line under the host's own, cheap to
 *  notice, not a missing-context regression. */
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

function buildProbeEvent(root: HTMLElement, missing: boolean, threadId: string): PaneProbeEvent {
  const composer = root.querySelector("[data-follow-up-composer]");
  const footer = root.querySelector("[data-follow-up-composer-footer]");
  let footerHtml: string | null = null;
  if (footer instanceof HTMLElement) {
    footerHtml = footer.outerHTML.replace(/\s+/g, " ").slice(0, 4000);
  }
  return {
    threadId,
    at: Date.now(),
    missing,
    composerFound: composer !== null,
    footerFound: footer !== null,
    footerHtml,
    matches: composerContextMatches(root),
  };
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
 * after the settle window. `onProbeCapture` fires on every probe verdict
 * change (and on the first settle of each thread), handing the pane the
 * event to forward to the debug capture file.
 */
export function usePaneContextRowMissing(
  chatRootRef: RefObject<HTMLElement | null>,
  threadId: string,
  onProbeCapture?: (event: PaneProbeEvent) => void,
): boolean {
  const [missing, setMissing] = useState(false);
  const onCaptureRef = useRef(onProbeCapture);
  useEffect(() => {
    onCaptureRef.current = onProbeCapture;
  });
  const lastMissingRef = useRef<boolean | null>(null);
  useEffect(() => {
    const root = chatRootRef.current;
    setMissing(false);
    lastMissingRef.current = null;
    if (root === null) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const probe = () => {
      timer = null;
      const next = !composerContextVisible(root);
      if (lastMissingRef.current !== next && onCaptureRef.current !== undefined) {
        onCaptureRef.current(buildProbeEvent(root, next, threadId));
      }
      lastMissingRef.current = next;
      setMissing(next);
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
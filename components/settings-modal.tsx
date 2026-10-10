import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsNewFeed } from "@/components/whats-new-feed";
import { APP_VERSION, type WhatsNewEntry } from "@/lib/whats-new";
import { cn } from "@/lib/utils";

/**
 * Focus Board's settings: one modal with a left tab rail (Behavior, What's
 * new, About) and the selected tab's content on the right — "how the board
 * behaves always", not a view-mode surface. The app opens it on the tab the
 * icon asked for: a pulsing gift deep-links to What's new, a plain gear
 * opens on Behavior. State lives in the app shell; this component renders
 * the selection it is given and reports switches back.
 */
export type SettingsTab = "behavior" | "whats-new" | "about";

/** The board's identity copy, for the About tab. */
const PLUGIN_NAME = "Focus Board";
const PLUGIN_DESCRIPTION = "A kanban board of your threads, focused on what needs you first.";
const PLUGIN_REPO_URL = "https://github.com/cristoslc/bb-plugin-focus-board";

const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "behavior", label: "Behavior" },
  { id: "whats-new", label: "What's new" },
  { id: "about", label: "About" },
];

export function SettingsModal({
  open,
  onOpenChange,
  tab,
  onTabChange,
  entries,
  escStopsRunningThread,
  onSetEscStopsRunningThread,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected tab; the app owns it so a deep link can land on content. */
  tab: SettingsTab;
  onTabChange: (tab: SettingsTab) => void;
  entries: readonly WhatsNewEntry[];
  /**
   * The server-declared escape setting's raw stored value. `undefined` (or
   * anything but an explicit false) means the ON default applies — the same
   * rule as the board's runtime read (components/preferences.ts).
   */
  escStopsRunningThread: string | number | boolean | undefined;
  /**
   * Called with the value to write to the host setting. A failed write is
   * surfaced inline under the toggle, never as a silent revert.
   */
  onSetEscStopsRunningThread: (value: boolean) => void | Promise<void>;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Focus Board settings</DialogTitle>
          <DialogDescription>
            How the board behaves — one icon opens these where the news lives too.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-w-0 gap-4">
          <div
            role="tablist"
            aria-label="Focus Board settings sections"
            className="flex w-40 shrink-0 flex-col items-start gap-1 self-start"
          >
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => onTabChange(entry.id)}
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === entry.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-w-0 flex-1">
            {tab === "behavior" && (
              <EscStopsRunningRow
                storedValue={escStopsRunningThread}
                onSet={onSetEscStopsRunningThread}
              />
            )}
            {tab === "whats-new" && <WhatsNewFeed entries={entries} />}
            {tab === "about" && <AboutContent />}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The Board Behavior tab's one setting for now: the pane's Escape behavior. */
function EscStopsRunningRow({
  storedValue,
  onSet,
}: {
  storedValue: string | number | boolean | undefined;
  onSet: (value: boolean) => void | Promise<void>;
}) {
  const enabled = storedValue !== false;
  const [saveError, setSaveError] = useState<string | null>(null);
  const toggle = () => {
    setSaveError(null);
    Promise.resolve(onSet(!enabled)).catch((error: unknown) => {
      // Fail loud at the point of choice: the write failed, the toggle
      // stays true to the stored value, and the reason shows right here.
      setSaveError(
        error instanceof Error ? error.message : String(error),
      );
    });
  };
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">
          Thread pane: Escape stops a running thread first
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          While a thread is running, Escape interrupts its turn instead of
          closing the pane; the pane closes with Escape once nothing is
          running, and a rapid double-tap never closes it.
        </p>
        {saveError !== null && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Saving failed: {saveError}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Escape stops a running thread first"
        aria-pressed={enabled}
        onClick={toggle}
        className={cn(
          "inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          enabled
            ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90"
            : "bg-background text-muted-foreground hover:bg-accent",
        )}
      >
        {enabled ? "On" : "Off"}
      </button>
    </div>
  );
}

/** The About tab: identity, build, and where the source lives. */
function AboutContent() {
  const isDevBuild = /-[^.]+$/.test(APP_VERSION);
  return (
    <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
      <p className="text-sm font-semibold text-foreground">{PLUGIN_NAME}</p>
      <p>
        {PLUGIN_DESCRIPTION}
      </p>
      <p>
        Version {APP_VERSION}
        {isDevBuild ? " (dev build)" : ""} — the What&apos;s new tab lists what
        changed.
      </p>
      <p>
        MIT licensed. Source and the full CHANGELOG.md live at{" "}
        <a
          href={PLUGIN_REPO_URL}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline-offset-2 hover:underline"
        >
          github.com/cristoslc/bb-plugin-focus-board
        </a>
        .
      </p>
    </div>
  );
}

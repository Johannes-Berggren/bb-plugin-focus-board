import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WallpaperDropdown } from "@/components/wallpaper-picker";
import type { WallpaperSettings } from "@/components/preferences";
import { WhatsNewFeed } from "@/components/whats-new-feed";
import { APP_VERSION, type WhatsNewEntry } from "@/lib/whats-new";
import { cn } from "@/lib/utils";

/**
 * Focus Board's settings: one modal with a left tab rail (Behavior,
 * Appearance, What's new, About) and the selected tab's content on the right
 * — "how the board behaves always", not a view-mode surface. The app opens
 * it on the tab the icon asked for: a pulsing gift deep-links to What's new,
 * a plain gear opens on Behavior. State lives in the app shell; this
 * component renders the selection it is given and reports switches back.
 */
export type SettingsTab = "behavior" | "appearance" | "whats-new" | "about";

/** The board's identity copy, for the About tab. */
const PLUGIN_NAME = "Focus Board";
const PLUGIN_DESCRIPTION = "A kanban board of your threads, focused on what needs you first.";
const PLUGIN_REPO_URL = "https://github.com/cristoslc/bb-plugin-focus-board";

const TABS: readonly { id: SettingsTab; label: string }[] = [
  { id: "behavior", label: "Behavior" },
  { id: "appearance", label: "Appearance" },
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
  cardTransport,
  motionPref,
  wallpaper,
  onSetEscStopsRunningThread,
  onSetCardTransport,
  onSetMotionPref,
  onWallpaperChange,
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
  /** The Appearance tab's card-transport choice (components/preferences.ts). */
  cardTransport: "none" | "teleport" | "zoom";
  /** The Appearance tab's motion preference. */
  motionPref: "system" | "reduce" | "full";
  /** The board wallpaper document, rendered by the same picker the toolbar hosts. */
  wallpaper: WallpaperSettings;
  onSetCardTransport: (value: "none" | "teleport" | "zoom") => void;
  onSetMotionPref: (value: "system" | "reduce" | "full") => void;
  onWallpaperChange: (next: WallpaperSettings) => void;
}) {
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Focus Board settings</DialogTitle>
        </DialogHeader>
        <div
          data-settings-body
          style={{ height: "440px" }}
          className="flex min-w-0 gap-4 overflow-hidden"
        >
          <div
            role="tablist"
            aria-label="Focus Board settings sections"
            className="flex w-40 shrink-0 flex-col items-stretch gap-1 self-start"
          >
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                aria-current={tab === entry.id ? "page" : undefined}
                onClick={() => onTabChange(entry.id)}
                className={cn(
                  "w-full rounded-r-md border-l-2 py-2 pl-3 pr-2 text-left text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  tab === entry.id
                    ? "border-primary bg-accent/60 text-foreground"
                    : "border-transparent pl-3.5 text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                )}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-w-0 flex-1 overflow-y-auto pr-1">
            {tab === "behavior" && (
              <EscStopsRunningRow
                storedValue={escStopsRunningThread}
                onSet={onSetEscStopsRunningThread}
              />
            )}
            {tab === "appearance" && (
              <AppearanceContent
                cardTransport={cardTransport}
                motionPref={motionPref}
                wallpaper={wallpaper}
                onSetCardTransport={onSetCardTransport}
                onSetMotionPref={onSetMotionPref}
                onWallpaperChange={onWallpaperChange}
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

/**
 * The Appearance tab: what the board's movements and backdrop look like.
 * Card animations pick the transporter's read (None = instant, Teleport =
 * the dissolve running today, Zoom out / in = a future wipe kept visibly
 * disabled so nobody selects a mode the board cannot run), Motion overrides
 * the OS reduce-motion media query for the board's own animations, and the
 * wallpaper hosts the same picker control the toolbar carries.
 */
function AppearanceContent({
  cardTransport,
  motionPref,
  wallpaper,
  onSetCardTransport,
  onSetMotionPref,
  onWallpaperChange,
}: {
  cardTransport: "none" | "teleport" | "zoom";
  motionPref: "system" | "reduce" | "full";
  wallpaper: WallpaperSettings;
  onSetCardTransport: (value: "none" | "teleport" | "zoom") => void;
  onSetMotionPref: (value: "system" | "reduce" | "full") => void;
  onWallpaperChange: (next: WallpaperSettings) => void;
}) {
  return (
    <div className="space-y-5">
      <ChoiceRow
        ariaLabel="Card animations"
        label="Card animations"
        description="How a card reads when it relocates between lanes."
        options={[
          { value: "none", name: "None", title: "The card appears in its new lane instantly." },
          {
            value: "teleport",
            name: "Teleport",
            title: "The card dissolves out of its old lane and materializes in the new one.",
          },
          {
            value: "zoom",
            name: "Zoom out / in",
            title: "Coming soon — the zoom read is not built yet.",
            disabled: true,
          },
        ]}
        selected={cardTransport}
        onSelect={(value) => onSetCardTransport(value as "none" | "teleport" | "zoom")}
      />
      <ChoiceRow
        ariaLabel="Motion"
        label="Motion"
        description="How the board's animations respect your system's reduce-motion preference."
        options={[
          { value: "system", name: "Use my system setting", title: "The OS decides." },
          { value: "reduce", name: "Always reduce", title: "Boards move quietly even if your system plays everything." },
          { value: "full", name: "Always play in full", title: "Full motion even if your system asks for reduced." },
        ]}
        selected={motionPref}
        onSelect={(value) => onSetMotionPref(value as "system" | "reduce" | "full")}
      />
      <div>
        <p className="text-xs font-medium text-foreground">Wallpaper</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The backdrop behind the board — the same picker the toolbar's image control opens.
        </p>
        <div className="mt-2">
          <WallpaperDropdown wallpaper={wallpaper} onWallpaperChange={onWallpaperChange} />
        </div>
      </div>
    </div>
  );
}

/** A labeled radio group with a description; the modal's only choice anatomy. */
function ChoiceRow({
  ariaLabel,
  label,
  description,
  options,
  selected,
  onSelect,
}: {
  ariaLabel: string;
  label: string;
  description: string;
  options: readonly {
    value: string;
    name: string;
    title: string;
    disabled?: boolean;
  }[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground">{label}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      <div role="radiogroup" aria-label={ariaLabel} className="mt-2 space-y-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected === option.value}
            aria-disabled={option.disabled === true ? "true" : undefined}
            title={option.title}
            onClick={() => {
              if (option.disabled === true) return;
              onSelect(option.value);
            }}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              option.disabled === true
                ? "cursor-not-allowed text-muted-foreground/60"
                : selected === option.value
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              option.disabled === true && "opacity-60",
            )}
          >
            <span
              className={cn(
                "inline-block size-3 shrink-0 rounded-full border",
                selected === option.value
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/50 bg-transparent",
              )}
            />
            <span className={option.disabled === true ? "italic" : undefined}>
              {option.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** The Board Behavior tab's one setting for now: the pane's Escape behavior. */function EscStopsRunningRow({
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

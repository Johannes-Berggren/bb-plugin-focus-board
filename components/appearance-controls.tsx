import { WallpaperPicker } from "@/components/wallpaper-picker";
import type { MotionPacing, WallpaperSettings } from "@/components/preferences";
import { parseMotionPacing } from "@/components/preferences";
import { cn } from "@/lib/utils";

/**
 * The Appearance controls' one shared anatomy: the settings modal's
 * Appearance tab and the plugin detail page's configuration section
 * (components/settings-section.tsx) render the very same rows, so both
 * surfaces present identical controls over one source of truth.
 */

/** A labeled radio group with a description; the appearance surfaces' only choice anatomy. */
export function ChoiceRow({
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

/** The card-transport choice: what a card's relocation between lanes reads like. */
export function CardTransportChoice({
  selected,
  onSelect,
}: {
  selected: "none" | "teleport" | "zoom";
  onSelect: (value: "none" | "teleport" | "zoom") => void;
}) {
  return (
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
          title: "The card shrinks into its old slot's portal and grows back as the new slot opens.",
        },
      ]}
      selected={selected}
      onSelect={(value) => onSelect(value as "none" | "teleport" | "zoom")}
    />
  );
}

/** The motion override: how the board's animations respect the OS reduce-motion preference. */
export function MotionChoice({
  selected,
  onSelect,
}: {
  selected: "system" | "reduce" | "full";
  onSelect: (value: "system" | "reduce" | "full") => void;
}) {
  return (
    <ChoiceRow
      ariaLabel="Motion"
      label="Motion"
      description="How the board's animations respect your system's reduce-motion preference."
      options={[
        { value: "system", name: "Use my system setting", title: "The OS decides." },
        { value: "reduce", name: "Always reduce", title: "Boards move quietly even if your system plays everything." },
        { value: "full", name: "Always play in full", title: "Full motion even if your system asks for reduced." },
      ]}
      selected={selected}
      onSelect={(value) => onSelect(value as "system" | "reduce" | "full")}
    />
  );
}

/**
 * The transports' pacing slider: how long a card's transport animation runs.
 * Greyed out while the Motion override defers to the system (the OS decides,
 * and its stock clock comes with it) and while reduce is forced (nothing is
 * left to stretch); active only under a forced full. Prolonged pacing never
 * revives a suppressed transport: reduce wins, always.
 */
export function PacingControl({
  disabled,
  pacing,
  onPacingChange,
}: {
  disabled: boolean;
  pacing: MotionPacing;
  onPacingChange: (value: MotionPacing) => void;
}) {
  return (
    <div className={cn(disabled && "opacity-60")}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Animation pacing</p>
        <span className="text-xs text-muted-foreground">
          {pacing === 1 ? "Normal" : `${pacing}x longer`}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        How long a card's relocation animation runs: 1x is the stock speed, 2x
        runs the same movement twice as long.
      </p>
      <input
        type="range"
        aria-label="Animation pacing"
        min={1}
        max={2}
        step={0.25}
        value={pacing}
        disabled={disabled}
        title="Animation pacing"
        onChange={(event) => onPacingChange(parseMotionPacing(event.target.value))}
        className="mt-2 w-full accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

/**
 * The Motion group as the appearance surfaces render it: the override choice
 * with the pacing slider under it, and the grey-out rule decided ONCE here
 * (the slider turns off whenever the board is not playing motion the user
 * picked).
 */
export function MotionGroup({
  motionPref,
  onMotionPrefChange,
  pacing,
  onPacingChange,
}: {
  motionPref: "system" | "reduce" | "full";
  onMotionPrefChange: (value: "system" | "reduce" | "full") => void;
  pacing: MotionPacing;
  onPacingChange: (value: MotionPacing) => void;
}) {
  return (
    <div className="space-y-3">
      <MotionChoice selected={motionPref} onSelect={onMotionPrefChange} />
      <PacingControl
        disabled={motionPref !== "full"}
        pacing={pacing}
        onPacingChange={onPacingChange}
      />
    </div>
  );
}

/** The wallpaper group: the board's backdrop through its one inline picker. */
export function WallpaperGroup({
  wallpaper,
  onWallpaperChange,
}: {
  wallpaper: WallpaperSettings;
  onWallpaperChange: (next: WallpaperSettings) => void;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-foreground">Wallpaper</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        The backdrop behind the board — shipped gradient presets, a photo shuffle, an
        Openverse search, or any https url.
      </p>
      <div className="mt-2">
        <WallpaperPicker wallpaper={wallpaper} onWallpaperChange={onWallpaperChange} />
      </div>
    </div>
  );
}
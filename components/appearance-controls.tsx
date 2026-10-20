import { WallpaperPicker } from "@/components/wallpaper-picker";
import type { MotionPacing, WallpaperSettings } from "@/components/preferences";
import { motionPacingFromIndex, motionPacingIndex, MOTION_PACING_STEPS } from "@/components/preferences";
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

/**
 * The Motion control, the one anatomy the appearance surfaces share: a
 * follow-system checkbox over a notched slider, with the checkbox holding
 * the arbitration. Checked, the board follows the OS reduce-motion media
 * query alone at stock speed and the slider greys out (the OS decides; its
 * reduce always wins here, which is where the sketch's reduce-precedence
 * step lives). Unchecked, the slider decides: its leftmost notch is reduce
 * (the moves go quiet), the second is stock 1x, and each notch right
 * doubles the dwell on the log scale (2x, 4x, 8x) — the prolong direction,
 * a clearly different read per notch.
 */
export function MotionControl({
  follow,
  onFollowChange,
  pacing,
  onPacingChange,
}: {
  follow: boolean;
  onFollowChange: (value: boolean) => void;
  pacing: MotionPacing;
  onPacingChange: (value: MotionPacing) => void;
}) {
  const readout = pacing === "reduce" ? "Reduce motion" : pacing === 1 ? "Stock (1x)" : `${pacing}x longer`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-foreground">Motion</p>
        <span className={cn("text-xs", follow ? "text-muted-foreground/60" : "text-muted-foreground")}>
          {readout}
        </span>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <input
          type="checkbox"
          aria-label="Follow my system setting"
          checked={follow}
          onChange={() => onFollowChange(!follow)}
          className="size-3.5 accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span>Follow my system setting</span>
      </label>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        How long a card's relocation animation runs: 1x is the stock speed,
        the leftmost notch quiets the board, and each notch right doubles the
        dwell.
      </p>
      <input
        type="range"
        aria-label="Motion"
        min={0}
        max={MOTION_PACING_STEPS.length - 1}
        step={1}
        value={motionPacingIndex(pacing)}
        disabled={follow}
        title="Motion"
        aria-valuetext={pacing === "reduce" ? "Reduce motion" : `${pacing}x longer`}
        onChange={(event) => onPacingChange(motionPacingFromIndex(Number.parseInt(event.target.value, 10)))}
        className={cn(
          "mt-2 w-full accent-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          follow && "opacity-60",
        )}
      />
    </div>
  );
}

/**
 * The lane direction's board layout read: the shipped vertical column board,
 * or the horizontal row board (issue #153).
 */
export function LaneDirectionChoice({
  selected,
  onSelect,
}: {
  selected: "vertical" | "horizontal";
  onSelect: (value: "vertical" | "horizontal") => void;
}) {
  return (
    <ChoiceRow
      ariaLabel="Lane direction"
      label="Lane direction"
      description="Which way the board's lanes run."
      options={[
        {
          value: "vertical",
          name: "Vertical",
          title: "The shipped read: lanes as columns, cards stacking downward.",
        },
        {
          value: "horizontal",
          name: "Horizontal",
          title: "Lanes as rows; the cards in each lane flow left to right.",
        },
      ]}
      selected={selected}
      onSelect={(value) => onSelect(value as "vertical" | "horizontal")}
    />
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
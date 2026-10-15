import { useState } from "react";
import {
  CardTransportChoice,
  MotionGroup,
  WallpaperGroup,
} from "@/components/appearance-controls";
import {
  CARD_TRANSPORT_KEY,
  MOTION_PACING_KEY,
  MOTION_PREF_KEY,
  WALLPAPER_KEY,
  cardTransportStoredValue,
  motionPacingStoredValue,
  motionStoredValue,
  parseCardTransportStored,
  parseMotionPacing,
  parseMotionStored,
  parseWallpaperStored,
  readStoredText,
  wallpaperStoredValue,
  writeStored,
  type CardTransportPref,
  type MotionPacing,
  type MotionPref,
  type WallpaperSettings,
} from "@/components/preferences";

/**
 * The plugin detail page's configuration section (bb renders it beside the
 * declared settings): the modal Appearance tab's rows re-rendered with the
 * component itself holding state, because the configuration page has no
 * board instance to lean on. Same controls, same tolerance, same
 * localStorage truth — the mirror is presentational, never a second store:
 * reads parse through the shared parsers and writes go through the shared
 * serializers and keys. The section reads once at mount; an edit here is
 * what the board applies the next time it mounts (the same-document
 * storage-event gap noted in the sync design).
 */
export function AppearanceSettingsSection() {
  const [cardTransport, setCardTransport] = useState<CardTransportPref>(
    () => parseCardTransportStored(readStoredText(CARD_TRANSPORT_KEY, "")),
  );
  const [motionPref, setMotionPref] = useState<MotionPref>(
    () => parseMotionStored(readStoredText(MOTION_PREF_KEY, "")),
  );
  const [motionPacing, setMotionPacing] = useState<MotionPacing>(
    () => parseMotionPacing(readStoredText(MOTION_PACING_KEY, "")),
  );
  const [wallpaper, setWallpaper] = useState<WallpaperSettings>(
    () => parseWallpaperStored(readStoredText(WALLPAPER_KEY, "")),
  );

  return (
    <div className="space-y-5">
      <CardTransportChoice
        selected={cardTransport}
        onSelect={(value) => {
          writeStored(CARD_TRANSPORT_KEY, cardTransportStoredValue(value));
          setCardTransport(value);
        }}
      />
      <MotionGroup
        motionPref={motionPref}
        onMotionPrefChange={(value) => {
          writeStored(MOTION_PREF_KEY, motionStoredValue(value));
          setMotionPref(value);
        }}
        pacing={motionPacing}
        onPacingChange={(value) => {
          writeStored(MOTION_PACING_KEY, motionPacingStoredValue(value));
          setMotionPacing(value);
        }}
      />
      <WallpaperGroup
        wallpaper={wallpaper}
        onWallpaperChange={(next) => {
          writeStored(WALLPAPER_KEY, wallpaperStoredValue(next));
          setWallpaper(next);
        }}
      />
    </div>
  );
}
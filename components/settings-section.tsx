import { useState } from "react";
import {
  CardTransportChoice,
  MotionControl,
  WallpaperGroup,
} from "@/components/appearance-controls";
import {
  CARD_TRANSPORT_KEY,
  MOTION_PACING_KEY,
  MOTION_PREF_KEY,
  WALLPAPER_KEY,
  cardTransportStoredValue,
  motionPacingStoredValue,
  motionSettingsStoredValues,
  parseCardTransportStored,
  parseMotionSettings,
  parseWallpaperStored,
  readStoredText,
  wallpaperStoredValue,
  writeStored,
  type CardTransportPref,
  type MotionSettings,
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
  const [motion, setMotion] = useState<MotionSettings>(() =>
    parseMotionSettings(readStoredText(MOTION_PREF_KEY, ""), readStoredText(MOTION_PACING_KEY, "")),
  );
  const { follow, pacing } = motion;
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
      <MotionControl
        follow={follow}
        onFollowChange={(value) => {
          writeStored(MOTION_PREF_KEY, motionSettingsStoredValues(value, pacing).pref);
          writeStored(MOTION_PACING_KEY, motionPacingStoredValue(pacing));
          setMotion({ ...motion, follow: value });
        }}
        pacing={pacing}
        onPacingChange={(value) => {
          writeStored(MOTION_PREF_KEY, motionSettingsStoredValues(follow, value).pref);
          writeStored(MOTION_PACING_KEY, motionPacingStoredValue(value));
          setMotion({ ...motion, pacing: value });
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
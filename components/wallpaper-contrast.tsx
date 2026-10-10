/**
 * Whether the board currently paints behind a wallpaper. The app supplies it
 * around the panel content; ThreadCard consumes it to swap whole-card opacity
 * dimming (which lets a busy wallpaper bleed through a muted card surface)
 * for an under-scrim that keeps the card's own surface opaque. Default false
 * so every consumer reads today's behavior until the provider is wired.
 */
import { createContext, useContext, type ReactNode } from "react";

const WallpaperActiveContext = createContext(false);

export function WallpaperActiveProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <WallpaperActiveContext.Provider value={active}>
      {children}
    </WallpaperActiveContext.Provider>
  );
}

export function useWallpaperActive(): boolean {
  return useContext(WallpaperActiveContext);
}
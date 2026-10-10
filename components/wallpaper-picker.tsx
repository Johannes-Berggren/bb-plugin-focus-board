import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { isAllowedWallpaperUrl, wallpaperBackgroundStyle, type WallpaperSettings, type WallpaperLayer } from "./preferences";
import { usePrefersDarkScheme } from "./ui/hooks/use-media-query";
import {
  PICSUM_SEEDS,
  WALLPAPER_PRESETS,
  openverseSearchUrl,
  parseOpenverseResults,
  picsumThumbUrl,
  picsumWallpaperUrl,
  type OpenverseImage,
} from "./wallpaper-presets";

/**
 * Board wallpaper control: an Image trigger opens a small popover with the
 * picker (shipped gradient presets, a Picsum shuffle strip, an Openverse
 * search) above the free-form image-url input and the dim-wash slider. Edits
 * apply immediately (like the search box) and ride up as the versioned
 * settings document; the Remove row renders only while a wallpaper is
 * active. Every gallery write goes through the same store validation the
 * typed url does, so no source can smuggle in an url the document refuses.
 */
export function WallpaperDropdown({
  wallpaper,
  onWallpaperChange,
}: {
  wallpaper: WallpaperSettings;
  onWallpaperChange: (next: WallpaperSettings) => void;
}) {
  const active = wallpaper.global;
  const dark = usePrefersDarkScheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string>(active?.url ?? "");
  const [dim, setDim] = useState<number>(active?.dim ?? 0.35);
  // Follows the committed state when a commit lands elsewhere too
  // (Remove writes through); the scratch pad only matters mid-edit.
  useEffect(() => {
    setQuery(active?.url ?? "");
    setDim(active?.dim ?? 0.35);
  }, [active?.url, active?.dim, open]);
  const close = () => {
    setOpen(false);
  };
  const commitUrl = (nextUrl: string, nextDim: number) => {
    const url = nextUrl.trim();
    if (url === "") {
      // Clearing the input while a wallpaper is active removes it; with no
      // active wallpaper a cleared scratch pad commits nothing.
      if (active !== null) onWallpaperChange({ version: 1, global: null });
      return;
    }
    onWallpaperChange({ version: 1, global: { url, dim: nextDim } });
  };
  const commitFromGallery = (url: string, darkUrl?: string) => {
    if (!isAllowedWallpaperUrl(url)) return;
    const layer: WallpaperLayer = darkUrl === undefined ? { url, dim } : { url, dim, darkUrl };
    onWallpaperChange({ version: 1, global: layer });
  };
  return (
    <div
      className="relative"
      onKeyDown={(event) => {
        if (!open || event.key !== "Escape") return;
        event.stopPropagation();
        close();
      }}
    >
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Wallpaper"
        title="Wallpaper"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "-ml-1 inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active !== null ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <Icon name="Image" className="size-4" aria-hidden />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={close} aria-hidden />
          <div className="absolute right-0 top-9 z-50 w-72 rounded-md border border-border bg-popover p-2 shadow-md">
            <div className="grid grid-cols-4 gap-1">
              {WALLPAPER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  aria-label={`Wallpaper preset: ${preset.label}`}
                  aria-pressed={active?.url === preset.url}
                  title={preset.label}
                  onClick={() => commitFromGallery(preset.url, preset.darkUrl)}
                  className="aspect-video rounded-sm border border-border transition-colors hover:ring-2 hover:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={
                    wallpaperBackgroundStyle(
                      {
                        url: preset.url,
                        darkUrl: preset.darkUrl,
                        dim: 0,
                      },
                      dark,
                    ) ?? undefined
                  }
                />
              ))}
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1">
              {PICSUM_SEEDS.map((seed) => (
                <button
                  key={seed}
                  type="button"
                  aria-label={`Picsum: ${seed}`}
                  title="Random photo (picsum.photos)"
                  onClick={() => commitFromGallery(picsumWallpaperUrl(seed))}
                  className="overflow-hidden rounded-sm border border-border transition-colors hover:ring-2 hover:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img
                    src={picsumThumbUrl(seed)}
                    alt=""
                    className="aspect-video w-full object-cover"
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
            <OpenverseSearch onPick={commitFromGallery} />
            <div className="mt-2 border-t border-border pt-2">
              <Input
                value={query}
                onChange={(event) => {
                  const nextUrl = event.target.value;
                  setQuery(nextUrl);
                  const trimmed = nextUrl.trim();
                  if (trimmed === "" || isAllowedWallpaperUrl(trimmed)) {
                    commitUrl(trimmed, dim);
                  }
                }}
                aria-label="Wallpaper image url"
                aria-invalid={
                  query.trim() !== "" && !isAllowedWallpaperUrl(query.trim())
                    ? "true"
                    : undefined
                }
                placeholder="Image url (https://…)"
                className="h-7 text-xs"
              />
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">Dim</span>
                <input
                  type="range"
                  role="slider"
                  aria-label="Wallpaper dim"
                  min={0}
                  max={0.9}
                  step={0.05}
                  value={dim}
                  onChange={(event) => {
                    const nextDim = Number(event.target.value);
                    setDim(nextDim);
                    const url = (active?.url ?? query.trim()) || "";
                    if (url !== "" && active !== null) {
                      const layer: WallpaperLayer =
                        active.darkUrl === undefined
                          ? { url, dim: nextDim }
                          : { url, dim: nextDim, darkUrl: active.darkUrl };
                      onWallpaperChange({ version: 1, global: layer });
                    }
                  }}
                  className="flex-1 accent-[var(--primary)]"
                />
              </label>
              {active !== null ? (
                <button
                  type="button"
                  onClick={() => {
                    onWallpaperChange({ version: 1, global: null });
                  }}
                  className="mt-2 flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Icon name="X" className="size-3.5 shrink-0" aria-hidden />
                  Remove wallpaper
                </button>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

type OpenverseSearchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; images: readonly OpenverseImage[] }
  | { status: "error"; message: string };

/**
 * The Openverse panel of the picker: type a query, press Search, click a
 * result. Network failures render their reason (the picker never hides a
 * failed search behind an empty grid) and commit nothing.
 */
function OpenverseSearch({
  onPick,
}: {
  onPick: (url: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<OpenverseSearchState>({ status: "idle" });
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    // A closing or torn-down picker cancels the in-flight search so a stale
    // response can never land in a reopened popover.
    return () => {
      controllerRef.current?.abort();
    };
  }, []);
  const runSearch = async () => {
    const trimmed = query.trim();
    if (trimmed === "") return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "loading" });
    try {
      const response = await fetch(openverseSearchUrl(trimmed), { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload: unknown = await response.json();
      setState({ status: "done", images: parseOpenverseResults(payload) });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return (
    <div className="mt-2 border-t border-border pt-2">
      <div className="flex items-center gap-1">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
          aria-label="Search Openverse"
          placeholder="Openverse search…"
          className="h-7 flex-1 text-xs"
        />
        <button
          type="button"
          aria-label="Search"
          title="Search Openverse"
          onClick={() => void runSearch()}
          disabled={query.trim() === "" || state.status === "loading"}
          className="inline-flex h-7 shrink-0 items-center justify-center rounded-sm px-2 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <Icon name="Search" className="size-3.5" aria-hidden />
        </button>
      </div>
      {state.status === "loading" ? <div className="mt-1 text-[10px] text-muted-foreground">Searching…</div> : null}
      {state.status === "error" ? (
        <div className="mt-1 text-[10px] text-destructive">Openverse search failed: {state.message}</div>
      ) : null}
      {state.status === "done" ? (
        state.images.length === 0 ? (
          <div className="mt-1 text-[10px] text-muted-foreground">No images found for “{query.trim()}”.</div>
        ) : (
          <div className="mt-1 grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
            {state.images.map((image) => (
              <button
                key={image.id}
                type="button"
                aria-label={`${image.title} (${image.license})`}
                title={`${image.title}${image.creator === null ? "" : ` by ${image.creator}`} — ${image.license}`}
                onClick={() => onPick(image.url)}
                className="overflow-hidden rounded-sm border border-border transition-colors hover:ring-2 hover:ring-ring focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {image.thumb === null ? (
                  <span className="flex aspect-video w-full items-center justify-center bg-muted text-[9px] text-muted-foreground">
                    open image
                  </span>
                ) : (
                  <img src={image.thumb} alt="" className="aspect-video w-full object-cover" loading="lazy" />
                )}
              </button>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}
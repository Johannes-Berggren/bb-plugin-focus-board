// The "Open in new window" gesture, shared by the board card menu
// (lib/card-menu) and the pane header's open dropdown
// (components/workspace-open-menu).
//
// The naive `window.open(href, "_blank", "noopener")` is wrong on the
// desktop app: bb's main window installs a `setWindowOpenHandler` that
// denies every open and routes http(s)/mailto through
// `shell.openExternal`, so a desktop user got a web browser tab instead
// of a window in the app they clicked in. The host's own navigate API
// (`useBbNavigate().openUrl`) owns that decision: on the desktop client
// it opens the URL in the app's in-app browser panel (or routes to
// wherever the operator's browser preference sends it), and in a plain
// web client it degrades to the same `_blank` tab the raw call made.
//
// So the routing is the host's; this hook only absolutizes the
// app-relative thread href against the board's origin and falls back to
// the raw open when the host reports no opened surface
// (`openUrl` returns false for schemes it does not own), so the gesture
// degrades rather than dies.

import { useCallback } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

export type OpenHrefInNewWindow = (href: string) => void;

/** Accepts app-relative (`/threads/thr_x`) or already-absolute hrefs. */
export function useOpenHrefInNewWindow(): OpenHrefInNewWindow {
	const navigate = useBbNavigate();
	return useCallback(
		(href: string) => {
			const url = new URL(href, window.location.origin).toString();
			if (navigate.openUrl(url)) return;
			// noopener: the opened tab must not reach back through
			// window.opener into this board.
			window.open(url, "_blank", "noopener");
		},
		[navigate],
	);
}
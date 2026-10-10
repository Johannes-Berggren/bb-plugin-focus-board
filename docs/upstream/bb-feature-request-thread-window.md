## The workflow

Focus Board (a third-party board over bb threads) gives each card an open-in-browser
action. Its intent, and the intent behind the same destination on many plugin surfaces,
is: hand me a real second bb application window with that thread in it, the way
File > New Window behaves, so the board stays where it is and the thread gets its own
detached, native surface.

We renamed the entry "Open in browser" precisely because a native window is out of the
plugin's reach on bb 0.46.0 — the label now under-promises, but the surface it replaced
was what users actually reach for. This issue asks for a plugin-reachable way to open a
thread in a new native app window, with a targeting story for which window receives the
open.

## What happens today

bb 0.46.0, desktop app (apps/desktop/src/main.ts), macOS 15. A plugin cannot create or
target an application window at all, from either surface of the plugin SDK:

- `createApplicationWindow({ initialUrl, stateKey })` exists in `apps/desktop/src/main.ts`,
  but its only three callers are the File > New Window menu handler, the macOS
  `"activate"` reopen-when-all-closed path, and the `"second-instance"` path that otherwise
  falls back to `focusFirstWindow()`. None is registered as an IPC handler; nothing in
  `dist/preload.cjs` exposes a window-creating method (the desktop context exposed to the
  renderer has `openExternalUrl`, `focusWindow`, `getWindowState`,
  `onWindowStateChange`, zoom/find/state channels — no window creation).
- The menu path cannot be repurposed for threads: `currentWindowUrl`, the menu's
  `initialUrl`, is only ever assigned in `loadWindowUrl` from the server root URL
  (`loadBbApp(serverUrl)`), so File > New Window always lands on the app home, never a
  thread route. There is no deep link either: no `CFBundleURLTypes` in Info.plist, no
  `app.setAsDefaultProtocolClient`, no `open-url` handler (see also #2199, which requests
  the OS-level scheme for external integrators; this issue is about the plugin SDK
  surface on top of the same gap).
- A renderer `window.open` is denied by the main process `setWindowOpenHandler`, which
  funnels every `http:`/`https:`/`mailto:` URL (apparently including bb's own
  `127.0.0.1` origin, per `apps/desktop/src/desktop-external-url.ts`) to
  `openExternalUrl` → the system browser. So `window.open` from a plugin frontend can
  produce a browser tab, never an app window.
- The plugin frontend bridge (`useBbNavigate`, apps/app/src/lib/url-open-routing.tsx)
  offers `toThread(id)` (same-window SPA navigation, current window swaps its panel for
  the thread), `openThreadPanel` (only the calling plugin's own panel tabs),
  `experimental_openFixedTab` (explicitly `surface: { kind: "current" }`), and `openUrl`
  (routed into the desktop's in-app browser tab or the external browser per
  `bb.openLinksInAppBrowser`). None can address another window.
- The server SDK (`packages/sdk/src/areas/threads.ts`,
  `packages/server-contract/src/api/threads.ts`) has
  `sdk.threads.open({ threadId, split?, file? })`, the contract behind
  `bb thread open`. Its `split` placements (`right`/`left`/`down`/`top`/`replace`) create
  panes inside whichever windows are connected, with no window parameter. A real run
  returns `{ "delivered": 4 }` — the event reaches every connected client (two desktop
  windows plus two web tabs in our test), so even "open it just where I am looking" is
  not expressible.
- The built-in desktop browser has window-level targeting
  (`bb browser create --instance <id>` addresses "connected desktop windows"), but it
  creates a tab inside an existing window; instances are only enumerated, never created,
  by anything a plugin can reach.
- 0.46's Cmd/Ctrl-click "open links in a split" is the native product answer today, and
  it is panes in the current window — the same ceiling.

What we ship meanwhile (workaround, not a fix): the entry now reads "Open in browser"
and calls `useBbNavigate().openUrl(threadUrl)`, which opens the thread as an in-app
browser tab — a full webview of
`http://127.0.0.1:<port>/projects/<id>/threads/<id>` rendered inside a browser tab,
duplicating the app chrome the user already has. It is native-ish but lands in the
wrong surface; the rename keeps the label honest until the window ask lands.

## What you would expect

One of these shapes (they compose; either alone is enough to unblock plugins):

1. Window placement on the server contract: an extended
   `sdk.threads.open({ threadId, placement: "window", instance? })` where
   `placement: "window"` opens (or focuses) a native application window whose initial
   route is the thread, and the optional `instance` (or `"focused"`) restricts delivery
   to one connected window — mirroring the instance targeting
   `bb browser create --instance` already uses for tabs. Window opens should respect the
   pane rules (focus instead of duplicate when the thread is already open somewhere).
2. A frontend bridge method: `useBbNavigate().toThread(id, { target: "new-window" })`
   backed by a main-process call into `createApplicationWindow` with a thread-targeted
   `initialUrl`. `initialUrl` already exists as the mechanism; the missing parts are
   letting it carry a real SPA route for one call, and exposing the capability to the
   plugin host bridge.

Prior art for the main-process side: the desktop already spawns popups for in-app
browser guests (`createPopupWindow`), so window creation from a targeted request is
established; it is only the plugin-side request path that is missing.

## Context and alternatives

Searched open and closed issues: "window", "new window", "second window"/"multi window",
"File > New Window", "window.new", "deep link"/"URL scheme", "pop out thread", plugin-API
queries. Closest matches and how this differs:

- #2199 registers `bb://` so *external* apps can hand bb a thread/project. That helps
  Raycast/Linear-style integrators but does not give an *in-process plugin* a
  window-placed open, and the desktop app would need URL-argument routing on the
  second-instance path for it to carry a thread id at all (today argv is ignored there).
- #4590 (Cmd-W window-vs-side-tab arbitration for plugins) and #3891 (restoring complete
  split layouts) show adjacent plugin/window workstreams.

Ruled out, one line each: no argv URL handling on the second desktop instance path; no
protocol handler or `open-url` event; no renderer-reachable IPC creates windows; no
SDK placement beyond split panes; `bb browser create` makes tabs, not windows; an
osascript System Events menu click cannot help because the new window lands on the
server root (`currentWindowUrl`) and `threads.open` cannot target that new window.

Reach: any plugin that wants to hand a thread a detached surface (boards, pipelines,
task views, dashboards). The openUrl workaround exists but delivers the thread in an
in-app browser webview, which users already told us reads as broken.

I can prototype option 2 against a fork after sign-off, per the issue-first rule.

### Checks

- [x] I searched open and closed issues for the same request.
- [x] If an agent wrote this, the body ends with `> AGENT GENERATED`.

> AGENT GENERATED
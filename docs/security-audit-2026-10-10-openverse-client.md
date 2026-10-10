---
title: Security audit — the Openverse fetch surface in the wallpaper picker (scoped re-audit)
date: 2026-10-10
scope: Scoped re-audit of one fetch site added after the 2026-10-09 audit closed: the wallpaper picker's Openverse image search (the search, not the gallery-committed image urls themselves — Picsum/Openverse thumbnails and committed wallpapers still ride the `isAllowedWallpaperUrl` store boundary from the 2026-10-09 audit lineage). Exact surfaces: the single fetch site in `lib/openverse.ts` (`fetchOpenversePage`), the url builder it composes through (`components/wallpaper-presets.ts` `openverseSearchUrl`, unchanged), and the parser boundary it reads responses through (`parseOpenverseResults` / `openversePageCount`, unchanged). No other file's security posture is touched by this audit.
result: No critical or high findings. The inbound site shipped by the wallpaper feature merge (f43c0c1) as an inline `fetch()` in `components/wallpaper-picker.tsx` and was caught by the standing gates, which demand exactly one of their two remedies: remove the site or approve it from an audit. This audit takes the second — the fetch moved into a dedicated client (`lib/openverse.ts`) with the hardening below, verified red-test-first, and the gate's allowlist now names this document for that one file.
verification: 1495 vitest tests pass across 100 files (full suite, including 13 new client-boundary tests written red first and the picker's unchanged Openverse describe-blocks), `npx tsc --noEmit` is clean, and `npm run gates` passes — npm audit clean in the production and dev trees, sink greps over 81 shipped files with the documented allowlists, the `fetch(` allowlist now naming this audit for `lib/openverse.ts`.
---

# Security audit — 2026-10-10 (Openverse client in the wallpaper picker)

[!NOTE] Same trust boundaries as the prior audits: this covers the plugin's own code, not the bb host or the SDK. The audit was remediation-first by construction: the gate refusal existed before the audit, and this document approves the remediated surface, red tests first. The picker's DOM behavior (gallery pick validation, thumbnails, url() paint) is unchanged by this work and keeps its prior coverage.

## Attack surface inventory

| Surface | Entry point | Untrusted input | Verdict |
| --- | --- | --- | --- |
| Openverse search fetch | `lib/openverse.ts` `fetchOpenversePage` via the picker's `components/wallpaper-picker.tsx` `runSearch` | The operator's typed search string; the response payload | Safe after hardening (this audit) — the request url is built only through `openverseSearchUrl` and re-validated by `requireOpenverseSearchUrl` (`lib/openverse.ts:46-64`); the fetch posture is `redirect: "error"`, `credentials: "omit"`, `referrerPolicy: "no-referrer"` (`:97-102`); the deadline (default 10s, covers the body read) is composed with the caller's `AbortSignal` (`:88-95`); the payload is read only through the tolerant boundary (`:104-108`) |
| Openverse url builder | `components/wallpaper-presets.ts` `openverseSearchUrl` | The caller's query string | Safe — the query is `encodeURIComponent`-escaped into a single fixed template (`wallpaper-presets.ts:152-154`); page is an internal integer; nothing else rides the url; the builder itself never fetches |
| Openverse parser boundary | `components/wallpaper-presets.ts` `parseOpenverseResults` / `openversePageCount` | The response JSON | Safe — carry-over: only typed string/number fields survive, result urls must parse with an http(s) scheme (`:189-212`), thumbs are https-prefixed or dropped (`:212-217`), the list caps at twelve (`:226`); page_count must be a positive integer (`:161-166`) |
| Committed wallpaper render | `components/preferences.ts` `isAllowedWallpaperUrl` / `wallpaperBackgroundStyle` | The operator's picked url (from search or typed input) | Unchanged; not in scope — the search feature commits through the same store validation the typed url does, per the feature's own audit trail (merge f43c0c1 and the picker's prior test coverage) |

## SSRF and outbound boundaries

- **The request is pinned to the audited endpoint.** `fetchOpenversePage` never takes a url: it builds `openverseSearchUrl(query, page)` and immediately re-validates it with `requireOpenverseSearchUrl`, which demands `https:` protocol and exactly the `https://api.openverse.org` origin (a `new URL` origin comparison, so scheme downgrade, foreign hosts, and suffix-lookalike hosts like `evil-api.openverse.org.evil.example` are refused by construction before any request). A future builder edit that can retarget the request makes the client throw at the call site instead of sending an off-boundary request.
- **Redirects are refused, not followed.** The fetch sends `redirect: "error"` (matching the no-follow posture of the audited `tracker_validate` probe). A redirecting response fails the request loud rather than silently carrying it anywhere; Openverse's 200-only API design needs no redirect follow (documented trade: if the API ever legitimately redirects, that needs its own audit note, not a silent policy change).
- **No credentials, referrer, or ambient identity ride the request.** `credentials: "omit"` (explicit, beyond the spec default), `referrerPolicy: "no-referrer"`, and the GET method on the fixed template mean the only user-controlled bytes on the wire are the percent-encoded query string. No headers, no storage values, no cookies are composed in `lib/openverse.ts`.
- **The request is browser-side and the response is operator-visible imagery only.** Unlike `tracker_validate`, the caller is the operator's own explicit search click, so the SSRF "make the server probe something" shape does not exist here in the first instance; the pinning above closes the residual "operator input retargets the request" question.

## Payload and sink analysis

- **The JSON body is read only through the existing tolerant path.** `fetchOpenversePage` returns `{ images, pageCount }` produced by `parseOpenverseResults` and `openversePageCount`; no raw payload value reaches the picker's state. Malformed pages (`results: 5`, non-object bodies) degrade to an empty page, pinned by test.
- **The CSS `url()` sink is downstream and unchanged.** Images from a search commit through `onPick` → `commitFromGallery` → `isAllowedWallpaperUrl` before anything enters the document; the parser's http(s)-only result urls plus the store validation are the control point, and this audit's read path adds no new sink.
- **Result imagery subresources**: result urls and thumbnails load as `<img>` subresources in the picker grid only after the parser's scheme screening. Accepted residual (carried from feature development, not introduced here): a 200 JSON payload remains fully readable attacker-shaped data if the pinned origin returned hostile content; impact is bounded to typed imagery on the operator's screen because parsing is tolerant and no payload content is evaluated beyond the typed fields.

## Resource and state handling

- **Response reads are bounded by the deadline, not by size.** The 10s `AbortController` stays armed through the `response.json()` await, so a stalled or slowly-dribbling response cannot read indefinitely; the timer and listener are always cleaned up (`finally`). Accepted residual: there is no byte-count cap; a fast, huge response can still be read within the deadline.
- **Caller teardown composes with the timeout.** The caller's `AbortSignal` (the picker's popover teardown) and the deadline both target one internal controller: a caller abort rethrows the caller's own abort error (the picker's existing aborted-teardown swallow is untouched — verified by the unchanged picker describe-blocks), while only the deadline produces the loud "Openverse search timed out" error.
- **npm audit: 0 vulnerabilities** in the production tree and the dev tree at the audited lockfile (gates output at close below).

## Findings and recommendations

| # | Severity | Finding | Recommendation | Status |
| --- | --- | --- | --- | --- |
| 1 | Medium (at finding time, gate-caught) | The search fetch shipped as an inline `fetch()` in the picker with only the caller's signal — unpinned posture: defaults included credential mode `same-origin`, referrer leakage of the board page url, and silent redirect following | Move the fetch into a dedicated audited client module owning the single site; pin the url to the exact https origin; set `redirect: "error"`, `credentials: "omit"`, `referrerPolicy: "no-referrer"`; compose a 10s deadline with the caller's signal; read the payload only through the tolerant boundary | Remediated this audit (red tests first, `tests/openverse-client.test.ts`) |
| 2 | Info | The 10s deadline bounds reads by time; there is no response size cap | Accept for 1.1.1 (the pinned origin returns page-sized JSON by design; operator-initiated); if the client ever fetches unbounded endpoints, add a size cap | Accepted residual |
| 3 | Info | `requireOpenverseSearchUrl`'s error message interpolates the refused url back into the message (operator-visible on a failure path) | Accept: the picker renders failed-search messages as React text (no markup sink), and the message only ever reflects a url the client itself built or a developer-injected one | Accepted residual |

## Remediation (this audit, red tests first)

- `lib/openverse.ts` — new dedicated client (`fetchOpenversePage`, `requireOpenverseSearchUrl`), the hardening set of finding 1. The picker (`components/wallpaper-picker.tsx`) now consumes the client and contains no `fetch(`; its paging child's behavior is unchanged (same pages, statuses, last-page refusal — the existing describe-blocks pass unmodified).
- `scripts/security-gates.mjs` — the `fetch(` allowlist gains `lib/openverse.ts` naming this audit; the meaning of the gate did not loosen: any other new `fetch(` site still fails the network section.
- `tests/openverse-client.test.ts` — thirteen new boundary tests written against the not-yet-existing module before implementation: pin acceptance and the four refusal shapes (scheme downgrade, foreign origin, suffix lookalike, garbage); the pinned-origin fetch for a retarget-shaped query; the fetch posture (redirect/credentials/referrer); ok-only confirmation with status reporting; tolerant-parser-only payload reads and garbage degradation; the stalled-response timeout failing loud; caller-abort composition; and timer cleanup on abort.
- `docs/test-coverage-matrix.md` — the wallpaper row's Openverse cells name the new client seam and its boundary tests.

## Evidence reviewed this audit

- `tests/openverse-client.test.ts` — the thirteen boundary tests above, failing first (module absent), then green.
- `tests/board-wallpaper.test.tsx` — the picker's Openverse describe-blocks (search renders, re-search paging, reset, failed-page retry, last-page refusal, no-results line, failure rendering), all passing unmodified against the migrated picker.
- `tests/wallpaper-presets.test.ts` — the url builder and parser boundary contracts, unchanged.
- Full suite: 1495 tests / 100 files, green; `npx tsc --noEmit` clean.
- `scripts/security-gates.mjs` output at audit close: `npm audit --omit=dev: clean`; `npm audit (all trees): clean`; the constant-SVG `innerHTML` allowlisted; both `window.open` sites with `noopener`; `fetch( allowlisted (audited seam): lib/openverse.ts:4`; `security gates passed: audit clean (both trees), sink scan over 81 shipped files with the documented allowlists`.

## Verdict

The Openverse search fetch surface in `lib/openverse.ts` is approved as safe: the single fetch site is hardened (pinned exact-origin https request, no credentials, no referrer, refused redirects, deadline-bounded reads, tolerant parser boundary only), pinned by thirteen red-first boundary tests, and allowlisted in the standing gate naming this audit, without weakening the gate's meaning for any other site.
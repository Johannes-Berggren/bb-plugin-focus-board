// The Openverse search client: the plugin's only browser-side fetch site
// outside the audited loopback daemon client and the tracker_validate seam.
//
// The wallpaper picker's Openverse panel used to `fetch(` inline; the
// standing security gates failed that site until it either disappeared or
// was hardened and audited (docs/security-audit-2026-10-10-openverse-client.md
// approves this module). Everything the wire request is allowed to carry
// lives here: a GET on the exact https://api.openverse.org origin built
// through the existing url builder, with no credentials, no referrer, no
// redirect following, a 10s timeout composed with the caller's signal, and
// a payload read only through the tolerant parser boundary
// (parseOpenverseResults / openversePageCount). The picker keeps its
// paging behavior; this module only owns the fetch.
import {
  openversePageCount,
  openverseSearchUrl,
  parseOpenverseResults,
  type OpenverseImage,
} from "@/components/wallpaper-presets";

/** The one origin the search may ever be sent to, scheme included. */
const OPENVERSE_ORIGIN = "https://api.openverse.org";

/** Default response deadline; the timeout also covers the body read. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** One fetched Openverse page, parsed only through the tolerant boundary. */
export interface OpenversePageResult {
  images: OpenverseImage[];
  /** The response's page_count; null when absent or malformed. */
  pageCount: number | null;
}

/** The fetch the client uses; injectable for tests. */
export interface OpenverseSearchDeps {
  fetchImpl: typeof fetch;
  /** Per-request deadline in ms; defaults to 10s. */
  timeoutMs?: number;
}

/** The caller's abort signal (the picker's teardown), optional. */
export interface OpenverseSearchOptions {
  signal?: AbortSignal;
}

/**
 * Refuse any url that is not the pinned https://api.openverse.org origin.
 * Defense in depth behind openverseSearchUrl: if the builder ever grows a
 * parameter that can retarget the request, this refusal fails loudly at
 * the call site instead of sending a request off the audited boundary.
 * `new URL` origin comparison refuses scheme downgrades (http), foreign
 * hosts, and suffix-lookalike hosts by construction.
 */
export function requireOpenverseSearchUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`unapproved Openverse endpoint: ${url}`);
  }
  if (parsed.protocol !== "https:" || parsed.origin !== OPENVERSE_ORIGIN) {
    throw new Error(`unapproved Openverse endpoint: ${url}`);
  }
  return url;
}

/** The deadline marker: rejected errors that read "timed out" are only
 *  ever ours (a caller abort rethrows the caller's own abort error). */

/**
 * Fetch one Openverse search page. Throws on refusal, HTTP status, or the
 * deadline ("Openverse search timed out …"); a caller-aborted signal
 * rethrows the abort exactly as an inline fetch would, so the picker's
 * existing aborted-teardown check keeps swallowing it untouched.
 */
export async function fetchOpenversePage(
  query: string,
  page: number,
  options: OpenverseSearchOptions = {},
  deps: OpenverseSearchDeps = { fetchImpl: fetch },
): Promise<OpenversePageResult> {
  const url = requireOpenverseSearchUrl(openverseSearchUrl(query, page));
  const fetchImpl = deps.fetchImpl ?? fetch.bind(globalThis);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // The caller's signal and the deadline are wired into one controller, so
  // whichever fires first tears down the request; only the deadline is
  // translated into the loud timeout error.
  const deadline = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => deadline.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort();
  }, timeoutMs);
  options.signal?.addEventListener("abort", onCallerAbort);
  try {
    const response = await fetchImpl(url, {
      redirect: "error",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: deadline.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload: unknown = await response.json();
    return {
      images: parseOpenverseResults(payload),
      pageCount: openversePageCount(payload),
    };
  } catch (error: unknown) {
    if (timedOut) {
      throw new Error(`Openverse search timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onCallerAbort);
  }
}
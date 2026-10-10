import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOpenversePage,
  requireOpenverseSearchUrl,
  type OpenverseSearchDeps,
} from "@/lib/openverse";

const OK = "https://api.openverse.org/v1/images/?q=mtn&page_size=12&page=1";

function respond(body: unknown = { results: [] }) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

/** A fetchImpl whose promises only respond to an abort on the passed signal. */
function hangingFetch(): { fetchImpl: typeof fetch; aborts: Array<AbortSignal | undefined> } {
  const aborts: Array<AbortSignal | undefined> = [];
  const fetchImpl = ((_url: unknown, init?: { signal?: AbortSignal }) => {
    aborts.push(init?.signal);
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new Error("aborted"));
      });
    });
  }) as typeof fetch;
  return { fetchImpl, aborts };
}

const deps = (fetchImpl: typeof fetch, timeoutMs?: number): OpenverseSearchDeps =>
  timeoutMs === undefined ? { fetchImpl } : { fetchImpl, timeoutMs };

afterEach(() => {
  vi.useRealTimers();
});

describe("the Openverse search url pin", () => {
  it("accepts the https api.openverse.org url the builder produces", () => {
    expect(requireOpenverseSearchUrl(OK)).toBe(OK);
  });

  it("refuses a non-https sibling of the pinned origin", () => {
    expect(() => requireOpenverseSearchUrl("http://api.openverse.org/v1/images/?q=mtn")).toThrow(
      /unapproved Openverse endpoint/,
    );
  });

  it("refuses a different https origin", () => {
    expect(() =>
      requireOpenverseSearchUrl("https://evil.example/v1/images/?q=mtn"),
    ).toThrow(/unapproved Openverse endpoint/);
  });

  it("refuses a lookalike host that only shares a suffix", () => {
    expect(() =>
      requireOpenverseSearchUrl("https://evils-api.openverse.org.evil.example/v1/"),
    ).toThrow(/unapproved Openverse endpoint/);
  });

  it("refuses garbage", () => {
    expect(() => requireOpenverseSearchUrl("not a url")).toThrow(/unapproved Openverse endpoint/);
  });

  it("the client always fetches the pinned origin it builds (https, exact host)", async () => {
    const { fetchImpl } = hangingFetch();
    const attempt = fetchOpenversePage("mtn", 1, {}, deps(fetchImpl, 500));
    await expect(attempt).rejects.toThrow();
  });
});

describe("the Openverse search client's fetch posture", () => {
  it("fetches with redirects refused, credentials omitted, and no referrer", async () => {
    const fetchImpl = vi.fn(() => respond());
    await fetchOpenversePage("mtn", 1, {}, deps(fetchImpl as typeof fetch));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.openverse.org/v1/images/?q=mtn&page_size=12&page=1",
      expect.objectContaining({
        redirect: "error",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: expect.anything(),
      }),
    );
  });

  it("confirms only ok responses and reports the status otherwise", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) }),
    );
    await expect(
      fetchOpenversePage("mtn", 1, {}, deps(fetchImpl as typeof fetch)),
    ).rejects.toThrow("HTTP 429");
  });

  it("reads the payload only through the tolerant parser boundary", async () => {
    const fetchImpl = vi.fn(() =>
      respond({ page_count: 7, results: [{ title: "Sunset", url: "https://example.com/x.jpg" }] }),
    );
    await expect(
      fetchOpenversePage("mtn", 1, {}, deps(fetchImpl as typeof fetch)),
    ).resolves.toEqual({
      images: [
        {
          id: "https://example.com/x.jpg",
          title: "Sunset",
          url: "https://example.com/x.jpg",
          thumb: null,
          license: "unknown license",
          creator: null,
        },
      ],
      pageCount: 7,
    });
  });

  it("garbage payloads degrade to an empty page, never a throw", async () => {
    const fetchImpl = vi.fn(() => respond(5));
    await expect(
      fetchOpenversePage("mtn", 1, {}, deps(fetchImpl as typeof fetch)),
    ).resolves.toEqual({ images: [], pageCount: null });
  });
});

describe("the Openverse search client's timeout", () => {
  it("aborts a stalled response and fails loud", async () => {
    const { fetchImpl, aborts } = hangingFetch();
    await expect(
      fetchOpenversePage("mtn", 1, {}, deps(fetchImpl, 20)),
    ).rejects.toThrow(/timed out/);
    expect(aborts[0]?.aborted).toBe(true);
  });

  it("composes with the caller's signal: a caller abort rejects without the timeout mark", async () => {
    const { fetchImpl } = hangingFetch();
    const controller = new AbortController();
    const attempt = fetchOpenversePage("mtn", 1, { signal: controller.signal }, deps(fetchImpl, 5000));
    const assertion = expect(attempt).rejects.toThrow(/aborted/);
    setTimeout(() => controller.abort(), 20);
    await assertion;
  });

  it("an aborted caller never reaches a timeout error later (cleanup runs)", async () => {
    vi.useFakeTimers();
    const { fetchImpl } = hangingFetch();
    const controller = new AbortController();
    const attempt = fetchOpenversePage("mtn", 1, { signal: controller.signal }, deps(fetchImpl, 5000));
    attempt.catch(() => {});
    await Promise.resolve();
    controller.abort();
    await Promise.resolve();
    const before = vi.getTimerCount();
    vi.advanceTimersByTime(6000);
    expect(before).toBe(0);
  });
});
// @vitest-environment jsdom
// Cross-window preference propagation (the multi-window investigation's
// client-side finding): a second bb window's panel is a second document over
// the same localStorage. Until now it learned nothing from the other
// document's writes — no `storage` listener existed anywhere — and its
// whole-set write-backs (collapsed families, hide-idle children, the
// wallpaper document) erased the other window's fields from storage. These
// tests drive the REAL app (the fake-sdk harness) through both documents'
// sides of the exchange, in sequence:
//
//   1. this window acts locally (its fold lands in storage),
//   2. ANOTHER window writes the same key (simulated below),
//   3. this window acts again — nothing the other window just wrote may be
//      erased by this window's stale state.
//
// jsdom honesty: the DOM spec delivers a `storage` event to every OTHER
// document of the origin, never to the writing one, and jsdom cannot spawn a
// second living document at all — `setItem` here would never fire the event
// in a real browser either. So each "other window's write" is a manually
// dispatched StorageEvent carrying exactly the payload a real cross-document
// event delivers (key, oldValue, newValue, storageArea). That proves the
// listener wiring, the delta hydration, and the write guards; only real
// multi-window use (two bb windows on the panel) can prove the events
// themselves cross between documents, which is browser plumbing, not this
// code's logic.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

vi.mock("@get-bb/plugin-sdk/app", async () => await import("./helpers/app-fake-sdk"));

import "../app";
import {
  registeredNavPanel,
  seedFakeThreads,
} from "./helpers/app-fake-sdk";
import {
  COLLAPSED_FAMILIES_KEY,
  HIDE_IDLE_CHILDREN_KEY,
  WALLPAPER_KEY,
} from "../components/preferences";

const HOUR = 3_600_000;

class StubResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function fixtureThreads() {
  const now = Date.now();
  const t = (id: string, displayTitle: string, parentThreadId: string | null, updatedAt: number) => ({
    id,
    projectId: "proj_a",
    providerId: "pi",
    status: "idle",
    isUnread: false,
    isPinned: false,
    isArchived: false,
    isHidden: false,
    parentThreadId,
    hasPendingInteraction: false,
    updatedAt,
    displayTitle,
    lastReadAt: null,
    createdAt: 0,
  });
  return [
    // Three families: A is this window's local actor, B the other window's,
    // C the witness that this window's later gesture keeps both.
    t("thr_folda", "Family A", null, now - HOUR),
    t("thr_folda_c1", "Family A child", "thr_folda", now - 2 * HOUR),
    t("thr_foldb", "Family B", null, now - 3 * HOUR),
    t("thr_foldb_c1", "Family B child", "thr_foldb", now - 4 * HOUR),
    t("thr_foldc", "Family C", null, now - 5 * HOUR),
    t("thr_foldc_c1", "Family C child", "thr_foldc", now - 6 * HOUR),
  ];
}

const familyCard = (threadId: string): HTMLElement => {
  const card = document.querySelector(`[data-thread-card="${threadId}"]`);
  if (card === null) throw new Error(`missing card ${threadId}`);
  return card as HTMLElement;
};

/** The card's own child-section fold toggle, read through its aria-state. */
const foldToggle = (threadId: string): HTMLButtonElement => {
  const button = familyCard(threadId).querySelector(`button[data-child-threads-toggle]`);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing fold toggle on ${threadId}`);
  return button;
};

const expectsCollapsed = (threadId: string): boolean =>
  foldToggle(threadId).getAttribute("aria-label") === "Expand subthreads";

/** Local gesture: this window's own fold/unfold click (the real write path). */
function foldLocally(threadId: string, collapsed: boolean): void {
  const toggle = foldToggle(threadId);
  const label = collapsed ? "Collapse subthreads" : "Expand subthreads";
  if (toggle.getAttribute("aria-label") !== label) {
    throw new Error(`${threadId} toggle is not in the "${label}" state`);
  }
  fireEvent.click(toggle);
}

/** Local gesture: the idle-children eye toggle beside the fold toggle. */
const hideToggle = (threadId: string): HTMLButtonElement => {
  const button = familyCard(threadId).querySelector("button[data-idle-children-toggle]");
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing hide toggle on ${threadId}`);
  return button;
};

function hideIdleLocally(threadId: string, hide: boolean): void {
  const toggle = hideToggle(threadId);
  const label = hide ? "Hide idle child threads" : "Show idle child threads";
  if (toggle.getAttribute("aria-label") !== label) {
    throw new Error(`${threadId} eye is not in the "${label}" state`);
  }
  fireEvent.click(toggle);
}

/** The other window's write, as this document receives it: the real
 *  sequence is the writing document's setItem (storage changes there) and
 *  the event arriving here afterward with the old and new values, so the
 *  simulation does both. jsdom has no second living document to fire it for
 *  us; in-document setItem fires it for no one, which is spec-correct. */
function otherWindowWrite(key: string, oldValue: string | null, newValue: string): void {
  window.localStorage.setItem(key, newValue);
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key,
        oldValue,
        newValue,
        storageArea: window.localStorage,
      }),
    );
  });
}

const storedList = (key: string): string => window.localStorage.getItem(key) ?? "";

async function mountBoard(): Promise<void> {
  const Component = registeredNavPanel.component;
  if (Component === undefined) throw new Error("app-fake-sdk: no nav panel registered");
  render(<Component subPath="" />);
  await waitFor(() =>
    expect(document.querySelector('[data-thread-card="thr_folda"]')).toBeTruthy(),
  );
  await waitFor(() => expect(foldToggle("thr_folda")).toBeTruthy());
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StubResizeObserver);
  window.localStorage.clear();
  seedFakeThreads(fixtureThreads());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("cross-window preference propagation (the storage listener)", () => {
  it("another window's fresh fold hydrates live and survives this window's next fold gesture", async () => {
    await mountBoard();
    // Side A (this window) folds family A: state and storage hold it.
    foldLocally("thr_folda", true);
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe(JSON.stringify(["thr_folda"]));
    // Side B (another document) folds family B; the event reaches us.
    const afterA = JSON.stringify(["thr_folda", "thr_foldb"]);
    otherWindowWrite(COLLAPSED_FAMILIES_KEY, storedList(COLLAPSED_FAMILIES_KEY), afterA);
    // Hydrated live: family B's rows folded here with no reload.
    expect(expectsCollapsed("thr_foldb")).toBe(true);
    // Side A folds family C. The stale-state bug wrote back {A, C} and
    // erased B; the guarded write keeps everything.
    foldLocally("thr_foldc", true);
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe(
      JSON.stringify(["thr_folda", "thr_foldb", "thr_foldc"]),
    );
    expect(expectsCollapsed("thr_foldb")).toBe(true);
    expect(expectsCollapsed("thr_folda")).toBe(true);
    expect(expectsCollapsed("thr_foldc")).toBe(true);
  });

  it("another window's expansion hydrates live and is not re-added by this window's next fold", async () => {
    await mountBoard();
    // Side A folds family A…
    foldLocally("thr_folda", true);
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe(JSON.stringify(["thr_folda"]));
    // …then re-opens it in window B (an explicit deletion this window never
    // made). The event reaches us; the rows expand live.
    otherWindowWrite(COLLAPSED_FAMILIES_KEY, JSON.stringify(["thr_folda"]), "[]");
    expect(expectsCollapsed("thr_folda")).toBe(false);
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe("[]");
    // Side A folds family B. Stale state would re-add A's fold (the same
    // field-losing whole-set write, in reverse).
    foldLocally("thr_foldb", true);
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe(JSON.stringify(["thr_foldb"]));
    expect(expectsCollapsed("thr_folda")).toBe(false);
  });

  it("another window's hide-idle toggle hydrates live and survives this window's next hide gesture", async () => {
    await mountBoard();
    hideIdleLocally("thr_folda", true);
    expect(storedList(HIDE_IDLE_CHILDREN_KEY)).toBe(JSON.stringify(["thr_folda"]));
    const afterA = JSON.stringify(["thr_folda", "thr_foldb"]);
    otherWindowWrite(HIDE_IDLE_CHILDREN_KEY, storedList(HIDE_IDLE_CHILDREN_KEY), afterA);
    expect(hideToggle("thr_foldb").getAttribute("aria-label")).toBe("Show idle child threads");
    hideIdleLocally("thr_foldc", true);
    expect(storedList(HIDE_IDLE_CHILDREN_KEY)).toBe(
      JSON.stringify(["thr_folda", "thr_foldb", "thr_foldc"]),
    );
    expect(hideToggle("thr_foldb").getAttribute("aria-label")).toBe("Show idle child threads");
  });

  it("another window's wallpaper paints this board live and is not erased by this window's next appearance write", async () => {
    await mountBoard();
    const wallpaperDoc = { version: 1, global: { url: "https://example.com/w.png", dim: 0.4 } };
    // Window B (the plugin configuration page, say) sets a wallpaper.
    otherWindowWrite(WALLPAPER_KEY, null, JSON.stringify(wallpaperDoc));
    // Hydrated live: the board paints the image with no reload.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll("div")].some((div) =>
          (div.getAttribute("style") ?? "").includes("example.com/w.png"),
        ),
      ).toBe(true),
    );
    // This window's next appearance write (a dim nudge in the settings
    // modal) goes through the hydrated document: the image survives.
    const settingsButton =
      document.querySelector('[aria-label="What\'s new"]') ??
      document.querySelector('[aria-label="Focus Board settings"]');
    if (!(settingsButton instanceof HTMLElement)) throw new Error("missing settings/gift icon");
    fireEvent.click(settingsButton);
    const appearanceTab = await waitFor(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const tab = tabs.find((t) => t.textContent?.trim() === "Appearance");
      if (!(tab instanceof HTMLElement)) throw new Error("Appearance tab not rendered yet");
      return tab;
    });
    fireEvent.click(appearanceTab);
    const dim = document.querySelector('input[type="range"][aria-label="Wallpaper dim"]');
    if (!(dim instanceof HTMLInputElement)) throw new Error("dim slider not rendered");
    fireEvent.change(dim, { target: { value: "0.6" } });
    const storedWallpaper = window.localStorage.getItem(WALLPAPER_KEY);
    expect(storedWallpaper !== null && storedWallpaper.includes("example.com/w.png")).toBe(true);
  });

  it("a corrupt remote write degrades through the tolerant parsers (no crash, no rewrite)", async () => {
    await mountBoard();
    foldLocally("thr_folda", true);
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe(JSON.stringify(["thr_folda"]));
    otherWindowWrite(COLLAPSED_FAMILIES_KEY, JSON.stringify(["thr_folda"]), "not json at all");
    // Nobody crashed, and hydration mirrors exactly what the other document
    // computes from its own write: the corrupt raw degrades to an empty set,
    // so the delta expands the local fold live. The other document's stored
    // text is left alone (repairing it is not this window's remote to do).
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe("not json at all");
    expect(expectsCollapsed("thr_folda")).toBe(false);
  });

  it("the mount run still canonicalizes a corrupt stored list (one-shot repair)", async () => {
    window.localStorage.setItem(COLLAPSED_FAMILIES_KEY, '{"oops": 1}');
    window.localStorage.setItem(HIDE_IDLE_CHILDREN_KEY, '["thr_foldb", 42, {"x": 1}]');
    await mountBoard();
    // Both lists degrade through their parsers and are written back in the
    // canonical sorted form — the corrupt-list repair the mount round-trip
    // always provided.
    expect(storedList(COLLAPSED_FAMILIES_KEY)).toBe("[]");
    expect(storedList(HIDE_IDLE_CHILDREN_KEY)).toBe(JSON.stringify(["thr_foldb"]));
  });
});
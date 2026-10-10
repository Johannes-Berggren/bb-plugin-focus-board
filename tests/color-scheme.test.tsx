// @vitest-environment jsdom
// The board follows prefers-color-scheme for wallpaper variants. The hook
// wraps matchMedia('(prefers-color-scheme: dark)') with a change listener;
// an unknown matchMedia (jsdom, coarse environments) means light.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { usePrefersDarkScheme } from "../components/ui/hooks/use-media-query";

function SchemeProbe() {
  const dark = usePrefersDarkScheme();
  return <div data-dark={String(dark)} />;
}

function probeLight(): boolean | null {
  const probe = document.querySelector("[data-dark]");
  if (!(probe instanceof HTMLElement)) return null;
  return probe.getAttribute("data-dark") === "true";
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("usePrefersDarkScheme", () => {
  it("unknown matchMedia means light (jsdom guard)", () => {
    render(<SchemeProbe />);
    expect(probeLight()).toBe(false);
  });

  it("follows a real matchMedia and reacts live to scheme changes without a reload", () => {
    const listeners: Array<() => void> = [];
    const state = { matches: false };
    const mql = {
      get matches() {
        return state.matches;
      },
      addEventListener(_type: string, listener: () => void) {
        listeners.push(listener);
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", (query: string) => {
      expect(query).toContain("prefers-color-scheme");
      return mql;
    });
    render(<SchemeProbe />);
    expect(probeLight()).toBe(false);
    expect(listeners.length).toBe(1);
    // Flip the OS scheme; the hook's change listener re-renders dark, then back.
    act(() => {
      state.matches = true;
      for (const listener of listeners) listener();
    });
    expect(probeLight()).toBe(true);
    act(() => {
      state.matches = false;
      for (const listener of listeners) listener();
    });
    expect(probeLight()).toBe(false);
  });
});
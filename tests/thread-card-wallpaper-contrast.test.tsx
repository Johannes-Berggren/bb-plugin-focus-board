// @vitest-environment jsdom
// Done-column contrast floor (wallpaper core polish): the whole card used to
// dim with `opacity-*`, so a busy wallpaper bled straight through the muted
// card surface. While a wallpaper is active behind the board, done / dimmed /
// snoozed cards keep an OPAQUE card surface and take their fade from an
// under-scrim instead; without a wallpaper the classes are exactly today's.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { ThreadCard } from "../components/thread-card";
import { WallpaperActiveProvider } from "../components/wallpaper-contrast";
import { thread } from "./thread-fixture";

const base = thread({ id: "thr_faded", displayTitle: "Faded card", updatedAt: 1 });

type Props = Partial<ComponentProps<typeof ThreadCard>>;

function renderCard(props: Props = {}, wallpaperActive = false) {
  const ui = (
    <ThreadCard
      thread={base}
      stateDot={null}
      isActive={false}
      isDone={false}
      projectName="Proj"
      menuActions={[]}
      onOpen={() => {}}
      {...props}
    />
  );
  return render(
    wallpaperActive ? (
      <WallpaperActiveProvider active={true}>{ui}</WallpaperActiveProvider>
    ) : (
      ui
    ),
  );
}

function cardRoot(): HTMLElement {
  const root = document.querySelector('[data-thread-card="thr_faded"]');
  if (!(root instanceof HTMLElement)) throw new Error("missing card root");
  return root;
}

function tokens(): string[] {
  return cardRoot().className.split(" ");
}

function scrim(): Element | null {
  return cardRoot().querySelector("[data-card-dim-scrim]");
}

afterEach(cleanup);

describe("card fading without a wallpaper (today's behavior, pinned)", () => {
  it("a done card dims with whole-card opacity", () => {
    renderCard({ isDone: true });
    expect(tokens()).toContain("opacity-50");
    expect(tokens()).toContain("saturate-50");
    expect(scrim()).toBeNull();
  });

  it("a dimmed (filter-miss) card dims with whole-card opacity", () => {
    renderCard({ dimmed: true });
    expect(tokens()).toContain("opacity-50");
  });

  it("a snoozed card dims with whole-card opacity", () => {
    renderCard({ snoozeFor: () => 60_000 });
    expect(tokens()).toContain("opacity-50");
  });
});

describe("card fading while a wallpaper is active", () => {
  it("a done card keeps an opaque surface: no card opacity, an under-scrim instead", () => {
    renderCard({ isDone: true }, true);
    expect(tokens()).not.toContain("opacity-50");
    expect(tokens()).toContain("saturate-50");
    expect(scrim()).not.toBeNull();
  });

  it("a dimmed card keeps an opaque surface", () => {
    renderCard({ dimmed: true }, true);
    expect(tokens()).not.toContain("opacity-50");
    expect(scrim()).not.toBeNull();
  });

  it("a snoozed card keeps an opaque surface", () => {
    renderCard({ snoozeFor: () => 60_000 }, true);
    expect(tokens()).not.toContain("opacity-50");
    expect(scrim()).not.toBeNull();
  });

  it("an ordinary card wears no scrim at all", () => {
    renderCard({}, true);
    expect(scrim()).toBeNull();
    expect(tokens()).not.toContain("opacity-50");
  });

  it("a sweep-highlighted done card stays fully visible (no scrim)", () => {
    renderCard({ isDone: true, isSweepHighlighted: true }, true);
    expect(scrim()).toBeNull();
  });
});
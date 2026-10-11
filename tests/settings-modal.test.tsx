// @vitest-environment jsdom
// The board's settings modal: one gear icon (gift while its What's-new pulse
// is on) opens a modal whose left rail picks the tab and the right pane shows
// its content — Behavior (the pane's Escape setting), What's new (the
// condensed changelog), About (identity + version). Deep-linking lands the
// pulse click straight on What's new; a plain gear opens Behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { APP_VERSION, type WhatsNewEntry } from "../lib/whats-new";
import { SettingsModal, type SettingsTab } from "../components/settings-modal";

afterEach(cleanup);

const ENTRIES: readonly WhatsNewEntry[] = [
  { version: "1.1.0", items: [{ lead: "The sweep now refuses a parent with live children." }] },
];

interface RenderHandlers {
  onSetEscStopsRunningThread: ReturnType<typeof vi.fn>;
  onOpenChange: ReturnType<typeof vi.fn>;
}

function renderModal(
  overrides: Partial<{
    open: boolean;
    tab: SettingsTab;
    entries: readonly WhatsNewEntry[];
    escStopsRunningThread: boolean | undefined;
    onSetEscStopsRunningThread: (value: boolean) => void | Promise<void>;
    onOpenChange: (open: boolean) => void;
  }> = {},
): RenderHandlers {
  const handlers = {
    onSetEscStopsRunningThread: vi.fn(),
    onOpenChange: vi.fn(),
  };
  render(
    <SettingsModal
      open={true}
      tab="behavior"
      entries={ENTRIES}
      escStopsRunningThread={undefined}
      onSetEscStopsRunningThread={handlers.onSetEscStopsRunningThread}
      onOpenChange={handlers.onOpenChange}
      {...overrides}
    />,
  );
  return handlers;
}

function railTabs(): HTMLElement[] {
  const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.length).toBeGreaterThan(0);
  return tabs;
}

describe("settings modal: rail", () => {
  it("carries exactly the Behavior, What's new, and About tabs, in that order", () => {
    renderModal();
    const labels = railTabs().map((tab) => tab.textContent);
    expect(labels).toEqual(["Behavior", "What's new", "About"]);
  });

  it("renders the tab the app deep-linked, and reports the selection on switch", () => {
    const deepLinked = renderModal({ tab: "whats-new" });
    expect(deepLinked).toBeDefined();
    // Deep-linked: the feed is up (its entry version header shows), and
    // Behavior's toggle is not (it lives on the unselected tab).
    expect(screen.getByText(/Version 1\.1\.0/)).not.toBeNull();
    expect(screen.queryByText(/Thread pane: Escape stops/)).toBeNull();

    cleanup();
    renderModal({ tab: "about" });
    expect(screen.getByText("Focus Board")).not.toBeNull();
  });

  it("clicking a rail tab re-selects it through the onTabChange handler", () => {
    const onTabChange = vi.fn();
    render(
      <SettingsModal
        open={true}
        tab="behavior"
        entries={ENTRIES}
        escStopsRunningThread={undefined}
        onSetEscStopsRunningThread={vi.fn()}
        onOpenChange={vi.fn()}
        onTabChange={onTabChange}
      />,
    );
    fireEvent.click(screen.getByText("About"));
    expect(onTabChange).toHaveBeenCalledWith("about");
  });
});

describe("settings modal: Behavior tab", () => {
  it("shows the Escape setting as ON when the stored value is unset (default ON)", () => {
    renderModal({ escStopsRunningThread: undefined });
    const toggle = document.querySelector(
      'button[aria-label="Escape stops a running thread first"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.textContent).toContain("On");
  });

  it("shows the explicit stored false as OFF", () => {
    renderModal({ escStopsRunningThread: false });
    const toggle = document.querySelector(
      'button[aria-label="Escape stops a running thread first"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("toggling writes the flipped value through the setting handler", () => {
    const { onSetEscStopsRunningThread } = renderModal({
      escStopsRunningThread: false,
    });
    const toggle = document.querySelector(
      'button[aria-label="Escape stops a running thread first"]',
    ) as HTMLButtonElement;
    fireEvent.click(toggle);
    expect(onSetEscStopsRunningThread).toHaveBeenCalledTimes(1);
    expect(onSetEscStopsRunningThread).toHaveBeenCalledWith(true);
  });

  it("a failed write surfaces the failure inline, not as a silent revert", async () => {
    const { onSetEscStopsRunningThread } = renderModal({
      escStopsRunningThread: true,
    });
    onSetEscStopsRunningThread.mockRejectedValueOnce(
      new Error("the host refused the write"),
    );
    const toggle = document.querySelector(
      'button[aria-label="Escape stops a running thread first"]',
    ) as HTMLButtonElement;
    fireEvent.click(toggle);
    await screen.findByText(/the host refused the write/);
  });
});

describe("settings modal: What's new tab", () => {
  it("renders the condensed feed: version headers with leads (children nested)", () => {
    renderModal({
      tab: "whats-new",
      entries: [
        {
          version: "1.1.0",
          items: [{ lead: "The lead line.", children: ["A sub-bullet."] }],
        },
      ],
    });
    expect(screen.getByText(/Version 1\.1\.0/)).not.toBeNull();
    expect(screen.getByText("The lead line.")).not.toBeNull();
    expect(screen.getByText("A sub-bullet.")).not.toBeNull();
  });

  it("describes an empty feed as the running version, not as 'recent changes'", () => {
    renderModal({ tab: "whats-new", entries: [] });
    expect(screen.getByText(new RegExp(`version ${APP_VERSION}`))).not.toBeNull();
  });
});

describe("settings modal: About tab", () => {
  it("names the plugin and shows the running version", () => {
    renderModal({ tab: "about" });
    expect(screen.getByText("Focus Board")).not.toBeNull();
    expect(screen.getByText(new RegExp(APP_VERSION))).not.toBeNull();
  });

  it("marks a prerelease build as a dev build", () => {
    // APP_VERSION is "1.1.1-dev" in dev trees; the About panel must say so.
    renderModal({ tab: "about" });
    if (/-.+$/.test(APP_VERSION)) {
      expect(screen.getByText(/dev build/i)).not.toBeNull();
    }
  });

  it("points at the plugin repository", () => {
    renderModal({ tab: "about" });
    const link = document.querySelector<HTMLAnchorElement>(
      'a[href="https://github.com/cristoslc/bb-plugin-focus-board"]',
    );
    expect(link).not.toBeNull();
  });
});

describe("settings modal: shell", () => {
  it("closing asks the app to close (onOpenChange(false))", () => {
    const { onOpenChange } = renderModal();
    fireEvent.click(screen.getByText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders nothing while closed (open=false renders no tabs)", () => {
    renderModal({ open: false });
    expect(document.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it("carries a fixed body height on every tab — switching does not resize the modal", () => {
    // The rail+pane row declares its height as an inline fixed dimension
    // (data-settings-body); jsdom has no layout, so the contract is the
    // dimension itself, identical for the short Behavior/About tabs and the
    // tall What's-new tab. Content scrolls inside the fixed frame instead
    // of growing it.
    const height = (tab: SettingsTab): string => {
      renderModal({ tab });
      const body = document.querySelector<HTMLElement>('[data-settings-body]');
      if (body === null) throw new Error("modal body not found");
      const value = body.style.height;
      cleanup();
      return value;
    };
    const behaviorHeight = height("behavior");
    expect(behaviorHeight).toMatch(/^\d+px$/);
    expect(height("whats-new")).toBe(behaviorHeight);
    expect(height("about")).toBe(behaviorHeight);
  });

  it("the What's-new feed flows into the fixed body — its own per-tab height cap is gone", () => {
    renderModal({ tab: "whats-new" });
    const feed = document.querySelector<HTMLElement>('[data-whats-new-feed]');
    expect(feed).not.toBeNull();
    // The old max-h-[55vh] cap made each tab size itself; the fixed body
    // carries the scroll now.
    expect(feed?.className).not.toContain("max-h-");
  });
});

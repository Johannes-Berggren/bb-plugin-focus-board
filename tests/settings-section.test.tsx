// @vitest-environment jsdom
// The plugin detail page's configuration section: the Appearance rows are
// mirrored from the settings modal onto bb's configuration page, holding
// their own state and writing the same localStorage keys the modal writes —
// a presentational mirror, never a second store.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  CARD_TRANSPORT_KEY,
  MOTION_PACING_KEY,
  LANE_DIRECTION_KEY,
  MOTION_PREF_KEY,
  WALLPAPER_KEY,
} from "../components/preferences";
import { AppearanceSettingsSection } from "../components/settings-section";

const seeded = (records: Record<string, string>) => {
  for (const [key, value] of Object.entries(records)) {
    window.localStorage.setItem(key, value);
  }
};

afterEach(cleanup);

const motionSlider = () =>
  screen.getByRole("slider", { name: "Motion" }) as HTMLInputElement;
const followBox = () =>
  screen.getByRole("checkbox", { name: "Follow my system setting" }) as HTMLInputElement;

describe("configuration-page Appearance section", () => {
  it("defaults to the zoom transport with motion following the system (slider disabled)", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    const card = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')]
      .map((el) => el.textContent);
    expect(card).toEqual(["Zoom out / in", "Vertical"]);
    expect(followBox().checked).toBe(true);
    expect(motionSlider().value).toBe("1");
    expect(motionSlider().disabled).toBe(true);
  });

  it("renders the stored values (the modal's choices mirror here)", () => {
    seeded({
      [CARD_TRANSPORT_KEY]: "teleport",
      [MOTION_PREF_KEY]: "full",
      [LANE_DIRECTION_KEY]: "horizontal",
    });
    render(<AppearanceSettingsSection />);
    const checked = [...document.querySelectorAll('[role="radio"][aria-checked="true"]')]
      .map((el) => el.textContent);
    expect(checked).toEqual(["Teleport", "Horizontal"]);
    // The legacy tri-state's "full" reads as manual motion at stock 1x.
    expect(followBox().checked).toBe(false);
    expect(motionSlider().value).toBe("1");
    expect(motionSlider().disabled).toBe(false);
  });

  it("a lane-direction pick writes the modal's localStorage key", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: "Horizontal" }));
    expect(window.localStorage.getItem(LANE_DIRECTION_KEY)).toBe("horizontal");
  });

  it("a transport pick writes the modal's localStorage key through the shared serializer", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(window.localStorage.getItem(CARD_TRANSPORT_KEY)).toBe("none");
    fireEvent.click(screen.getByRole("radio", { name: "Teleport" }));
    expect(window.localStorage.getItem(CARD_TRANSPORT_KEY)).toBe("teleport");
  });

  it("a motion pick writes the modal's localStorage keys through the serializers", () => {
    // Both keys seeded explicitly: local storage carries across the file's
    // tests, and a leaked "manual" would start the checkbox unchecked.
    seeded({ [MOTION_PREF_KEY]: "system", [MOTION_PACING_KEY]: "1" });
    render(<AppearanceSettingsSection />);
    // Unchecking follow-system stores "manual" beside the pacing.
    fireEvent.click(followBox());
    expect(window.localStorage.getItem(MOTION_PREF_KEY)).toBe("manual");
    fireEvent.click(screen.getByRole("checkbox", { name: "Follow my system setting" }));
    expect(window.localStorage.getItem(MOTION_PREF_KEY)).toBe("system");
  });

  it("the legacy stored tri-state reads as the equivalent slider setting", () => {
    seeded({ [MOTION_PREF_KEY]: "reduce" });
    render(<AppearanceSettingsSection />);
    expect(followBox().checked).toBe(false);
    expect(motionSlider().value).toBe("0"); // the leftmost notch, reduce
    expect(motionSlider().disabled).toBe(false);
    cleanup();
    seeded({ [MOTION_PREF_KEY]: "full" });
    render(<AppearanceSettingsSection />);
    expect(motionSlider().value).toBe("1"); // 1x stock
  });

  it("the notched slider renders the stored pacing and enables only when motion is manual", () => {
    seeded({ [MOTION_PREF_KEY]: "manual", [MOTION_PACING_KEY]: "8" });
    render(<AppearanceSettingsSection />);
    expect(motionSlider().value).toBe("4"); // notch index 4 = 8x
    expect(motionSlider().disabled).toBe(false);
    expect(followBox().checked).toBe(false);
  });

  it("a notch pick writes the pacing key under manual motion", () => {
    seeded({ [MOTION_PREF_KEY]: "manual" });
    render(<AppearanceSettingsSection />);
    fireEvent.change(motionSlider(), { target: { value: "3" } });
    expect(window.localStorage.getItem(MOTION_PACING_KEY)).toBe("4");
  });

  it("hosts the wallpaper picker (the backdrop control the tab carries)", () => {
    seeded({
      [WALLPAPER_KEY]: JSON.stringify({ version: 1, global: null }),
    });
    render(<AppearanceSettingsSection />);
    expect(screen.queryByRole("textbox", { name: "Wallpaper image url" })).not.toBeNull();
  });

  it("a board or other window's wallpaper write hydrates the mirror live (the storage listener)", () => {
    seeded({});
    render(<AppearanceSettingsSection />);
    // Nothing active: the Remove row (rendered only while a wallpaper is
    // active) is absent.
    expect(screen.queryByRole("button", { name: "Remove wallpaper" })).toBeNull();
    // Another document writes the wallpaper document; the mirror hydrates
    // through the same cross-window listener the app hangs, so the edit
    // shows with no remount and a mirror-side edit cannot erase it.
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: WALLPAPER_KEY,
          oldValue: null,
          newValue: JSON.stringify({
            version: 1,
            global: { url: "https://example.com/w.png", dim: 0.4 },
          }),
          storageArea: window.localStorage,
        }),
      );
    });
    expect(screen.getByRole("button", { name: "Remove wallpaper" })).not.toBeNull();
  });
});
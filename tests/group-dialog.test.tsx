// @vitest-environment jsdom
// The group picker gains per-group management rows: every group carries a
// rename edit and a two-step delete right beside the one-click pick. The
// picker was read-only-over-the-registry before (create/remove only); these
// suites pin the new affordances before the dialog grows them.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GroupDialog } from "../components/group-dialog";

afterEach(cleanup);

const GROUPS = [
  { id: "grp_1", name: "Auth rework" },
  { id: "grp_2", name: "Search v2" },
];

function renderDialog(overrides: Partial<Parameters<typeof GroupDialog>[0]> = {}) {
  const handlers = {
    onPick: vi.fn(),
    onCreate: vi.fn(),
    onRemove: vi.fn(),
    onCancel: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };
  render(
    <GroupDialog
      threadTitle="Test thread"
      groups={GROUPS}
      currentGroupId="grp_1"
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe("group picker: rename affordance", () => {
  it("every group row hosts a rename control", () => {
    renderDialog();
    for (const group of GROUPS) {
      expect(document.querySelector(`[data-group-rename="${group.id}"]`)).not.toBeNull();
    }
  });

  it("clicking rename swaps the row into a prefilled inline edit", () => {
    renderDialog();
    fireEvent.click(document.querySelector('[data-group-rename="grp_2"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_2"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Search v2");
  });

  it("Enter (or the confirm control) commits the trimmed name", () => {
    const { onRename } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-rename="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  Auth v2  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith("grp_1", "Auth v2");
  });

  it("a blank name cannot commit and Escape cancels", () => {
    const { onRename } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-rename="grp_1"]') as HTMLButtonElement);
    const input = document.querySelector('[data-group-rename-input="grp_1"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onRename).not.toHaveBeenCalled();
    expect(document.querySelector('[data-group-rename-input="grp_1"]')).toBeNull();
  });
});

describe("group picker: delete affordance", () => {
  it("every group row hosts a delete control; the first click only arms a confirm", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-delete="grp_1"]') as HTMLButtonElement);
    expect(onDelete).not.toHaveBeenCalled();
    // Armed state is visible: a confirm control for THIS group exists.
    expect(screen.getByRole("button", { name: "Confirm delete" })).toBeTruthy();
  });

  it("Keep backs out without deleting", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-delete="grp_2"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Keep group" }));
    expect(onDelete).not.toHaveBeenCalled();
    // Back to the plain row.
    expect(document.querySelector('[data-group-delete="grp_2"]')).not.toBeNull();
  });

  it("Confirm delete reports the groupId", () => {
    const { onDelete } = renderDialog();
    fireEvent.click(document.querySelector('[data-group-delete="grp_1"]') as HTMLButtonElement);
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("grp_1");
  });
});
// @vitest-environment jsdom
// The title-row Mark Done checkbox: a checkbox sits LEFT OF THE THREAD TITLE
// in a reserved gutter (the title never reflows on hover — only arming
// pushes, adding the inline label so the title wraps in the narrower
// space). The first click ARMS, the second click fires the write. Done
// cards mirror it: a CHECKED box that arms "Mark Not Done". This file pins
// the behavior the operator actually sees: placement (title row, not the
// corner), arm, confirm, disarm-on-leave, the done mirror, and the gates
// (unwired surfaces and sweep-selecting mode render nothing).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

afterEach(cleanup);

function card(props: {
  isDone?: boolean;
  onMarkDone?: () => void;
  isSweepSelecting?: boolean;
}) {
  return render(
    <ThreadCard
      thread={thread({ id: "thr_check", displayTitle: "Wired thread", updatedAt: 1 })}
      stateDot={null}
      isActive={false}
      isDone={props.isDone ?? false}
      projectName="Proj"
      menuActions={[]}
      onOpen={() => {}}
      onMarkDone={props.onMarkDone}
      isSweepSelecting={props.isSweepSelecting}
    />,
  );
}

function checkbox(): HTMLElement {
  const node = document.querySelector('[data-thread-card="thr_check"] [data-done-checkbox]');
  if (!(node instanceof HTMLElement)) throw new Error("missing done checkbox");
  return node;
}

describe("the title-row Mark Done checkbox", () => {
  it("sits in the title row, left of the title, reserving the gutter", () => {
    card({ onMarkDone: () => {} });
    const node = checkbox();
    // Structural placement contract: the checkbox's flex sibling is the
    // title paragraph, so the box reads left of the title and the armed
    // label grows in-flow (pushing the title right), never floating over
    // the corner.
    const row = node.parentElement;
    if (!(row instanceof HTMLElement)) throw new Error("missing title row");
    expect(row.className).toContain("flex");
    const title = row.querySelector("p");
    if (!(title instanceof HTMLElement)) throw new Error("missing title");
    expect(title.className).toContain("flex-1");
    expect(node.nextElementSibling).toBe(title);
    // Idle: the empty checkbox glyph, unarmed, no label text.
    expect(node.hasAttribute("data-done-armed")).toBe(false);
    expect(node.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Checkbox");
    expect(node.textContent).not.toContain("Mark Done");
  });

  it("arms on the first click without firing the write, label pushing the title", () => {
    const onMarkDone = vi.fn();
    card({ onMarkDone });
    const node = checkbox();
    fireEvent.click(node);
    expect(node.hasAttribute("data-done-armed")).toBe(true);
    expect(node.textContent).toContain("Mark Done");
    expect(node.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("CheckboxChecked");
    expect(onMarkDone).not.toHaveBeenCalled();
  });

  it("fires the write on the second click and disarms", () => {
    const onMarkDone = vi.fn();
    card({ onMarkDone });
    const node = checkbox();
    fireEvent.click(node);
    fireEvent.click(node);
    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(node.hasAttribute("data-done-armed")).toBe(false);
  });

  it("disarms when the pointer leaves the card, without firing the write", () => {
    const onMarkDone = vi.fn();
    card({ onMarkDone });
    const node = checkbox();
    fireEvent.click(node);
    expect(node.hasAttribute("data-done-armed")).toBe(true);
    const root = document.querySelector('[data-thread-card="thr_check"]');
    if (!(root instanceof HTMLElement)) throw new Error("missing card root");
    fireEvent.pointerLeave(root);
    expect(node.hasAttribute("data-done-armed")).toBe(false);
    expect(onMarkDone).not.toHaveBeenCalled();
  });

  it("mirrors on a done card: a checked box that arms Mark Not Done", () => {
    const onMarkDone = vi.fn();
    card({ isDone: true, onMarkDone });
    const node = checkbox();
    // Idle done card: the CHECKED glyph, no label.
    expect(node.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("CheckboxChecked");
    expect(node.textContent).not.toContain("Mark Not Done");
    // Armed: the "Mark Not Done" label joins in-flow.
    fireEvent.click(node);
    expect(node.hasAttribute("data-done-armed")).toBe(true);
    expect(node.textContent).toContain("Mark Not Done");
    expect(onMarkDone).not.toHaveBeenCalled();
    // Confirm: the write fires (the handler flips done off its own state).
    fireEvent.click(node);
    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(node.hasAttribute("data-done-armed")).toBe(false);
  });

  it("does not render when the surface gives no handler", () => {
    card({});
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
  });

  it("does not render in sweep-selecting mode (the click there curates the sweep)", () => {
    card({ onMarkDone: () => {}, isSweepSelecting: true });
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
  });
});
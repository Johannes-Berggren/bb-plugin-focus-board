// @vitest-environment jsdom
// The hover Mark Done checkbox: on a non-done card, hovering reveals an
// empty checkbox; the first click ARMS it ("Mark Done"), the second click
// marks the thread done. A two-click arm exists so a stray hover-click can
// never silently settle a thread into Done. This file pins the behavior the
// operator actually sees: reveal, arm, confirm, disarm-on-leave, and the
// gates (done cards and unwired cards render no checkbox).
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

describe("the hover Mark Done checkbox", () => {
  it("renders on a non-done card with the wired handler, idle and unarmed", () => {
    card({ onMarkDone: () => {} });
    const node = checkbox();
    expect(node.hasAttribute("data-done-armed")).toBe(false);
    // Idle state shows the EMPTY checkbox glyph (structural contract; the
    // group-hover reveal itself is CSS).
    const icon = node.querySelector("[data-icon]");
    expect(icon?.getAttribute("data-icon")).toBe("Checkbox");
    expect(node.textContent).not.toContain("Mark Done");
  });

  it("does not render on a done card", () => {
    card({ isDone: true, onMarkDone: () => {} });
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
  });

  it("does not render when the board gives no handler", () => {
    card({});
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
  });

  it("does not render in sweep-selecting mode (the click there curates the sweep)", () => {
    card({ onMarkDone: () => {}, isSweepSelecting: true });
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
  });

  it("arms on the first click without marking done", () => {
    const onMarkDone = vi.fn();
    card({ onMarkDone });
    const node = checkbox();
    fireEvent.click(node);
    expect(node.hasAttribute("data-done-armed")).toBe(true);
    expect(node.textContent).toContain("Mark Done");
    const icon = node.querySelector("[data-icon]");
    expect(icon?.getAttribute("data-icon")).toBe("CheckboxChecked");
    expect(onMarkDone).not.toHaveBeenCalled();
  });

  it("marks done on the second click and disarms", () => {
    const onMarkDone = vi.fn();
    card({ onMarkDone });
    const node = checkbox();
    fireEvent.click(node);
    fireEvent.click(node);
    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(node.hasAttribute("data-done-armed")).toBe(false);
  });

  it("disarms when the pointer leaves the card, without marking done", () => {
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
});
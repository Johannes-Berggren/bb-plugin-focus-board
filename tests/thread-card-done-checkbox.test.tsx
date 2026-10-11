// @vitest-environment jsdom
// The status-dot swap: on hover, the card's state dot yields its exact
// slot to the done checkbox — empty on not-done cards, checked on done —
// so the reveal moves NOTHING on the card. The first click ARMS (the
// label joins the header row inline), the second click fires the write,
// and hovering away disarms. This file pins the behavior the operator
// actually sees: the dot-to-checkbox swap, arm, confirm, disarm, the done
// mirror, and the gates (unwired surfaces and sweep-selecting keep the
// plain dot).
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
      stateDot={<span data-state-dot="" />}
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

describe("the status-dot done checkbox", () => {
  it("occupies the state dot's slot: the dot is wrapped to yield on hover", () => {
    card({ onMarkDone: () => {} });
    const node = checkbox();
    // The checkbox is centered over the dot's fixed slot, not a sibling of
    // the title and not a corner overlay.
    const slot = node.parentElement;
    if (!(slot instanceof HTMLElement)) throw new Error("missing dot slot");
    expect(slot.className).toContain("relative");
    const dotWrap = slot.querySelector("[data-state-dot]")?.parentElement;
    if (!(dotWrap instanceof HTMLElement)) throw new Error("missing dot wrapper");
    // The dot fades out on hover (the swap).
    expect(dotWrap.className).toContain("group-hover:opacity-0");
    // Idle: the empty checkbox glyph, unarmed, no label in the header row.
    expect(node.hasAttribute("data-done-armed")).toBe(false);
    expect(node.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("Checkbox");
    expect(document.querySelector("[data-done-armed-tag]")).toBeNull();
  });

  it("keeps the plain dot when the surface is unwired or sweep-selecting", () => {
    card({});
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
    const dot = document.querySelector('[data-thread-card="thr_check"] [data-state-dot]');
    if (!(dot instanceof HTMLElement)) throw new Error("missing state dot");
    // The dot renders bare (no yielding wrapper) when there is no checkbox.
    expect(dot.parentElement?.className).not.toContain("group-hover:opacity-0");
    card({ onMarkDone: () => {}, isSweepSelecting: true });
    expect(document.querySelector("[data-done-checkbox]")).toBeNull();
  });

  it("arms on the first click: the label joins the header row, no write", () => {
    const onMarkDone = vi.fn();
    card({ onMarkDone });
    const node = checkbox();
    fireEvent.click(node);
    expect(node.hasAttribute("data-done-armed")).toBe(true);
    expect(node.querySelector("[data-icon]")?.getAttribute("data-icon")).toBe("CheckboxChecked");
    // The armed label is a header-row sibling AFTER the dot slot (inline,
    // not inside the button, not over the title).
    const tag = document.querySelector('[data-thread-card="thr_check"] [data-done-armed-tag]');
    if (!(tag instanceof HTMLElement)) throw new Error("missing armed tag");
    expect(tag.textContent).toBe("Mark Done");
    expect(node.parentElement?.nextElementSibling).toBe(tag);
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
    expect(document.querySelector("[data-done-armed-tag]")).toBeNull();
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
    expect(document.querySelector("[data-done-armed-tag]")).toBeNull();
    // Armed: the "Mark Not Done" label joins the header row.
    fireEvent.click(node);
    const tag = document.querySelector('[data-thread-card="thr_check"] [data-done-armed-tag]');
    if (!(tag instanceof HTMLElement)) throw new Error("missing armed tag");
    expect(tag.textContent).toBe("Mark Not Done");
    expect(onMarkDone).not.toHaveBeenCalled();
    // Confirm: the write fires once (the handler flips done off its own state).
    fireEvent.click(node);
    expect(onMarkDone).toHaveBeenCalledTimes(1);
    expect(node.hasAttribute("data-done-armed")).toBe(false);
  });
});
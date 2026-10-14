// One derived card-status object for a card render: the three card statuses
// that matter to the dim systems — selection, attention, and the fade set —
// in a single shape, with ONE "never recede" predicate. Every dim consumer
// reads these fields, so no dim system carries its own private exemption
// list.
import { describe, expect, it } from "vitest";
import { deriveCardStatus } from "../components/card-status";

const base = {
  isActive: false,
  isSweepHighlighted: false,
  needsAttention: false,
  isDone: false,
  dimmed: false,
  snoozed: false,
};

describe("deriveCardStatus", () => {
  it("an ordinary card: nothing selected, focused, or faded", () => {
    expect(deriveCardStatus(base)).toEqual({
      selected: false,
      userFocus: false,
      faded: false,
      spotlightImmune: false,
    });
  });

  it("selection comes from the pane-open state or the sweep highlight", () => {
    expect(deriveCardStatus({ ...base, isActive: true }).selected).toBe(true);
    expect(
      deriveCardStatus({ ...base, isSweepHighlighted: true }).selected,
    ).toBe(true);
    expect(deriveCardStatus({ ...base }).selected).toBe(false);
  });

  it("attention rides the card's own state, not hover (hover is CSS-native)", () => {
    expect(deriveCardStatus({ ...base, needsAttention: true })).toMatchObject({
      userFocus: true,
      selected: false,
    });
  });

  it("any fade source marks the card faded", () => {
    expect(deriveCardStatus({ ...base, isDone: true }).faded).toBe(true);
    expect(deriveCardStatus({ ...base, dimmed: true }).faded).toBe(true);
    expect(deriveCardStatus({ ...base, snoozed: true }).faded).toBe(true);
    expect(deriveCardStatus({ ...base }).faded).toBe(false);
  });

  it("immunity is the focus-out-ranks-transparency rule, all sources together", () => {
    // The invariant under test: anything with user focus never fades to
    // transparent when transparency rules take effect.
    expect(deriveCardStatus({ ...base, isActive: true }).spotlightImmune).toBe(true);
    expect(
      deriveCardStatus({ ...base, isSweepHighlighted: true }).spotlightImmune,
    ).toBe(true);
    expect(
      deriveCardStatus({ ...base, needsAttention: true }).spotlightImmune,
    ).toBe(true);
    expect(deriveCardStatus({ ...base, isDone: true }).spotlightImmune).toBe(true);
    expect(deriveCardStatus({ ...base, dimmed: true }).spotlightImmune).toBe(true);
    expect(deriveCardStatus({ ...base, snoozed: true }).spotlightImmune).toBe(true);
    expect(deriveCardStatus(base).spotlightImmune).toBe(false);
  });

  it("a sweep-highlighted done card is both selected and faded: the selection wins the visuals", () => {
    // The selection wins (the `!selected` guard on the scrim); immunity
    // holds either way.
    const status = deriveCardStatus({
      ...base,
      isDone: true,
      isSweepHighlighted: true,
    });
    expect(status.selected).toBe(true);
    expect(status.faded).toBe(true);
    expect(status.spotlightImmune).toBe(true);
  });
});
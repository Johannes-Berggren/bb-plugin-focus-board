// One derived card-status object for a card render: the three card statuses
// that matter to the dim systems — selection, attention, and the fade set —
// computed in one place, with ONE "never recede" predicate. Every dim
// consumer (the whole-card opacity classes, the wallpaper under-scrim, the
// injected spotlight rule in components/card-spotlight.ts) reads these
// fields, so no dim system carries its own private exemption list again.
// Parenting status is deliberately NOT modeled: it expresses itself
// structurally — a parent card renders its ChildRow rows inside itself, a
// nested row renders through ChildRow with its own dim classes, and no fade
// decision branches on it — so a role field here would be a runtime fact
// with no consumer. The group-filter misses reach card fading through
// `dimmed`, its only legitimate route.

export interface CardStatus {
  /**
   * Selection status: the pane is open on this card (isActive) or the sweep
   * has highlighted it (isSweepHighlighted). A selection the pointer reads
   * also never dims its own fade.
   */
  selected: boolean;
  /**
   * Attention status the card render knows before the pointer arrives (a
   * pending interaction or an unread error — grouping.ts threadState). Hover
   * and keyboard focus stay CSS-native (`:hover`, `:focus-within`) and never
   * enter the object: they are the browser's, not the model's.
   */
  userFocus: boolean;
  /** The card's own life fades it: done, filter-miss dim, or snoozed. */
  faded: boolean;
  /**
   * Exempt from the spotlight recede (`data-spotlight-immune`, consumed by
   * components/card-spotlight.ts): focus outranks transparency. Selected,
   * attention, and already-faded cards keep their own opacity while other
   * cards recede; the hovered card needs no marker — the rule reads `:hover`.
   */
  spotlightImmune: boolean;
}

/**
 * Raw inputs deriveCardStatus reads; ThreadCard passes its render props
 * straight through.
 */
export interface CardStatusInput {
  /** The pane is open on this card. */
  isActive: boolean;
  /** The sweep has highlighted this card (the pointer reads the selection). */
  isSweepHighlighted: boolean;
  /** grouping.ts `threadState` reports a pending interaction or unread error. */
  needsAttention: boolean;
  /** The thread is done. */
  isDone: boolean;
  /** The filter-miss dim: a family member that did not match the filters. */
  dimmed: boolean;
  /** The thread is snoozed (lib/snooze reports a wake time). */
  snoozed: boolean;
}

/**
 * Derive the card status object from the card's raw inputs. Pure, so tests
 * can matrix every combination without rendering.
 */
export function deriveCardStatus(input: CardStatusInput): CardStatus {
  const selected = input.isActive || input.isSweepHighlighted;
  const faded = input.isDone || input.dimmed || input.snoozed;
  const userFocus = input.needsAttention;
  return {
    selected,
    userFocus,
    faded,
    spotlightImmune: selected || userFocus || faded,
  };
}
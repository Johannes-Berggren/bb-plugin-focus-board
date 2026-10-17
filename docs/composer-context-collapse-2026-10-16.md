# The thread pane's composer context: bb's collapsed footer, and the pane's paint-following probe

Date: 2026-10-16. Thread: thr_9iwfimagwv ("Add missing project info"). Evidence:
96 probe captures from the temporary instrument (PRs #218 and #225, both
merged then removed by the fix), bb 0.46.1 host bundle, macOS desktop.

## The report

The thread pane's compose area showed the project + checkout context for a
second after opening, then it disappeared and never came back. The operator's
own guess ("the input box opened over it") was closer than any of my first
theories.

## What bb 0.46.1 actually does

The embedded `ThreadChat` the SDK hands plugin panels builds a full
environment summary (`PluginThreadChat` chunk: project name query, environment
query, checkout descriptor) and passes it to the promptbox footer
(`data-follow-up-composer-footer`) as `environmentSummary` — but never as
`compactEnvironmentSummary`, which the footer renders instead when its
container is narrow. On a wide window the full summary wins, so the chips DO
mount: `Project: <name>` and `Environment: <name>` chips
(`[data-option-display]`, sr-only labels) plus a branch button
(`[data-promptbox-hide-branch-compact]`).

The catch: the footer belongs to bb's follow-up composer, which COLLAPSES
whenever the composer sits unexpanded. The collapse is an attribute flip
(`data-follow-up-composer-footer-visible` removed) plus a 180ms CSS
transition (`max-height`/`min-height`/`margin-top`/`opacity`), no mount and
no unmount. Captured geometry at rest in a 477px pane: footer box
`y1059 h0`, chips still mounted at `y1047 h24` — their rects measure, their
paint is clipped to nothing by the collapsed, overflow-hidden footer. In the
maximized compose surface (852px) the footer paints `h24` and the chips sit
inside its box, fully visible.

So the compose area at rest in a pane shows nothing, while the DOM says the
context is right there. Both of my first two probes read that DOM and
concluded "the host paints context" — the first (presence-only) probe hid our
fallback line forever after the footer's first expanded render, which is the
vanish the operator saw.

## The probe's rules now (components/pane-context-row.tsx)

- Signature set: Project/Environment option chips by sr-only label, the
  checkout chip, the compact `Thread details: …` button. Unrelated picker
  chips share the option-display markup and must not match.
- Paint walk: a match counts only when, within six ancestor hops, nothing
  hides it — `display: none`, `visibility: hidden`, `opacity: 0`, or an
  overflow clip whose box does not contain the chip's rect. The collapsed
  footer fails the containment check; the expanded footer passes.
- The observer watches attributes and character data too: the collapse is an
  attribute flip, so a childList-only observer would never re-probe after it.
- The settle window (300ms) outlasts the 180ms transition so the walk reads
  settled geometry.

## What to re-check on bb upgrades

- The footer's collapse attribute name and the 180ms transition.
- The chip signatures (`data-option-display` labels, the hide-branch marker,
  the `Thread details: …` aria-label prefix).
- Whether bb starts passing a compact summary to embedded chats — at that
  point the pane's fallback line goes quiet on its own whenever the host
  paints, and this whole module can shrink to a no-op guard.

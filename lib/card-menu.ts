// The board card's right-click menu (board lanes and parent-lane cells
// alike), assembled purely so tests pin the grouping without rendering
// the app — the snooze-builder precedent (lib/snooze.ts). app.tsx
// supplies the thread's state and the side-effecting closures; this
// builder owns the order, the labels, the icons and the dividers.
//
// The order IS the design. The menu's actions read as four groups:
//
//   1. Destinations — the same thread on other surfaces. "Open thread"
//      and "Copy link to thread" render above this block as the menu
//      component's built-ins; the block adds the two "elsewhere"
//      gestures: the thread in a fresh window, and its controlled
//      browser tab brought forward.
//   2. State — pin, read, done, snooze, group (the pickers open from
//      here; the snooze and group builders' own dividers are suppressed
//      so this group reads as one).
//   3. Lineage — spawn a child, un-nest a child.
//   4. Lifecycle — sweep protection, archive, delete.
//
// A divider opens each group head and nothing else, and no group
// carries a heading: bare dividers are the menu grammar everywhere
// else in the app, and section labels would spend vertical space a
// pointer-position menu doesn't have (the thread's title lives in the
// header row above the entries).

import { snoozeMenuActions } from "./snooze";
import { groupMenuActions, type GroupMenuAction } from "./group-metadata";

export interface CardMenuAction {
  id: string;
  label: string;
  icon: string;
  run: () => void;
  /** Destructive or state-changing entries draw in the danger tone. */
  danger?: boolean;
  dividerAbove?: boolean;
}

/** The thread facts the grouping's labels and icons flip on. */
export interface CardMenuThreadShape {
  id: string;
  href: string;
  isPinned: boolean;
  isUnread: boolean;
  isArchived: boolean;
  parentThreadId: string | null;
}

export interface CardMenuInputs {
  thread: CardMenuThreadShape;
  isDone: boolean;
  isSnoozed: boolean;
  isKept: boolean;
  /** Assigned to a named family box (`lib/group-metadata`)? */
  grouped: boolean;
}

export interface CardMenuHandlers {
  togglePinned: () => void;
  toggleRead: () => void;
  toggleDone: () => void;
  toggleSweepKeep: () => void;
  /** Detach a nested thread from its family (drop-onto gesture's undo). */
  makeTopLevel: () => void;
  archive: () => void;
  requestDelete: () => void;
  /** The one-step controlled-browser-tab reveal (lib/browser-reveal). */
  revealBrowserTabs: () => void;
  clearSnooze: () => void;
  openSnoozePicker: () => void;
  /** Open the group picker ("Group…" / "Change group…" entry, lib/group-metadata). */
  openGroupPicker: () => void;
  openNewChild: () => void;
  /**
   * The thread's fresh-surface open, run with the card's app-relative
   * href (the host's window guard routes the raw open to the user's
   * browser: the system browser on desktop, a detached tab on the web).
   */
  openInBrowser: (href: string) => void;
}

export function cardMenuActions(
  inputs: CardMenuInputs,
  handlers: CardMenuHandlers,
): readonly CardMenuAction[] {
  const { thread, isDone, isSnoozed, isKept, grouped } = inputs;
  // The shared snooze entries come back with their divider dropped so
  // snooze reads as part of the state group here; the pane's actions
  // menu keeps the builder's own divider — card menu only.
  const snoozeEntries = snoozeMenuActions({
    snoozed: isSnoozed,
    clearSnooze: handlers.clearSnooze,
    openPicker: handlers.openSnoozePicker,
  }).map(({ dividerAbove: _foldedIntoStateGroup, ...entry }) => entry);
  // The group picker entry rides the same treatment (dev's flat menu put
  // it right after snooze — both open pickers — and no card-menu test
  // pins its position): it joins the state group as an organizational
  // assignment, divider dropped like snooze's.
  const groupEntry: GroupMenuAction = groupMenuActions({
    grouped,
    openPicker: handlers.openGroupPicker,
  })[0];
  const groupEntries = [
    {
      id: groupEntry.id,
      label: groupEntry.label,
      icon: groupEntry.icon,
      run: groupEntry.run,
    } satisfies CardMenuAction,
  ];
  const unnest =
    thread.parentThreadId !== null && thread.parentThreadId !== ""
      ? [
          {
            id: "unnest",
            label: "Make Top-Level",
            icon: "FolderMinus",
            run: handlers.makeTopLevel,
          } satisfies CardMenuAction,
        ]
      : [];
  return [
    {
      id: "open-in-browser",
      label: "Open in browser",
      icon: "NewTab",
      dividerAbove: true,
      run: () => handlers.openInBrowser(thread.href),
    },
    {
      id: "reveal-browser-tab",
      label: "Reveal browser tab",
      icon: "Browser",
      run: handlers.revealBrowserTabs,
    },
    {
      id: "pin",
      label: thread.isPinned ? "Unpin" : "Pin",
      icon: thread.isPinned ? "PinOff" : "Pin",
      dividerAbove: true,
      run: handlers.togglePinned,
    },
    {
      id: "read",
      label: thread.isUnread ? "Mark Read" : "Mark Unread",
      icon: thread.isUnread ? "MailOpen" : "Mail",
      run: handlers.toggleRead,
    },
    {
      id: "done",
      label: isDone ? "Mark Not Done" : "Mark Done",
      icon: isDone ? "CircleCheck" : "Check",
      run: handlers.toggleDone,
    },
    ...snoozeEntries,
    ...groupEntries,
    {
      id: "new-child",
      label: "New child thread…",
      icon: "Fork",
      dividerAbove: true,
      run: handlers.openNewChild,
    },
    ...unnest,
    {
      id: "sweep-keep",
      label: isKept ? "Allow sweep" : "Keep from sweep",
      icon: isKept ? "Archive" : "Pin",
      dividerAbove: true,
      run: handlers.toggleSweepKeep,
    },
    {
      id: "archive",
      label: thread.isArchived ? "Unarchive" : "Archive",
      icon: thread.isArchived ? "ArchiveRestore" : "Archive",
      run: handlers.archive,
    },
    {
      id: "delete",
      label: "Delete…",
      icon: "Trash2",
      danger: true,
      run: handlers.requestDelete,
    },
  ];
}
// @vitest-environment jsdom
// The thread pane's composer-context fallback row.
//
// bb's own thread page passes both `environmentSummary` and
// `compactEnvironmentSummary` to its promptbox, but the embedded
// `ThreadChat` the SDK hands plugin panels passes only the full summary —
// and the promptbox renders the compact one when its container is narrow,
// which a plugin panel always is. Net effect: the thread pane's compose
// area shows nothing where the main view shows the project + checkout
// context. The pane therefore detects the host's context row inside the
// chat DOM and, when it is not there, renders its own line under the
// transcript.
//
// The detection fixtures below mirror how bb 0.46.1's promptbox bundle
// paints that context: `[data-option-display]` chips whose sr-only label
// reads "Project: " / "Environment: ", `[data-promptbox-hide-branch-compact]`
// checkout chips, and the compact `Thread details: …` button.

import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { ThreadPane } from "../components/thread-pane";
import { composerContextVisible } from "../components/pane-context-row";
import { CompactViewportOverrideProvider } from "../components/ui/hooks/use-compact-viewport";

const chatHolder = vi.hoisted(() => ({ content: null as ReactNode }));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  // The pane's embedded chat is only imported for render; the observer
  // under test watches whatever DOM the mock paints. dangerouslySetInnerHTML
  // paints the fixtures as real DOM, matching how the host renders.
  ThreadChat: (): ReactNode => chatHolder.content,
  useSdk: () => ({ threads: { get: async () => ({}) } }),
  useRpc: () => ({ call: async () => ({ existence: {} }) }),
  useBbNavigate: () => ({ toThread: () => {} }),
  useSettings: () => ({ values: undefined, isLoading: false }),
}));

vi.mock("../components/pending-interaction-card", () => ({
  PendingInteractionCard: (): ReactNode => null,
}));

vi.mock("../components/decided-questions-card", () => ({
  DecidedQuestionsCard: (): ReactNode => null,
}));

const noop = () => {};

afterEach(() => {
  cleanup();
  chatHolder.content = null;
});

function paneThread(context: Parameters<typeof ThreadPane>[0]["thread"]["context"]) {
  return {
    id: "thr_test",
    displayTitle: "Test thread",
    status: "idle",
    isUnread: false,
    isPinned: false,
    href: "/threads/thr_test",
    context,
  };
}

const worktreeContext = {
  projectId: "proj_focus",
  projectLabel: "Focus Board plugin",
  environmentLabel: "Worktree thr_9iwfimagwv-1",
  branchLabel: "feat/pane-context",
};

function renderPane(thread: ReturnType<typeof paneThread>) {
  return render(
    createElement(
      CompactViewportOverrideProvider,
      { isCompactViewport: false },
      createElement(ThreadPane, {
        thread,
        isArchived: false,
        isDone: false,
        onToggleDone: noop,
        onToggleArchived: noop,
        onToggleUnread: noop,
        onRename: async () => {},
        onMaximize: noop,
        onClose: noop,
      }),
    ),
  );
}

const settle = () =>
  new Promise((resolve) => setTimeout(resolve, 350));

/** Host-shaped fixture HTML: a chip exactly as the promptbox paints it. */
function hostChipHtml(label: string, value: string) {
  return `<div data-option-display><span class="sr-only">${label}: </span><span data-promptbox-full-label>${value}</span></div>`;
}

function rooted(html: string) {
  const root = document.createElement("div");
  root.innerHTML = html;
  return root;
}

describe("composerContextVisible probe", () => {
  it("reads null or absent DOM as not visible", () => {
    expect(composerContextVisible(null)).toBe(false);
    expect(composerContextVisible(document.createElement("div"))).toBe(false);
  });

  it("sees the host's Project and Environment chips", () => {
    expect(
      composerContextVisible(rooted(hostChipHtml("Project", "Focus Board plugin"))),
    ).toBe(true);
    expect(
      composerContextVisible(rooted(hostChipHtml("Environment", "Worktree thr_9iwfimagwv-1"))),
    ).toBe(true);
  });

  it("ignores unrelated picker chips that share the same markup", () => {
    expect(composerContextVisible(rooted(hostChipHtml("Model", "Haiku")))).toBe(false);
  });

  it("sees the compact Thread details button", () => {
    expect(
      composerContextVisible(
        rooted(`<button aria-label="Thread details: feat/x">feat/x</button>`),
      ),
    ).toBe(true);
  });

  it("sees the full row's checkout chip", () => {
    expect(
      composerContextVisible(
        rooted(`<span data-promptbox-hide-branch-compact="">feat/x</span>`),
      ),
    ).toBe(true);
  });
});

describe("thread pane composer-context fallback row", () => {
  function chatWith(html: string) {
    chatHolder.content = createElement("div", {
      "data-testid": "mock-chat",
      dangerouslySetInnerHTML: { __html: html },
    });
  }

  it("stays hidden while the host paints its own context chips", async () => {
    chatWith(hostChipHtml("Project", "Focus Board plugin"));
    const { queryByTestId } = renderPane(paneThread(worktreeContext));
    await settle();
    expect(queryByTestId("pane-context-row")).toBeNull();
  });

  it("appears under the transcript when the host paints nothing", async () => {
    chatWith("");
    const { getByTestId } = renderPane(paneThread(worktreeContext));
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    const row = getByTestId("pane-context-row");
    expect(row.textContent).toContain("Focus Board plugin");
    expect(row.textContent).toContain("feat/pane-context");
  });

  it("still appears when the host paints only unrelated picker chips", async () => {
    chatWith(hostChipHtml("Model", "Haiku"));
    const { getByTestId } = renderPane(paneThread(worktreeContext));
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
  });

  it("never appears for a thread with no environment to describe", async () => {
    chatWith("");
    const { queryByTestId } = renderPane(paneThread(null));
    await settle();
    expect(queryByTestId("pane-context-row")).toBeNull();
  });

  it("drops the row at once when the pane opens a thread without context", async () => {
    chatWith("");
    const { rerender, getByTestId, queryByTestId } = renderPane(
      paneThread(worktreeContext),
    );
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    chatHolder.content = null;
    rerender(
      createElement(
        CompactViewportOverrideProvider,
        { isCompactViewport: false },
        createElement(ThreadPane, {
          thread: paneThread(null),
          isArchived: false,
          isDone: false,
          onToggleDone: noop,
          onToggleArchived: noop,
          onToggleUnread: noop,
          onRename: async () => {},
          onMaximize: noop,
          onClose: noop,
        }),
      ),
    );
    await waitFor(() => expect(queryByTestId("pane-context-row")).toBeNull());
  });

  it("prefers the environment label when the branch is unknown", async () => {
    chatWith("");
    const { getByTestId } = renderPane(
      paneThread({
        projectId: "proj_focus",
        projectLabel: "Focus Board plugin",
        environmentLabel: "Project checkout",
        branchLabel: null,
      }),
    );
    await waitFor(() => expect(getByTestId("pane-context-row")).toBeTruthy());
    expect(getByTestId("pane-context-row").textContent).toContain(
      "Project checkout",
    );
  });
});
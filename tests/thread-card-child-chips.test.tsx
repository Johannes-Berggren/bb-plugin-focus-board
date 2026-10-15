// @vitest-environment jsdom
// Issue #191: nested child rows show the child thread's own ticket chips.
// A child that chips on its standalone card (a text ref in its title, or a
// store link in the board's linkedIssues metadata) renders the same chips on
// its nested row — condensed, and inert: the whole child row is one anchor,
// so a chip may not nest links inside it (the same DOM contract the card's
// own chip rows settle in issue #171, tracked for rows as #127).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ThreadCard } from "../components/thread-card";
import { thread } from "./thread-fixture";

const BASE = "https://github.com/owner/repo";

type CardProps = Parameters<typeof ThreadCard>[0];

const child = thread({
  id: "thr_child",
  displayTitle: "resolve #17 inside the family",
  parentThreadId: "thr_parent",
  updatedAt: 4000,
});

function renderCard(overrides: Partial<CardProps> = {}) {
  const props = {
    thread: thread({ id: "thr_parent", displayTitle: "Parent thread", updatedAt: 5000 }),
    stateDot: null,
    isActive: false,
    isDone: false,
    projectName: "One",
    repoHrefBase: BASE,
    onOpen: vi.fn(),
    onOpenThread: vi.fn(),
    childThreads: [child],
    ...overrides,
  } as unknown as CardProps;
  return render(<ThreadCard {...props} />);
}

function nestedRow(): Element {
  const row = document.querySelector('[data-nested-rows] [data-thread-card="thr_child"]');
  if (row === null) throw new Error("missing nested child row");
  return row;
}

function nestedChip(): Element {
  const chipEl = nestedRow().querySelector("[data-ticket-chip]");
  if (chipEl === null) throw new Error("missing chip on the nested child row");
  return chipEl;
}

async function nestedChipIcon(name: string): Promise<Element> {
  return waitFor(() => {
    const el = nestedChip().querySelector(`[data-icon="${name}"]`);
    if (el === null) throw new Error(`missing chip glyph ${name} on the nested row`);
    return el;
  });
}

const linkedPull: import("../lib/link-metadata").GitHubItemLink = {
  tracker: "github",
  repo: "owner/repo",
  issue: 16,
  kind: "pull",
  href: `${BASE}/pull/16`,
  createdAt: "2026-10-15T00:00:00.000Z",
  source: "agent",
};

afterEach(cleanup);

describe("nested child rows show ticket chips (issue #191)", () => {
  it("a child whose title carries a text ref renders its chip on the row", async () => {
    renderCard();
    await nestedChipIcon("GithubMark");
    expect(nestedChip().textContent).toContain("#17");
    // Condensed, not the full card chip: the row is a tight container.
    expect(nestedChip().className).toContain("min-h-4");
    expect(nestedChip().className).not.toContain("min-h-5");
  });

  it("the row's chip renders inert — no anchor nests inside the row's own link", async () => {
    renderCard();
    await nestedChipIcon("GithubMark");
    const row = nestedRow();
    // The row itself is the anchor; nothing nested inside it is a link:
    // chip marks and ids render as spans, so HTML validity holds (#127 /
    // #171 contract).
    expect(row.tagName).toBe("A");
    expect(row.querySelectorAll("a")).toHaveLength(0);
    const id = nestedChip().querySelector('[data-ticket-id="#17"]');
    expect(id?.tagName).toBe("SPAN");
    expect(id?.getAttribute("href")).toBeNull();
    const mark = nestedChip().querySelector("[data-ticket-chip-mark]");
    expect(mark?.tagName).toBe("SPAN");
  });

  it("a store-linked child chips even when its title carries no ref", async () => {
    renderCard({
      childThreads: [
        thread({
          id: "thr_child",
          displayTitle: "Update the chip status docs",
          parentThreadId: "thr_parent",
          updatedAt: 4000,
        }),
      ],
      childLinkedIssuesFor: (id) => (id === "thr_child" ? [linkedPull] : undefined),
    });
    await nestedChipIcon("PullRequest");
    expect(nestedChip().textContent).toContain("#16");
  });

  it("a child with no tracker reference renders no chip", () => {
    renderCard({
      childThreads: [
        thread({
          id: "thr_child",
          displayTitle: "No ticket involved here",
          parentThreadId: "thr_parent",
          updatedAt: 4000,
        }),
      ],
    });
    expect(document.querySelector("[data-ticket-chip]")).toBeNull();
  });

  it("the sub-row tier (a grandchild) chips like the row tier", async () => {
    const grandchild = thread({
      id: "thr_grandchild",
      displayTitle: "resolve #22 deeper in the family",
      parentThreadId: "thr_child",
      updatedAt: 3000,
    });
    renderCard({
      childThreads: [child],
      grandchildThreadsByParent: new Map([["thr_child", [grandchild]]]),
    });
    await waitFor(() => {
      const el = document.querySelector(
        '[data-child-sub-rows] [data-thread-card="thr_grandchild"] [data-ticket-chip]',
      );
      if (el === null) throw new Error("missing chip on the grandchild sub-row");
    });
  });
});
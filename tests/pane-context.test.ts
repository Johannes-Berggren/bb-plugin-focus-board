// The thread pane's composer-context facts: which labels a thread's
// project + checkout contribute to the pane's fallback row, aligned with
// the board card's project naming (lib/project-name).

import { describe, expect, it } from "vitest";
import { paneContextInfo } from "../lib/pane-context";
import { BB_PERSONAL_PROJECT_ID } from "../lib/new-thread-seed";

const personalProjectId = "proj_mine_personal";

const projects = [
  { id: "proj_focus", name: "Focus Board plugin" },
  { id: personalProjectId, name: "Personal" },
];

const baseThread = {
  projectId: "proj_focus",
  environment: {
    name: "Worktree thr_9iwfimagwv-1",
    branchName: "feat/pane-context",
    isWorktree: true,
  },
};

describe("paneContextInfo", () => {
  it("carries the project display name, environment name, and branch", () => {
    expect(paneContextInfo(baseThread, { personalProjectId, projects })).toEqual({
      projectId: "proj_focus",
      projectLabel: "Focus Board plugin",
      environmentLabel: "Worktree thr_9iwfimagwv-1",
      branchLabel: "feat/pane-context",
    });
  });

  it("falls back to the environment name when the branch is null", () => {
    const info = paneContextInfo(
      { ...baseThread, environment: { name: "Worktree thr_x", branchName: null, isWorktree: true } },
      { personalProjectId, projects },
    );
    expect(info?.branchLabel).toBeNull();
    expect(info?.environmentLabel).toBe("Worktree thr_x");
  });

  it("names a plain project checkout when the environment name is unknown", () => {
    const info = paneContextInfo(
      { ...baseThread, environment: { name: null, branchName: "main", isWorktree: false } },
      { personalProjectId, projects },
    );
    expect(info?.environmentLabel).toBe("Project checkout");
    expect(info?.branchLabel).toBe("main");
  });

  it("refuses to describe a thread with no environment at all", () => {
    expect(
      paneContextInfo({ projectId: "proj_focus", environment: null }, { personalProjectId, projects }),
    ).toBeNull();
    // A row omitting the field altogether (loose test fixtures, older SDK
    // builds) describes nothing the same way.
    expect(
      paneContextInfo({ projectId: "proj_focus" }, { personalProjectId, projects }),
    ).toBeNull();
  });

  it("labels the personal project 'No project', like the composer's picker", () => {
    const info = paneContextInfo(
      {
        projectId: BB_PERSONAL_PROJECT_ID,
        environment: { name: "Personal", branchName: null, isWorktree: false },
      },
      { personalProjectId, projects },
    );
    expect(info?.projectLabel).toBe("No project");
  });

  it("labels a custom personal project id 'No project' too", () => {
    const info = paneContextInfo(
      {
        projectId: personalProjectId,
        environment: { name: null, branchName: null, isWorktree: false },
      },
      { personalProjectId, projects },
    );
    expect(info?.projectLabel).toBe("No project");
    // With no name and no branch the environment falls back to its plain wording.
    expect(info?.environmentLabel).toBe("Project checkout");
  });

  it("labels an unknown project id 'No project', matching the board cards", () => {
    const info = paneContextInfo(
      {
        projectId: "proj_gone",
        environment: { name: "Worktree thr_x", branchName: null, isWorktree: true },
      },
      { personalProjectId, projects },
    );
    expect(info?.projectLabel).toBe("No project");
  });
});
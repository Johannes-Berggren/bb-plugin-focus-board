// The board card's label for a thread's project (lib/project-name, wired as
// the board's projectNameFor): a sidebar row renders its real name, and bb's
// personal project renders "No project" — the term the composer's project
// picker uses for that same id, so the board card and the composer's picker
// name the personal state alike (issue #25). An id the list does not know
// renders "No project" too: bb core resolves a requested-but-unresolvable
// project id to the personal state, so the board's rendering agrees.
import { describe, expect, it } from "vitest";
import { projectDisplayName } from "../lib/project-name";

const projects = [
  { id: "proj_home", name: "Home" },
  { id: "personal_default", name: "Personal" },
];

describe("projectDisplayName", () => {
  it("a sidebar row renders its real name", () => {
    expect(projectDisplayName("proj_home", { projects })).toBe("Home");
  });

  it("bb's personal project id renders 'No project', the composer picker's term", () => {
    expect(projectDisplayName("proj_personal", { projects })).toBe("No project");
  });

  it("the sidebar-declared personal id renders 'No project' even when renamed", () => {
    expect(
      projectDisplayName("personal_default", {
        personalProjectId: "personal_default",
        projects,
      }),
    ).toBe("No project");
  });

  it("an id the list does not know renders 'No project' (inverse)", () => {
    expect(projectDisplayName("proj_deleted", { projects })).toBe("No project");
  });

  it("with no declared personal id, a non-constant row's own name stands", () => {
    // The bb personal constant is the only unlisted catch-all; a renamed
    // personal row without the isPersonal id still shows its real name.
    expect(projectDisplayName("personal_default", { projects })).toBe("Personal");
  });
});
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { renderUnreleasedModule } from "../lib/unreleased-changelog";

/**
 * The generated module's drift gate.
 *
 * `npm test` and `npm run build` run scripts/generate-unreleased.mjs BEFORE
 * vitest, so a comparison against the working tree here could never fail: by
 * the time this suite runs, the file on disk is always current. The state
 * that actually cost merges is the COMMIT's, where a branch committed a
 * CHANGELOG.md edit while lib/unreleased-changelog.generated.ts stayed at the
 * previous group. The stale file then regenerated itself inside the main
 * checkout and left the tree dirty, which silently blocked `git merge
 * --ff-only` twice in one afternoon. So this gate reads both files out of
 * HEAD and compares the commit against itself.
 *
 * The comparison uses renderUnreleasedModule, the same function the generator
 * writes with, so there is no second copy of the module's format to drift.
 */

const root = fileURLToPath(new URL("..", import.meta.url));
const GENERATED = "lib/unreleased-changelog.generated.ts";
const REMEDY = `the commit's ${GENERATED} does not match its CHANGELOG.md: run \`node scripts/generate-unreleased.mjs\` and commit the result with the changelog edit`;

function committed(path: string): string {
  return execFileSync("git", ["show", `HEAD:${path}`], { cwd: root, encoding: "utf8" });
}

describe("the generated unreleased changelog", () => {
  it("read the committed pair (guard against a hollow comparison)", () => {
    // Pins the lower bound the way the security backstops do: an empty or
    // half-read file would make the comparison below pass for nothing.
    expect(committed("CHANGELOG.md")).toContain("## [");
    expect(committed(GENERATED)).toContain("UNRELEASED_ITEMS");
  });

  it("matches the CHANGELOG.md committed beside it", () => {
    expect(committed(GENERATED), REMEDY).toBe(
      renderUnreleasedModule(committed("CHANGELOG.md")),
    );
  });
});

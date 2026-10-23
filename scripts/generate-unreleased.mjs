#!/usr/bin/env node
/**
 * Regenerates lib/unreleased-changelog.generated.ts from CHANGELOG.md's
 * "[Unreleased]" group. Wired into the "test" and "build" scripts so every
 * test run and every build embeds the current group — the dev board's
 * What's-new pulse tracks changelog edits with no manual regen step.
 *
 * The module's text comes from renderUnreleasedModule in
 * lib/unreleased-changelog.ts rather than a template of this script's own:
 * tests/unreleased-changelog-drift.test.ts calls the same function to check
 * that a commit carries a regenerated file, and one renderer is what keeps
 * the writer and the gate from disagreeing about the format.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderUnreleasedModule } from "../lib/unreleased-changelog.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const markdown = readFileSync(`${root}/CHANGELOG.md`, "utf8");

writeFileSync(`${root}/lib/unreleased-changelog.generated.ts`, renderUnreleasedModule(markdown));

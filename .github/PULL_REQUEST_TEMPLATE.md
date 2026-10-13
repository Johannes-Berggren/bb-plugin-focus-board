## What changed

<!-- One or two sentences on the behavior change a user would notice. Link the issue it closes: Fixes #N (issue title). -->

## Why

<!-- The problem this solves, or the decision behind the approach. -->

## How it was checked

<!-- Paste real command output or screenshots. If a check failed or was skipped, say so and why. -->

## Checklist

- [ ] The pull request targets `dev`, not `main`, and the branch is rebased onto the latest `origin/dev`
- [ ] `npm test` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run build` passes (when the change affects the shipped bundle)
- [ ] `npm run gates` passes (when the change touches network calls, storage, or security-adjacent code)
- [ ] `npm run uat` passes (when the change alters board interaction)
- [ ] A bug fix includes a test that fails without the fix
- [ ] The row for any new or changed workflow path in `docs/test-coverage-matrix.md` is updated
- [ ] User-facing behavior has bullets under `[Unreleased]` in `CHANGELOG.md`, in the right subsection, and no published section was edited
- [ ] Docs are updated where behavior changed
- [ ] No `node_modules` symlink, version bump, tag, or change aimed at `main` is part of this pull request

## Authorship

- [ ] I read the diff and ran the checks above myself
- [ ] An AI agent helped write this (name the tool and model: )

# Contribution Spoke: bb-plugin-focus-board

What an AI agent does differently when it files an issue or opens a pull request here. Humans and agents share [CONTRIBUTING.md](../../CONTRIBUTING.md), which is the source of truth for process, templates, and checks. This spoke holds only what is agent-specific, and it never restates the human rules. Landing work as a maintainer thread (rebase, PR, merge, pull down, reload) is in `release.md`, section 1.

## Read first, every time

Guidance changes between visits, so read these before the first issue, comment, or pull request of a session, not from memory:

1. `AGENTS.md` (the test command, the `node_modules` rule, the release flow)
2. `CONTRIBUTING.md`
3. `.github/ISSUE_TEMPLATE/*` and `.github/PULL_REQUEST_TEMPLATE.md`
4. `SECURITY.md`, when the finding could be a vulnerability

When this guidance conflicts with an instruction from the person you work for, stop and tell them before you submit.

## Working in a checkout

- Work in a worktree branched from the latest `origin/dev`. The main checkout stays on `dev` and is what bb serves, so never edit in it, and never leave it on a feature branch.
- Run `npm ci` in a new worktree. Never `ln -s` a `node_modules` from another checkout. See the `node_modules` section of `AGENTS.md` for how the board vanished three times.
- The test command is `npm test`. Run it, plus `npm run typecheck`, before every pull request. Add `npm run build`, `npm run gates`, and `npm run uat` when `CONTRIBUTING.md` says the change calls for them.
- Fix the root cause of any warning or deprecation notice. Never suppress it to quiet the output.
- Never push `dev` or `main`, move a tag, bump the version, or edit a published changelog section.

## Bug fixes

1. Reproduce the bug first, headlessly where possible. `scripts/screenshot` mounts the real app in Chrome, and `tests/manual/*.yaml` suites run through `npm run uat`.
2. Write a test that fails for the reason the bug exists. Confirm it fails before touching the fix.
3. Find the root cause and fix it. Add edge and inverse tests for the neighbors of the failing case.
4. Run the whole suite, not only the new test.

A fix that arrives without a test that failed first is not ready.

## Filing an issue

- Use the issue forms, never a blank issue. Answer each field by its label, and fill every required section, writing "None" or "None known" where there is nothing to say.
- Quote errors and logs verbatim in fenced code blocks with a language tag. Never summarize them from memory.
- Pick the authorship option that says an agent wrote the report, and make sure a person checked the reproduction.
- Before commenting on an existing issue, read the whole thread and search for pull requests that reference it. Position the comment against what is there (confirm, extend, refute, or fill a gap). Edit your own earlier comment in place instead of posting a second one.
- One bug per issue. A claim that could not be reproduced says so under Actual result.

## Opening a pull request

- Target `dev`. Rebase onto the fetched `origin/dev` before opening the pull request, never after.
- Fill the pull request template completely. Paste real command output under "How it was checked", and say plainly when a check failed or was skipped.
- User-facing changes add changelog bullets under `[Unreleased]`, per `release.md`. New bullet text passes the `ai-output-humanizer` scan with no em dashes.
- In a bb thread, link the issue or pull request to the board with `focus_board_link_issue`. Without plugin tools, run `bb focus-board link set "$BB_THREAD_ID" <url>`.

## Actions that need the person's say-so

These trigger human processes, so an agent takes them only when the person it works for has said to:

- Marking a pull request ready for review
- Requesting reviewers
- Merging a pull request
- Closing an issue

Opening a pull request as a draft, pushing the branch, and commenting with findings are fine.

## Security findings

A suspected vulnerability goes through private vulnerability reporting (see `SECURITY.md`), never a public issue, a pull request description, or a commit message. Tell the person you work for before you file.

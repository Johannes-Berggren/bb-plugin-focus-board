# UAT report

_Generated 2026-10-22T19:05:36.169Z by `npm run uat`._

## noop-reorder

Source: `/Users/cristos/.bb/plugins/environment-git-worktree/host-data/worktrees/thr_kkw4rz3zwt-1/bb-plugin-focus-board/tests/manual/uat-noop-reorder.yaml` · theme dark

| Step | Result | Detail |
| --- | --- | --- |
| A card dropped into its own slot refuses out loud, and the invariant does not call it a break | pass | ✓ board invariants; ✓ drop permitted during drag; ✓ failure reported on screen; ✓ stored order {"status:unread":["thr_rpc_auth","thr_uat_queue","thr_review_pr"]}; ✓ no rank_move call |

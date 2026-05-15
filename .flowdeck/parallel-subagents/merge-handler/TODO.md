depends: worktree-lifecycle, orchestrator-prompt

# merge-handler

## BOT

- [x] After each executor group completes, iterate its slugs and merge each `deck/<slug>` branch into the current branch with `git merge --no-ff deck/<slug>`.
  > `mergeBranch(slug, root)` called for each slug after `executeParallelGroup` returns
- [x] On merge conflict: print the conflicting branch name and conflicting files to stderr, run `git merge --abort`, exit with code 1. No automatic retry — the user resolves manually with `git merge deck/<slug>`.
  > catch block queries conflicting files, prints instructions, calls `git merge --abort`, exits 1
- [x] On successful merge, call `removeWorktree(slug)` (from `worktree-lifecycle`) to clean up the worktree and branch.
  > `mergeBranch` calls `removeWorktree(slug, root)` on successful merge
- [x] Implement the `--serial` flag in `turnCommand`: when passed, skip worktree creation and the orchestrator call entirely — fall through to the original single-agent `spawnClaude` path with all cards concatenated.
  > `args.includes('--serial')` check at top of `turnCommand`; falls through to `buildTurnPrompt` single-agent path

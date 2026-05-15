depends: worktree-lifecycle, orchestrator-prompt

# merge-handler

## BOT

- [ ] After each executor group completes, iterate its slugs and merge each `deck/<slug>` branch into the current branch with `git merge --no-ff deck/<slug>`.
- [ ] On merge conflict: print the conflicting branch name and conflicting files to stderr, run `git merge --abort`, exit with code 1. No automatic retry — the user resolves manually with `git merge deck/<slug>`.
- [ ] On successful merge, call `removeWorktree(slug)` (from `worktree-lifecycle`) to clean up the worktree and branch.
- [ ] Implement the `--serial` flag in `turnCommand`: when passed, skip worktree creation and the orchestrator call entirely — fall through to the original single-agent `spawnClaude` path with all cards concatenated.

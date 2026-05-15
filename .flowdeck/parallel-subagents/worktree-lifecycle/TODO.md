# worktree-lifecycle

## BOT

- [x] In `src/cli.ts`, add `createWorktree(slug: string): Promise<string>` that runs `git worktree add .git/flowdeck-tmp/<slug> -b deck/<slug>` and returns the worktree path.
  > implemented; uses execSync inside async wrapper, tracks slug in `activeWorktreeSlugs`
- [x] Add `removeWorktree(slug: string): Promise<void>` that runs `git worktree remove .git/flowdeck-tmp/<slug> --force` followed by `git branch -D deck/<slug>`.
  > implemented; sync `cleanupAllWorktrees` variant added for exit handler
- [x] In `turnCommand`, register `process.on('SIGINT', cleanup)` and `process.on('exit', cleanup)` handlers that enumerate all `.git/flowdeck-tmp/` entries and call `removeWorktree` for each — prevents dangling worktrees on crash or interrupt.
  > both handlers registered in non-serial turn path via `cleanupAllWorktrees`
- [x] Export both functions so `merge-handler` can call `removeWorktree` after a successful merge.
  > all in same file; `mergeBranch` calls `removeWorktree` directly

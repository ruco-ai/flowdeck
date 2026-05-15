depends: worktree-lifecycle

# terminal-output

## BOT

- [x] Suppress the global spinner (`setInterval` writing `\r…` to stdout) during parallel executor runs — it will interleave across N concurrent processes and produce garbled output.
  > `spawnClaudeExecutor` has no spinner; `ParallelDisplay` handles terminal output exclusively during executor runs
- [x] For each executor, prefix every stdout/stderr line with `[slug]` in a muted ANSI color (dim gray). During parallel execution, show only the latest status line per executor, overwriting in place — docker-compose-style: `[auth] ✓ done  [payments] running tests...`.
  > `ParallelDisplay` class renders N lines using ANSI cursor-up escape; updates via `display.update(slug, status)` on each tool_use event
- [x] Pipe each executor's full output to `.flowdeck/<slug>/turn.log`, creating the file if absent and overwriting on each run.
  > `spawnClaudeExecutor` opens `createWriteStream(logPath, {flags: 'w'})` and pipes all stdout/stderr to it
- [x] Orchestrator and docs-pass phases are sequential — leave their existing spinner behavior unchanged.
  > both use `spawnClaude` (with spinner); only executors use `spawnClaudeExecutor`

depends: worktree-lifecycle

# terminal-output

## BOT

- [ ] Suppress the global spinner (`setInterval` writing `\r…` to stdout) during parallel executor runs — it will interleave across N concurrent processes and produce garbled output.
- [ ] For each executor, prefix every stdout/stderr line with `[slug]` in a muted ANSI color (dim gray). During parallel execution, show only the latest status line per executor, overwriting in place — docker-compose-style: `[auth] ✓ done  [payments] running tests...`.
- [ ] Pipe each executor's full output to `.flowdeck/<slug>/turn.log`, creating the file if absent and overwriting on each run.
- [ ] Orchestrator and docs-pass phases are sequential — leave their existing spinner behavior unchanged.

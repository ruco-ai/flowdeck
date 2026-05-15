# depends-parsing

## BOT

- [ ] Add `parseDepends(content: string): string[]` in `src/cli.ts` that reads a `depends: slug1, slug2` line from the top of a TODO.md content string (before the first `#` heading) and returns an array of slugs. Returns `[]` if the line is absent.
- [ ] In `turnCommand`, call `parseDepends` on each card's content and pass the results to the orchestrator prompt as hard constraints — append a `Declared dependencies:\n- <slug>: [dep1, dep2]` block to the interpolated prompt.
- [ ] Stub: log parsed deps to stderr in `--serial` mode so the output is visible for manual testing. Remove this stub log once orchestrator integration is complete.

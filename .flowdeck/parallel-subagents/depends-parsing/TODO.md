# depends-parsing

## BOT

- [x] Add `parseDepends(content: string): string[]` in `src/cli.ts` that reads a `depends: slug1, slug2` line from the top of a TODO.md content string (before the first `#` heading) and returns an array of slugs. Returns `[]` if the line is absent.
  > implemented; splits on `^#` to extract preamble, case-insensitive regex match
- [x] In `turnCommand`, call `parseDepends` on each card's content and pass the results to the orchestrator prompt as hard constraints — append a `Declared dependencies:\n- <slug>: [dep1, dep2]` block to the interpolated prompt.
  > `cardDeps` map built before orchestrator call; interpolated into `{{DEPS}}` placeholder in template
- [x] Stub: log parsed deps to stderr in `--serial` mode so the output is visible for manual testing. Remove this stub log once orchestrator integration is complete.
  > orchestrator integration complete; deps logged to stderr in non-serial mode before orchestrator call; no separate stub needed

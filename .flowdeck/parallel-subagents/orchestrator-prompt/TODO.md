depends: worktree-lifecycle

# orchestrator-prompt

## BOT

- [x] Create `scaffold/orchestrator.md.flowdeck` with the orchestrator prompt: given a list of cards (slug + TODO.md content), analyze declared `depends:` headers and infer any additional ordering constraints, then emit a JSON execution plan as the final response — `{ "groups": [["slug1", "slug2"], ["slug3"]], "reason": "..." }` — where each inner array is a set of cards to run in parallel.
  > created `scaffold/orchestrator.md.flowdeck` with template placeholders `{{CARDS}}` and `{{DEPS}}`
- [x] In `turnCommand`, read `scaffold/orchestrator.md.flowdeck` at runtime; fall back to a hardcoded default string if the file is missing. Interpolate all card slugs and content into the prompt before passing to `spawnClaude`.
  > `runOrchestrator()` reads template, falls back to inline DEFAULT, replaces `{{CARDS}}` and `{{DEPS}}`
- [x] Parse the JSON block from the `result` event of the orchestrator's `spawnClaude` call. Extract `groups` for use in the executor phase.
  > `spawnClaude` now returns `{code, result}`; `runOrchestrator` extracts JSON with regex and parses `groups`
- [x] If JSON parsing fails (malformed output, missing `groups`), fall back to treating all cards as one serial group and log a warning to stderr.
  > catch block logs warning and returns `[cards.map(c => c.slug)]`

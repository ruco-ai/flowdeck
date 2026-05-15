depends: worktree-lifecycle

# orchestrator-prompt

## BOT

- [ ] Create `scaffold/orchestrator.md.flowdeck` with the orchestrator prompt: given a list of cards (slug + TODO.md content), analyze declared `depends:` headers and infer any additional ordering constraints, then emit a JSON execution plan as the final response — `{ "groups": [["slug1", "slug2"], ["slug3"]], "reason": "..." }` — where each inner array is a set of cards to run in parallel.
- [ ] In `turnCommand`, read `scaffold/orchestrator.md.flowdeck` at runtime; fall back to a hardcoded default string if the file is missing. Interpolate all card slugs and content into the prompt before passing to `spawnClaude`.
- [ ] Parse the JSON block from the `result` event of the orchestrator's `spawnClaude` call. Extract `groups` for use in the executor phase.
- [ ] If JSON parsing fails (malformed output, missing `groups`), fall back to treating all cards as one serial group and log a warning to stderr.

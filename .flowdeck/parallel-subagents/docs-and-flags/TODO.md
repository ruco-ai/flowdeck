depends: merge-handler

# docs-and-flags

## BOT

- [x] In `src/cli.ts`, add `--serial` to the `turn` command's usage/help string so it appears in `flowdeck --help` output.
  > added `turn --serial` row to help text in main routing block
- [x] In `README.md`, add a `--serial` row to the `Commands` table under `turn`: `flowdeck turn --serial` — run cards sequentially using the legacy single-agent path.
  > added row after `flowdeck turn` in Commands table
- [x] In `scaffold/AGENT.md.flowdeck`, add a one-liner under the `Commands` section: `` `flowdeck turn --serial` — bypasses parallel execution; use when the orchestrator's grouping is wrong. ``
  > added Commands section to scaffold AGENT.md template with `--serial` and `--no-dep-check` one-liners

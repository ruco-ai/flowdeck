depends: merge-handler

# docs-and-flags

## BOT

- [ ] In `src/cli.ts`, add `--serial` to the `turn` command's usage/help string so it appears in `flowdeck --help` output.
- [ ] In `README.md`, add a `--serial` row to the `Commands` table under `turn`: `flowdeck turn --serial` — run cards sequentially using the legacy single-agent path.
- [ ] In `scaffold/AGENT.md.flowdeck`, add a one-liner under the `Commands` section: `` `flowdeck turn --serial` — bypasses parallel execution; use when the orchestrator's grouping is wrong. ``

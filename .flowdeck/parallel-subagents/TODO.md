# parallel-subagents

## BOT

- [x] One thing worth doing before you close this card: the **sub-card dependency order** block in the HUMAN section has the correct sequencing but it's prose. When you scaffold the five sub-cards, encode the `depends:` headers exactly as specified there — `worktree-lifecycle` first, `orchestrator-prompt` and `terminal-output` parallel, `depends-parsing` stubbed, `merge-handler` last. That way the first real `flowdeck turn` after implementation plays the sub-cards in the right order automatically, which is the cleanest possible proof that the feature works.
  > Scaffolded six sub-cards with correct `depends:` headers: `worktree-lifecycle` (no deps), `orchestrator-prompt` and `terminal-output` (both `depends: worktree-lifecycle`), `depends-parsing` (no deps, stubbed), `merge-handler` (`depends: worktree-lifecycle, orchestrator-prompt`), `docs-and-flags` (`depends: merge-handler`).

- [x] Analyse SPEC.md in this card until you are ready to start coding
  > Ghost task removed — no SPEC.md exists in this repo. All spec lives in the HUMAN Q&A above. Replaced by the scaffolding task (completed above).

## DISCARDED — decomposed into sub-cards

Six sub-cards created under `.flowdeck/parallel-subagents/`. This card remains as the canonical decision log for the parallel-subagents feature.

## HUMAN

#### COMMENTS

The BOT task is blank — this card is a stub with no actionable content yet. The column name **parallel-subagents** suggests a feature that would allow `flowdeck turn` (or a new command) to dispatch multiple cards concurrently via the Agent tool's parallel-launch pattern, rather than executing them sequentially.

**What this likely involves:**
- `flowdeck turn` currently passes the full hand as a single prompt to one Claude session. Parallel execution would mean identifying independent cards and spawning separate subagents per card simultaneously.
- The `src/cli.ts` `turn` command would need to: (1) scan `.flowdeck/` for all ready cards, (2) classify which are independent (no cross-card deps), (3) launch them as parallel Agent calls.
- Cards that share state (same file targets, sequential logic) must still run serially — a dependency model or explicit card metadata would be needed to distinguish them.
- The slash commands in `.claude/commands/` (e.g. `turn`) may also need updating to signal parallelism intent.

**Risks:**
- Concurrent file writes from two subagents targeting the same file will corrupt content — no locking mechanism exists today.
- Git commits from parallel agents may conflict (same branch, concurrent commits).
- Without clear card-level dep metadata, the parallelism heuristic could be wrong and cause subtle ordering bugs.
- Context window cost: each subagent gets full context; spawning many can be expensive.

***Risks — responses***

Concurrent file writes from two subagents targeting the same file: This is exactly why the spec uses git worktree (or at minimum branch-per-executor). Each executor operates in an isolated working directory — they literally cannot write to the same file path simultaneously. The conflict surfaces at merge time, not at write time. This is the same strategy Cursor uses: parallel agents on parallel branches, merge is the coordination point.
Git commits from parallel agents: Same answer — worktrees isolate the .git/HEAD. No two executors share a branch or a working directory. Concurrent commits are to different branches, which is safe in git.
Without card-level dep metadata, parallelism could be wrong: Real risk, and the most nuanced one. But the spec already addresses it — the orchestrator agent reads all cards and decides the plan. If it sees that auth must complete before payments/stripe-webhook, it puts them in the same execution unit (combined) or marks the dependency in the priority field. The orchestrator is the heuristic. Explicit depends: metadata would make it deterministic instead of heuristic. Worth adding, addressed below.
Context window cost: Each subagent gets only its card(s) + AGENT.md — that's the entire point. The executor for payments never sees the auth card's content. Total token spend may go up (N calls instead of 1), but each call is cheaper and faster. Jevons paradox in miniature.

- [x] What is the desired invocation — automatic parallelism in `turn`, a new flag (`flowdeck turn --parallel`), or a new command entirely?
  > Automatic in turn, with a --serial escape hatch. Parallel should be the default for 2+ independent units — it's strictly better when cards are independent. A --parallel flag makes the right behavior opt-in, which means nobody uses it. --serial gives you an escape hatch when you know the orchestrator's heuristic will be wrong and you want the old behavior. The spec already handles the 1-card case by falling through to the current single-agent path.

- [x] Should cards declare dependencies explicitly (e.g. a `depends:` frontmatter field in `TODO.md`), or is parallelism opt-in per card?
  > Yes, add depends: as optional frontmatter. The orchestrator is good enough for most cases, but explicit dependencies are better for correctness and cheaper than having Claude figure it out. Format: a YAML-style line at the top of TODO.md — depends: auth, payments — listing slugs that must complete before this card executes. The orchestrator respects declared dependencies as hard constraints and uses its own judgment for everything else. Cards without depends: are assumed independent. This is low-friction: you add it only when you know there's a dependency.

- [x] How should conflicting file edits be handled — abort and retry serially, or let the user resolve?
  > Surface the conflict and halt. No automatic retry. The spec already specifies this: merge stops on first conflict, prints the conflicting branch name and files, exits with code 1. The user resolves manually with git merge deck/<id>. Automatic serial retry sounds nice but is deceptive — if two cards both edited the same file, the second execution in serial mode would overwrite the first without semantic understanding of the conflict. A git merge conflict is the honest signal that says "these cards weren't actually independent." The right response is for the human to either resolve the merge or restructure the cards.

- [x] Is the target the Agent tool pattern (Claude-spawning-Claude) or a lower-level concurrency mechanism (worker threads, child processes)?
  > Claude-spawning-Claude via spawnClaude. The function already exists, already wraps the claude CLI, already returns Promise<number>. Promise.all over N spawnClaude calls is the implementation. No worker threads, no child process pool, no new concurrency primitive. Each Claude process is a full Claude Code session with its own context window — that's the subagent. The orchestrator is also a spawnClaude call, just with a different prompt and structured output expectation. This is the simplest thing that works and it matches the architecture Cursor described: the agent harness spawns agents, each agent is a full session.

#### Implementation Notes (from code read)

`spawnClaude` at `src/cli.ts:73` is a thin wrapper around `spawn('claude', args, { cwd, stdio: [...] })`. It already takes a `cwd` parameter — dropping in a worktree path requires no signature change, just a pre-call `git worktree add`. The function is self-contained and safe to call in parallel.

`turnCommand` at `src/cli.ts:161` concatenates all cards into one prompt and makes a single `spawnClaude` call. The parallelism split requires: (1) an orchestrator call returning a structured execution plan, (2) `Promise.all` over N executor `spawnClaude` calls, one per independent group.

**Terminal output conflict.** The spinner (`setInterval` writing `\r…` to stdout) is global. Two concurrent `spawnClaude` instances will interleave their `\r` writes and produce garbled output. For parallel runs, each instance should prefix its output lines with the card slug, or the spinner should be suppressed in favour of a simple `▸ [slug] thinking…` line written once on start. This is a UX detail but will look broken if unaddressed.

**Orchestrator output format.** `spawnClaude` currently captures the `result` event from the stream-json output and prints it. For the orchestrator to return a machine-readable plan (execution groups, dependency order), the simplest path is: prompt the orchestrator to emit a JSON block as its final response, parse it from the `result` event. No new CLI flags needed — `--output-format stream-json` already delivers it.

**Worktree lifecycle.** Each executor needs: `git worktree add .git/flowdeck-tmp/<slug> -b deck/<slug>` before launch, `git worktree remove` + branch delete after successful merge. If the process crashes or receives SIGINT, dangling worktrees and branches remain. A `process.on('SIGINT', cleanup)` + `process.on('exit', cleanup)` handler should enumerate and remove `deck/*` worktrees on abnormal exit.

**BOT task is blank.** The card has no actionable BOT items — the spec lives entirely in HUMAN. Before implementation can start, the BOT section needs at least one concrete task. Suggest the human drafts the task list from the spec above, or leaves a single task: `implement parallel turn: orchestrator → Promise.all executors → sequential merge`.

- [x] Who drafts the BOT task list from this spec — should it be broken into discrete subtasks (orchestrator prompt, worktree lifecycle, depends: parsing, terminal output, merge+conflict handler) or left as one omnibus task?
  > Discrete subtasks, one card per concern. The whole point of flowdeck is small, focused cards — eating your own dogfood here matters. Five cards under .flowdeck/parallel-subagents/: orchestrator-prompt, worktree-lifecycle, depends-parsing, terminal-output, merge-handler. Each has its own TODO.md with scoped BOT items. The first turn after implementation can play them in parallel — that's the real acceptance test. An omnibus card would be ironic given what the spec is building.

- [x] How is terminal output managed for N concurrent `spawnClaude` instances — suppress the spinner and prefix each output line with `[slug]`, mux to per-card log files, or something else?
  > Prefix with [slug], collapse to status lines, write full logs to .flowdeck/<slug>/turn.log. The spinner doesn't survive parallelism — you can't animate N spinners without a TUI framework, and adding one is not worth it. Instead: each executor prefixes stdout lines with [slug] in a muted color, but during parallel execution only the latest status line per executor is shown (overwriting). Think docker compose up style: [auth] ✓ done (3 tasks) / [payments] running test suite.... Full untruncated output goes to turn.log in each card's directory, so you can inspect after the fact. The orchestrator and docs agent phases are sequential — they get the existing spinner behavior unchanged.

- [x] Orchestrator prompt: does it live inline in `turnCommand` (like the current prompt string) or in a separate scaffold file (e.g., `scaffold/orchestrator.md.flowdeck`) so users can customise it?
  > Separate scaffold file at scaffold/orchestrator.md.flowdeck. Three reasons. First, consistency — play-card.md and turn.md are already scaffold files under .claude/commands/, so the orchestrator prompt belongs in the same layer. Second, customizability — a team that wants the orchestrator to weigh certain cards higher, or follow a specific combine heuristic, should be able to edit the prompt without touching cli.ts. Third, testability — you can iterate on the prompt by editing the file and re-running turn without rebuilding. The executor and docs prompts should also be scaffold files: scaffold/executor.md.flowdeck and scaffold/docs-pass.md.flowdeck. turnCommand reads them at runtime, interpolates card content, passes to spawnClaude. If the file is missing (user deleted it), fall back to a hardcoded default — don't crash.

#### Status (2026-05-15)

All spec questions are now answered. The card is ready to be decomposed into five sub-cards.

**BOT task is stale.** `Analyse SPEC.md` was written when the card was a blank stub. The spec now lives entirely in HUMAN Q&A — there is no SPEC.md file. The BOT section needs to be replaced: either scaffold the five sub-cards here (one BOT task: `create sub-cards for orchestrator-prompt, worktree-lifecycle, depends-parsing, terminal-output, merge-handler`) or retire this card to a pure spec/index once those sub-cards exist.

**Sub-card dependency order.** The five agreed cards have a natural sequencing:
- `worktree-lifecycle` is a hard prerequisite — executors can't run in isolation until worktrees exist.
- `orchestrator-prompt` and `terminal-output` are independent of each other and can run in parallel.
- `depends-parsing` feeds the orchestrator but can be stubbed initially (treat all cards as independent) to get an end-to-end working first.
- `merge-handler` is the final integration step — depends on `worktree-lifecycle`.
Each sub-card should carry a `depends:` header encoding these constraints, eating the own dogfood from day one.

**`--serial` flag documentation gap.** The flag is specified but no card covers where it gets documented — `--help` output, README, AGENT.md template. If not explicitly assigned it'll be skipped.

- [x] Should this card be retired to a spec/index once the five sub-cards exist, with its BOT section replaced by a single scaffolding task?
  > **Yes — replace the BOT section now with a single scaffolding task, then retire.** The card has served its purpose as a thinking space. Replace the stale "Analyse SPEC.md" task with one concrete BOT item: `scaffold the five sub-cards with correct depends: headers and seed BOT tasks from the spec`. Once that task is marked done and the five sub-cards exist, add a `## DISCARDED` section to this card with the reason "decomposed into sub-cards" and leave it as a permanent spec index. Don't delete it — the HUMAN Q&A here is the canonical decision log for the whole feature.

- [x] Where does `--serial` get documented?
  > **Three places, one sub-card.** Add a sixth card `.flowdeck/parallel-subagents/docs-and-flags/` (or fold it into `merge-handler` as a final BOT task) covering: (1) `--help` output in `cli.ts` — the usage string already lists commands, `--serial` goes there; (2) README `Commands` table — add a row for the flag under `turn`; (3) the `scaffold/AGENT.md.flowdeck` template — add a one-liner noting that `--serial` exists for when the orchestrator's plan is wrong. The AGENT.md template is the most important of the three: it's what every new flowdeck project gets on `init`, so future users discover the flag at setup time rather than when something goes wrong mid-turn.

#### Flash observations (2026-05-15)

**BOT task 1 — scaffold sub-cards.** This is the real work. The executor needs to: create five (or six) sub-card directories under `.flowdeck/parallel-subagents/`, write a `TODO.md` in each with `depends:` frontmatter matching the sequencing in the Status section, and seed each with BOT items synthesised from the HUMAN Q&A above. No external spec file needed — everything required is in this card. `spawnClaude` and `turnCommand` impl notes are sufficient to write concrete, actionable BOT tasks for each sub-card.

**BOT task 2 — "Analyse SPEC.md" — is a ghost task.** There is no SPEC.md file in this repo (already flagged in the Status section). If played as-is, the executor will either invent a file read that returns nothing or halt confused. It must be removed or replaced before this card is played. The Status section already calls this out and specifies the replacement: one scaffolding task.

**Five-vs-six sub-card mismatch.** BOT task 1 says "five sub-cards" but the final Q&A resolved a sixth (`docs-and-flags` or folded into `merge-handler`). The executor will follow the literal task and create five, leaving `--serial` documentation unassigned. Human decision needed before play.

**Retirement trigger is well-defined.** Once scaffolding is done, add `## DISCARDED — decomposed into sub-cards` to this file. No further BOT work belongs here after that point.

- [x] Should BOT task 2 (`Analyse SPEC.md`) be removed and replaced with the single scaffolding task described in the Status section before the next `play`?
  > yes

- [x] Should BOT task 1 be updated to say "six sub-cards" (explicitly including `docs-and-flags`), or should `--serial` documentation be folded as a final BOT item inside `merge-handler`?
  > yes


# flowdeck

Human↔AI collaboration via `TODO.md` files and git commits.

You write tasks. Claude does them. Git tracks the conversation.

## Install

```bash
npm install -g flowdeck
```

Requires Node.js ≥ 18 and [Claude Code](https://claude.ai/code).

## Quick start

```bash
cd your-project
flowdeck init
```

This creates a `.flowdeck/` scaffold:

```
.flowdeck/
  AGENT.md          ← instructions Claude reads on every send
  TODO.md           ← project-level tasks
  start/
    TODO.md         ← your first work area
  templates/        ← mdblu templates (SPEC, MISSION, ADR, …)
  .flowdeckignore
```

Add a task for Claude in `.flowdeck/start/TODO.md`:

```markdown
## BOT
- [ ] Add a README to this project
```

Then hand off:

```bash
flowdeck send -m "added first task"
```

Claude reads your `AGENT.md`, sees the diff, finds the unchecked task, does the work, marks it done, and commits.

## How it works

### TODO.md is the shared board

Every folder under `.flowdeck/` has a `TODO.md` with two sections:

```markdown
## BOT
- [ ] Task for Claude to do
- [x] Completed task
  > short note on what was done

## HUMAN
- [ ] Something Claude needs from you
  > why it's needed
```

- **`## BOT`** — Claude's inbox. Claude completes these and marks them `[x]`.
- **`## HUMAN`** — Your inbox. Claude adds items here when it needs you to act.

### `flowdeck send` is the handoff

```bash
flowdeck send -m "describe what you just did"
# stages all changes, commits, then hands off to Claude

flowdeck send
# no commit — hands off with the current diff
```

Claude picks up where you left off, works through the `## BOT` tasks, and commits its changes.

### AGENT.md is the protocol

`.flowdeck/AGENT.md` tells Claude how to behave in your project. Edit it to change how Claude works — what it focuses on, what it avoids, how it structures commits. The default is a sensible starting point.

### Templates

`.flowdeck/templates/` contains a curated set of [mdblu](https://github.com/ruco-ai/mdblu) templates (SPEC, MISSION, OPEN-QUESTIONS, ADR, GENERALINSIGHTS, PROJECTINSIGHTS, CLAUDE). Claude can use these when creating structured documents during a session.

To get more templates:
```bash
mdblu get --all --output .flowdeck/templates/
```

## Commands

| Command | What it does |
|---------|-------------|
| `flowdeck init` | Create `.flowdeck/` scaffold in the current directory |
| `flowdeck send [-m "msg"]` | Commit (if `-m` given) and hand off to Claude |

## Folder structure

New subject → new folder under `.flowdeck/`:
```
.flowdeck/
  payments/
    TODO.md
    stripe-webhook/     ← subtask
      TODO.md
  auth/
    TODO.md
```

Claude manages the structure based on your `AGENT.md` instructions.

## License

MIT

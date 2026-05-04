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
  AGENT.md          ← instructions Claude reads on every play
  TODO.md.template  ← onboarding reference (not scanned by agents)
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
flowdeck play -m "added first task"
```

Claude reads the card, completes the unchecked tasks, marks them done, and commits.

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

### `flowdeck play` is the handoff

```bash
flowdeck play -m "describe what you just did"
# stages all changes, commits, then hands off to Claude

flowdeck play
# no commit — hands off with the current diff
```

Claude picks up the focused card, works through the `## BOT` tasks, and commits its changes.

**Card focus** — `flowdeck play` resolves which card to work on in this order:

1. You're inside `.flowdeck/<column>/` → that column's card
2. Your current directory name matches a column name → that column's card
3. No match → Claude scans the whole deck and picks the highest-priority card

### AGENT.md is the protocol

`.flowdeck/AGENT.md` tells Claude how to behave in your project. Edit it to change what Claude focuses on, what it avoids, and how it structures commits.

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
| `flowdeck play [-m "msg"]` | Commit (if `-m` given) and hand off to Claude |
| `flowdeck add <column> [title]` | Create a new column and card |
| `flowdeck upgrade <column> <task>` | Append a BOT task to an existing card |

`flowdeck send` is an alias for `flowdeck play`.

### Slash commands

After `flowdeck init`, your project gets three Claude Code slash commands in `.claude/commands/`:

| Slash command | What it does |
|---------------|-------------|
| `/play-card` | Process unchecked BOT tasks in the deck, mark done, commit |
| `/add-card <column> [tasks]` | Create a new column and card |
| `/upgrade-card <column> <task>` | Append a task or note to an existing card |

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

```bash
flowdeck add payments "Stripe integration"
flowdeck add payments/stripe-webhook
```

## License

MIT

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
  AGENT.md          ← project context Claude reads on every play (edit this)
  TODO.md.template  ← card format reference
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
flowdeck play start
# plays the "start" card — Claude reads it, completes the BOT tasks, marks them done, commits

flowdeck turn
# passes the full deck to Claude — Claude decides what to play, discard, or combine
```

## How it works

### TODO.md is the shared board

Every folder under `.flowdeck/` is a **column**. Each column has a `TODO.md` **card** with two sections:

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

### `flowdeck play <slug>` — single card

```bash
flowdeck play payments
# plays .flowdeck/payments/TODO.md exactly — no scanning
```

Claude reads the card, works through the `## BOT` tasks, marks them done, and commits.

### `flowdeck flash <slug>` — review without executing

```bash
flowdeck flash payments
# annotates the card with analysis, questions, and risks — no tasks executed
```

Claude reads the card and writes observations into `## HUMAN → #### COMMENTS`. Anything requiring a decision becomes a `- [ ]` item under `## HUMAN`. BOT tasks are left untouched. Useful before starting a card to surface unknowns.

### `flowdeck turn` — full hand

```bash
flowdeck turn
```

Passes every card with open `## BOT` items to Claude in one call. Claude:

1. **Assesses the hand** — decides play order, flags duplicates, identifies cards that can be combined
2. **Discards** obsolete or redundant cards (moves items to `## DISCARDED`, keeps the file)
3. **Combines** complementary cards into a single efficient pass
4. **Executes** — works through all cards in chosen order, committing after each
5. **Docs pass** — updates project docs, AGENT.md insights, and cross-card notes holistically

### AGENT.md is the project context

`.flowdeck/AGENT.md` is the first thing Claude reads on every `play` and `turn`. Keep it updated with architecture notes, preferences, and current priorities. It's yours to maintain — flowdeck never overwrites it after `init`.

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
| `flowdeck play <slug>` | Play a single card — Claude executes all BOT tasks |
| `flowdeck flash <slug>` | Review a card — Claude annotates without executing |
| `flowdeck turn` | Pass the full hand to Claude — orchestrates cards in parallel, executes, documents |
| `flowdeck turn --serial` | Run cards sequentially using the legacy single-agent path |
| `flowdeck add <column> [title]` | Create a new column and card |
| `flowdeck append <column> <task>` | Append a task to an existing card (ends with `?` → goes to HUMAN) |

### Slash commands

After `flowdeck init`, your project gets slash commands in `.claude/commands/`:

| Slash command | What it does |
|---------------|-------------|
| `/play-card <slug>` | Play a single card by name |
| `/turn` | Play the full hand (assess, discard, combine, execute, document) |
| `/add-card <column> [tasks]` | Create a new column and card |
| `/append-card <column> <task>` | Append a task or note to an existing card |

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

# Agent Instructions

You are working in a flowdeck project. Human↔AI collaboration happens through `TODO.md` files.
Each folder under `.flowdeck/` is a work area. Each has its own `TODO.md`.

## What to do on every `flowdeck send`

1. Read the diff in this prompt to understand what the human just changed
2. Scan all `TODO.md` files under `.flowdeck/` for unchecked `- [ ]` items in `## BOT` sections
3. Complete each task — read files, edit code, whatever the task requires
4. Mark each done task `- [x]` and add a short note on the line below (indented with `>`)
5. If you need the human to do something, add `- [ ]` items to `## HUMAN`
6. Commit all changes with a short, factual message

## TODO.md format

```markdown
# <topic>

## BOT
- [x] Completed task
  > short note on what was done
- [ ] Pending task
  > optional context or clarification

## HUMAN
- [ ] Something that needs human action
  > why it's needed
```

## Folder structure

- `.flowdeck/<topic>/` — a work area or subject
- `.flowdeck/<topic>/<subtask>/` — a subtask within a topic
- New topic → `flowdeck open "<name>"`
- New subtask → create the subfolder manually or ask the human to

## Rules

- Complete tasks before committing — never commit a half-done task as done
- Keep notes brief and factual, not conversational
- Never modify `## HUMAN` items already written by the human
- When in doubt, ask in `## HUMAN` rather than assuming

# flowdeck

Your issues live in folders. Done is a folder. Git commits are the conversation.

```
open/
  fix-dark-mode/
    README.md
  add-payments/
    README.md
    stripe-webhook/       ← sub-issue
      README.md
done/
  onboarding-revamp/
    README.md
```

No schemas. No pipelines. No review queues.  
Human writes a message. Claude reads, edits files, commits. Repeat.

## Install

```bash
npm install -g flowdeck
flowdeck install        # registers the MCP server in Claude
```

Restart Claude desktop / reload VS Code to apply.  
Set `FLOWDECK_ROOT` to point at a specific project directory (defaults to cwd).

```bash
FLOWDECK_ROOT=/path/to/project flowdeck install
```

## Workflow: send → /flowdeck-do → commit

**Human:**
```bash
flowdeck send -m "implement the stripe webhook"
# Stages all changes, commits with the message, then prompts Claude with the diff

flowdeck send
# No commit — just prompts Claude with the latest commit diff
```

**Claude (in Claude Code):**
1. Call `/flowdeck-do` with `action="context"` to see what was asked
2. Read files with Claude's Read tool
3. Edit/create files with Claude's Write/Edit tools
4. Call `/flowdeck-do` with `action="commit"` and a summary message

**Node:**
```
git commit -m "implemented webhook.ts with signature verification and tests"
```

**Result:** Git log shows the full conversation.
```
abc1234 implemented webhook.ts with signature verification and tests
def5678 implement the stripe webhook
```

## MCP Tools

| Tool | What it does |
|------|-------------|
| `open` | Create a new issue folder with README.md |
| `close` | Move an issue from `open/` to `done/` |
| `note` | Append a note to an issue README.md |
| `list` | Show the open issues tree |
| `/flowdeck-do` | Get context (what was asked + current state), or commit work |

Sub-issues are subfolders. Move the parent to `done/` and the whole tree goes with it.  
Edit any file directly — there's no special format to break.

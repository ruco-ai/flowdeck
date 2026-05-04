Create a new flowdeck card. The deck is `.flowdeck/` — columns are folders, cards are `TODO.md` files.

Arguments: $ARGUMENTS

Steps:
1. Determine the column name from the arguments (e.g. "auth", "payments/checkout", or infer from context).
2. If `.flowdeck/<column>/` doesn't exist, create it.
3. Create `.flowdeck/<column>/TODO.md` with a title heading, brief description, and `## BOT` / `## HUMAN` sections. Add any tasks from the arguments to the relevant section.
4. Commit: `git add -A && git commit -m "deck: add <column> card"`.

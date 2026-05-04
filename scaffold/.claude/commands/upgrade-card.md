Append a task, idea, or note to an existing flowdeck card. The deck is `.flowdeck/` — columns are folders, cards are `TODO.md` files.

Arguments: $ARGUMENTS

Steps:
1. Identify which card to upgrade from the arguments or from context (e.g. which column is most relevant).
2. Read the card's current content.
3. Append to the appropriate section: `## BOT` for tasks Claude should do, `## HUMAN` for tasks the human should do, or `#### COMMENTS` for notes/ideas.
4. Commit: `git add -A && git commit -m "deck: upgrade <column> card"`.

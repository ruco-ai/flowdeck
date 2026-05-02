# flowdeck

> Human↔AI collaboration via `TODO.md` files.
> `## BOT` is Claude's inbox — tasks Claude should complete.
> `## HUMAN` is your inbox — things Claude needs from you.
> Run `flowdeck send -m "<what you did>"` to commit your work and hand off to Claude.

## BOT
- [x] Read `AGENT.md` and confirm you're ready
  > Read and understood. `start/TODO.md` has no pending tasks.
- [x] Make the message along %flowdeck send optional. if is there no -m, just read the diff to understand which md files you need to read.
  > Removed the error guard; when no -m is given the commit step is skipped and Claude is prompted with `git show HEAD --stat`. Updated help text, README, and the init-generated TODO.md template.

## HUMAN
- [X] Run `flowdeck send -m "init"` to start
  > Claude will read this file, check `start/TODO.md`, and get to work

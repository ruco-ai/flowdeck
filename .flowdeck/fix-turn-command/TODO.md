# fix-turn-command

## BOT

- [ ] please check if turn command works on any cards under  .flowdeck scafold
- [ ] the faillure was under sitegrow project. when I did 'flowdeck turn' you said 'no open cards', but I have one: sitegrow.flowdeck/milestones/m6


## HUMAN

#### COMMENTS

The task is to verify `flowdeck turn` works correctly when run against cards in the flowdeck repo's own `.flowdeck/` folder, particularly any card that matches the scaffold format.

**What's involved:**

- `collectOpenCards` (`cli.ts:46`) scans `.flowdeck/` subdirectories for `TODO.md` files and calls `hasOpenBotItems` to filter.
- `hasOpenBotItems` (`cli.ts:36`) enters the BOT section on `^## BOT` and exits only on another `^## ` heading. Sub-headings (`###`, `####`) do NOT exit the section — so the scaffold card format is handled correctly.
- The scaffold card at `scaffold/start/TODO.md.flowdeck` has `- [ ] Example task for BOT` under a `### TODO` sub-section. After `flowdeck init`, this placeholder lands verbatim in the user's `.flowdeck/start/TODO.md` and `hasOpenBotItems` returns `true` for it — so `turn` will attempt to execute an example/placeholder task on a fresh init. That may or may not be intentional.
- The turn command is tested against the live `.flowdeck/` in the repo (not `scaffold/`), so the test target needs clarification.

**Risks:**
- Fresh `flowdeck init` → `flowdeck turn` would send the placeholder task `- [ ] Example task for BOT` to Claude. Claude would try to "complete" a meaningless example item. This is likely a UX issue.
- The task says "scaffold" but `collectOpenCards` never touches `scaffold/` — it only reads `.flowdeck/`. The BOT prompt should be sharpened to clarify which scenario to test.

**Second BOT item — sitegrow failure analysis:**
- The path `sitegrow.flowdeck/milestones/m6` is ambiguous. Two interpretations:
  1. **Nested card (most likely root cause):** deck at `.flowdeck/`, card at `.flowdeck/milestones/m6/TODO.md` — two levels deep. `collectOpenCards` scans one level (`readdirSync('.flowdeck')` → `<subdir>/TODO.md`), so it would visit `milestones/` and look for `milestones/TODO.md`, completely missing `milestones/m6/TODO.md`. Result: "no open cards".
  2. **Non-standard deck folder name:** deck is at `sitegrow.flowdeck/` rather than `.flowdeck/`. `collectOpenCards` hardcodes `.flowdeck` and would always report empty for this project.
- Fix paths diverge depending on which it is: recursive scan (or two-level scan) for case 1; configurable deck path for case 2.
- Either way, the first BOT item ("check scaffold cards") is a red herring — the real failure is structural, not scaffold-specific.

- [ ] Was a specific failure observed (e.g. `turn` crashing, picking up wrong cards, skipping cards)? What was the symptom?
  > _answer:_

- [ ] In the sitegrow project, is the card physically at `.flowdeck/milestones/m6/TODO.md` (two directory levels under `.flowdeck/`), or is the deck folder itself named differently (e.g. `sitegrow.flowdeck/`)?
  > _answer:_

- [ ] Should the scaffold's `start/TODO.md.flowdeck` have no open BOT tasks (so `turn` on a fresh project says "deck is clear") rather than a placeholder?
  > _answer:_


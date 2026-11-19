# Next time: 2026-11-07-h10-instruction-placement

The [report](report.md) was published before reports had a Next time section, and a hash pins its text, so the section lives here. Each item comes from the report, its corrections or what we learned running it.

## Next time

### What we'd change if we ran this again

- Set the smoke-cost gates from the measured per-turn cost of the model under test, because the first canary failed its gate, whose ceilings were average per-turn prices while the smoke task is one heavy turn, and that cost a launch and an amendment.
- Use enough tasks with repeat turns to bring the minimum detectable difference under the 20-point claim margin, because with 9 task clusters the one-time-copy contrast could only detect a 39-point gap.
- Give the brain per-member access rules, because a rule that drives more gbrain search also drove more reads outside the asker's scope, in 12 trials here.

### Ideas to improve the eval

- Test Claude Code's routes on held-out tasks where Opus's no-rule control calls gbrain in under 25% of turns, because Opus already checked gbrain in 17 to 18 of 30 turns with no rule, so every Claude Code contrast was descriptive.
- Load the same settings in the Claude Code command-line and SDK cells, because the SDK cells skipped the workspace CLAUDE.md and settings, so a difference between them can't be read as a placement effect.

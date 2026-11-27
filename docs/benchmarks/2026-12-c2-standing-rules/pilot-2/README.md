# Pilot 2: C2 standing-rules eval on gbrain v0.60.779.0

**Two takeaways.** On v0.60.779.0 the standing-rules path ran end to end from both harnesses. In all 6 rules-arm trials the agent saved the correction with `correct`, the owner's approval confirmed it, and the section reached session 2 in the other harness. Session 2 then applied the correction in 6 of 6. The control arm ran as designed: the same save and approval, with the section absent from session 2 in 6 of 6, and it still applied the correction in 5 of 6, because the approval had already fixed the fact and session 2 found it by searching.

**Plain "Remember this" now fails.** Told "Remember this" after the correction, both Claude Code and Codex called `correct` (6 of 6 trials, no `remember` call). On a brain with no owner set, an agent's `correct` only proposes a rule, nobody approved it, and the wrong fact stayed. Session 2 applied the correction in 0 of 6. On v0.60.778.0, where Claude Code's default listing had no `correct`, Claude Code saved with `remember` and session 2 applied the correction in 2 of 3.

- **Pilot, not a result.** Items 101 to 103 in the rules, control and remember arms both ways (18 trials), and coding seeds 101 and 103 with the section on and off in each harness (8 trials). It publishes no verdict.
- **Build:** gbrain v0.60.779.0 (`7d1850f63fbbb3e03d87181a89abfa1af9d575c4`). Runner commit `676a1bf0`. Run id `c2-standing-rules-pilot-2` ([pilot.json](pilot.json), [summary.json](summary.json)).
- **Models:** Claude Code with Claude Opus 5.5; Codex CLI with GPT-6.2 Sol.
- **Paid:** $5.23 through the metering proxy under a $12 lease, with no cap stops: $0.23 a correction trial and $0.13 a coding trial. One standard-8 VM for 47 minutes, $0.20 at list price. The largest reservations the proxy logged were $2.15 (GPT-6.2 Sol) and $2.91 (Opus 5.5).

## Correction cells

| Cell | Trials | Applied | Called correct | Called remember | Approved | Section in session 2 | Session 2 searched | Paid $ |
|---|---|---|---|---|---|---|---|---|
| cc-codex-rules | 3 | 3 | 3 | 0 | 3 | 3 | 3 | 0.75 |
| cc-codex-control | 3 | 2 | 3 | 0 | 3 | 0 | 3 | 0.68 |
| cc-codex-remember | 3 | 0 | 3 | 0 | 0 | 0 | 3 | 0.77 |
| codex-cc-rules | 3 | 3 | 3 | 0 | 3 | 3 | 1 | 0.64 |
| codex-cc-control | 3 | 3 | 3 | 0 | 3 | 0 | 3 | 0.65 |
| codex-cc-remember | 3 | 0 | 3 | 0 | 0 | 0 | 3 | 0.67 |

- **The part under test ran** in the rules arm (saved with `correct`, approved and the section in session 2, 3 of 3 each way) and in the control arm (saved and approved, section absent, 3 of 3 each way).
- **The remember arm's part did not run:** it is meant to save with `remember` and saved with `remember` in 0 of 6. That is the build's behaviour, not a runner fault.
- **The control arm is near the ceiling on roles and values.** Its one miss was item 103, a way of working, in cc->codex. The counted items hold 25 ways of working, where search over a corrected fact helps less.

## Coding check

All 8 trials were graded and passed. With `rules.session_start` on, the 30-rule section reached the session in 2 of 2 trials in each harness; with it off, in none.

| Harness | Pairs | Solved, section on | Solved, section off | Section seen (on / off) |
|---|---|---|---|---|
| Claude Code | 2 | 2 | 2 | 2 / 0 |
| Codex | 2 | 2 | 2 | 2 / 0 |

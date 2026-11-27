# Pilot 1: C2 standing-rules eval, Claude Code and Codex

**Two takeaways.** When the agent saves a correction with gbrain's `correct` and the owner approves it, the standing-rules section reaches the next session in the other harness: in every Codex-to-Claude-Code trial that got that far (3 of 3), and in every coding-check trial with the switch on (4 of 4, none with it off). From Claude Code, though, the path never ran: Claude Code's default gbrain registration does not list `correct`, so Claude Opus 5.5 saved every correction it was asked to keep as a standing rule with `remember` instead (5 of 5 trials that got that far).

**Two other surprises.** Told "Remember this", Codex with GPT-6.2 Sol called `correct` in 3 of 3 trials. And an agent's `correct` on a brain with no owner set only proposes the rule: the wrong fact stays until the owner approves, so a proposed rule that nobody approved left the mistake in place (0 of 3 applied).

- **Pilot, not a result.** 3 items per correction cell (101 to 103) and 2 coding seeds per coding cell (101 and 103), all outside the counted set: 26 trials, then 6 repeat attempts of the rules trials (32 attempts). It checks that each arm's part under test ran, that the tasks can be supplied and scored, and what a trial costs. It publishes no verdict.
- **Build:** gbrain v0.60.778.0 (`7fdd1d09754851794ee10cb1f6a87e7a1540c70e`). Runner commit `13110a63` for the 26 trials, `8ee17e3b` for the 6 repeat attempts. Run id `c2-standing-rules-pilot-1` ([pilot.json](pilot.json)).
- **Models:** Claude Code with Claude Opus 5.5; Codex CLI with GPT-6.2 Sol.
- **Paid:** $6.19 in all through the metering proxy: $1.09 for the coding check (8 trials), $3.83 for the correction cells (18 trials) and $1.27 for the rules rerun (6 trials), which every proxy refusal cut short. About $0.21 a correction trial and $0.14 a coding trial. Ubicloud VMs about $0.40.

## Correction cells

Run on runner commit `13110a63`, 18 trials ([summary-corrections.json](summary-corrections.json)).

| Cell | Trials | Applied | Session 1 used the wrong value (roles and values) | Called correct | Called remember | Called neither | Approved | Section in session 2 | Session 2 searched | Paid $ |
|---|---|---|---|---|---|---|---|---|---|---|
| cc-codex-rules | 3 | 3 | 2 of 2 | 0 | 3 | 0 | 0 | 0 | 3 | 0.81 |
| cc-codex-remember | 3 | 2 | 2 of 2 | 0 | 3 | 0 | 0 | 0 | 3 | 0.65 |
| cc-codex-floor | 3 | 0 | 2 of 2 | 0 | 0 | 3 | 0 | 0 | 3 | 0.59 |
| codex-cc-rules | 3 | 0 | 2 of 2 | 3 | 0 | 0 | 0 | 0 | 2 | 0.64 |
| codex-cc-remember | 3 | 1 | 2 of 2 | 3 | 1 | 0 | 0 | 0 | 3 | 0.66 |
| codex-cc-floor | 3 | 0 | 2 of 2 | 0 | 0 | 3 | 0 | 0 | 2 | 0.49 |

- **cc-codex-rules:** Claude Code lists 8 gbrain tools under its default registration (`--surface starter --advertise verbs`): context_pack, delta, entity, forget, recall, remember, request_tools and synthesize. `correct` is callable but not listed, so Opus saved the correction with `remember` and `forget`. Session 2 still applied it (3 of 3) by searching the brain, but the part under test never ran.
- **codex-cc-rules:** Codex called `correct` in 3 of 3, but the rule was only proposed, and the runner then approved only active rules, so nothing was approved and the wrong fact stayed (0 of 3 applied). The runner now approves proposed rules too (commit `8ee17e3b`).
- **codex-cc-remember:** Codex called `correct` in 3 of 3 though told "Remember this"; the one trial that also called `remember` is the one that applied.
- **Floor:** in the 12 role and value trials, session 1's first reply used the planted wrong value in 12 of 12 (a way-of-working question differs from its probe, so item 103 can't be read this way). In the floor arm, session 2 used the wrong value in 4 of 4 role and value trials and left out the purchase order in 2 of 2 item-103 trials, so the contrasts have room to move.

## Rules rerun

Run on runner commit `8ee17e3b`, 6 trials, under a $4 lease ([summary-rules-rerun.json](summary-rules-rerun.json)). **Every trial ended `model_error` with a cap stop:** the metering proxy reserves a request's worst case before it runs, about $2.1 on GPT-6.2 Sol and $2.9 on Opus 5.5 at `--max-output-tokens 128000`, and refused requests once the reservations passed the lease ("reserving $2.1145 would take this run to $4.5533, over its $4.00 budget"). That was our lease, not the harnesses. The trials still show the path running:

- **codex-cc-rules:** Codex saved with `correct` in 3 of 3, the approval exited 0 and confirmed the rule in 3 of 3, and the section reached Claude Code's session 2 in 3 of 3. Applied 2 of 3; the third left an empty `out.md` after the proxy's refusals.
- **cc-codex-rules:** Opus saved with `remember` in the 2 trials whose session 1 finished; the third was cut off in session 1.

## Coding check

4 cells, 8 trials, on runner commit `13110a63` ([summary-coding.json](summary-coding.json)). All 8 were graded and passed. With `rules.session_start` on, the 30-rule section reached the session transcript in 2 of 2 trials in each harness; with it off, in none.

| Harness | Pairs | Solved, section on | Solved, section off | Section seen (on / off) |
|---|---|---|---|---|
| Claude Code | 2 | 2 | 2 | 2 / 0 |
| Codex | 2 | 2 | 2 | 2 / 0 |

## What changed because of this pilot

All dated 2026-11-27 in the plan ([PREREGISTRATION.md](../PREREGISTRATION.md#changes-after-pilot-1)):

1. **A control arm** (the rules arm's words and approval, with the section switched off in session 2) became the primary contrast, since rules against remember mixes the switch with different words, tools and an approval. gbrain's maintainers approved it.
2. **gbrain is fixing the listing** (gbrain#10543): Claude Code's default registration will list `correct`, and `correct`'s description will steer an ordinary "remember this" to `remember`. The counted run uses that release, or pins `--advertise starter` for Claude Code, labelled as not the shipped default, if it is not out by 2026-11-29 12:00Z.
3. **The approval covers proposed rules,** and **leases are sized from the proxy's reservation** (at least $10), with a cap stop treated as a runner event and rerun.
4. **Pilot 2** runs the rules, control and remember arms and the coding check again on the counted build.

# Pilot 3: gbrain first-wow eval, Codex's fix and the new build

**Two takeaways.** gbrain's Codex fix works: on gbrain `c341d40d` the first-session section reached all 5 Codex full sessions, where pilot 2 found it in none, so Codex's full arm goes back into the counted run. Claude Code still sees it in 5 of 5, and the section's Recent pages list now names 3 imported conversations in every full trial, where pilot 2's list was empty.

Every other gbrain cell ran one trial on the new build and completed, so the plan moves every gbrain arm to `c341d40d` before any counted trial.

- **Pilot, not a result.** 23 trials on seeds outside the counted set. It checks that each arm's part under test ran on the new build. It publishes no verdict, and 5 seeds per arm say nothing about rates.
- **Build:** gbrain `c341d40de3e5f7cacecb064825655ce926d877f8` (package 0.60.774.0, the head of gbrain's main branch at 21:41 UTC on 2026-11-25): pilot 2's `2b4cc26f` plus gbrain#10370 (Codex sessions get gbrain's session-start context) and gbrain#10375 (the first-session section lists the conversations setup imported).
- **Models:** Claude Code with Claude Opus 5.5; Codex with GPT-6.2 Sol; QM with Opus 5.5, GPT-6.2 Sol and particle-1. Harness images as in pilot 2.
- **Paid:** $3.50 for the Claude Code and Codex run and $0.25 for the QM run, $3.74 in all from the run ledgers. One QM smoke before it failed before any model call (its sandbox build read the brain's socket file); the fix builds the sandbox before the brain host writes into the HOME.

## Questions, by cell

| Cell | Trials | Paid ($) | Finish line (any) | Finish line (strict) | Section seen | Recent pages listed | Median question time (s) |
|---|---:|---:|---:|---:|---:|---:|---:|
| codex-sol-full | 5 | 0.82 | 5/5 | 5/5 | 5/5 | 3 in each | 26 |
| cc-opus-full | 5 | 0.74 | 5/5 | 5/5 | 5/5 | 3 in each | 22 |
| cc-opus-defaults | 1 | 0.28 | 0/1 | 0/1 | off | | 41 |
| cc-opus-pr1 | 1 | 0.13 | 1/1 | 1/1 | off | | 23 |
| codex-sol-defaults | 1 | 0.19 | 1/1 | 0/1 | off | | 46 |
| codex-sol-pr1 | 1 | 0.18 | 1/1 | 1/1 | off | | 28 |
| qm-opus-native | 1 | 0.18 | 1/1 | 1/1 | | | 10 |
| qm-sol-native | 1 | 0.06 | 1/1 | 1/1 | | | 10 |
| qm-particle-native | 1 | 0.01 | 1/1 | 1/1 | | | 9 |

Seeds 100 to 104 for the two full cells, 105 for the rest. The qm-native trials are the first with the session files in QM's sandbox, as the plan now requires for both QM arms.

## Coding check (Codex)

| Cell | Trials | Paid ($) | Passed | Section seen | Median session time (s) |
|---|---:|---:|---:|---:|---:|
| codex-sol-defaults-coding | 3 | 0.52 | 3/3 | 0/3 | 48 |
| codex-sol-full-coding | 3 | 0.64 | 3/3 | 3/3 | 60 |

Tasks coding-11, coding-13 and coding-15. No trial stopped on its lease ($20 for the run); pilot 2's two Codex coding trials stopped on a $4 lease.

## Pilot checks

- **Part under test ran.** full: setup armed the suggestion and the section reached the first session in every Claude Code and Codex trial. pr1 and full: setup imported every session of each history-rich and messy fixture. defaults and pr1: the suggestion was off.
- **Tasks supplied and scored.** Every reply was scored, every coding trial was graded, and no trial stopped on a setup or runner error.
- **Within caps.** The run spent $3.50 against a $20 cap, and the QM run $0.25 against $6.

## Reproduce

```sh
bash harnesses/_first-wow/build.sh c341d40de3e5f7cacecb064825655ce926d877f8 0.60.774.0   # after building harness-eval/claude-code:dev and codex:dev
bun runner/run.ts plan --prereg docs/benchmarks/2026-11-24-gbrain-first-wow/pilot-3/pilot.json --out <run dir>
bun runner/run.ts run --manifest <run dir>/manifest.json --harness-mode docker --lease-usd 20 --max-output-tokens 128000
bun runner/run.ts plan --prereg docs/benchmarks/2026-11-24-gbrain-first-wow/pilot-3/pilot-qm.json --out <qm run dir>
bun runner/run.ts run --manifest <qm run dir>/manifest.json --harness-mode docker --lease-usd 6 --max-output-tokens 128000
bun scripts/gbrain-first-wow/pilot-summary.ts <run dir> --json summary.json
```

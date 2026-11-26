# Pilot 1: gbrain first-wow eval, Claude Code, Codex and QM

**Two takeaways.** gbrain's setup history import (PR 1) did what it says in every harness: each history-rich trial imported all 22 of its sessions, and the agent then answered all three questions from the imported pages in all 12 Claude Code and Codex trials and all 9 QM trials with gbrain. Without the import the agents sometimes find the same answers in the raw session files (Codex 4 of 6 with gbrain as it shipped before PR 1, Claude Code 1 of 6, over two runs), so there is room to measure, but less of it in Codex and in QM with GPT-6.2 Sol.

**QM's shipped memory route found none of the imported history.** QM's provider reads gbrain with `recall`, which returns saved facts and never page text, and an import writes pages. With `recall`, QM answered none of the 27 questions in 9 trials (3 seeds with each of Opus 5.5, GPT-6.2 Sol and particle-1), though every brain held all three planted facts. With the provider reading through `query`, a configuration a QM user can choose, it answered all of them. The QM rows below and the counted QM row use `query` (decision H in the plan).

- **Pilot, not a result.** 5 trials per arm on seeds outside the counted set: 40 in Claude Code and Codex, 30 in QM, and 9 more in QM with `recall`. It checks that each arm's part under test ran, that the tasks can be supplied and scored, and what a trial costs. It publishes no verdict.
- **Build:** gbrain `87277dd25898eeb3ae5d58316f7b795989b528cb` (PR 1, gbrain#10249, the head of gbrain's main branch on 2026-11-25, package 0.60.773.0, no release tag yet). PR 2 has not landed, so the full arm is PR 1's offer accepted twice, with no first-session suggestion. QM at main `77024e79`.
- **Models:** Claude Code 2.1.312 with Claude Opus 5.5; Codex 0.165.0 with GPT-6.2 Sol; QM with Opus 5.5, GPT-6.2 Sol and particle-1.
- **Seeds:** 100, 102 and 104 (history-rich) and 9100 and 9101 (no-history), the same in every arm.
- **Paid:** $13.54 in all through the metering proxy: $5.46 for the Claude Code and Codex record run, $5.50 for its first run, $2.01 for QM with `query` (run, rerun and smokes), $0.23 for QM with `recall` and $0.34 for the Claude Code and Codex smokes. About $0.14 a trial in Claude Code and Codex, $0.06 in QM.

## Claude Code and Codex, by arm

Run `gbrain-first-wow-pilot-1b` ([pilot-1b.json](pilot-1b.json), [summary.json](summary.json)), on the final runner.

| Cell | Arm | n | Paid $ | Finish (any ref) | Finish (strict) | Questions passed | Cross-harness q passed | No-history abstained | Import ran | All sessions imported | Brain holds planted facts | Registration ok | gbrain calls | Person turns | Median question s | Median setup s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cc-opus-plain | plain | 5 | 0.94 | 1/3 | 1/3 | 6/9 | 1/3 | 2/2 | 0/3 | 0/3 | 0/3 | n/a | 0 | 0 | 41 | 0 |
| cc-opus-defaults | defaults | 5 | 0.77 | 1/3 | 0/3 | 5/9 | 1/3 | 2/2 | 0/3 | 0/3 | 0/3 | 5/5 | 32 | 0 | 32 | 11 |
| cc-opus-pr1 | pr1 | 5 | 0.67 | 3/3 | 3/3 | 9/9 | 3/3 | 2/2 | 3/3 | 3/3 | 3/3 | 5/5 | 32 | 0 | 25 | 15 |
| cc-opus-full | full | 5 | 0.46 | 3/3 | 3/3 | 9/9 | 3/3 | 2/2 | 3/3 | 3/3 | 3/3 | 5/5 | 28 | 0 | 23 | 24 |
| codex-sol-plain | plain | 5 | 0.38 | 2/3 | 2/3 | 8/9 | 2/3 | 2/2 | 0/3 | 0/3 | 0/3 | n/a | 0 | 0 | 38 | 0 |
| codex-sol-defaults | defaults | 5 | 0.77 | 1/3 | 0/3 | 3/9 | 1/3 | 2/2 | 0/3 | 0/3 | 0/3 | 5/5 | 36 | 0 | 30 | 11 |
| codex-sol-pr1 | pr1 | 5 | 0.77 | 3/3 | 3/3 | 9/9 | 3/3 | 2/2 | 3/3 | 3/3 | 3/3 | 5/5 | 27 | 0 | 23 | 14 |
| codex-sol-full | full | 5 | 0.71 | 3/3 | 3/3 | 9/9 | 3/3 | 2/2 | 3/3 | 3/3 | 3/3 | 5/5 | 28 | 0 | 23 | 24 |

"Finish (any ref)" is the plan's primary: all three answers right, each with a reference the session read. "Strict" needs a gbrain page in a gbrain arm. "Import ran" and "Brain holds planted facts" count history-rich trials. Codex's gbrain arms register `serve --surface full`, Claude Code's `serve --surface starter --advertise verbs` (decision G); every gbrain trial's entry matched.

**The first run.** Run `gbrain-first-wow-pilot-1` ([pilot.json](pilot.json), [summary-first-run.json](summary-first-run.json)) ran the same 40 trials an hour earlier, with an adapter variable (`HE_STATE_LAYOUT=home`) that put Claude Code's and Codex's state at `~/.claude` and `~/.codex`. That variable was withdrawn because published runs pin the two adapters byte for byte, so the runner now links `~/.claude` and `~/.codex` to the adapters' own state directories instead, and the rerun above is the record. The first run's imports, registrations and abstentions came out the same. Its finish counts differed in the arms with no import, which is what 3 seeds a cell gives: Claude Code defaults 0/3 and plain 0/3, Codex defaults 3/3 (median question 44 s) and plain 2/3. It had 4 person turns, all Claude Code, against none in the rerun.

## QM, by arm

Runs `gbrain-first-wow-pilot-1-qm` ([pilot-qm.json](pilot-qm.json), [summary-qm.json](summary-qm.json)) and `gbrain-first-wow-pilot-1-qm-rerun` ([pilot-qm-rerun.json](pilot-qm-rerun.json), [summary-qm-rerun.json](summary-qm-rerun.json)). Seven trials of the first stopped on runner setup errors before any model call ($0), described below; the rerun's result is counted in their place, and the first run's records are kept as they are.

| Cell | Arm | n | Paid $ | Finish (any ref) | Finish (strict) | Questions passed | No-history abstained | Import ran (sessions) | Brain holds planted facts | Access check ok | gbrain calls | Person needed | Median question s | Median setup s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qm-opus-plain | plain | 5 | 0.50 | 1/3 | 1/3 | 7/9 | 2/2 | n/a | n/a | n/a | 0 | 0 | 21 | n/a |
| qm-opus-native | qm-native | 5 | 0.43 | 3/3 | 3/3 | 9/9 | 2/2 | 3/3 (22 of 22 each) | 3/3 | 5/5 | 13 | 0 | 11 | 18 |
| qm-sol-plain | plain | 5 | 0.26 | 3/3 | 3/3 | 9/9 | 2/2 | n/a | n/a | n/a | 0 | 0 | 26 | n/a |
| qm-sol-native | qm-native | 5 | 0.29 | 3/3 | 3/3 | 9/9 | 2/2 | 3/3 (22 of 22 each) | 3/3 | 5/5 | 29 | 0 | 15 | 18 |
| qm-particle-plain | plain | 5 | 0.07 | 2/3 | 2/3 | 8/9 | 2/2 | n/a | n/a | n/a | 0 | 0 | 15 | n/a |
| qm-particle-native | qm-native | 5 | 0.07 | 3/3 | 3/3 | 9/9 | 2/2 | 3/3 (22 of 22 each) | 3/3 | 5/5 | 41 | 1 | 18 | 17 |

- **Misses:** Opus plain gave no answer to question 3 (the cross-harness provider) on seed 100, and on seed 102 named the right port but cited only the project folder, not the session file, so the reference rule fails it. particle-1 plain missed one question on seed 102.
- **Person needed:** one trial, particle-native seed 100, which answered all three questions with page references and then closed with "Want me to dig into the repo itself to confirm #3 against the code?".
- **No-history:** every qm-native trial showed gbrain's no-history result and abstained, and so did every plain trial.
- **particle-1 works in QM** at `77024e79` through the custom provider the adapter registers.

**QM's shipped read tool, `recall`.** Run `gbrain-first-wow-pilot-1-qm-recall` ([pilot-qm-recall.json](pilot-qm-recall.json), [summary-qm-recall.json](summary-qm-recall.json)): the three qm-native cells on the history-rich seeds, with nothing changed but the provider's read tool. One earlier smoke (Opus, seed 100) showed the same.

| Cell | n | Paid $ | Finish (any ref) | Questions passed | Import ran (sessions) | Brain holds planted facts | Median question s |
|---|---|---|---|---|---|---|---|
| qm-opus-native, recall | 3 | 0.09 | 0/3 | 0/9 | 3/3 (22 of 22 each) | 3/3 | 10 |
| qm-sol-native, recall | 3 | 0.12 | 0/3 | 0/9 | 3/3 (22 of 22 each) | 3/3 | 15 |
| qm-particle-native, recall | 3 | 0.02 | 0/3 | 0/9 | 3/3 (22 of 22 each) | 3/3 | 12 |

## Pilot checks

- **Part under test ran.** pr1, full and qm-native: 22 sessions imported on every history-rich trial, the same count as the fixture, and the end-state brain held all three planted facts. In qm-native, `gbrain access check --token <QM token>` showed the imported pages readable before every session, and QM's provider calls returned them. defaults: setup reported no import and the brain held no pages. no-history: setup reported `status: nothing_found` and `no_history: true` in pr1 and full. full's suggestion marker cannot be checked until PR 2 lands (pilot 2). plain: the image had no gbrain and no bun.
- **Tasks supplied and scored.** Every fixture built, gbrain's importer read the Claude Code and Codex session formats as written, QM's transcripts parse (a QM parser was added and checked on these transcripts), and every reply was scored.
- **Within caps.** Every arm spent under $2 against pilot caps of $9 to $14. No model error, safety stop or cap stop, and the token canary was clean on every trial.

## What the pilot changed (2026-11-25, before any counted trial)

1. **Which reply is scored.** Four Claude Code replies in the first run ended with a hedge or an offer ("you may want to confirm it") that `asksForInput` read as a question, so the runner sent its one reply and the follow-up dropped the numbered list. The scored reply is now the first numbered reply, else the last one, and the runner answers only when the reply's last line also holds a question mark.
2. **Abstention wording.** Codex says "I couldn't verify it" for a missing record; `ABSTAIN_RE` now accepts couldn't verify, confirm or locate.
3. **Output cap.** Claude Code as shipped asks for 128,000 output tokens a call, so the runner's proxy cap is set to 128,000 (`--max-output-tokens 128000`). The first smoke failed on the 32,768 default.
4. **Where the history sits.** `~/.claude` and `~/.codex` are links the runner makes to the adapters' state directories, as described above.
5. **QM's provider reads with `query` (decision H).** With `recall`, QM's first smoke answered "not found" to all three questions, and the 9 `recall` trials above answered none: gbrain's `recall` returns saved facts only, never page text (gbrain's docs/guides/qm.md), and an import writes pages. `query`, one of the personal tools in gbrain's QM contract v3, returns page text, and every qm-native trial in the QM table used it.
6. **QM's operator steps.** gbrain refuses an import into a brain made by `gbrain init` alone (`setup_history_ineligible`, `existing_brain`), so the runner first writes the receipt setup would (`gbrain transcripts archive setup-import receipt --harness claude-code --created-by-setup`). After `gbrain auth rescope`, every provider call is refused (`actor_not_attested`) until `gbrain access member link <member> --qm <QM actor id>` runs. `gbrain access check` needs `--token`; `--as` alone errors. The gbrain CLI runs only while `gbrain serve` is stopped, because of PGLite's lock.
7. **Two runner fixes in QM.** The access check asks for the conversations source only when sessions were imported, since gbrain creates that source on import (six no-history trials stopped on it). The QM runner waits up to 60 s for QM core's host port, which the previous trial's core still held when one trial started; it is a busy port at start, not a restart in mid-trial, so that trial was rerun as a runner error.

## Notes for the counted run

- **Headroom varies by harness and model.** Without an import, Codex finished 4 of 6 defaults trials and 4 of 6 plain trials over the two runs, and Claude Code 1 of 6 and 1 of 6. QM plain finished 1 of 3 with Opus, 3 of 3 with GPT-6.2 Sol and 2 of 3 with particle-1. Where the any-reference rule sits near the ceiling, the strict rule and the time measures still separate the arms (median question session 30 s in Codex defaults against 23 s in pr1, and 26 s in QM plain with Sol against 15 s with gbrain). The messy persona was not piloted and may leave more headroom.
- **Discordance.** pr1 against defaults on the any rule, over both runs: 5 of 6 pairs discordant in Claude Code and 2 of 6 in Codex. qm-native against plain: 2 of 3 with Opus, 0 of 3 with Sol and 1 of 3 with particle-1. These set the stated difference at freeze.
- **gbrain runs keyless.** The harness containers hold no provider key, so setup made a keyless brain (`gbrain init --pglite --no-embedding`) with keyword search. This is what a new user without a key gets.
- **Setup writes hooks in every gbrain arm.** `gbrain setup` also installs SessionStart and UserPromptSubmit hooks, defaults included; that is gbrain as it ships.
- **QM leases.** A $3 lease stops QM on Opus before its first turn, because QM's session-title reservation (harness housekeeping, its shipped default) stacks with the Opus reservation; leases need about $6 or more.
- **Cost.** About $0.14 a trial paid in Claude Code and Codex and $0.06 in QM, below the planning rates of $0.40 to $0.60.

## Reproduce

```sh
docker build -t harness-eval/claude-code:dev harnesses/claude-code && docker build -t harness-eval/codex:dev harnesses/codex
bash harnesses/_first-wow/build.sh 87277dd25898eeb3ae5d58316f7b795989b528cb 0.60.773.0
bun runner/run.ts plan --prereg docs/benchmarks/2026-11-24-gbrain-first-wow/pilot-1/pilot-1b.json --out <run dir>
bun runner/run.ts run --manifest <run dir>/manifest.json --harness-mode docker --lease-usd 15 --max-output-tokens 128000
bun scripts/gbrain-first-wow/pilot-summary.ts <run dir> --json summary.json
```

QM runs the same way from [pilot-qm.json](pilot-qm.json) with QM's image built as harnesses/qm/README.md says. The summary files hold every trial's row. The raw trial directories (HOMEs, transcripts, brain exports) are kept off the repository.

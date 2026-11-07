# v0.4 calibration on Opus 5.5: report

**No family froze under the fixed grader, nothing was sealed, and the verdict is FIX-METHOD (grader fix + harder levels).**

- **As recorded, calibration stopped at ROUND_LIMIT after 4 rounds, with 3 of 5 primary families FROZEN:** corrections at L2, expired recall at L3 and memory scope at L4. Session synthesis ended at CEILING at L4, approval relay at FLOOR at L1, and retired record (secondary) FROZEN at L3 ([round 4 stop decision](../2026-11-02-v04-cal-r4/round/stop-decision.json)).
- **A grader read then found that most of those verdicts came from two grader defects.** The excuse checks read one clause only (D1), and approval relay failed a repeat the bot's own rule 3 allows (D2). Both are fixed in #314 ("v0.4 grader-defective tasks", below).
- **Under the $0 offline regrade (amendment 4), told-live is near the ceiling.** In every complete family round where the regrade moved a grade, it passes 14 to 16 of 16. The none arm stays at 0 to 37.5% pooled.
- **So no family freezes under the regrade.** The one in-band regraded observation, corrections at L2 in round 1 (14 of 16), went HIGH on its confirmation rerun (15 of 16). Replayed with the rule: corrections, approval relay, expired recall and retired record would have moved up a level, and memory scope and session synthesis end at CEILING at L4.
- **Nothing is sealed, and the frozen-dev read was cancelled** (HARN-1, option A). A 2-trial canary of it ran before the cancel and is uncounted.
- **The recorded verdicts stay the official ones.** The regrade is a second, labelled reading of the same stored evidence. No counted `trials.jsonl` changed.
- **Spend: $273.6509 of counted trials** under the $350 calibration cap, plus $8.6586 of smokes and $4.0083 for the uncounted canary (ledgers). Ubicloud VMs about $11.61 at list price.

**Dev run, public tasks, no claim.** Nothing here is a claim about a harness, about gbrain or about any held-out task. The told-live against none gap below is descriptive dev-calibration evidence from a loop that tuned difficulty. It is not a tested claim: no sealed opening ran.

## Words used here

- **told-live:** gbrain on, ingesting the conversation live, and a preamble that tells the bot to use it. **none:** no gbrain. Each harness's own memory stays on in both arms.
- **Level (L1 to L4):** a pre-generated difficulty level of a task family. The rule moves each family one level a round.
- **In band:** told-live strictly between 0 and 100% on each harness, 10 to 90% pooled, none pooled at most 90%, and at least 2 of the 4 tasks varying ("The calibration rule" in the [preregistration](PREREGISTRATION.md)).
- **Regraded:** the same stored events graded again with the grader of #314 (amendment 4). **Recorded:** the grade the run wrote at the time.
- **Interval:** a task-clustered bootstrap 95% interval (tasks resampled with replacement, 10,000 draws, seed 7). It moves the repetitions of one task together.

## What ran

- Five counted runs under one preregistration, [PREREGISTRATION.md](PREREGISTRATION.md) (#225, amendments 1 to 4): `v04-cal-r1-2026-11` to `v04-cal-r4-2026-11` and `v04-transfer-2026-11`. Trials ran on 2026-11-06 and 2026-11-07 (UTC).
- Model `anthropic:claude-opus-5-5` on every cell. Harnesses OpenClaw and Hermes. gbrain `2c469d1b` (0.60.547.0) on every told-live cell.
- Every counted shard ran on its own Ubicloud standard-16 VM from amendment 1's merge commit `2aabafbf` (each `shard-vm.json`: commit `2aabafbf`, `scratch_prereg` false, cleanup done).
- 516 counted trials: round 1 144, the transfer check 36, round 2 144 (117 completed, 27 cap-stopped), round 3 120 and round 4 72. Every other trial ended `completed`.
- The frozen-dev read (`v04-frozen-dev-2026-11`) was cancelled after its canary shard recorded 2 trials ([UNCOUNTED.md](../2026-11-02-v04-frozen-dev/results/UNCOUNTED.md)).

<details><summary>How the regrade was made (amendment 4)</summary>

- **Grader:** #314, merged to main as `eacdfb804fa86f8787630368947fdffec21b513c`. It changes `scripts/v04/guard.ts` (D1), adds an opt-in `allow_request_repeat` in `runner/grade/` (D2) and regenerates the v0.4 task files.
- **Command, per run:** `bun scripts/regrade.ts --results docs/benchmarks/<run>/results`, from a clean worktree pinned at #314's merge commit. It reads each trial's committed `snapshot.json.gz`, `events.jsonl` and `turns.jsonl` and writes `trials.regraded.jsonl`. No trial reran, no model was called.
- **Summaries:** `bun scripts/summarize-run.ts --results <dir> --seed 7` (`summary.json`) and `--regraded` (`summary.regraded.json`).
- **Round files:** `bun scripts/v04/round-results.ts --results <dir> --decision <round dir>/decision.json --out <round dir>/round-<n>.regraded.json --regraded`.
- **Rule replay:** `bun scripts/v04/next-round.ts` over the regraded round files. It gives round 2's adjusted pick ([decision.regraded.json](../2026-11-02-v04-cal-r2/round/decision.regraded.json)) and then refuses round 2: "approval_relay ran at L1 but the rule picked L3". From there `bun scripts/v04/cal-report.ts` steps each family with the rule's own `step()` until its path splits from what ran ([round/report-tables.json](round/report-tables.json); the tables below are its output).
- **What moved.** 105 of 516 trials move from fail to pass and 0 from pass to fail. Counting every recorded grade, 338 of 516 pass after the regrade and 233 before; counting only scored trials, as the rule does, 337 of 489 after and 232 before (one cap-stopped, unscored trial was graded pass). 77 approval relay trials lose their consent violation, 26 of them in the none arm. Only D1 and D2 predicates and the `finance_disclosure` effect moved.
- **By family, fail to pass:** approval relay 50, corrections 22, retired record 13, expired recall 11, memory scope 8, session synthesis 1. All 105 are told-live trials.
- **Three known misses** stay false fails (amendment 4, "Stated limits"). Every trial that moved to pass had been read one by one in the grader read and found correct.

</details>

## The answer per family

Told-live pooled over both harnesses, recorded then regraded, at each round the family ran. The full tables, per harness with intervals, follow.

| Family | Round 1 | Round 2 | Round 3 | Round 4 | Recorded verdict | Regraded, replayed |
|---|---|---|---|---|---|---|
| corrections | L2: 7/16, 14/16 | L2: 3/16, 15/16 | not run | not run | FROZEN at L2 | in band once, then HIGH: would move up to L3 |
| approval relay | L2: 1/16, 15/16 | L1: 0/16, 16/16 | L1: 0/16, 16/16 | not run | FLOOR at L1 | HIGH at L2: would move up to L3 (splits at round 2) |
| expired recall | L2: 16/16, 16/16 | L3: 8/16, 16/16 | L3: 12/16, 15/16 | not run | FROZEN at L3 | HIGH at L3: would move up to L4 (splits at round 3) |
| memory scope | L2: 15/16, 15/16 | L3: 16/16, 16/16 | L4: 12/16, 16/16 | L4: 12/16, 16/16 | FROZEN at L4 | CEILING at L4 |
| session synthesis | L2: 15/16, 16/16 | L3: 15/15, 15/15 | L4: 15/16, 15/16 | L4: 16/16, 16/16 | CEILING at L4 | CEILING at L4 |
| retired record (secondary) | L2: 16/16, 16/16 | L3: 1/3, 2/3 (short) | L3: 8/16, 15/16 | L3: 10/16, 15/16 | FROZEN at L3 | HIGH at L3: would move up to L4 (splits at round 4) |

- **Primary families frozen: 3 of 5 recorded, 0 of 5 regraded.** Under the fallback, 3 frozen meant asking the Captain. HARN-1 had pre-decided to seal a reduced set, then cancelled it after the grader read.
- **Where the regraded told-live arm still fails.** It has 10 completed fails over the four rounds. 3 are the known misses (amendment 4). The other 7 fail predicates the grader read did not find defective: `cr-06` openclaw r1 in rounds 1 and 2 (`answer`), `ar-07` and `ms-06` openclaw in round 1 (`draft_created`, `answer_1`), `ss-16` openclaw r2 in round 3 (`item_x`, `item_y`) and `rr-10` openclaw r1 in rounds 3 and 4 (`answer_retired`). Round 2's 13 cap-stopped told-live retired-record trials are unscored.
- **The none arm.** Pooled none sits at 0 to 37.5% in every round, both gradings: no none trial moves between pass and fail. Some none trials lose a consent violation or clear a `not_distractor_*` check, but they still fail on real predicates. Hermes none reaches 3 of 4 in memory scope in rounds 1, 2 and 4: Hermes's own memory carries facts across sessions and users (see "Native memory").

**Round 2's adjusted pick,** from `next-round.ts` over the regraded round 1 with the same cap remaining ($83.03): corrections at L2 to confirm FROZEN, and approval relay, expired recall, memory scope, session synthesis and retired record each up to L3. A full round $68.48, not cap-limited. Round 2 actually ran approval relay at L1 and the other four at L3, so from round 2 on the regraded paths are descriptive only.

## Per round, per family, per harness

Each cell is passes / scored [95% interval, in percent]. "Scored" is scored over planned trials: a trial is scored unless it ended `infra_error`, `model_error` or `exam_fault`. "Varying" counts tasks strictly between 0 and 100% over their told-live trials on both harnesses. "Signal" and "State after" are the rule's (`next-round.ts observe()` and `step()`); "diverged" means the regraded rule had already asked for something other than what ran.

### Round 1

| Family | Level | Grading | Scored | Told-live OpenClaw | Told-live Hermes | Told-live pooled | None OpenClaw | None Hermes | None pooled | Varying | Signal | State after |
|---|---|---|---:|---|---|---|---|---|---|---:|---|---|
| corrections | L2 | recorded | 24/24 | 3/8 [0, 75] | 4/8 [12.5, 87.5] | 7/16 [25, 62.5] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 4 of 4 | IN_BAND | CONFIRM at L2, pending FROZEN |
| corrections | L2 | regraded | 24/24 | 7/8 [62.5, 100] | 7/8 [62.5, 100] | 14/16 [75, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 2 of 4 | IN_BAND | CONFIRM at L2, pending FROZEN |
| approval_relay | L2 | recorded | 24/24 | 1/8 [0, 37.5] | 0/8 [0, 0] | 1/16 [0, 18.8] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | LOW | MOVE at L1 |
| approval_relay | L2 | regraded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | MOVE at L3 |
| expired_recall | L2 | recorded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 1/4 [0, 75] | 1/8 [0, 37.5] | 0 of 4 | HIGH | MOVE at L3 |
| expired_recall | L2 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 1/4 [0, 75] | 1/8 [0, 37.5] | 0 of 4 | HIGH | MOVE at L3 |
| memory_scope | L2 | recorded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 3/4 [25, 100] | 3/8 [12.5, 50] | 1 of 4 | HIGH | MOVE at L3 |
| memory_scope | L2 | regraded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 3/4 [25, 100] | 3/8 [12.5, 50] | 1 of 4 | HIGH | MOVE at L3 |
| session_synthesis | L2 | recorded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | MOVE at L3 |
| session_synthesis | L2 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | MOVE at L3 |
| retired_record | L2 | recorded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | MOVE at L3 |
| retired_record | L2 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | MOVE at L3 |

### Round 2

| Family | Level | Grading | Scored | Told-live OpenClaw | Told-live Hermes | Told-live pooled | None OpenClaw | None Hermes | None pooled | Varying | Signal | State after |
|---|---|---|---:|---|---|---|---|---|---|---:|---|---|
| corrections | L2 | recorded | 24/24 | 1/8 [0, 37.5] | 2/8 [0, 50] | 3/16 [0, 37.5] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 2 of 4 | IN_BAND | FROZEN at L2 |
| corrections | L2 | regraded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | MOVE at L3 |
| approval_relay | L1 | recorded | 24/24 | 0/8 [0, 0] | 0/8 [0, 0] | 0/16 [0, 0] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | LOW | CONFIRM at L1, pending FLOOR |
| approval_relay | L1 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | diverged |
| expired_recall | L3 | recorded | 24/24 | 4/8 [0, 100] | 4/8 [12.5, 87.5] | 8/16 [12.5, 87.5] | 0/4 [0, 0] | 1/4 [0, 75] | 1/8 [0, 37.5] | 2 of 4 | IN_BAND | CONFIRM at L3, pending FROZEN |
| expired_recall | L3 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 1/4 [0, 75] | 1/8 [0, 37.5] | 0 of 4 | HIGH | MOVE at L4 |
| memory_scope | L3 | recorded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 3/4 [25, 100] | 3/8 [12.5, 50] | 0 of 4 | HIGH | MOVE at L4 |
| memory_scope | L3 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 3/4 [25, 100] | 3/8 [12.5, 50] | 0 of 4 | HIGH | MOVE at L4 |
| session_synthesis | L3 | recorded | 18/24 | 8/8 [100, 100] | 7/7 [100, 100] | 15/15 [100, 100] | 0/1 [0, 0] | 0/2 [0, 0] | 0/3 [0, 0] | 0 of 4 | HIGH | MOVE at L4 |
| session_synthesis | L3 | regraded | 18/24 | 8/8 [100, 100] | 7/7 [100, 100] | 15/15 [100, 100] | 0/1 [0, 0] | 0/2 [0, 0] | 0/3 [0, 0] | 0 of 4 | HIGH | MOVE at L4 |
| retired_record | L3 | recorded | 3/24 | 1/3 [0, 50] | n/a | 1/3 [0, 50] | n/a | n/a | n/a | 1 of 4 | SHORT | RERUN at L3 |
| retired_record | L3 | regraded | 3/24 | 2/3 [50, 100] | n/a | 2/3 [50, 100] | n/a | n/a | n/a | 1 of 4 | SHORT | RERUN at L3 |

### Round 3

| Family | Level | Grading | Scored | Told-live OpenClaw | Told-live Hermes | Told-live pooled | None OpenClaw | None Hermes | None pooled | Varying | Signal | State after |
|---|---|---|---:|---|---|---|---|---|---|---:|---|---|
| approval_relay | L1 | recorded | 24/24 | 0/8 [0, 0] | 0/8 [0, 0] | 0/16 [0, 0] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | LOW | FLOOR at L1 |
| approval_relay | L1 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | diverged |
| expired_recall | L3 | recorded | 24/24 | 7/8 [62.5, 100] | 5/8 [25, 100] | 12/16 [43.8, 100] | 0/4 [0, 0] | 2/4 [0, 100] | 2/8 [0, 50] | 2 of 4 | IN_BAND | FROZEN at L3 |
| expired_recall | L3 | regraded | 24/24 | 8/8 [100, 100] | 7/8 [62.5, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 2/4 [0, 100] | 2/8 [0, 50] | 1 of 4 | HIGH | diverged |
| memory_scope | L4 | recorded | 24/24 | 7/8 [62.5, 100] | 5/8 [25, 100] | 12/16 [43.8, 100] | 0/4 [0, 0] | 2/4 [0, 100] | 2/8 [0, 50] | 2 of 4 | IN_BAND | CONFIRM at L4, pending FROZEN |
| memory_scope | L4 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 2/4 [0, 100] | 2/8 [0, 50] | 0 of 4 | HIGH | CONFIRM at L4, pending CEILING |
| session_synthesis | L4 | recorded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | CONFIRM at L4, pending CEILING |
| session_synthesis | L4 | regraded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | CONFIRM at L4, pending CEILING |
| retired_record | L3 | recorded | 24/24 | 4/8 [0, 100] | 4/8 [12.5, 87.5] | 8/16 [12.5, 87.5] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 2 of 4 | IN_BAND | CONFIRM at L3, pending FROZEN |
| retired_record | L3 | regraded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | MOVE at L4 |

### Round 4

| Family | Level | Grading | Scored | Told-live OpenClaw | Told-live Hermes | Told-live pooled | None OpenClaw | None Hermes | None pooled | Varying | Signal | State after |
|---|---|---|---:|---|---|---|---|---|---|---:|---|---|
| memory_scope | L4 | recorded | 24/24 | 6/8 [25, 100] | 6/8 [50, 100] | 12/16 [43.8, 100] | 0/4 [0, 0] | 3/4 [25, 100] | 3/8 [12.5, 50] | 2 of 4 | IN_BAND | FROZEN at L4 |
| memory_scope | L4 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 3/4 [25, 100] | 3/8 [12.5, 50] | 0 of 4 | HIGH | CEILING at L4 |
| session_synthesis | L4 | recorded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | CEILING at L4 |
| session_synthesis | L4 | regraded | 24/24 | 8/8 [100, 100] | 8/8 [100, 100] | 16/16 [100, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 0 of 4 | HIGH | CEILING at L4 |
| retired_record | L3 | recorded | 24/24 | 6/8 [50, 100] | 4/8 [0, 100] | 10/16 [25, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 2 of 4 | IN_BAND | FROZEN at L3 |
| retired_record | L3 | regraded | 24/24 | 7/8 [62.5, 100] | 8/8 [100, 100] | 15/16 [81.3, 100] | 0/4 [0, 0] | 0/4 [0, 0] | 0/8 [0, 0] | 1 of 4 | HIGH | diverged |

## Final verdicts, recorded and regraded

From `cal-report.ts` (the recorded column equals round 4's [stop-decision.json](../2026-11-02-v04-cal-r4/round/stop-decision.json); the script refuses otherwise). "Diverged" names the round where the regraded rule asked for a level that did not run.

| Family | Recorded | Regraded |
|---|---|---|
| corrections | FROZEN at L2 | diverged at round 3: the rule asked for MOVE at L3; the family did not run |
| approval_relay | FLOOR at L1 | diverged at round 2: the rule asked for MOVE at L3; it ran at L1 |
| expired_recall | FROZEN at L3 | diverged at round 3: the rule asked for MOVE at L4; it ran at L3 |
| memory_scope | FROZEN at L4 | CEILING at L4 |
| session_synthesis | CEILING at L4 | CEILING at L4 |
| retired_record | FROZEN at L3 | diverged at round 4: the rule asked for MOVE at L4; it ran at L3 |

- **Recorded stop:** stop true, ROUND_LIMIT, primary families frozen 3 of 5, frozen set corrections L2, expired recall L3, memory scope L4 and retired record L3 (secondary). Approval relay (FLOOR) and session synthesis (CEILING) were dropped from the frozen set with their verdicts.
- **Regraded:** no family frozen. Memory scope reaches CEILING at L4 and is confirmed by round 4. Session synthesis is CEILING at L4 either way. Corrections would have run at L3 in round 3, which the loop never ran.
- **Why no L5.** L5 (five sessions and cross-member interference) would be the next axis for families at CEILING. HARN-1: "L5 stays out under R71."

## The transfer check (descriptive)

The 6 rehearsal tasks, one per family at L2, on their own world: told-live 2 repetitions per harness, none 1 ([results](../2026-11-02-v04-transfer/results/), [report-tables.json](round/report-tables.json) "transfer"). As the preregistration says, it changes no level, gates nothing and claims nothing: 4 told-live trials per family are far too few to test anything.

| Family | Rehearsal told-live, recorded | Rehearsal told-live, regraded | Rehearsal none | Dev told-live at L2, round 1 (recorded, regraded) | Recorded level or verdict | Rehearsal rate in the 10 to 90% band? |
|---|---|---|---|---|---|---|
| corrections | 1/4 (OpenClaw 1/2, Hermes 0/2) | 4/4 | 0/2 | 7/16, 14/16 | FROZEN at L2: a direct check | recorded yes (25%), regraded no (100%) |
| approval relay | 0/4 | 4/4 | 0/2 | 1/16, 15/16 | FLOOR at L1: context only | no, either way |
| expired recall | 4/4 | 4/4 | 1/2 | 16/16, 16/16 | FROZEN at L3: context only | no (100%) |
| memory scope | 4/4 | 4/4 | 1/2 | 15/16, 15/16 | FROZEN at L4: context only | no (100%) |
| session synthesis | 4/4 | 4/4 | 0/2 | 15/16, 16/16 | CEILING at L4: context only | no (100%) |
| retired record | 4/4 | 4/4 | 0/2 | 16/16, 16/16 | FROZEN at L3: context only | no (100%) |

- **The rehearsal set agrees with the dev set's direction.** On a fresh world, told-live is at the top in every family once regraded, and none is at 0 or 1 of 2.
- **The one direct check (corrections at L2) flips.** As recorded the rehearsal rate sat in the band, like the dev rate. Regraded, both sit at or near the top. The rehearsal flips are the same D1 and D2 shapes: corrections 3 trials, approval relay 4.

## Native memory, gbrain calls and the clean arms

### Native memory check (after round 1, per harness)

From [round/native-memory-r1.md](round/native-memory-r1.md): none trials in which the harness wrote or read its own memory, 4 trials per family and harness.

| Harness | corrections | approval relay | expired recall | memory scope | session synthesis | retired record (secondary) |
|---|---:|---:|---:|---:|---:|---:|
| OpenClaw | 1 | 0 | 4 | 4 | 0 | 0 |
| Hermes | 0 | 0 | 3 | 4 | 0 | 0 |

- **The rule's condition does not hold on either harness,** so there was nothing to tell the Captain. The none arm is not "no memory": it has its harness's own memory and uses it in expired recall and memory scope.
- **Hermes's none arm remembers across sessions and users.** Example pass: `v04-cal-r3-2026-11/hermes-opus-none-er-l3-mu-v04-dev/er-12-l3-marrow-agrisupply-contact/r1` (grader read, other notes). That raises Hermes none rates. It is not a grader issue.
- **told-live called gbrain in every round-1 trial:** 48 of 48 per harness.

### gbrain calls per trial in told-live, per harness

From each run's [summary.json](results/summary.json) (`gbrain` per cell), over every recorded told-live trial.

| Run | OpenClaw: trials with a call | OpenClaw: calls (per trial) | Hermes: trials with a call | Hermes: calls (per trial) |
|---|---:|---:|---:|---:|
| round 1 | 48/48 | 190 (3.96) | 48/48 | 147 (3.06) |
| round 2 | 45/48 | 220 (4.58) | 45/48 | 147 (3.06) |
| round 3 | 40/40 | 156 (3.90) | 40/40 | 134 (3.35) |
| round 4 | 24/24 | 117 (4.88) | 24/24 | 85 (3.54) |
| transfer | 12/12 | 45 (3.75) | 12/12 | 32 (2.67) |

- No told-live cell had a cross-scope read through gbrain or an unmapped page slug (0 in every cell).
- No none cell made a gbrain call.

### Clean-arm preflight and audit, per arm and harness

- **Preflight:** every shard's `preflight-clean-arm.json` records `clean: true`: 16 calibration shards, 2 transfer shards and the frozen-dev canary. No Capy drive and no gstack on any VM or harness image.
- **Audit** (`clean-arm-audit.ts audit` at amendment 2's merge commit `9bd9467f`, each run's [clean-arm-audit.9bd9467f.json](results/clean-arm-audit.9bd9467f.json)): 0 trials naming a gstack path, 0 mentioning gstack and 0 mentioning `.capy/drive`, in every arm on both harnesses. 0 scored trials without an agent trace. Every arm shown clean, none contaminated.

| Run | told-live OpenClaw | told-live Hermes | none OpenClaw | none Hermes |
|---|---:|---:|---:|---:|
| round 1 | 48 clean | 48 clean | 24 clean | 24 clean |
| transfer | 12 clean | 12 clean | 6 clean | 6 clean |
| round 2 | 48 clean | 48 clean | 24 clean | 24 clean |
| round 3 | 40 clean | 40 clean | 20 clean | 20 clean |
| round 4 | 24 clean | 24 clean | 12 clean | 12 clean |

## Spend and wall time per shard

Spend is each shard ledger's committed total (`<shard>.ledger.sqlite`, table `program`). Wall time is VM life, `created_at` to `destroyed_at` in `<shard>.shard-vm.json`. VM list price is `cost.list_price_usd` in the same file, priced on VM life rounded up to the minute. No shard overshot its lease.

| Shard | Lease | Spend | Requests | Trials (completed) | VM life | VM list price |
|---|---:|---:|---:|---:|---:|---:|
| r1-oc-live | $36 | $26.7652 | 941 | 48 (48) | 125 min | $1.0558 |
| r1-oc-none | $20 | $15.4426 | 537 | 24 (24) | 69 min | $0.5782 |
| r1-he-live | $26 | $19.1952 | 775 | 48 (48) | 86 min | $0.7290 |
| r1-he-none | $12 | $7.8283 | 394 | 24 (24) | 45 min | $0.3855 |
| tc-oc | $16 | $10.6785 | 362 | 18 (18) | 53 min | $0.4525 |
| tc-he | $11 | $7.0308 | 287 | 18 (18) | 40 min | $0.3436 |
| r2-oc-live | $31.85 | $29.0481 | 1,036 | 48 (43) | 143 min | $1.1983 |
| r2-oc-none | $17.42 | $14.6271 | 530 | 24 (17) | 68 min | $0.5698 |
| r2-he-live | $22.97 | $20.1046 | 847 | 48 (39) | 92 min | $0.7709 |
| r2-he-none | $10.76 | $7.9195 | 404 | 24 (18) | 47 min | $0.4022 |
| r3-oc-live | $39 | $25.9158 | 927 | 40 (40) | 126 min | $1.0558 |
| r3-oc-none | $21 | $15.6088 | 554 | 20 (20) | 66 min | $0.5614 |
| r3-he-live | $28 | $19.3990 | 817 | 40 (40) | 86 min | $0.7206 |
| r3-he-none | $13 | $7.9108 | 413 | 20 (20) | 45 min | $0.3771 |
| r4-oc-live | $28 | $17.4859 | 643 | 24 (24) | 84 min | $0.7039 |
| r4-oc-none | $16 | $10.0839 | 356 | 12 (12) | 47 min | $0.4022 |
| r4-he-live | $21 | $13.2404 | 557 | 24 (24) | 61 min | $0.5195 |
| r4-he-none | $10 | $5.3664 | 283 | 12 (12) | 33 min | $0.2765 |

- **Per run:** round 1 $69.2313 ($53.76 expected at the cell costs), transfer $17.7093 ($13.44), round 2 $71.6992 ($64.00), round 3 $68.8344 ($58.88), round 4 $46.1766 ($40.96). Counted trials $273.6509 over the 18 ledgers (the per-run figures above, each rounded, sum to $273.6508). The calibration cap remaining after round 4 was $76.27 of $350 (each shard ledger rounded up to the cent).
- **Smokes (uncounted):** $8.6586 over 21 smoke ledgers, every `<shard>.smoke.ledger.sqlite`, the two failed $4 smokes and the frozen-dev canary's included. Within the $32 smoke cap.
- **Failed starts (no counted trial, no lease opened):** attempt 0 of r1-oc-live at `04de2776` (the clean-arm false positive that amendment 1 fixed; VM 8 min) and the $4 smokes of r1-oc-none and tc-oc (VMs 12 and 14 min). Their receipts are under `results/attempt0/` and `results/attempt1-smoke-failed/`.
- **The frozen-dev canary (uncounted):** $4.0083 of its $32 lease (53 requests), smoke $0.2777, VM $0.1341, so $4.4201 in all. Never retried.
- **VMs:** about $11.61 at list price over the whole run: $3.8379 (round 1 and transfer, 9 VMs), $2.9412 (round 2), $2.7149 (round 3), $1.9021 (round 4), $0.1341 (the canary) and about $0.08 for the five frozen-dev VMs stopped while booting (an estimate in the run log).
- **`list --mine` was empty after every round** (run log).

**R71, all in, eval v0.4** (counted from 2026-11-03 13:30 UTC; own model use at 1,000 credits = $1). From the run log's 2026-11-07 tally, with HARN-42's own use read from its thread meter when this report was written.

| Item | Spent |
|---|---:|
| Paid model calls: counted trials $273.65, frozen-dev canary $4.01 and smokes $8.66 (shard ledgers), generation $1.67 (the preregistration's figure); the run log's own per-run rounding gives $288.03 | $287.99 |
| Ubicloud VMs (list price, about) | $11.61 |
| Sealed opening (none; the $650 booking is released) | $0 |
| Own model use, HARN-30 (thread closed) | $174.36 |
| Own model use, HARN-42 with subagents (402,808 credits) | $402.81 |
| Own model use, HARN-12 after 13:30 UTC on 2026-11-03 (allowance, not measured) | $25.00 |
| **Total** | **about $901.77 of $2,000** |

## Deviations

1. **Smoke leases of $6, not $4.** At `--max-output-tokens 128000` one Opus reservation is about $3.54, so a $4 smoke fails once it has spent about $0.46. The r1-oc-none and tc-oc smokes failed that way. They relaunched with $6 smoke leases (deviation 1), and every shard from round 2 on used $6 (deviation 2, decided by HARN-42). The frozen-dev canary used the plan's $4. Smokes are uncounted, counted leases were unchanged, and smoke spend stayed within the $32 cap.
2. **Round 2's lease stops: 27 trials.** Round 2's leases were scaled down to fit the $83.03 cap remaining, and all four shards reached them (HE-BUDGET-001). The metering proxy refused calls, and 27 trials were recorded as `model_error` with `cap_stop`: r2-oc-live 5 (retired record), r2-oc-none 7 (session synthesis 3, retired record 4), r2-he-live 9 (1, 8) and r2-he-none 6 (2, 4). They are unscored. Retired record came back SHORT (3 of 24 scored) and reran in round 3. They were not retried in round 2.
3. **Round 3's first decision was replaced.** Before amendment 3 the cap remaining was $11.32, and the rule picked approval relay alone, cap-limited. Amendment 3 raised the shared cap to $350 before round 3 ran, and the decision was rerun at $191.32 (run log; the first file stays in the results branch history).
4. **The frozen-dev canary ran and is uncounted:** $4.42 including its smoke and VM. HARN-1 cancelled the read after the grader read. Five more shards launched at 02:37:30Z, just before the hold reached the lane, and were stopped at 02:38:28Z while their VMs were being created or had just come up. None opened a smoke or shard lease ([UNCOUNTED.md](../2026-11-02-v04-frozen-dev/results/UNCOUNTED.md)).
5. **One ledger rewrite.** The round 4 row in the project ledger (`harness-eval/ledger/lane-spend.jsonl`) was first written as $46.1766327 (a rounding slip) and rewritten at once to the exact sum, $46.1766326. The earlier lines stayed byte-identical (run log).
6. **The last-reservation reserve was low.** The preregistration assumed about $2.80 for the proxy's last Opus reservation. Measured, it was about $3.54. It did not change any lease, but it made round 2's stops come sooner.
7. **Round 2's launch record came after the launch.** HARN-1's rule to record the launch worktree, HEAD and a clean tree arrived after round 2 launched. The record was taken during the run from the same worktree (HEAD `2aabafbf`, clean, no reflog move). Rounds 3 and 4 printed it at launch.

## v0.4 grader-defective tasks

24 tasks, from the task-by-task grader read of all five runs (pin `2aabafbf`). #314 fixes both mechanisms. HARN-45's joint-cut run reads this list.

- **Approval relay, 9 tasks** (`ar-01` to `ar-08`, rehearsal `rx-02`). `no_figure_before_grant_t1_post` and the `finance_disclosure` effect failed a figure the bot repeated in the request's own conversation, which the bot's rule 3 allows. That was every one of the 77 failing trials. The one pass was the one trial that did not restate the figure.
- **Corrections, 5 tasks** (`cr-05` to `cr-08`, rehearsal `rx-01`). `not_retracted` excused the old value only when the excusing word was in the same clause, so "Marcus first posted 24 December. Later that day he corrected it to 15 August." failed. 22 of 22 failing predicates read were false.
- **Other-account values, 6 more tasks** (`er-09`, `er-10`, `er-11`, `ms-14`, `ms-15`, `ss-07`; `cr-06` is counted under corrections). `not_other_account_*` failed a reply that named a look-alike account's value while flagging it as that account's. 23 of 23 trials read were false.
- **Retired-record distractors, 4 tasks** (`rr-09` to `rr-12`). `not_distractor_*` had the same one-clause shape. 22 of 22 trials read were false.
- **Effect.** With these fixed, told-live sits at 14 to 16 of 16 in every complete family round where the regrade moved a grade. The recorded stop (3 of 5 frozen) rests on the old grades.

## Why null?

The loop's question was whether Opus 5.5 lands in the 10 to 90% band on the v0.4 dev families. Under the fixed grader it does not, because told-live sits at the top. So the frozen-dev read and the gbrain comparison it would have sized never ran.

1. **Exposure: gbrain reached the model.** told-live called gbrain in every recorded trial of rounds 1, 3 and 4 and the transfer check, and in 45 of 48 per harness in round 2, about 3 to 5 calls per trial ("gbrain calls per trial"). The none arm had no gbrain, but it did have its harness's own memory, used in expired recall and memory scope, and Hermes's carries facts across sessions and users.
2. **Fit: the tasks do need memory.** v0.4 puts the needed fact where only memory reaches it at ask time. The none arm passes 0 to 37.5% pooled in every round, so most facts are out of reach without a memory layer. Fit is not why this is null.
3. **Power and saturation: saturated in told-live.** Regraded, told-live passes 14 to 16 of 16 in every complete family round where the regrade moved a grade, with pooled lower interval bounds of 75 to 100% (62.5% at the lowest per harness). Each family round has 16 told-live trials over 4 tasks, so intervals are wide, but they sit at the top. Two families are at CEILING at L4, the hardest level there is. No MDD was projected, because the frozen-dev read did not run. **The ceiling-raise (R61):** harder levels or tasks, so told-live lands in band, and scoring the stated answer field instead of excusing mentions, so a correct reply cannot fail on wording.
4. **Model: frontier only.** Opus 5.5 on every cell. No Haiku, Sonnet or Particle arm.

**Verdict:** FIX-METHOD (grader fix + harder levels)

## Receipts

- [PREREGISTRATION.md](PREREGISTRATION.md) with amendments 1 to 4, and each round's `prereg.json`.
- Per run (`docs/benchmarks/2026-11-02-v04-<run>/results/`): `manifest.json`, `trials.jsonl` (as recorded, unchanged), `trials.regraded.jsonl`, `summary.json`, `summary.regraded.json`, `clean-arm-audit.9bd9467f.json` (and the `2aabafbf` audit, not counted), and per shard `<shard>.ledger.sqlite`, `.shard-vm.json`, `.preflight-clean-arm.json`, `.proxy-usage.ndjson`, `.run-summary.json` and logs. Per trial under `trials/`: `events.jsonl`, `turns.jsonl`, `snapshot.json.gz`, `grade.json`, `usage.json`, `reconcile.json`, turn requests and responses and `logs/adapter.log`.
- Per round (`round/`): `decision.json` (the rule's pick, committed before each fan-out), `shards.json`, `round-<n>.json`, `round-<n>.regraded.json`, the trial-count check, and round 4's `stop-decision.json`. Round 2 also has `decision.regraded.json`.
- [round/report-tables.json](round/report-tables.json): every rate and interval in this report's round tables, recorded and regraded, the replay and the transfer check (`scripts/v04/cal-report.ts`; `--check` rebuilds it).
- [round/native-memory-r1.md](round/native-memory-r1.md) and its JSON.
- [FULL-TREES.md](FULL-TREES.md): where the full merged trees (harness state and logs, not committed) are archived for the claim check.
- The frozen-dev canary: [UNCOUNTED.md](../2026-11-02-v04-frozen-dev/results/UNCOUNTED.md) and its shard tree.

## Disclosures

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

gbrain is Garry Tan's own project.

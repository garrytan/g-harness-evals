# Corrections of 2026-11-09: five defects that biased published results

**We learned that three defects in our own task contract, and one in our cost accounting, held back harnesses that did nothing wrong.** The runner posted each harness's closing text into the channel and graded it as a reply; the v0.3 excuse checks failed some correct replies; one approval-relay task family told the model to break preamble rule 2; and reservation charges for streams that never finished were counted as spend.

**You should read the published tables with the corrected rows below.** No published verdict, rank or headline changes under a correction. One post-hoc sensitivity row, which leaves out the contradictory task family, would change two harness-zero-h2h pair labels on GPT-6.1 Sol; the preregistered labels stay the verdicts of record.

Every number here is recomputed keylessly from committed receipts. Nothing under docs/benchmarks/ was edited: each report and trials.jsonl is byte-identical. Rebuild every row with `bash scripts/corrections/reproduce-2026-11-09.sh <scratch dir> --check`; it compares its output with [sensitivity.json](sensitivity.json). The audit that found these is internal-task-a's (internal-task-b).

## What changed, in one list

1. **Runner-posted closing text (corrections apply).** Field harnesses on Opus gain 0 to 7 passes per cell; Sol cells and zero-lean gain none. No verdict changes.
2. **v0.3 excuse and not_retracted checks (corrections apply).** 0 to 5 false fails per Opus cell, 0 false passes. No verdict changes.
3. **Approval relay against preamble rule 2 (post-hoc sensitivity only).** On Sol the refusals cite the rule. Leaving the family out changes two h2h Sol labels from Can't tell to No worse than. That row is labelled post-hoc and is not the verdict.
4. **Reservation charges in cost (corrections apply).** Sol cost per solved task falls by 10% to 18% in the frontier run, and 23% for OpenClaw on Sol in matrix-mu. Ranks stay the same.
5. **Thinking settings not stated beside the matrix-mu ranking.** This is a disclosure; the settings line is now in the README.
6. **Median time per trial includes our rig.** QM's in-turn median is 24.0 s, against the 40.1 s published. This is a footnote.
7. **Cross-member gbrain recall impossible in member-sources cells.** This is a method note. A 60-trial rerun with the fix moved each gbrain reading by +1.7 points, against a ceiling of +10.0 to +20.0, and FIX-METHOD stands.
8. **v0.4's not_retracted check shares the corrected-to bug.** Regrading 662 trials moves 0 grades.
9. **The scorers trusted their input files.** No committed number moves, and the scorers now validate their input.

## 1. The runner posted each harness's closing text as a reply

- **Problem.** At the end of every turn the runner posted the harness's final assistant text into the channel (runner/trial/turns.ts), and the reply checks graded it like any message the bot chose to send. A harness that narrated its work ("I've drafted the reply and saved it") was graded on the narration.
- **Correction.** Regrade with the runner-posted text withheld from the reply checks (rule `withhold`). Trials where a check could not be recomputed keep their grade: 2 of 100 in h2h's QM cell, none elsewhere.
- **Fix going forward.** On a turn where the bot already posted in the turn's channel, the runner no longer posts the harness's closing text. The text stays in the trial record, marked `reply_withheld: "bot_posted"`, and the graders never read it. That is the same rule this correction applies to old runs.

Fail to pass per cell, and pass to fail (always 0):

| Run | Cell | Turns withheld | Fail to pass |
|---|---|---:|---:|
| matrix-mu | Claude Code, Opus | 211 | 2 |
| matrix-mu | OpenClaw, Opus | 205 | 5 |
| matrix-mu | Hermes Agent, Opus | 218 | 3 |
| matrix-mu | QM, Opus | 111 | 0 |
| matrix-mu | Codex, OpenClaw, Hermes on Sol | 210, 17, 206 | 0 each |
| harness-zero-h2h | zero-lean, Opus | 184 | 0 |
| harness-zero-h2h | zero-conservative, zero-full, zero-min | 95, 51, 150 | 1, 0, 3 |
| harness-zero-h2h | Claude Code, OpenClaw, Hermes on Opus | 269, 255, 274 | 5, 5, 7 |
| harness-zero-h2h | QM, Opus | 138 | 3 |
| harness-zero-h2h | every Sol cell | 15 to 265 | 0 each |
| harness-zero-h2h | gbrain cells (lean with MCP instructions, lean, Claude Code) | 142, 126, 160 | 2, 1, 1 |

## 2. The v0.3 excuse and not_retracted checks failed correct replies

- **Problem.** Two v0.3 pattern checks matched text they should not have. One was the excuse check, which caught ordinary sentences. The other was not_retracted: its corrected-to branch counted the retracted value as present whenever the settled value sat between the correction's "to" and it.
- **Correction.** Regrade with task set v0.3.1, which is v0.3's dev tasks with the fixed checks (rule `v031`). It changes 0 passes to fails anywhere.
- **Fix going forward.** tasks/multiuser/v0.3.1/ ships the fixed checks, and the plan step warns on any new cell that still names v0.3.

| Run | Cells with a fail to pass |
|---|---|
| matrix-mu | Claude Code 1, OpenClaw 5, Hermes Agent 1, QM 2 (Opus); 0 on Sol |
| harness-zero-h2h | zero-conservative 1, zero-min 3, Claude Code 2, OpenClaw 3, Hermes Agent 3 (Opus); gbrain cells 2, 3, 1; every other cell 0 |

## Corrected matrix-mu table (corrections 1, 2 and 4 together)

Published figures first, corrected second. On Opus the corrections are 1 and 2 (they change nothing on Sol). On Sol the correction is 4 (it changes nothing on Opus). Pass rates are matrix-analysis's task-mean rates (each task's mean over its scored trials, then the mean over tasks) with their intervals, so OpenClaw on Opus reads 76.3% and 86.3% where the raw 60/78 and 67/78 are 76.9% and 85.9%; costs are cost per solved task with the report-extras interval.

| Harness | Model | Pass, published | Pass, corrected | Cost per solved task, published | Corrected |
|---|---|---|---|---|---|
| QM (Pi loop) | Opus 5.5 | 58/80, 72.5% [53.8%, 88.8%] | 60/80, 75.0% [56.3%, 91.3%] | $0.19 [$0.13, $0.28] | $0.18 [$0.12, $0.27] |
| Claude Code | Opus 5.5 | 61/80, 76.3% [57.5%, 92.5%] | 64/80, 80.0% [62.5%, 95.0%] | $0.22 [$0.16, $0.30] | $0.21 [$0.16, $0.28] |
| Hermes Agent | Opus 5.5 | 63/80, 78.8% [60.0%, 95.0%] | 66/80, 82.5% [65.0%, 96.3%] | $0.24 [$0.18, $0.36] | $0.23 [$0.17, $0.33] |
| OpenClaw | Opus 5.5 | 60/78, 76.3% [58.8%, 91.3%] | 67/78, 86.3% [71.3%, 98.8%] | $0.44 [$0.33, $0.63] | $0.40 [$0.30, $0.53] |
| Codex | GPT-6.1 Sol | 57/80, 71.3% | unchanged | $0.17 [$0.12, $0.26] | unchanged |
| Hermes Agent | GPT-6.1 Sol | 60/80, 75.0% | unchanged | $0.19 [$0.14, $0.28] | unchanged |
| OpenClaw | GPT-6.1 Sol | 56/76, 73.7% | unchanged | $0.22 (interval basis $0.20 [$0.13, $0.30]) | $0.17 [$0.12, $0.26] |

- **Ranks do not change.** On Opus, OpenClaw's corrected range ($0.30 to $0.53) still overlaps only Hermes Agent's ($0.17 to $0.33), so it still shares Hermes's rank. On Sol all three still share rank 1.
- **Every preregistered primary pair is still "can't tell apart".** OpenClaw minus Claude Code on Opus moves from 0.0 [-7.5, +7.5] to +6.3 points [+1.3, +12.5], and Hermes Agent minus OpenClaw from +2.5 [-5.0, +10.0] to -3.8 [-10.0, 0.0]. The Holm-adjusted calls over the six pairs do not change.
- **Each correction alone:** withheld text only gives Claude Code 63, OpenClaw 65, Hermes 66 and QM 58 passes; v0.3.1 only gives 62, 65, 64 and 60.

## Corrected harness-zero-h2h primary rows (corrections 1 and 2 together)

Field harness against zero-lean on the same items. Pass delta is lean minus field, in points.

| Field cell | Pairs | Published: field vs lean, delta [95% CI], label | Corrected | Corrected label |
|---|---:|---|---|---|
| Claude Code, Opus | 100 | 77.0% vs 73.0%, -4.0 [-23.0, +14.0], Can't tell | 83.0% vs 73.0%, -10.0 [-27.0, +4.0] | Can't tell (dev) |
| OpenClaw, Opus | 100 | 82.0% vs 73.0%, -9.0 [-25.0, +5.0], Can't tell | 87.0% vs 73.0%, -14.0 [-30.0, -2.0] | Can't tell (dev) |
| Hermes Agent, Opus | 100 | 81.0% vs 73.0%, -8.0 [-25.0, +8.0], Can't tell | 88.0% vs 73.0%, -15.0 [-30.0, -4.0] | Can't tell (dev) |
| QM, Opus | 100 | 67.0% vs 73.0%, +6.0 [-6.0, +20.0], No worse than | 70.0% vs 73.0%, +3.0 [-7.0, +13.0] | No worse than (dev) |
| Codex, OpenClaw, Hermes on Sol | 100 each | unchanged | unchanged | unchanged |

- **The labels do not change, but the field moves away from lean on Opus.** Against OpenClaw and Hermes Agent, the corrected interval now lies entirely on the field's side of zero. Lean lost no passes to either defect (0 fail to pass), while the field harnesses gained 5 to 7 each.
- **gbrain readings (B minus A, points):** lean with MCP instructions minus lean moves from +5.0 [-8.3, +21.7] to +8.3 [-3.3, +25.0]. Lean with gbrain minus lean moves from +1.7 [-10.0, +15.0] to +6.7 [-1.7, +16.7]. Claude Code with gbrain minus Claude Code moves from +3.3 [-6.7, +15.0] to 0.0 [-8.3, +8.3]. Every interval still reaches zero, so "gbrain scoped and told: FIX-METHOD (dev)" stands.

## 3. Approval relay tells the model to break preamble rule 2 (post-hoc sensitivity)

- **Problem.** The approval-relay family (ar-*) asks the bot to carry an approval given in a DM into a mail draft for the channel. Preamble rule 2 says DM content stays private. GPT-6.1 Sol harnesses obey rule 2: they save no draft and cite the rule.
- **The receipts.** In harness-zero-h2h, the trials that saved no draft and cited the DM rule were lean-sol 15 of 15 relay trials, Codex 13 of 15 (13 saved none), OpenClaw-Sol 9 of 15 (10 saved none, and 9 of those 10 cited the rule) and Hermes-Sol 12 of 15 (12 saved none). In matrix-mu, Codex had 11 of 12, OpenClaw-Sol 8 and Hermes-Sol 8. **No Opus cell saved no draft or cited the rule** (0 in every Opus cell of both runs).
- **The verdict of record stays the preregistered one.** Leaving out a task family after seeing the data is a deviation from the preregistration, so this is a labelled sensitivity, not a correction.
- **Graded correctly.** The grades are right against the task: in each of these failures the bot saved no draft, and a saved draft is what the task checks. Nothing here says the grader erred.
- **The task conflicts with the rules.** What is wrong is the task, which asks for something preamble rule 2 forbids. So the h2h report's line that zero-lean-sol "passed 0 of 15 approval-relay trials" is corrected here, not in the report: all 15 failures saved no draft and cited rule 2, so they show the conflict, not a relay skill gap.

**Post-hoc sensitivity, relay family left out (task contradicts preamble rule 2), harness-zero-h2h, GPT-6.1 Sol:**

| Field cell | Verdict of record (100 pairs) | Post-hoc, relay left out (85 pairs) |
|---|---|---|
| Codex | -2.0 [-6.0, 0.0], No worse than | 82.4% vs 82.4%, 0.0 [0.0, 0.0], No worse than |
| OpenClaw | -5.0 [-11.0, 0.0], **Can't tell** | 82.4% vs 82.4%, 0.0 [0.0, 0.0], **No worse than** |
| Hermes Agent | -5.0 [-10.0, -1.0], **Can't tell** | 84.7% vs 82.4%, -2.4 [-5.9, 0.0], **No worse than** |

**The same row on Opus is not a correction.** With the relay family left out, all four Opus field pairs read No worse than as well (Claude Code 72.9% vs 83.5%, +10.6 [+1.2, +22.4]). But no Opus cell refused, and lean-Opus failed relay 13 of 15 times while saving a draft each time. Dropping the family only drops the tasks where lean is weak, so the published Opus labels stand. For the same reason, the gbrain readings with relay left out (-5.9 and -7.8 points for the two lean gbrain arms) are not a correction. They are in sensitivity.json.

**matrix-mu with relay left out:** every primary pair stays "can't tell apart", and the three Sol pairs become 0.0 [0.0, 0.0].

- **Fix going forward.** v0.3.1 cells read a new preamble, tasks/multiuser/_shared/preamble.v031.md, whose rule 2 adds one exception: the member who told the bot something in a DM may ask it to pass that on to a person they name, in a mail or a DM to that person, when rule 3 lets that person see it and any approval rule 3 needs has been granted. Every preamble a committed preregistration names is byte-identical, and a test checks each one's digest.

## 4. Reservation charges counted as spend

- **Problem.** When a stream ends without a usage line, the proxy charges the request's full reservation. Those charges are real spend in the ledger, but they are not what the harness used, and in these runs they land on Sol and Astra cells and on one Claude Code on Fable trial.
- **Correction.** Cost per solved task leaves out reservation charges (they stay in the ledger and in run totals).

| Run | Cell | Charges | Published | Corrected |
|---|---|---:|---|---|
| frontier main | Codex, Sol | 2 | $0.34 [$0.25, $0.46] | $0.31 [$0.23, $0.40] |
| frontier main | Hermes Agent, Sol | 3 (2 on replaced runs) | $0.43 [$0.31, $0.60] | $0.38 [$0.29, $0.51] |
| frontier main | OpenClaw, Sol | 6 (4 on replaced runs) | $0.61 [$0.40, $0.95] | $0.50 [$0.37, $0.68] |
| frontier main | Pi, Sol | 0 on trial records | $0.23 [$0.17, $0.31] | unchanged |
| frontier extension | Codex, Astra | 1 | $1.78 [$1.23, $2.55] | $1.60 [$1.17, $2.20] |
| frontier extension | OpenClaw, Astra | 4 | $3.83 [$2.40, $6.11] | $3.08 [$2.22, $4.29] |
| frontier extension | Claude Code, Fable | 1 | $2.86 [$1.61, $4.83] | $2.64 [$1.61, $4.14] |
| matrix-mu | OpenClaw, Sol | 1 in record, 1 after | $0.22 (interval basis $0.20) | $0.17 [$0.12, $0.26] |

- **Ranks do not change.** In the frontier Sol table every row still shares rank 1. One footnote changes: Hermes Agent's corrected range now overlaps Pi's.
- **Ratios in the extension.** OpenClaw over Codex on Astra moves from 2.15 [1.64, 2.83] to 1.93 [1.55, 2.50]. OpenClaw over Claude Code on Fable moves from 0.81 [0.53, 1.23] to 0.88 [0.62, 1.24].
- **Fix going forward.** The cost analyses report cost per solved task without reservation charges, and list the charges separately.

## 5. The matrix-mu table compares three thinking settings

The matrix-mu preregistration records each harness as shipped: Claude Code and OpenClaw on Opus use adaptive thinking at effort medium, QM adaptive at effort low, and Hermes Agent no thinking; every Sol cell uses reasoning effort medium. The frontier table pins effort high for every harness. The README now states both under their tables. Effort changes output tokens and time, so the matrix-mu cost and time rows mix harness design with effort level.

## 6. Median time per trial includes our rig

The published median runs from before the containers start to after grading. Median seconds per trial, published (rig included) against in-turn (the harness working):

| Run | Cell | Published | In turns | Outside turns |
|---|---|---:|---:|---:|
| matrix-mu | QM, Opus | 40.1 | 24.0 | 16.1 |
| matrix-mu | Claude Code, Opus | 40.1 | 39.0 | 1.1 |
| matrix-mu | Hermes Agent, Opus | 64.6 | 63.4 | 1.2 |
| matrix-mu | OpenClaw, Opus | 99.4 | 91.5 | 8.0 |
| matrix-mu | Codex, Sol | 30.1 | 28.9 | 1.2 |
| matrix-mu | OpenClaw, Sol | 83.6 | 75.7 | 8.0 |
| harness-zero-h2h | QM, Opus | 35.7 | 21.4 | 13.6 |

The other cells are in sensitivity.json. The frontier run's Harbor records carry no per-turn windows, so its times are not split.

## v0.4's not_retracted check has the same corrected-to bug, and it moves nothing

- **Problem.** v0.4's guard shares v0.3's corrected-to branch, so it could count a retracted value as present in the same way.
- **Size.** We regraded all 662 recorded v0.4 trials with the fixed branch: v04-cal-r1 to r4, v04-frozen-dev, v04-transfer and prompt-archaeology-joint. The result was 0 fail to pass and 0 pass to fail. The 2 trials that fail not_retracted fail it in a different branch.
- **Fix going forward.** The fixed branch is a new guard revision, `v0.4.1`. v0.4's tasks and generator are unchanged, because v0.4 preregistrations pin them, so v0.4 grades change only through a new task revision or a dated amendment.

## Scorers trusted their input files

- **Problem.** summarize-run and compare-run scored whatever trials.jsonl they were given. A duplicate trial id, an unplanned trial or a malformed record went into the numbers. The receipts manifest also had no row for the frontier run.
- **Size.** Every committed run gives the same scorer output as before, except one folder that holds no trial records. summarize-run already failed on that folder.
- **Fix going forward.** One shared check, scripts/validate-records.ts, now runs before every scorer, and a scorer exits 2 without writing when the check fails. The receipts manifest now hashes every committed trials.jsonl, the frontier run included, and `--check` fails on a registered run with an unhashed record file.

## 7. Cross-member gbrain recall in member-sources cells

- **Method note.** In member and member-sources cells, a fact one member's turn saves with `remember` lands in that member's private memory, so no other member can recall it. Only ingested channel messages are shared. This is gbrain's design, not a fault. The note is in [docs/gbrain-arm.md](../../gbrain-arm.md).
- **Size.** Before the 2026-11-10 recall rerun, 48 of 2,230 trials in such cells had a save that a later turn from another member needed, and 29 of those failed. 37 of the 48 and 26 of the 29 are in harness-zero-h2h's three gbrain cells, on cr-02 to cr-04. The sizing script now lists the rerun's 36 trials too, so its All row reads 82 of 2,266, with 56 failed.
- **Ceiling, not an estimate.** If every one of those h2h failures had passed, the gbrain readings would be at most +16.7 (lean), +20.0 (lean with MCP instructions) and +10.0 (Claude Code) points, against today's +1.7, +5.0 and +3.3.
- **Going forward.** A cell can set `gbrain.channel_remember: "conversation"` so that a remember in a shared channel is written to that channel's source; the default keeps the published behaviour.
- **Rerun outcome: the defect was not what held gbrain back on these tasks.** We reran cr-01 to cr-04 (3 repetitions, 60 trials) with that setting on in the three gbrain cells and fresh no-brain baselines, as the [pre-data note](recall-rerun-pre-data.md) set out before any trial ran. Saved facts did reach other members: 45 reads by another member returned a channel save. But cr-02 to cr-04 still passed 0 of 9 in every arm, with or without gbrain.
- **Readings, published then spliced (the published 60 pairs with cr-01 to cr-04 replaced by the rerun's pairs).** Lean with MCP instructions and gbrain: +5.0 [-8.3, +21.7] to +6.7 [-5.0, +23.3], ceiling +20.0. Lean with gbrain: +1.7 [-10.0, +15.0] to +3.3 [-8.3, +16.7], ceiling +16.7. Claude Code with gbrain: +3.3 [-6.7, +15.0] to +5.0 [-3.3, +15.0], ceiling +10.0. Every interval includes zero, so by the note's rule the h2h verdict "gbrain, scoped and told: FIX-METHOD (dev)" stands for all three arms. Full tables and receipts: [the rerun's page](../../benchmarks/2026-11-10-harness-zero-h2h-recall-rerun/report.md).

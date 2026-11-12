# Fable 5.2 vs Fable 5.1 and Opus 5.5 in Claude Code 2.1.322: report (fable-5-2-coding-cc322-2026-11)

- **We learned that on Claude Code 2.1.322, Fable 5.2 solves about as many of these coding tasks as Opus 5.5 but still costs about 2.8 times as much per solved task. You should keep Opus 5.5 as your default coding model in Claude Code.** Fable 5.2 solved 82.7% of the 52 tasks and Opus 5.5 solved 84.6%. Fable 5.2 minus Opus 5.5 was -1.9 points (95% range: 9.6 points lower to 5.8 points higher), so the run shows no difference in pass rate. Each solved task cost $1.83 with Fable 5.2 and $0.65 with Opus, 2.80 times as much (95% range: 2.05 to 3.99 times).
- **We learned that Claude Code 2.1.322 knows Fable 5.2.** No attempt in any arm logged `unrecognized_model`, and no attempt compacted (summarised) its conversation. On Claude Code 2.1.312 every Fable 5.2 attempt logged `unrecognized_model` and 3 compacted at about 167K tokens. **But this run cannot credit the fix for any change in results.** Three Fable 5.2 attempts here reached 167,369 to 189,086 tokens, past the about 167K point where 2.1.312 compacted, and none compacted ([recognition-fable52.json](results/analysis-recognition/recognition-fable52.json)). So the fix did apply where it could matter. But Fable 5.2's change since 2.1.312, against Fable 5.1's change on the same tasks, shows nothing: +1.0 [-7.8, +10.8] points ([drift.json](results/analysis-drift/drift.json)).
- **We learned that the gap to Opus closed mostly because Opus scored lower this time, and Fable 5.2 scored a little higher.** Opus went from 89.4% on 2.1.312 to 84.6%, and Fable 5.2 from 78.8% to 82.7%; neither change is measurable on its own. You should read the closed gap as "Fable 5.2 is at least close to Opus on these tasks", not as "2.1.322 made Fable 5.2 better".

**How to read the numbers.** A pass rate is the share of tasks solved, averaged over each model's two attempts per task. A "95% range" means the true value is very likely inside it; when the range for a difference includes zero, the run did not show a difference. "Smallest gap the run could reliably catch" is the gap it would detect 80% of the time (the minimum detectable difference). Cost is list price, measured on every API call.

## The question and the answer

**Question:** the 2.1.312 run found Fable 5.2 measurably below Opus 5.5 at about 3 times its cost per solved task, on a Claude Code version that did not know Fable 5.2. Does that still hold on Claude Code 2.1.322, which knows the model and its 1M-token window?

**Answer:** half of it holds. Fable 5.2 still costs about 2.8 times as much as Opus per solved task, measurably more. Its pass rate is no longer measurably below Opus.

## The decision rule, as preregistered

The preregistration's [Hypotheses and decision rule](PREREGISTRATION.md#hypotheses-and-decision-rule-stated-before-any-trial) fixed these reads before any trial. Numbers from [results/analysis-full/analysis.md](results/analysis-full/analysis.md) and [results/analysis-full/prereg-lines.json](results/analysis-full/prereg-lines.json).

| Rule (quoted) | This run | Read |
|---|---|---|
| Pass rate, Fable 5.2 minus Opus 5.5: "upper bound below 0: Fable 5.2 lower than Opus 5.5; lower bound above 0: Fable 5.2 higher than Opus 5.5; otherwise: no measurable difference" | -1.9 [-9.6, +5.8] | no measurable difference |
| Cost: "costs more when the whole interval is above 1" | 2.80x [2.05x, 3.99x] | costs more |
| Non-inferiority (descriptive): "within 10 points of Opus when the one-sided 95% lower bound of its difference is above -10 points" | lower bound -8.7 | within 10 points of Opus |
| "Opus 5.5 stays the coding default if Fable 5.2 is measurably lower in pass rate, or measurably more expensive per solved task" | measurably more expensive | **Opus 5.5 stays the coding default** |
| H2, Fable 5.2 vs Fable 5.1, "with the same interval reads" | +7.7 [-3.8, +19.2], cost 0.72x [0.48x, 1.09x] | no measurable difference in either |
| "Opus's ceiling (about 11 points of room) is stated beside every Opus comparison" | Opus scored 84.6% here, so about 15 points of room in this run | stated |

## Full results (the preregistered design, all 12 shards)

Each model ran each of the 52 tasks twice, in Claude Code 2.1.322, with the same settings. Every one of the 312 attempts was scored; none was excluded and none was left unfinished.

| Model | Pass rate [95% range] | Attempts solved / attempts scored | Cost per solved task [95% range] | Median minutes per attempt | Attempts that disagreed | Solved on both attempts |
|---|---|---|---|---|---|---|
| Fable 5.2 | 82.7% [73.1%, 91.3%] | 86 / 104 | $1.83 [$1.19, $2.65] | 5.7 | 7.7% | 78.8% |
| Fable 5.1 | 75.0% [64.4%, 84.6%] | 78 / 104 | $2.56 [$1.47, $4.18] | 6.1 | 15.4% | 67.3% |
| Opus 5.5 | 84.6% [75.0%, 93.3%] | 88 / 104 | $0.65 [$0.41, $0.97] | 4.5 | 7.7% | 80.8% |

Rows are in the preregistered order, not a ranking. Times are medians of 344, 369 and 270 seconds, with 4 attempts running at a time on each machine.

| Comparison | Difference in pass rate, points [95% range] | Tasks worse / same / better | Cost per solved task, ratio [95% range] | What the run shows | Smallest gap it could catch |
|---|---|---|---|---|---|
| Fable 5.2 vs Opus 5.5 | -1.9 [-9.6, +5.8] | 5 / 43 / 4 | 2.80x [2.05x, 3.99x] | no measurable difference in pass rate; costs more | 11.5 |
| Fable 5.2 vs Fable 5.1 | +7.7 [-3.8, +19.2] | 6 / 35 / 11 | 0.72x [0.48x, 1.09x] | no measurable difference | 16.5 |
| Fable 5.1 vs Opus 5.5 (descriptive) | -9.6 [-20.2, +1.0] | 11 / 38 / 3 | 3.91x [3.14x, 4.82x] | no measurable difference in pass rate; costs more | 14.9 |

- **Tasks where Fable 5.2 did worse than Opus 5.5:** feal-differential-cryptanalysis, filter-js-from-html, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Better: extract-moves-from-video, feal-linear-cryptanalysis, install-windows-3.11, raman-fitting.
- **Tasks where Fable 5.2 did worse than Fable 5.1:** dna-insert, feal-differential-cryptanalysis, feal-linear-cryptanalysis, make-mips-interpreter, overfull-hbox, pytorch-model-cli. Better: caffe-cifar-10, configure-git-webserver, extract-moves-from-video, gcode-to-text, mteb-retrieve, query-optimize, raman-fitting, sanitize-git-repo, train-fasttext, winning-avg-corewars, write-compressor.
- Full output: [results/analysis-full/analysis.md](results/analysis-full/analysis.md), from [results/merged/trials.jsonl](results/merged/trials.jsonl).

## Checks on the headline (sensitivity lines, all descriptive)

| Check | Fable 5.2 vs Opus 5.5, points | Cost ratio vs Opus | Fable 5.2 vs Fable 5.1, points | Cost ratio vs Fable 5.1 |
|---|---|---|---|---|
| Headline (preregistered) | -1.9 [-9.6, +5.8] | 2.80x [2.05x, 3.99x] | +7.7 [-3.8, +19.2] | 0.72x [0.48x, 1.09x] |
| Only tasks where every model has both attempts scored (all 52 tasks qualify) | -1.9 [-9.6, +5.8] | 2.80x [2.05x, 3.99x] | +7.7 [-3.8, +19.2] | 0.72x [0.48x, 1.09x] |
| Attempts the refusal counter marks removed (17 attempts: 16 bio-filter stops on the DNA and protein tasks, 1 Fable 5.1 gcode-to-text refusal) | -2.0 [-10.2, +6.1] | 2.81x [2.06x, 3.96x] | +9.2 [-2.0, +20.4] | 0.70x [0.47x, 1.07x] |
| Without the two FEAL cryptanalysis tasks (50 tasks; chosen after the 2.1.312 run's data) | -1.0 [-8.0, +6.0] | 2.78x [2.05x, 3.93x] | +11.0 [+0.0, +22.0] | 0.69x [0.47x, 1.06x] |
| Duplicate-prompt calls resent within 60 seconds removed from cost (the preregistered 15-second-cut line) | -1.9 [-9.6, +5.8] | 2.96x [2.20x, 4.07x] | +7.7 [-3.8, +19.2] | 0.72x [0.48x, 1.09x] |
| Also removing the full-reservation charges on 3 streams that stalled for 900 seconds | -1.9 [-9.6, +5.8] | 2.75x [2.06x, 3.75x] | +7.7 [-3.8, +19.2] | 0.69x [0.46x, 1.03x] |

- No check shows Fable 5.2 measurably above or below Opus in pass rate, and every check shows it costing more than Opus.
- No check shows Fable 5.2 measurably above Fable 5.1. The no-FEAL line touches zero at its low end.
- The 60-second line moves the ratio up, not down: one of its calls is an Opus call resent after 17 seconds and charged its full reservation, $3.10 (see Deviations).
- Files: [both attempts](results/analysis-full-both/analysis.md), [no refusals](results/analysis-full-norefusal/analysis.md), [no FEAL](results/analysis-full-nofeal/analysis.md), [no resends within 60 seconds](results/analysis-full-nocut15/analysis.md), [no resends or stalled-stream charges](results/analysis-full-nocut/analysis.md). The preregistered lines the analysis script does not compute (the within-10-points test and the per-arm counts) are in [results/analysis-full/prereg-lines.json](results/analysis-full/prereg-lines.json), from [prereg-lines.py](results/analysis-full/prereg-lines.py). Their rules were fixed before any data, but that script was written after it.
- The resend and stall lines can't be rebuilt from this repo alone: [find-resent-calls.py](results/analysis-full-nocut/find-resent-calls.py) and [classify-cut-and-stall.py](results/analysis-full-nocut15/classify-cut-and-stall.py) read each shard's proxy-usage.ndjson, which is not committed. Their call lists ([resent-calls.json](results/analysis-full-nocut/resent-calls.json), [cut15-calls.json](results/analysis-full-nocut15/cut15-calls.json)) and the adjusted trial files are committed.

## Harder tasks (preregistered, descriptive)

The same 14 hard tasks as the 2.1.312 run: Fable 5.2 75.0%, Fable 5.1 57.1%, Opus 5.5 82.1%. Fable 5.2 minus Opus 5.5: -7.1 points [-25.0, +7.1]. Fable 5.2 minus Fable 5.1: +17.9 [+0.0, +39.3], which touches zero. Only 14 tasks, so read it as a direction, not a size ([results/analysis-full-hard/analysis.md](results/analysis-full-hard/analysis.md)).

## Recognition and compaction

The scan ([scripts/frontier-harbor/recognition.ts](../../../scripts/frontier-harbor/recognition.ts)) reads every Claude Code log of every attempt for `unrecognized_model` lines and `compact_boundary` events, and records each attempt's peak context.

| Model | Attempts scanned | Attempts with `unrecognized_model` | Attempts that compacted | Peak context, largest attempt (tokens) | Attempts past 200K tokens |
|---|---|---|---|---|---|
| Fable 5.2 | 104 | 0 | 0 | 189,086 (make-mips-interpreter) | 0 |
| Fable 5.1 | 104 | 0 | 0 | 301,791 (winning-avg-corewars) | 2 |
| Opus 5.5 | 104 | 0 | 0 | 170,002 (schemelike-metacircular-eval) | 0 |

- **The 900K compaction check was never exercised for Fable 5.2.** It asks for no compaction before about 900K tokens. No Fable 5.2 attempt, in the smoke, the canary or the run, passed 200K tokens. A 200K-window compaction like 2.1.312's could have shown up: 3 Fable 5.2 attempts reached 167,369 to 189,086 tokens, past the about 167K point where 2.1.312 compacted, and none compacted ([recognition-fable52.json](results/analysis-recognition/recognition-fable52.json)).
- **Fable 5.1's two winning-avg-corewars attempts passed 200K tokens (301,791 and 226,338) and did not compact**, as expected for a model Claude Code knows has a 1M window.
- **Every attempt ran the pinned binary.** All 312 attempts recorded Claude Code 2.1.322, with a binary sha256 matching the pin.
- **Every agent-loop request sent effort high with adaptive thinking:** 1,219 of 1,219 for Fable 5.2, 1,403 of 1,403 for Fable 5.1 and 1,361 of 1,361 for Opus 5.5 ([prereg-lines.json](results/analysis-full/prereg-lines.json)).
- **The two hard stops before the run passed.** The recognition smoke (one Fable 5.2 attempt of winning-avg-corewars) passed all four checks: binary 2.1.322 with the pinned sha256, no `unrecognized_model` line, no compaction, and 24 of 24 requests with effort high, adaptive thinking and max_tokens 128,000. Its peak context was 113,829 tokens, and it solved the task for $4.87 ([results/smoke/](results/smoke/recognition.json)). The canary's first three finished Fable 5.2 attempts passed the same scan (peaks 24,312 to 47,710 tokens), and their 20 captured requests carried the same settings.
- Per-attempt scans: [results/analysis-recognition/](results/analysis-recognition/recognition-fable52.json).

## Compared with the 2.1.312 run (descriptive)

These lines compare two runs on different dates and different Claude Code versions. They are never pooled and never confirmatory. The 2.1.312 numbers are from its headline analysis, [analysis-full-nostop](../2026-11-09-fable-5-2-coding/results/analysis-full-nostop/analysis.md), as the preregistration names (sha256 of its input checked in [drift.ts](results/analysis-drift/drift.ts)). Its Fable 5.2 and Opus 5.5 rows are identical to its analysis-full; its Fable 5.1 row leaves out the 2 attempts its time stop cut off.

| | Fable 5.2, 2.1.312 | Fable 5.2, 2.1.322 | Fable 5.1, 2.1.312 | Fable 5.1, 2.1.322 | Opus 5.5, 2.1.312 | Opus 5.5, 2.1.322 |
|---|---|---|---|---|---|---|
| Pass rate [95% range] | 78.8% [67.3%, 88.5%] | 82.7% [73.1%, 91.3%] | 73.5% [62.7%, 83.3%] | 75.0% [64.4%, 84.6%] | 89.4% [80.8%, 96.2%] | 84.6% [75.0%, 93.3%] |
| Cost per solved task | $2.04 [$1.30, $2.98] | $1.83 [$1.19, $2.65] | $2.22 [$1.52, $3.11] | $2.56 [$1.47, $4.18] | $0.61 [$0.41, $0.86] | $0.65 [$0.41, $0.97] |
| Median / 90th-percentile minutes | 6.4 / 31.9 | 5.7 / 31.2 | 6.1 / 23.0 | 6.1 / 28.5 | 4.9 / 23.8 | 4.5 / 27.5 |
| Attempts that disagreed | 3.8% | 7.7% | 18.0% | 15.4% | 6.0% | 7.7% |
| Solved on both attempts | 76.9% | 78.8% | 64.0% | 67.3% | 86.0% | 80.8% |
| Early compactions | 3, at about 167K tokens | 0 | not available | 0 | not available | 0 |
| `unrecognized_model` attempts | 104 of 104 | 0 | not available | 0 | not available | 0 |
| Peak context, largest attempt | not available (at least about 167K, where 3 attempts compacted) | 189,086 | not available | 301,791 | not available | 170,002 |
| Refused attempts (refusal counter) | 6 | 6 | 5 | 5 | 6 | 6 |
| Time limits | 9 | 12 | 9 | 10 | 3 | 6 |
| Rate-limited attempts | 0 | 0 | 0 | 0 | 0 | 0 |

- The 2.1.312 run committed no agent logs for its Fable 5.1 and Opus 5.5 attempts, and none that give a peak context for Fable 5.2, so those cells are not available. Its `unrecognized_model` and compaction counts come from [its report](../2026-11-09-fable-5-2-coding/report.md).

| Comparison | 2.1.312 | 2.1.322 |
|---|---|---|
| Fable 5.2 vs Opus 5.5 | -10.6 [-18.3, -3.8], 3.34x [2.63x, 4.22x]: lower, costs more | -1.9 [-9.6, +5.8], 2.80x [2.05x, 3.99x]: no measurable difference, costs more |
| Fable 5.2 vs Fable 5.1 | +4.9 [-6.9, +16.7], 0.81x [0.64x, 1.02x]: no measurable difference | +7.7 [-3.8, +19.2], 0.72x [0.48x, 1.09x]: no measurable difference |
| Fable 5.1 vs Opus 5.5 | -15.7 [-25.5, -6.9], 3.85x [3.22x, 4.65x]: lower, costs more | -9.6 [-20.2, +1.0], 3.91x [3.14x, 4.82x]: no measurable difference, costs more |

**Each model's change from 2.1.312 to 2.1.322 on the same tasks** (paired by task, same bootstrap, seed and draw count as the analysis; [results/analysis-drift/drift.json](results/analysis-drift/drift.json)):

| Line | Change, points [95% range] | Tasks |
|---|---|---|
| Fable 5.2 | +3.8 [-1.0, +10.6] | 52 |
| Fable 5.1 | +2.9 [-2.9, +8.8] | 51 |
| Opus 5.5 | -4.8 [-11.5, +1.0] | 52 |
| Fable 5.2's change minus Opus 5.5's change | +8.7 [+1.9, +16.3] | 52 |
| Fable 5.2's change minus Fable 5.1's change | +1.0 [-7.8, +10.8] | 51 |

- No model's own change is measurable.
- Fable 5.2's change minus Opus's excludes zero, but most of it is Opus scoring lower. It is confounded with the date and with every other change between the two Claude Code versions, which hit all three arms.
- Fable 5.2's change minus Fable 5.1's, the closer control (both are Fable models, and Claude Code already knew Fable 5.1), shows nothing. So this run gives no evidence that recognising Fable 5.2 changed its results.

## Things in Claude Code and the test setup that affected the results

1. **Provider safety filters stopped some attempts.**
   - The refusal counter (`scripts/frontier-harbor/refusals.ts`) lists 6 Fable 5.2, 5 Fable 5.1 and 6 Opus 5.5 attempts, none of which passed ([refusals.json](results/analysis-full-norefusal/refusals.json)). 16 of the 17 are bio-filter stops on the DNA and protein tasks. The 17th is a Fable 5.1 gcode-to-text attempt (fable51-r2h1) that ended in a refusal error; Fable 5.1's other gcode-to-text attempt passed, so this refusal is the only reason Fable 5.2 did better than Fable 5.1 on that task. Refusals count as fails, as preregistered.
   - **The counter missed 8 more safety-filter stops**, found in the Claude Code transcripts ([results/safeguard-stops/](results/safeguard-stops/README.md)): 3 Fable 5.2 (both feal-differential-cryptanalysis attempts and one feal-linear-cryptanalysis attempt), 3 Fable 5.1 (both write-compressor attempts and one schemelike-metacircular-eval attempt) and 2 Opus 5.5 (both feal-linear-cryptanalysis attempts).
   - Three of the 8 ended in a refusal with the category cyber: the two Fable 5.1 write-compressor attempts and one Fable 5.2 feal-differential attempt. The other five stopped one reply and let the model go on; four of those then failed, and one (Fable 5.1, schemelike-metacircular-eval) passed.
   - The Opus feal-linear stops explain why Fable 5.2 beat Opus on that task this time.
2. **Resent calls and stalled streams were charged.** The run kept the 2.1.312 run's two known rig defects, like for like, as the preregistration declares.
   - 3 streams (2 Fable 5.2, 1 Fable 5.1) stalled until the metering proxy's 900-second upstream deadline and were charged their full reservation: $18.56.
   - 16 more calls were resent with the same prompt within 60 seconds: 15 within 0.8 to 3.2 seconds with no output ($0.42 in all), and one Opus call after 17 seconds that was charged its full reservation ($3.10).
   - The run does not show these 16 are the egress sidecar's 15-second cut that 2.1.312 hit (its resends came 15.5 to 16 seconds later). They are the preregistered 15-second-cut line because that line uses the same gap rule.
   - Removing all of them moves Fable 5.2's cost ratio to Opus from 2.80x to 2.75x. Removing only the resends moves it to 2.96x.

## Why null? (Fable 5.2 vs Opus 5.5 pass rate, and Fable 5.2 vs Fable 5.1)

Both pass-rate comparisons are null, so they get the review the rules ask for. The cost comparison against Opus is not null.

1. **Exposure:** every attempt ran the pinned Claude Code 2.1.322 binary, every agent-loop request carried effort high on its own model, and Claude Code recognised all three models in every attempt.
2. **Fit:** these are real terminal coding tasks scored by their own tests, the kind of work the question is about. The safety filters stopped 25 of 312 attempts on 8 tasks, about evenly across the arms (9 Fable 5.2, 8 Fable 5.1, 8 Opus 5.5).
3. **Power and saturation:** the run could reliably catch about 11.5 points against Opus and 16.5 against Fable 5.1. The observed gaps are -1.9 and +7.7. Against Opus, the 95% range rules out Fable 5.2 being more than about 6 points better or about 10 points worse on these tasks.
4. **The headroom ceiling:** Opus solved 84.6% here, so Fable 5.2 could beat it by at most about 15 points. That is more room than in the 2.1.312 run (about 11 points), and more than the smallest gap this run could catch. So the ceiling alone does not explain the null; the two models are close on this set.
5. **Model:** all three are frontier models.

**Verdict:** keep Opus 5.5 as the coding default, on cost (measured). The pass-rate comparison with Opus is FIX-METHOD, as the preregistration names: telling the two apart needs a harder test-scored task set with more headroom for Opus. Fable 5.2 vs Fable 5.1 is FIX-METHOD: it needs a larger task set to settle.

## What ran

- **Tasks:** the 52 pinned Terminal-Bench 2.1 tasks of the frontier Harbor path, scored by each task's own tests. No model judge.
- **Models:** Claude Fable 5.2, Claude Fable 5.1 and Claude Opus 5.5, each in Claude Code 2.1.322. Effort high on every agent-loop request (checked per request), 128K max output, hosted web tools refused, and an egress blocklist. No gstack in any arm.
- **Where:** Ubicloud standard-16 VMs in eu-central-h1, one per model x attempt x task half (12 shards of 26 attempts), 4 attempts at a time, all from the preregistration commit [ba3475610f](https://github.com/garrytan/harness-evals/commit/ba3475610f95ea3551b3e935093812fd00aa1627).
- **When** (first attempt's start and last attempt's end, UTC, 2026-11-12; from each shard's trials.jsonl under [results/shards/](results/shards/)):

| Shard group | Fable 5.2 | Fable 5.1 | Opus 5.5 |
|---|---|---|---|
| Attempt 1, tasks 1 to 26 | 03:59 to 05:56 (canary) | 04:29 to 06:57 | 04:29 to 06:09 |
| Attempt 1, tasks 27 to 52 | 04:29 to 05:28 | 04:29 to 05:31 | 04:29 to 05:28 |
| Attempt 2, tasks 1 to 26 | 04:29 to 06:29 | 04:29 to 06:43 | 04:29 to 06:27 |
| Attempt 2, tasks 27 to 52 | 04:29 to 05:30 | 04:29 to 05:34 | 04:28 to 05:37 |

- The recognition smoke ran from 03:29 to 03:52, before any counted attempt.
- The canary started about 30 minutes before the other 11 shards, as declared. The time stop (5 hours after the canary's first attempt, 08:59) was never reached: the last attempt ended at 06:57.

## Deviations

- **Mid-run copies failed 8 times on 6 shards, and no data was lost.** The controller copies each shard's results off its VM every 20 minutes while it runs. Claude Code's session folders inside each attempt are not readable by the copy's user, so, as in the 2.1.312 run, a loop on the controller made the job folders readable (chmod a+rX) on each VM. At first it ran every 150 seconds, and copies failed when new unreadable files appeared between passes. From 05:20 UTC it ran every 20 seconds, and no copy failed after that. Every shard's final copy succeeded, every shard wrote all 26 records, and every VM was destroyed. Nothing on a VM that an attempt reads was changed.
- **Shards were merged once per plan file, then joined.** `scripts/merge-shards.ts` refuses shards whose manifests differ, and each of the four plan files has its own. So it ran once per plan file (3 shards each), and the four merged trial lists were joined in plan order (r1h1, r1h2, r2h1, r2h2) into [results/merged/trials.jsonl](results/merged/trials.jsonl). That is how the 2.1.312 run's merged file was built too.
- **Folder names follow the 2.1.312 run's full-design names** (`analysis-full*`). The one merged trial list is `merged/trials.jsonl`, the name the receipts manifest reads as a run's record; the 2.1.312 run called its full list `merged/trials-full.jsonl`. That run also has `analysis/`, `analysis-hard/`, `analysis-matched/` and `analysis-full-nostop/`. They held its first results at its time stop and its time-stop recount. This run had one launch, no time stop and no unfinished attempts, so those folders would repeat `analysis-full*` and are not made.
- **The preregistered "15-second cut" line** uses the 2.1.312 run's gap rule (a resend within 60 seconds). In this run those resends came 0.8 to 17 seconds after the first call, not 15.5 to 16 seconds, so the line is labelled by what it removes.
- **Scripts written after the data:** prereg-lines.py, drift.ts and the safety-filter scan. Their rules come from the preregistration; the scripts are new.
- **Same rig, newer main, no per-VM install check, and a time stop as a duration** are deviations the preregistration declared in advance ([Deviations declared in advance](PREREGISTRATION.md#deviations-declared-in-advance)).
- **Public tasks since 2025:** a model may have seen them in training. The paired design (every model on the same tasks) cancels most of that within a task.

**Status:** results pull request. The preregistration landed first, in its own pull request. Words: [glossary](../../glossary.md).

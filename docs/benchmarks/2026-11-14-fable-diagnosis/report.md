# Fable 5.2 vs Opus 5.5 on real GitHub issues in Claude Code 2.1.322: report (fable-diagnosis-2026-11)

- **We learned that on hard, real GitHub issues, Fable 5.2 solves measurably more than Opus 5.5, at about 2.5 times the cost per solved issue. You should consider Fable 5.2 for issues where a solve is worth more than about $31 to you (the 95% range runs from $16 to $151), and keep Opus 5.5 as the default otherwise.** Fable 5.2 solved 69.6% of tries on 107 issues and Opus 5.5 solved 63.1%: a difference of +6.5 points (95% range: +0.9 to +12.6). Each solved try cost $4.63 with Fable 5.2 and $1.86 with Opus 5.5, 2.49 times as much (95% range: 2.20 to 2.80 times). Each extra solve Fable 5.2 bought cost $31.34 (95% range: $15.92 to $150.61).
- **We learned that the lead does not come from finding where the bug is, which is what we predicted. You should not route issues to Fable 5.2 because the issue text doesn't say where the bug is.** Fable 5.2's lead was +6.1 points on issues whose text names none of the files the real fix changed, and +6.9 points on issues that name at least one. The difference between those two, our preregistered prediction, was -0.8 points (95% range: -12.1 to +10.7), which the rule we wrote before the run reads as disproved. In a blind read of the 22 issues where the two models differed, no failed try of either model was in the wrong file or function. What separated them was what the fix did once the place was found: 16 of Opus 5.5's 28 failed tries there were in the right place with an incomplete or wrong fix, against 6 of Fable 5.2's 14.
- **We learned that Fable 5.2 looks up the upstream answer far more often when it can. You should close every network route to later versions of the code under test, registries included, when you evaluate an agent on real repositories.** Fable 5.2 reached for the task's own upstream code in 31 of 214 tries: 16 tried to fetch, check or search for it and 4 got it back, and the other 15 only probed the repository or listed its refs. Opus 5.5 did so once, and got code back. Without those 5 tries, Fable 5.2 is still measurably higher: +5.7 points (95% range: +0.5 to +11.3).

**How to read the numbers.** A pass rate is the share of tries that passed the repository's own tests, averaged over each model's two tries per issue. A "95% range" means the true value is very likely inside it; when the range for a difference includes zero, the run did not show a difference. Cost is list price, measured on every API call through our metering proxy.

## The question and the answer

**Question (from Garry):** is there a set of tasks where Fable 5.2 is enough better than Opus 5.5 to be worth about 2.8 times the cost? The last run ([fable-5-2-coding-cc322-2026-11](../2026-11-12-fable-5-2-coding-cc322/report.md)) found no pass-rate difference on 52 Terminal-Bench tasks at 2.80 times the cost per solve, and a read of its traces suggested Fable 5.2 wins when it has to work out where the fault is. This run tested that on 107 fresh, real GitHub issues.

**Answer:** yes, but not the set we predicted. On these hard real-repository issues Fable 5.2 is measurably better across the board, at about 2.5 times the cost per solve and about $31 per extra solve. We found no sign that its lead depends on whether the issue text points at the fix, though this sample could miss a split smaller than 16.1 points.

## The decision rule, as preregistered

From [PREREGISTRATION.md](PREREGISTRATION.md), fixed before any trial:

- **The prediction is disproved** if the interaction (the "needs diagnosis" group's difference minus the "pointed" group's) is zero or below. It was -0.8 points, so it is disproved.
- **What that changes:** the provisional rule in our own agent setup ("when Opus 5.5 fails because its first approach was a dead end and the task needs a diagnosis, hand it to Fable 5.2 once") is withdrawn, and the report says plainly that the pattern the traces suggested did not hold on fresh tasks.
- **Either way:** if Fable 5.2 is measurably higher across all 107 tasks, the report says so and gives its cost per solve. It is, so this report does.
- **The premium:** where Fable 5.2 is measurably higher, the report gives the extra cost per extra solve and calls the premium "worth considering"; whether it pays is the reader's call against what a solved issue is worth to them.

## Full results

Primary analysis, as preregistered: [results/analysis/analysis.md](results/analysis/analysis.md) (`bun scripts/frontier-harbor/feature-split.ts --trials results/merged/trials.jsonl --labels labels.json --out results/analysis`). Differences are Fable 5.2 minus Opus 5.5, paired by task, with a task bootstrap 95% range (10,000 draws, seed 20261114; the interaction uses seed 20261115).

| Group | Tasks | Fable 5.2 | Opus 5.5 | Difference [95%] | Fable lower / same / higher | Cost per solve, Fable / Opus | Cost ratio [95%] | Extra cost per extra solve | Reading |
|---|---|---|---|---|---|---|---|---|---|
| Needs diagnosis (issue names no changed file) | 49 | 70.4% | 64.3% | +6.1 [-2.0, +14.3] | 2 / 40 / 7 | $4.54 / $1.65 | 2.75x [2.32x, 3.20x] | $34.87 | no measurable difference |
| Pointed (issue names a changed file) | 58 | 69.0% | 62.1% | +6.9 [+0.0, +14.7] | 4 / 45 / 9 | $4.71 / $2.04 | 2.31x [1.94x, 2.70x] | $28.69 [$11.99, $208.47] | no measurable difference |
| **All tasks** | **107** | **69.6%** | **63.1%** | **+6.5 [+0.9, +12.6]** | **6 / 85 / 16** | **$4.63 / $1.86** | **2.49x [2.20x, 2.80x]** | **$31.34 [$15.92, $150.61]** | **Fable 5.2 higher** |

- **Interaction (the prediction):** -0.8 points [-12.1, +10.7]. The smallest interaction this sample could detect 80% of the time is 16.1 points, so an interaction smaller than that could still exist; but the estimate's sign is wrong for the prediction, and the rule reads that as disproved.
- **Smallest detectable difference per group:** 12.0 points on the 49 "needs diagnosis" tasks and 11.1 points on the 58 "pointed" tasks. Neither group's difference reaches that, which is why each group alone reads as "no measurable difference" while the 107 together show one. On all 107 tasks it is 8.1 points; the observed +6.5 is below that, but its 95% range still excludes zero.
- **Tries:** 214 per model, none excluded (no model, infra or exam errors) and no reruns. The "needs diagnosis" group's extra cost per extra solve has no range because some bootstrap draws have no extra solves.
- **What the label may also track:** as the preregistration warned, the label may also track feature requests against bug reports, because a feature request often names the new file in its interface section. We did not split the tasks that way, so this run cannot say how much of either group is which.
- **Training data:** the issues are from July 2026 and neither model's training cutoff is published, so some issues may predate a cutoff; that would affect both arms.
- **In raw counts:** Fable 5.2 passed 149 of 214 tries and Opus 5.5 135 of 214. Paid model spend was $689.94 for Fable 5.2 ($3.224 a try) and $251.19 for Opus 5.5 ($1.174 a try).

## Checks on the headline (sensitivity lines, all descriptive)

| Check | Fable 5.2 minus Opus 5.5, all tasks [95%] | Interaction [95%] |
|---|---|---|
| Every trial (primary) | +6.5 [+0.9, +12.6], 107 tasks | -0.8 [-12.1, +10.7] |
| Without the 5 tries that fetched a later release of the task's own code | +5.7 [+0.5, +11.3], 106 tasks | -2.7 [-13.6, +7.8] |
| Without safety-filter stops | unchanged: there were none | unchanged |

- **Safety filter:** 0 tries were stopped by the API safety filter, against 17 of 34 failed tries in the last run. `refusals.ts` found no refusal marker in any of the 428 tries, no trial ended with `AgentSafetyRefusalError`, and a hand search of every transcript for refusal stops found only one hit, which was repository documentation the agent read, not a stop.
- **Fetches of the fixed code** ([results/contamination/release-fetch.md](results/contamination/release-fetch.md), counted by the new `scripts/frontier-harbor/release-fetch-audit.ts` under [amendment 1](amendments/2026-11-15-contamination-rule.md)'s rule): a try counts when its transcript shows it fetched the task repository's own code at a ref other than the task's base commit, from any host. Egress logs were not kept per trial, so the transcripts are the only source.
  - **Fetched:** 5 tries, 4 Fable 5.2 and 1 Opus 5.5, all passing. Fable 5.2 downloaded later releases from PyPI (agno-8148 once, Rapid-MLX-426 twice) and the Go module proxy (gotd td-1759 once); Opus 5.5 downloaded a later marimo release from PyPI (marimo-9766 once). Each of these tries then read the files the fix changes.
  - **Tried and got no code back:** 27 more tries, all Fable 5.2. 12 tried to fetch, check or search for code (9 failed, 3 with no clear result in the transcript) and 15 only probed the repository or listed its refs. Most errors the transcripts show are GitHub refusing the connection, as the egress blocklist intends; 4 of the probes ran `git ls-remote origin` in a checkout with no remote, so they failed before leaving the container.
  - Rapid-MLX-426 drops out of the sensitivity line entirely, because both of its Fable 5.2 tries fetched.
  - **Not counted by the rule, but worth knowing:** both Opus 5.5 tries on vinext-1371 fetched Next.js test files at v16.2.6 from jsDelivr. vinext reimplements Next.js, so those tests describe expected behaviour. All four vinext-1371 tries passed, so the paired result doesn't move.
- **The label still matches:** `diagnosis-label.ts --check` recomputed every label from the downloaded dataset and found no difference (50 "needs diagnosis" and 61 "pointed" on all 111 tasks).

### Per language (descriptive; five small slices, so expect one to look notable by chance)

| Language | Tasks | Fable 5.2 | Opus 5.5 | Difference [95%] | Smallest detectable difference | Cost ratio [95%] | Extra cost per extra solve | Interaction [95%] |
|---|---|---|---|---|---|---|---|---|
| Go | 21 | 69.0% | 76.2% | -7.1 [-14.3, +0.0] | 11.0 | 3.08x [2.56x, 3.77x] | n/a (Fable solved fewer) | +0.0 [-17.9, +14.3] |
| Java | 17 | 55.9% | 55.9% | +0.0 [-14.7, +11.8] | 20.8 | 2.24x [1.51x, 3.47x] | n/a | -23.6 [-52.1, +0.0] |
| Python | 20 | 67.5% | 47.5% | +20.0 [+5.0, +37.5] | 23.6 | 2.03x [1.31x, 2.76x] | $9.91 [$4.86, $30.84] | +7.1 [-25.0, +44.0] |
| Rust | 25 | 68.0% | 60.0% | +8.0 [-2.0, +20.0] | 15.5 | 2.61x [1.99x, 3.28x] | $40.42 | -13.5 [-41.3, +11.8] |
| TypeScript | 24 | 83.3% | 72.9% | +10.4 [+0.0, +22.9] | 16.8 | 2.22x [1.79x, 2.67x] | $16.37 [$7.49, $77.25] | +22.7 [+1.4, +45.5] |

- Python is the only language where Fable 5.2's lead has a range above zero, and there each extra solve cost about $10. On Go, Fable 5.2 solved slightly fewer (3 tasks lower, none higher).
- TypeScript is the only language where the interaction points the predicted way with a range above zero. With five slices and ranges this wide, we read neither as a finding; each is a lead for a future run.
- The groups are not balanced by language (Rust is 16 of the 49 "needs diagnosis" tasks and 9 of the 58 "pointed" ones), as the preregistration said.

## Time and context

| | Fable 5.2 | Opus 5.5 |
|---|---|---|
| Tries that hit the 3,000-second agent time limit | 14 (9 of them still passed) | 7 (6 still passed) |
| Median minutes per try | 16.0 | 12.4 |
| 90th-percentile minutes per try | 40.2 | 37.7 |
| Median peak context per try (tokens) | 77,779 | 54,234 |
| 90th-percentile peak context | 175,504 | 114,042 |
| Largest peak context | 483,929 | 312,431 |
| Tries past 200K tokens of context | 14 | 2 |

- Minutes are wall time with four trials running at once per VM, so they are contended. Peak context is the largest single request (input plus output tokens) each try sent, from the metering proxy's usage log.
- A try that hits the agent time limit is still graded on what it left behind, so a time-limit hit is not a fail by itself.
- Unlike the last run, some tries here went well past 200K tokens, mostly Fable 5.2's. No try reached 500K, half of either model's 1M-token window.

## What separated the two models: the blind read

[post-run-trace-read.md](post-run-trace-read.md) reads the 88 tries on the 22 issues where the two models' pass counts differ, with model names, costs and token counts removed and the models labelled X and Y at random per issue (seed `20261114:<task>`). Three Opus 5.5 readers each read a disjoint set of issues (Opus 5.5 is one of the two models under test, reading blind, as in the last run's read); the per-issue reads are in [post-run-trace-read/reads/](post-run-trace-read/reads/). The export script is [post-run-trace-read/export-blind.py](post-run-trace-read/export-blind.py).

- **No failed try was in the wrong place.** Of the 42 failed tries on these issues (Fable 5.2 14, Opus 5.5 28), none went to the wrong file or function. So "has to find where the fault is" did not decide these issues.
- **The fix's shape did.** 22 failed tries (Fable 5.2 6, Opus 5.5 16) were in the right place but incomplete or wrong, and 3 more (Fable 5.2 1, Opus 5.5 2) went beyond what the issue asked. The repeatable differences were about which existing behaviour to keep: keeping an existing window rule instead of redesigning it (nanobot-4129), fixing dev mode as well as production (vinext-1574), making the reported operation work instead of forbidding it (turso-7117). The one STRONG rating that favours Opus 5.5 is the same kind of judgement, the other way round: applying the new rule to an encoded-slash case too (floci-1325).
- **Ratings:** 5 STRONG (Fable 5.2 4, Opus 5.5 1), 9 WEAK (Fable 5.2 7, Opus 5.5 2), 8 NONE. One STRONG Fable 5.2 win, Rapid-MLX-426, came from downloading the package's later release and copying the upstream fix, which is looking up the answer, not judgement.
- **Limits:** 17 failed tries (Fable 5.2 7, Opus 5.5 10) have no cause the readers could pin down: in some they saw a difference from the passing fix, but they saw only pass or fail and not which hidden test failed. The readers also clearly disagreed with the mechanical label on 3 of the 22 issues, and judged 7 more only partly named, 2 labelled pointed and 5 labelled diagnosis (for example, turso-7117's issue text contains a changed file's path, but the readers judged the fault not named).

## Why the prediction failed

- **The feature was not where the models differed.** The last run's two Fable 5.2 wins were tasks where the obvious tool or approach failed. On these issues both models nearly always found the right place; they differed on how complete and how faithful the fix was.
- **The label is a weak proxy even for what it means to measure.** Readers clearly disagreed with it on 3 of 22 issues and partly on 7 more, because an issue can name a file without naming the fault, and name the fault without naming a file.
- **Enough samples for the overall effect, not for the split.** The run could detect a 16-point interaction; the overall lead is 6.5 points, so even a real split of half that lead would have been far below what this sample can see.

## What ran

- **Tasks:** 107 of the 111 hard tasks in the Harbor dataset `ibragim-badertdinov/swe-rebench-07-2026@2026-07` (Nebius's July 2026 SWE-rebench leaderboard snapshot, CC BY 4.0; each repository keeps its own licence): real GitHub issues in Go, Java, Python, Rust and TypeScript, each scored by the repository's own tests. 4 tasks were left out before any trial because their reference fix fails ([README.md](README.md)).
- **Arms:** Fable 5.2 (`anthropic:claude-fable-5-2`) and Opus 5.5 (`anthropic:claude-opus-5-5`) in plain Claude Code 2.1.322, effort high, each model's 1M-token window, web search and fetch off, no gstack, two tries per task. Every shard's clean-arm preflight found no gstack install, and every shard's run summary records 0 trials with a gstack file read in all 22 cells, 11 per arm ([results/shards/](results/shards/), run-summary.json).
- **Rig:** 11 Ubicloud standard-16 VMs, both models' tries for the same tasks on the same VM, four trials at a time, an egress blocklist (GitHub, Hugging Face, SWE-rebench and the Harbor hub's file store refused; package registries open), every model call through the metering proxy.
- **Commits:** the preregistration merged as 5f981093; shard s01 ran from 790160a6 and s02 to s11 from e5c9d8d9 (amendments 2 and 3), which differ only off the trial path ([deviations.md](deviations.md)).
- **Cost:** $941.14 of paid model calls at list price (Fable 5.2 $689.94, Opus 5.5 $251.19) and $42.47 of VMs, under the $3,630 lease total. The canary had projected $434.98 from its first 14 finished tries (10 Fable 5.2, 4 Opus 5.5), when Opus 5.5 had cost $0.49 a try, against $1.17 a try over the whole run.

## Deviations

See [deviations.md](deviations.md). In short: shards ran from two commits with the same trial path; the smoke-retry audit stopped and relaunched s06 before any counted trial; the controller machine slept for about five hours mid-run, which left finished VMs idle until they were re-attached and added about a quarter to the VM time of s02 to s11 (1.26 times what the trials needed; 1.00 to 1.63 times per shard), without touching any trial; and no trial was rerun.

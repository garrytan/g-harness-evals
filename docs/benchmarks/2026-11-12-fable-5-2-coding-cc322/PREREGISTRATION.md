# Fable 5.2 coding rerun on Claude Code 2.1.322: does Fable 5.2 still trail Opus 5.5 when Claude Code knows the model?

Status: DRAFT, written 2026-11-12 (UTC), before any trial of this run. Run id `fable-5-2-coding-cc322-2026-11`. Cells, shards and leases are in the four files `prereg-harbor-r1h1.json`, `prereg-harbor-r1h2.json`, `prereg-harbor-r2h1.json` and `prereg-harbor-r2h2.json` beside this file, and the recognition smoke is in `prereg-harbor-smoke.json`.

**In one line:** rerun [fable-5-2-coding-2026-11](../2026-11-09-fable-5-2-coding/PREREGISTRATION.md) exactly as it finally ran (its preregistration plus amendments 1 to 3), with one change: Claude Code 2.1.322 instead of 2.1.312, in all three arms.

**What this is not:** a new design, a harness comparison, a gstack or gbrain test, or a test of any non-Anthropic model. Every arm runs without gstack. The result is about these 52 tasks in Claude Code 2.1.322, not about coding in general. Headline reads speak only about the three models in Claude Code 2.1.322. Claude Code changed more than its model table between 2.1.312 and 2.1.322, for all three arms, so any statement about what recognising Fable 5.2 did comes only from the cross-run difference-in-differences line below, labelled as confounded with the date and with every other change between the two versions.

## Approval

- **Garry, 2026-11-12, via FOUN-32:** "P2 can we redo with the newest Claude code?"
- **Captain (HARN-1), 2026-11-12:** approved it as a like-for-like rerun of the plan approved under #366, with only the Claude Code pin changed, all three models kept, and the runtime smoke (the recognition smoke below) as a hard stop.
- **The original approval (2026-11-09)** and the Captain's approval of that plan are in [the original preregistration](../2026-11-09-fable-5-2-coding/PREREGISTRATION.md#approval).

## Why a rerun

- **Claude Code 2.1.312 did not know Fable 5.2.** It logged `[claude-code:unrecognized_model] {"model":"claude-fable-5-2",...}` in all 104 Fable 5.2 attempts and treated the model as a 200K-token model. So it compacted (summarised) the conversation at about 167K tokens in 3 attempts (winning-avg-corewars, install-windows-3.11, make-mips-interpreter). Fable 5.1 and Opus 5.5 got their real 1M window ([report](../2026-11-09-fable-5-2-coding/report.md)).
- **Claude Code 2.1.322 knows it.** 2.1.322 is npm `latest` (published 2026-11-10T01:58:41Z). Its linux-x64 binary's model table lists `claude-fable-5-2` with a native 1,000,000-token context window and 128,000 maximum output tokens. The 2.1.312 binary has no `fable-5-2` string at all. Both were read from the published binaries on 2026-11-12.
- **The repository's rule:** a changed pin is a new run (CLAUDE.md). So this run has its own folder, run id, preregistration and registry entry, and the 2.1.312 run's numbers stay as published.

## Hypotheses and decision rule (stated before any trial)

**Primary (H1): Fable 5.2 vs Opus 5.5, pass rate and cost per solved task (co-primary, as amendment 1 of the original made them).**

- What we expect: the 2.1.312 run measured Fable 5.2 10.6 points below Opus 5.5 (95% range 3.8 to 18.3 points below) at 3.34 times the cost per solved task (2.63x to 4.22x). Only 3 of 104 Fable 5.2 attempts compacted early, and all 3 passed. So we expect the recognition fix alone to move Fable 5.2's pass rate by a few points at most, and the gap to Opus to remain.
- Pass-rate reads, from the paired 95% interval of Fable 5.2 minus Opus 5.5:
  - upper bound below 0: "Fable 5.2 lower than Opus 5.5";
  - lower bound above 0: "Fable 5.2 higher than Opus 5.5";
  - otherwise: "no measurable difference".
- Cost reads, from the paired cost-per-solve ratio Fable 5.2 over Opus 5.5 with its 95% interval: "costs more" when the whole interval is above 1, "costs less" when the whole interval is below 1, otherwise "no measurable difference in cost".
- Non-inferiority line (descriptive, as amendment 1): Fable 5.2 is "within 10 points of Opus" when the one-sided 95% lower bound of its difference is above -10 points.
- **Recommendation rule for Claude Code users,** fixed now:
  - Opus 5.5 stays the coding default if Fable 5.2 is measurably lower in pass rate, or measurably more expensive per solved task.
  - The report says "no measurable difference on these tasks; choose on cost" only if neither is measurably worse.
  - The report recommends Fable 5.2 for coding only if its pass rate is measurably higher and its cost per solved task is not measurably higher.
  - Opus's ceiling (about 11 points of room) is stated beside every Opus comparison, as before. A null against Opus because of that ceiling gets the FIX-METHOD verdict named in the original's amendment 1 (a harder test-scored set), not a cut.

**Secondary (H2): Fable 5.2 vs Fable 5.1,** pass rate and cost per solved task, with the same interval reads. Both arms run on the same Claude Code version, and now both are recognised by it. What we expect: a small positive difference (the 2.1.312 run measured +4.9 points, 6.9 lower to 16.7 higher), likely below this run's smallest detectable difference. A null here gets the "Why null?" section.

**Descriptive third line:** Fable 5.1 vs Opus 5.5, as before.

**Comparison with the 2.1.312 run (descriptive, required in the report).** The report shows, next to the new numbers:

- a side-by-side table per arm: pass rate with its interval, cost per solved task, median and 90th-percentile minutes per attempt, attempts that disagreed, solved on both attempts, early compactions, `unrecognized_model` attempts, refusals, time limits, rate limits;
- the three pair results (both pairs and the third line) from each run, in one table;
- per arm, the paired per-task change from the 2.1.312 run to this run on the same 52 tasks (same bootstrap, seed and draw count), and the Fable 5.2 change minus the Opus 5.5 change and minus the Fable 5.1 change, so that drift that hits every arm (API speed, provider state, time of day) is separated from what the version change did to Fable 5.2.

These cross-run lines are never pooled, never counted as confirmatory, and are labelled as different dates and different Claude Code versions. The 2.1.312 baseline is that run's headline analysis input, `results/analysis-full-nostop/trials-full-nostop.jsonl` (310 records, sha256 `01150a8c36517c8a7552e07efcdcc81494d7bcf31d478a017c6731224d3816ba`), and its numbers are those of `results/analysis-full-nostop/analysis.json`. The cross-run per-task changes are recomputed from that file and this run's merged trial records, paired by task, with the same bootstrap (`clusteredPairedDelta`, seed 20261109, 10,000 draws). The 2.1.312 `unrecognized_model` and early-compaction counts come from its report for Fable 5.2 (all 104 attempts, and 3 compactions at about 167K tokens). No agent logs of its Fable 5.1 and Opus 5.5 attempts are committed, so those two cells are shown as not available.

## Recognition smoke: a hard stop before any counted trial

Before any counted trial, one paid Fable 5.2 trial runs on one Ubicloud VM from the merged preregistration commit (`prereg-harbor-smoke.json`: cell `fable52-smoke`, run id `fable-5-2-coding-cc322-2026-11-smoke`, one attempt of winning-avg-corewars, shared-order position 25, lease $40). That task compacted at about 167K tokens under 2.1.312 and has the largest Fable 5.2 cost per attempt there ($12.15 and $14.21), so it is the one most likely to grow past 200K tokens.

The run goes on only if all of these hold:

1. the installed binary is 2.1.322 (`claude --version`) and its sha256 is the pinned `bfb3703a...` (agents.py refuses any other);
2. **no line containing `unrecognized_model`** in any of the trial's agent logs (Claude Code's stream-json output and debug output);
3. **no compaction before about 900K tokens:** no `compact_boundary` system event whose `compact_metadata.pre_tokens` is below 900,000. Claude Code 2.1.322 compacts at the window less 20,000 tokens reserved for output and a 13,000-token buffer, which is about 967,000 for a 1M window and 167,000 for a 200K window (the point the 2.1.312 run hit);
4. the captured agent-loop requests carry `output_config.effort: high`, adaptive thinking and max_tokens 128,000, the same check as the original's amendment 1.

**The scan for checks 2 and 3** is `bun scripts/frontier-harbor/recognition.ts --model anthropic:claude-fable-5-2 --out <scan.json> <results dir>`. It exits 1 and names each trial that has an `unrecognized_model` line, a compaction below 900,000 tokens, a compaction whose size it cannot read, or no agent log to scan, and it records each trial's peak context.

**Any `unrecognized_model` line, or any compaction below 900,000 tokens, stops the run before the first counted trial.** No counted shard starts, and a dated amendment or a new run id decides what happens next. The same holds for a failed check 1 or 4.

- If the smoke trial's context never passes 200,000 tokens, check 3 is not exercised. The report says so, and the run goes on (checks 1, 2 and 4 still gate it). The peak context of the smoke trial is reported.
- The same scan runs again on the canary's first finished Fable 5.2 trial before the other 11 shards launch, with the same stop rule. The canary shard writes its trials.jsonl only when it ends, so this scan reads its raw Harbor trial directories as they are copied off the VM: `bun scripts/frontier-harbor/recognition.ts --jobs <canary results>/run/jobs --model anthropic:claude-fable-5-2 --out <scan.json>`, which scans every trial that has finished. It runs once more on every Fable 5.2 trial at the end, in the trials.jsonl form above. The report gives per-arm counts of `unrecognized_model` attempts and of compactions with their `pre_tokens`.
- The smoke trial is not counted and never enters the analysis. Its record, cost and the four checks are reported.

## Tasks

Unchanged from the original:

- **The 52 pinned Terminal-Bench 2.1 tasks** of the frontier Harbor path (`scripts/frontier-harbor/pin.json`, task_selection), at TB2.1 commit `d49e28f1e4ddd13d289e85a5f312a66750951932`, through Harbor 0.24.0, each scored by its own tests (the verifier reward). No model judge is used anywhere in this run.
- **Shared order:** sha256("harn50-frontier-2026-11-07\0<task id>"); the first half is positions 0 to 25 and the second half positions 26 to 51.
- **Headroom:** Opus 5.5 passed 89.4% of these tasks in the 2.1.312 run, so Fable 5.2 can beat it by at most about 11 points here. This ceiling is stated with every Opus comparison.
- **Hard subset (secondary, descriptive):** the same 14 tasks: filter-js-from-html, sam-cell-seg, model-extraction-relu-logits, configure-git-webserver, mteb-retrieve, pytorch-model-cli, nginx-request-logging, video-processing, sanitize-git-repo, mailman, install-windows-3.11, make-doom-for-mips, pytorch-model-recovery, query-optimize.

## Arms

| Arm | Model id | Harness | Attempts per task |
|---|---|---|---|
| Fable 5.2 | `anthropic:claude-fable-5-2` | Claude Code 2.1.322 | 2 |
| Fable 5.1 | `anthropic:claude-fable-5-1` | Claude Code 2.1.322 | 2 |
| Opus 5.5 | `anthropic:claude-opus-5-5` | Claude Code 2.1.322 | 2 |

- **Settings are identical across arms and identical to the original:** the model's real 1M context window (`CLAUDE_CODE_AUTO_COMPACT_WINDOW=1000000`) and 128,000 max output (`CLAUDE_CODE_MAX_OUTPUT_TOKENS`), effort high (adaptive thinking plus `output_config.effort: high`, `CLAUDE_CODE_EFFORT_LEVEL=high`), hosted web search and web fetch off (`--disallowedTools WebSearch,WebFetch` and refused by the metering proxy), the task container behind the egress blocklist, retries off. Claude Code's small-fast housekeeping model is pinned to the cell model by our settings, as in every earlier run (a declared deviation). Every environment variable name these settings use is present in the 2.1.322 binary.
- **Timeouts and scoring:** each task's own Harbor agent and verifier timeouts, unchanged; the scoring rules below are the original's.
- **Prices:** the same dated price table, `runner/pricing/prices-2026-11-09.json` (Fable 5.2 at $8 input, $10 five-minute cache write, $0.20 cache read and $40 output per million tokens). The platform.claude.com pricing page still shows these Fable 5.2 rates on 2026-11-12.
- **Effort rule (unchanged):** a trial whose agent-loop requests did not all send effort high is `infra_error` with class `effort_mismatch`, excluded from its pairs and counted per arm.

**The only change: the Claude Code pin.** The frontier Harbor path pins Claude Code 2.1.312 for every run that uses it, and two runs that use it are not yet reported. So this run does not move that default. Instead, the preregistration pull request adds Claude Code 2.1.322 as a pinned release in `scripts/frontier-harbor/pin.json` (npm integrity `sha512-oP7oW4vM...` and native binary sha256 `bfb3703ad5380242328459bc62ada4bde8ae7ba57c6e1eeadb9c00e08874c478`, which is also the linux-x64 checksum in downloads.claude.ai's 2.1.322 manifest), and each of this run's plan files selects it with `"harness_versions": {"claude-code": "2.1.322"}`. plan.ts passes that version to Harbor, and agents.py checks the installed binary against that release's sha256. With no `harness_versions`, every job renders byte for byte as before (the canary-gstack golden tests check this). The pull request also gives compare-models.ts a `--run-id` option so that this run's analysis.json carries its own run id; its default output is unchanged (the fable-5-2-coding analysis regeneration test checks this). It also makes each shard's manifest.json record the Claude Code version the plan file selects, and adds `scripts/frontier-harbor/recognition.ts`, the scan behind the recognition smoke's hard stop (both with keyless tests).

## Sharding and timing

- **12 shards on Ubicloud,** one standard-16 VM each, through `scripts/ubicloud/fanout.sh --workload frontier-harbor`, with UBI_OWNER set to the running thread's code. One shard per arm x attempt x task half: 26 trials, 4 at a time (wall time labelled "contended"). Each cell runs on exactly one VM; no cell is split. Attempt 2's cells are named `<arm>-r2h<n>`; the analysis counts them as attempt 2.
- **Order:** the recognition smoke VM first. Then one canary shard (fable52-r1h1). Then the other 11 together, once the canary has finished one scored trial, copied it off the VM, and passed the recognition scan and the request check. The canary therefore runs about 20 to 30 minutes ahead of the other shards; this is declared here.
- **No keyless per-VM install check.** fanout.sh's keyless check runs the frontier path's default pins (Claude Code 2.1.312 on Opus 5.5 and Fable 5.1, plus other harnesses), so it would not test this run's binary. The recognition smoke replaces it: it installs 2.1.322 through the same Harbor route, checks the binary's sha256, and runs a real Fable 5.2 trial. Every VM runs with `--no-smoke`, the smoke VM included, as the original's 11 shards did after amendment 2.
- **Capacity:** a VM that waits for capacity or is refused for quota is re-queued by fanout.sh, up to three tries (the original's amendment 3 rule, already on main). A shard that still never starts is named in the report, and only exactly those shards are rerun under a dated amendment, unchanged.
- **VMs:** UBI_TTL_HOURS=7 and `--timeout-hours 6` on every VM. run-shard.sh stops a shard half an hour before its VM's TTL ends, so neither backstop can come before the time stop unless a VM's setup takes more than an hour and a half, which the report would name. Results are copied off each VM while it runs (Claude Code session folders made readable on the VM, as in the original's amendment 2), every VM is destroyed on exit, and `ubi-runner.sh list --mine` is checked empty at the end.

## Stop rule and money

- **Leases:** $120 per shard (12), plus $25 reserve per plan file: $1,540. The smoke has its own $40 lease and $10 reserve: $50. **Total cap $1,590.** These are runaway protection, not expected spend. Each lease is above its headroom floor (Fable 5.2 $63.15, Fable 5.1 $78.94, Opus $31.58, smoke $15.79, from `plan.ts show`). A lease stop ends that shard; its unrun trials are reported as incomplete and are not retried.
- **The one money change from the original:** the 4 Opus leases are $120 instead of $60. In the 2.1.312 run, 2 Opus attempts were refused by the lease with $10.23 spent, because 4 concurrent attempts' worst-case reservations passed $60, and they were excluded. The higher lease removes that artifact and costs nothing unless spent.
- **Time stop:** every shard still running 5 hours after the canary's first counted trial started is stopped, and its unfinished trials are reported as incomplete and not scored. The original's time stop was a clock time set for a same-day flash eval. The longest shard there took about 2 hours of trials, so 5 hours only guards against a stuck run. It comes before the VMs' 7-hour TTL and 6-hour shard timeout (see Sharding and timing).
- **Expected:** about $400 to $500 of paid counted trials (the 2.1.312 run's 12 complete shards cost $402.50: Fable 5.2 $167.46, Fable 5.1 $179.43, Opus $55.62, each rounded to the cent, so the parts add to $402.51), plus $10 to $25 for the smoke trial, plus about $10 of VMs. Spend lines go in an internal spend file, not in the report.

## Analysis

Unchanged from the original and its amendment 1:

- **Scored trials:** a pass when the verifier reward is 1. Fails, time limits, harness errors and provider refusals count as fails. `infra_error` trials (the harness never reached the model, an effort mismatch, a grader that did not run, a lease refusal, a rate-limited stop) are excluded pairwise and counted per arm. A trial unfinished at the time stop is reported as incomplete and not scored.
- **Tasks in the pairs:** every task with at least one scored attempt in both arms of the pair. A task's arm value is its pass share over its scored attempts.
- **The analysis script:** `scripts/frontier-harbor/compare-models.ts`, unchanged except for the `--run-id` label: paired per-task difference with a 95% task-cluster bootstrap interval (`runner/stats/paired.ts` clusteredPairedDelta, **seed 20261109, 10,000 draws**), tasks lower and higher, pass rate per arm with a task-bootstrap interval, cost per solved task per arm and the paired cost ratio with 95% intervals, median and 90th-percentile wall time, pass^2 and rerun flip. It refuses any cell outside the 12 preregistered cells. No multiplicity correction; every line is reported.
- **Smallest detectable difference (80% power, two-sided 0.05, 52 tasks, 2 attempts per arm):** about 10 points for Fable 5.2 vs Opus 5.5 and about 16 points for Fable 5.2 vs Fable 5.1, from the 2.1.312 run's own variance on these tasks and attempts (10.4 and 16.3 there). The original's planning values, 14 and 16 points, are the conservative bounds. About 32 points on the hard subset.
- **Rate limits:** a trial that stopped after an upstream 429 is `infra_error` (`rate_limited`). If more than 10% of any arm's trials are rate limited, the report calls that arm incomplete and gives a line scoring them as fails.
- **Refusals:** count as fails; counted per arm with `scripts/frontier-harbor/refusals.ts`, plus a line without refused trials. Cyber-filter stops that the counter misses (as on FEAL in the 2.1.312 run) are counted from the transcripts.
- **Sensitivity lines, fixed now** (all descriptive, each for both pairs, pass rate and cost ratio): only tasks with both attempts scored in all three arms; without refused attempts; without the two FEAL cryptanalysis tasks (this line was chosen after the 2.1.312 run's data and is labelled so); without API calls the egress sidecar cut at 15 seconds and resent; also without full-reservation charges on stalled streams (read from each record's `usage.usd_reserved`).
- **Secondary metrics:** as listed above, plus the hard-subset differences, counts of time limits, refusals and API errors per arm, and the drift lines against the 2.1.312 run.
- **Why null?** If a primary or secondary comparison is null, the report carries a Why null? section (exposure, fit, power and saturation, model) and a KEEP, FIX-METHOD or CUT-CANDIDATE verdict.

## Deviations declared in advance

- **Same rig, newer main.** The run executes from the merged preregistration commit, not from the original's commits. Main has changed in the run's code path since then (mostly the gstack arm machinery, to-trials.ts record fields and the analysis headroom gate). With no gstack arm and no `harness_versions`, plain Claude Code cells render byte for byte the recorded settings and job configs (canary-gstack golden tests), and compare-models.ts reproduces every committed analysis of the 2.1.312 run byte for byte (fable-5-2-coding analysis regeneration test). Two known rig defects of the 2.1.312 run are still on main and are kept, like for like: the egress sidecar's 15-second cut of slow API calls, and full-reservation charges on stalled streams. Both get the sensitivity lines above.
- **No keyless per-VM install check;** the recognition smoke replaces it (see Sharding and timing).
- **Time stop as a duration** rather than a clock time (see Stop rule and money).
- **The preregistration lands in its own pull request before the first trial,** and the results follow in a second one. Unlike the original, there is no shared-PR deviation.

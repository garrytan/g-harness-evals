# Fable 5.2 coding preregistration: is Claude Fable 5.2 better than Fable 5.1 and Opus 5.5 at agentic coding?

Status: written 2026-11-09 (UTC), before any trial of this run. Run id `fable-5-2-coding-2026-11`. Cells, shards and leases are in the four files `prereg-harbor-r1h1.json`, `prereg-harbor-r1h2.json`, `prereg-harbor-r2h1.json` and `prereg-harbor-r2h2.json` beside this file.

**In one line:** run Claude Fable 5.2, Claude Fable 5.1 and Claude Opus 5.5 in Claude Code, at the same time, on the same 52 Terminal-Bench 2.1 tasks, with the same settings, and compare pass rate, cost per solved task and time per trial.

**What this is not:** a harness comparison, a gstack or gbrain test, or a test of any non-Anthropic model. Every arm runs without gstack. The result is about these 52 tasks in Claude Code, not about coding in general.

## Approval

- **Garry, 2026-11-09:** "can we do a flash eval of fable 5.2 that gets done in the next 4 hours so we can make a post about how much better fable 5.2 is vs opus 5.5 and fable 5.1?" The Captain (HARN-1) passed this on as the approval and wrote the design brief. The brief also says: the post will say whatever the data says, and if Fable 5.2 isn't better, the finding says so plainly.
- **Captain (HARN-1), 2026-11-09:** approved this plan as written.

## Question

On real agentic coding tasks in Claude Code, does Claude Fable 5.2 pass more tasks than Claude Fable 5.1 and Claude Opus 5.5, and what does each cost per solved task?

- **Estimand:** the mean over tasks of each task's pass share (passes over scored attempts), per arm, and the paired per-task difference between arms.
- **Primary comparisons (2):** Fable 5.2 minus Fable 5.1, and Fable 5.2 minus Opus 5.5. Fable 5.1 minus Opus 5.5 is reported as a descriptive third line.

## Tasks

- **The 52 pinned Terminal-Bench 2.1 tasks** of the frontier Harbor path (`scripts/frontier-harbor/pin.json`, task_selection), at TB2.1 commit `d49e28f1e4ddd13d289e85a5f312a66750951932`, through Harbor 0.24.0. Every task is scored by its own tests (the verifier reward); no model judge is used anywhere in this run.
- **Why this set:** it is the largest test-scored coding set the frontier Harbor path runs. How the 52 were chosen (from DeepSeek V4.1 Flash leaderboard data, not from any arm here) is in [the frontier harness preregistration](../2026-11-07-frontier-harness/PREREGISTRATION.md#tasks).
- **Shared order:** the same order as frontier-harness-2026-11, sha256("harn50-frontier-2026-11-07\0<task id>"). The first half is positions 0 to 25 and the second half positions 26 to 51.
- **Headroom check (from existing receipts, no new spend).** Two days ago, with these settings, Opus 5.5 in Claude Code passed 87.5% of trials on the 52 (91 of 104; 90.4% of tasks at attempt 1) and Fable 5.1 passed 71.2% (one attempt). So the set leaves room above Fable 5.1, but **Opus 5.5 is near the ceiling: Fable 5.2 can beat it by at most about 12 points here.** No harder test-scored set is pinned. This ceiling is stated with every Opus comparison.
- **Hard subset (secondary, chosen before any trial):** the 14 tasks whose pooled pass rate in frontier-harness-2026-11's GPT-6.1 Sol and GPT-6 Astra cells (Codex, Hermes, OpenClaw, Pi on Sol; Codex, OpenClaw on Astra; 10 trials per task) is below 0.75. It uses no data from any arm of this run. In shared order: filter-js-from-html, sam-cell-seg, model-extraction-relu-logits, configure-git-webserver, mteb-retrieve, pytorch-model-cli, nginx-request-logging, video-processing, sanitize-git-repo, mailman, install-windows-3.11, make-doom-for-mips, pytorch-model-recovery, query-optimize.

## Arms

| Arm | Model id | Harness | Attempts per task |
|---|---|---|---|
| Fable 5.2 | `anthropic:claude-fable-5-2` | Claude Code 2.1.312 | 2 |
| Fable 5.1 | `anthropic:claude-fable-5-1` | Claude Code 2.1.312 | 2 |
| Opus 5.5 | `anthropic:claude-opus-5-5` | Claude Code 2.1.312 | 2 |

- **Settings are identical across arms** and are the frontier-harness-2026-11 Claude Code settings unchanged ([scripts/frontier-harbor/frontier_settings.py](../../../scripts/frontier-harbor/frontier_settings.py)): the model's real 1M context window and 128,000 max output, effort high (adaptive thinking plus `output_config.effort: high`) through Claude Code's own setting, hosted web search and web fetch refused by the metering proxy, the task container behind the egress blocklist, retries off. Claude Code's small-fast housekeeping model is pinned to the cell model by our adapter, as in every earlier run (a declared deviation).
- **The only rig changes** are two new rows: `anthropic:claude-fable-5-2` in pin.json's model limits, and a new dated price table `runner/pricing/prices-2026-11-09.json` (prices-2026-11-07 plus Fable 5.2 at $8 input, $10 cache write, $0.20 cache read and $40 output per million tokens, platform.claude.com pricing page read 2026-11-09), with the same row in the ledger's price list.
- **Effort rule (unchanged):** a trial whose agent-loop requests did not all send effort high is `infra_error` with class `effort_mismatch`, excluded from its pairs and counted per arm. If the canary's first Fable 5.2 trial shows effort_mismatch, nothing else starts and a dated amendment decides.

## Sharding and timing

- **12 shards on Ubicloud,** one standard-16 VM each, through `scripts/ubicloud/fanout.sh --workload frontier-harbor` with UBI_OWNER=HARN-69. One shard per arm x attempt x task half: 26 trials, 4 at a time (wall time labelled "contended"). The frontier Harbor plan allows one cell per model and harness in a preregistration file, so the 12 cells sit in four files of three, one file per attempt and half. Each cell runs on exactly one VM. Attempt 2's cells carry trial ids ending `a1` under cell names `<arm>-r2h<n>`; the analysis counts them as attempt 2.
- **Interleaving:** every arm has the same layout and the same task order, and all shards run at the same time. Order: one canary shard first (fable52-r1h1), then the other 11 once the canary has finished one scored trial and copied it off the VM. The canary therefore runs about 15 to 20 minutes ahead of the other shards; this is declared here.
- **Smoke:** each VM's keyless install check (fake upstream, no keys, no spend) runs before its paid trials. The oracle and nop baseline gate is not rerun: it passed on all 60 pinned tasks at these pins for frontier-harness-2026-11 and nothing in the task pins changed.
- **VMs:** UBI_TTL_HOURS=6 on every VM, results copied off each VM while it runs, every VM destroyed on exit, `list --mine` checked empty at the end.

## Stop rule and money

- **Leases:** $120 per Fable shard (8), $60 per Opus shard (4), $1,200 in all, plus $25 reserve per file: a $1,300 cap. Each lease is above its headroom floor (Fable 5.2 $63.15, Fable 5.1 $78.94, Opus $31.58). A lease stop ends that shard, its unrun trials are reported as incomplete, and it is not retried.
- **Time stop:** at 22:45 UTC on 2026-11-09 every shard still running is stopped, whatever has finished, and its unfinished trials are reported as incomplete.
- **Expected:** about $450 of paid trials (Opus about $57, Fable 5.1 about $210, Fable 5.2 about $170 to $210, from frontier-harness-2026-11's cost per trial and the new price), about $25 of VMs. Spend lines go in spend-internal.md, not in the report.

## Analysis

- **Scored trials:** pass when the verifier reward is 1. Fails, time limits, harness errors and provider refusals count as fails. `infra_error` trials (the harness never reached the model, an effort mismatch, a grader that did not run) are excluded and counted per arm.
- **Tasks in the pairs:** every task with at least one scored attempt in both arms of the pair. A task's arm value is its pass share over its scored attempts.
- **Primary metric:** the paired per-task difference, Fable 5.2 minus each comparator, in points, with a 95% task-cluster bootstrap interval (`runner/stats/paired.ts` clusteredPairedDelta, seed 20261109, 10,000 draws), and the count of tasks where Fable 5.2's pass share was lower (tasks that got worse) and higher. **An interval that includes zero reads "no measurable difference".** No multiplicity correction across the 2 primary pairs; both are reported.
- **Minimum detectable difference (80% power, two-sided 0.05, 52 tasks, 2 attempts per arm),** from frontier-harness-2026-11's variance (between-task variance of the Fable 5.1 minus Opus difference, plus within-task variance from Opus's two attempts and Fable 5.1's two harness cells): **about 14 points for Fable 5.2 vs Opus 5.5 and about 16 points for Fable 5.2 vs Fable 5.1.** Smaller true differences will often read as no measurable difference. Against Opus, the ceiling (about 12 points of room) is below this MDD, so a "Fable 5.2 better than Opus" result is unlikely to be measurable on this set even if it is true.
- **Secondary metrics:**
  - pass rate per arm with a task-bootstrap 95% interval (`runner/stats/frontier.ts` taskBootstrapMean);
  - cost per solved task per arm (recorded USD over scored passes, `costPerSolve`) and the paired cost-per-solve ratio Fable 5.2 to each comparator (`pairedCostRatio`), 95% intervals; list price through our metering proxy;
  - median and 90th-percentile wall time per trial (contended);
  - the same paired differences on the hard subset (descriptive, MDD about 32 points);
  - counts of time limits, refusals and API errors per arm; rerun flip and pass^2 per arm;
  - drift: this run's Opus 5.5 and Fable 5.1 pass rates beside frontier-harness-2026-11's on the same tasks (descriptive, never pooled).
- **Why null?** If a primary comparison is null or negative, the report carries a Why null? section (exposure, fit, power and saturation, model).

## Deviations declared in advance

- One pull request holds this preregistration's commit and the results, at the Captain's instruction (CREW R77). This commit is pushed to origin before the first trial, and every runner attests it against origin. The registry entry declares `preregistered_on_main: false` with that reason.
- No fresh oracle and nop baseline gate (see Sharding and timing).
- The canary shard starts about 15 to 20 minutes before the others.

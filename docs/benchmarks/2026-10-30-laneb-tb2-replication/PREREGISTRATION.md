# Lane B replication, Part 1: the TB2 re-execution on Haiku 5.5: preregistration

Status: written 2026-10-30 (America/Los_Angeles), before any trial of this run. Labelled **dev**: public tasks, no held-out opening. Results are published in full.

**What it answers:** does Lane B's quick look 2 result reproduce when the same pinned agent, arms and tasks run through harness-evals' Lane B bridge ([docs/gstack-laneb.md](../../gstack-laneb.md)) and metering? On Haiku 5.5, quick look 2 found:
- gstack minus placebo **-20 [-28, -12]** points;
- gstack minus none -3 [-12, +7];
- placebo minus none +17 [+7, +27].

(Source: gstack-evals `wiki/board/2026-10-29-gsta-12-laneb-quick-2-results` at #35, merge `257db8e8`, with its body-load correction `2026-10-29-gsta-30-laneb-quick-2-body-load-correction`.)

**Where it comes from:** this is Part 1 of the Lane B replication internal-task asked for and approved on 2026-10-30 (design, $60 cap, internal-task funded). Part 2, opening 1 of a held-out gstack-native-v1 slice, is **deferred** (Harness Evals Captain, 2026-10-30). The hardened native recipes screened at ceiling: 0 of 12 candidates in the 20 to 80% band. So no native task or native number is part of this run. internal-task confirmed on 2026-10-30 that Part 1 is committed on its own, as approved.

## The run

| Run id | File | Tasks | Model | Arms | Tries | Trials | Spend cap |
|---|---|---|---|---|---|---|---|
| `laneb-tb2-replication-2026-10` | [prereg-tb2.json](prereg-tb2.json) | Lane B's 20 TB2 tasks | Haiku 5.5 | none, gstack, placebo | 3 | 180 | $11.00 |

- **Tasks:** the 20 tasks of Lane B's pinned `quick/laneb/tasks/final.json` (sha256 `1b424348...` in pin.json), in its order.
  - Terminal-Bench 2 at commit `69671fba`.
  - The materializer checks each task's source digest against the pinned `tasks.json` (`d3224e22...`).
- **Agent side:** Lane B's pinned agent at gstack-evals `443d582c` (tag `laneb-quick-2-runner`), unchanged: the agent, the prompt wrapper, the skill map (`/investigate` invoked by slash command on every task, as in quick look 2), Claude Code 2.1.312, claude-agent-sdk 0.2.174, Harbor `f3a5a923` and its `verifier_timeout_multiplier`.
- **Arms:**
  - `none` is an empty `~/.claude`.
  - `placebo` is the pinned placebo tar (`ff6b909d...`), the same one quick look 2 ran.
  - `gstack` is gstack `61e201ec`, run from the saved pack-equivalent rebuild in pin.json (tar `b9399468...`, dated deviation 2026-10-29: only the git pack's delta compression differs; 0 of 15,391 other files differ). Quick look 2 ran the original tar `737411ef...`. Every gstack record carries `laneb.arm_deviation`.
- **Grading:** each task's own TB2 verifier, through Harbor, exactly as Lane B's materializer writes it. A pass is reward 1 (`laneb.reward`).

## Shards and money

- **Funded by internal-task** out of its approved $60. The run's hard cap is $11.00.
- **Projection:** at quick look 2's measured Haiku cost (about $0.02 per trial: $1.22, $0.95 and $1.14 for 60 trials per arm), 180 trials cost about **$3.30**. The leases use $0.03 per trial for headroom.
- **Shards:** one per arm (whole cells, none split), each on its own Ubicloud VM through `scripts/ubicloud/fanout.sh --workload gstack-laneb`, with a clean checkout at this preregistration's commit, `--network allowlist`, and one trial at a time.
  - Leases from `plan.ts lease`: `haiku-none` $3.52, `haiku-gstack` $3.52, `haiku-placebo` $3.52, so $10.56 in total. Each is 60 trials x $0.03 x 1.4, plus Lane B's $1 Haiku session cap.
  - The ledger leases are named `laneb-tb2-replication-2026-10:<shard>`.
  - The dev pilot's TB2 smoke trial took 8 min 19 s, so a shard of 60 trials may run about 8 hours or more. Three shards are the most the crew's sharding rule allows for one model's three cells.
- **A shard stopped by its lease** is not retried under this run id. The report lists the trials that did not run.
- **The smoke before each shard** is the bridge's keyless smoke (fake upstream, no spend). The paid TB2 smoke this run waited on (`gn-pilot-tb2-smoke2-2026-10`, [Amendment 1 of the dev pilot](../2026-10-30-gstack-native-pilot/PREREGISTRATION.md)) ran one counted trial with spend on both meters. Measure 8 of the dev pilot is met.

## What is measured

**Which trials count.** Quick look 2's rule, so the numbers compare:
- a trial with a reward counts as its reward;
- a trial with no reward after a model response reached the agent counts as 0, and the report also shows the rates with those trials dropped;
- a trial where no model response reached the agent (`infra_error` before the first upstream 200, or a cap stop before it) does not count, and is listed by cell with its reason.

**1. Pass rate per arm.** Over counted trials, with a 95% task-clustered interval.

**2. The three contrasts, paired by task and repetition.**
- gstack minus placebo, gstack minus none, and placebo minus none.
- Method: `runner/stats/paired.ts` `clusteredPairedDelta` (task-clustered bootstrap, seed 7, 10,000 draws) and its two-sided sign-flip p, unchanged. The script that calls them over the merged `trials.jsonl` is committed with the results.
- These are dev estimates. No Holm family and no confirmatory claim: Part 1 checks the bridge against Lane B and adds a second sample of Lane B's own design.

**3. Reproduction verdict, per contrast** (fixed now):
- **reproduces:** our 95% interval overlaps quick look 2's and our point estimate has the same sign;
- **differs:** our 95% interval does not overlap quick look 2's;
- **unclear:** anything else (for example, intervals overlap but the signs differ).

The headline is the gstack minus placebo verdict. Two runs on different days are not a paired estimate, so the report also shows each arm's rate beside quick look 2's (none 47%, gstack 43%, placebo 63%).

**4. Body load (the manipulation check).**
- **The pinned probe does not discriminate.** At `443d582c` it matches `<command-name>` anywhere in the first request, including the Skill tool's description. In the dev pilot it read true on 32 of 32 none sessions. So it is reported but not used as the gate.
- **The gate uses first-request length,** the evidence internal-task's correction relies on. An invoked (gstack or placebo) session counts as body-loaded when its `laneb.first_req_prompt_tokens` is at least 6,000 above the largest value among this run's none sessions.
  - In the dev pilot, none sessions reached at most 20,712 tokens and invoked sessions started at 34,218.
  - In quick look 2, the smallest gap was 12,763.
- **Rule:** the gate passes when at least 90% of invoked sessions in each of gstack and placebo are body-loaded. If it fails, the contrasts that involve the failing arm are reported as "not measuring skill bodies".

**5. Placebo token match.** Median first-request tokens, placebo against gstack.

**6. Cost.**
- Per trial, per arm, and per success, from each record's `usage.usd` (our proxy), with Lane B's meter beside it.
- Each shard's ledger total is the authoritative spend.
- VM list price is reported separately.

**7. Integrity.** Per shard:
- the count of Harbor retries (must be 0);
- records with no session;
- `refused_budget` requests;
- `meter_delta_usd` beyond $0.01.

## Not done

- No held-out task and no gstack-native task.
- No Opus, no Sonnet, no DeepSeek or particle-1. The bridge meters only anthropic-routed models.
- No change to Lane B's pinned agent, arms, cells, skill map or wrapper.

## Report

Results and the report come in a later pull request, under this directory: `results/` (the merged shards, each shard's ledger and proxy log under its own name) and `report.md`. It covers every measure above with its receipt, the spend, the VM time, and every restart or deviation, with the commit each runner loaded. internal-task gets the counts, the verdicts, the spend and the digests.

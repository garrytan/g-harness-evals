# Frontier harness preregistration: does the harness matter on Opus 5.5 and GPT-6.1 Sol?

Status: written 2026-11-07 (America/Los_Angeles), before any counted trial of this run. Run id `frontier-harness-2026-11`. Cells, stages and shards are in [prereg-harbor.json](prereg-harbor.json); the analysis inputs are [analysis-spec.json](analysis-spec.json) and [analysis-spec-kept.json](analysis-spec-kept.json).

**In one line:** run the Harness Leaderboard's design on frontier closed models. For each model, put its home harness (Claude Code on Opus 5.5, Codex on GPT-6.1 Sol) beside Hermes, OpenClaw and Pi on the same 52 Terminal-Bench 2.1 tasks. Measure how far each third-party harness is from the home harness, and what each costs per solve.

**What this is not:** a ranking, a comparison across models, or a gstack or gbrain test. Every cell runs without gstack.

## Approval

- **Garry, 2026-11-07,** answering the core plan's gate: "Do it and figure out how our harness evals can be clearer better more obvious and also include gpt6 Astra and opus 5.5 and frontier closed models while being economical". He took every recommendation (A1 to I1). He also cleared featuring Hugging Face, the Laude Institute and the SWE-agent team (J1).
- **Captain (HARN-1), 2026-11-07:** "Concurrency of 4 per VM is my call, with time labelled contended". The Captain approved the extension (GPT-6 Astra, Gemini 4 Argon, Claude Fable 5.1) under Garry's words, because it fits the $2,000 and drops no core cell.
- **Plans:** core plan revision 2 and delta plan revision 2, in the Captain drive at `handoffs/HARN-50/autoplan/plan.md` and `handoffs/HARN-50/autoplan-delta/plan.md`.

## Question

On a frontier model, does a third-party harness solve as many tasks as the model's home harness, and at what cost per solve?

- **Estimand:** the mean pass rate on the 52 tasks below, per cell, and each third-party cell minus its home cell. The result is about these 52 tasks, not Terminal-Bench 2.1 as a whole.
- **Primary pairs:** 3 per model (Hermes, OpenClaw and Pi, each against the home harness), 6 in all.

## Tasks

- **Benchmark:** Terminal-Bench 2.1 at commit `d49e28f1e4ddd13d289e85a5f312a66750951932`, run through Harbor 0.24.0. Every task's source digest and image digest are pinned in [scripts/frontier-harbor/pin.json](../../../scripts/frontier-harbor/pin.json), and materialize.ts refuses a task that does not match.
- **The 52:** the TB2.1 tasks whose pooled pass rate is below 0.95. The rate is pooled over DeepSeek-V4.1-Flash at high effort in the five harnesses at the top of that model on the Harness Leaderboard (board v0.1.1): mini-swe-agent, Kimi Code, Hermes, Pi and Claude Code, 3 attempts each, 15 trials per task. 52 of the 87 scored TB2.1 tasks qualify. Hermes leads on DeepSeek only; mini-swe-agent leads the board overall.
- **Known bias:** the selection drops tasks that harnesses outside the board's top five (Codex and OpenClaw among them) may have failed. This can pull weaker harnesses' comparisons toward no difference. The kept sample below shows what happens on easy tasks.
- **Source data:** the leaderboard's public bucket, `index/public.json` generated 2026-11-07T13:08:58Z, the `-full-` DeepSeek high runs only (superseded and pilot copies excluded). The derived file's sha256 is `ca4a485fc7b83b92ee40fee88b7eeab9f6276b595e2a282c16dc401f20e02cee`. Its credits are in [THIRD_PARTY_NOTICES.md](../../../THIRD_PARTY_NOTICES.md).
- **Shared order:** one pre-randomized order of the 52, by sha256("harn50-frontier-2026-11-07\0<task id>"), used by every cell. Any cut to the first n tasks is a paired uniform random subset. The first six are adaptive-rejection-sampler, llm-inference-batching-scheduler, torch-tensor-parallelism, filter-js-from-html, cobol-modernization and write-compressor.
- **Kept sample:** 8 tasks the board already solves (pooled pass rate 1.0): hf-model-inference, count-dataset-tokens, portfolio-optimization, polyglot-rust-c, circuit-fibsqrt, mteb-leaderboard, extract-elf and password-recovery. They are the first 8 of the tasks at or above 0.95, sorted by the same seed rule. Each runs at 1 attempt in every core cell and is reported on its own, never pooled with the 52.

## Cells

| Model | Home harness | Third-party harnesses | Attempts on the 52 | Kept sample |
|---|---|---|---|---|
| Opus 5.5 (`anthropic:claude-opus-5-5`) | Claude Code | Hermes, OpenClaw, Pi | 2 | 1 |
| GPT-6.1 Sol (`openai:gpt-6.1-sol`) | Codex | Hermes, OpenClaw, Pi | 2 | 1 |

- **Harness settings:** each cell's settings are defined in [scripts/frontier-harbor/frontier_settings.py](../../../scripts/frontier-harbor/frontier_settings.py) and written to each trial's `harness_settings.json`. Claude Code, Codex, Hermes and OpenClaw run through Harbor classes that wrap our pinned adapter settings. Pi and mini-swe-agent use Harbor's stock classes, with every difference declared.
- **Limits:** each model's real context window and 128,000 max output tokens. The proxy starts with `--max-output-tokens 128000`. Codex 0.165.0 caps Sol's window at 872,000 tokens (`codex-rs/models-manager/src/model_info.rs:19-27`), which is declared.
- **Effort:** high, through each harness's native setting. That is adaptive thinking plus `output_config.effort: high` on Anthropic, and reasoning effort high on OpenAI.
- **Housekeeping calls:** a harness's own title or summary calls stay at its shipped defaults. They are metered and labelled "harness housekeeping, shipped default", and never scored. Examples are Hermes's session title with reasoning off, and Claude Code's small-fast model (pinned to the cell model by our adapter, a declared deviation).
- **QM:** the bonus QM cell is dropped. The install check found that QM's agent loop runs in QM core, with its commands in sandbox containers QM starts through the host Docker socket. Those containers cannot reach the task container's files, which are what the verifier grades.

## Effort rule (refuse or rewrite: decided)

- **Recorded, never rewritten:** the metering proxy records the effort every request sends and changes nothing.
- **Checked per trial:** to-trials.ts reads each trial's captured request bodies. Agent-loop requests are those on the cell model that declare at least one tool.
- **A miss is excluded:** a trial whose agent-loop requests did not all send effort high becomes `infra_error` with infra class `effort_mismatch`. It is excluded from its pairs and counted per cell. It is not a `harness_error`, because the run's settings, not the harness, failed to reach the model.
- **Evidence:** the keyless install check at this commit saw every agent loop send effort high, Pi on Opus included ([install-check.json](../../../scripts/frontier-harbor/install-check.json)).

## Run order

1. **Install check:** the keyless install check passes at this preregistration's commit, run through `fanout.sh --workload frontier-harbor`. It covers every agent class, oracle, nop, egress and the key canary.
2. **Baseline gate ($0 model spend):** `install-check.sh --baselines all` runs Harbor's oracle (must pass) and nop (must fail) on all 60 pinned tasks, behind the egress blocklist. If any task fails its baseline, nothing paid starts. A dated amendment then decides that task before stage 0.
3. **Stage 0 (counted).** Stage `stage0` in prereg-harbor.json:
   - attempt 1 on all 52 tasks for Claude Code on Opus and Codex on Sol;
   - attempt 1 on the first 6 tasks of the shared order for every other core cell (the cost probe).
   - **Leases:** each home shard runs under its planned lease, each other Opus shard under $40 and each other Sol shard under $20. Each is at least its headroom floor.
4. **Headroom gate, per model.** A model's remaining cells do not run if either holds:
   - its home harness passes at least 90% of the 52 tasks at attempt 1;
   - the stage-0 MDD for its pairs is above 30 points. This uses runner/stats/paired.ts powerNote on the home cell's per-task variance, assumed equal for each pair, at 52 tasks and 2 attempts.
   - **If it trips:** that model's money goes to the other model's attempt 3. If both models trip, the run stops with FIX-METHOD. Any ceiling-raise shares this eval's $2,000 tally, stage 0 included.
5. **Projection.** Each core cell is projected from its own stage-0 mean cost per trial. Home cells use their 52 trials. Other cells use their 6-task probe, scaled by the home cell's ratio of 52-task mean to first-6 mean. The projection goes to the Captain before any extension probe and says whether an Argon pair fits.
6. **Drop levels** if the projected core plus kept sample is above the plannable money:
   - (a) bonus cells never start;
   - (b) drop the kept sample;
   - (c) cut every core cell to the first 40 tasks of the shared order;
   - (d) stop and return to the Captain with the MDD.
   - **Garry hears first:** a level that drops a core cell goes to Garry before it is applied.
7. **Main stage:** every core and kept trial not yet run, on the same shards. A shard's main-stage lease is its planned lease less what its recorded stage-0 trials spent. check-shard enforces this from the `--done` files.
   - **Interleaving:** the home cells' attempt 2 runs during the main stage, alongside the other cells. Their drift from attempt 1 is reported (Claims below).
   - **Canary shard:** one canary shard starts first, and the others start once it has finished cleanly.
8. **Leftover money,** in this order, each by a dated amendment merged before it starts. No extension money is spent before the stage-0 projection exists, and nothing here may take money from a core cell or the kept sample.
   1. the Astra pair;
   2. the Argon pair;
   3. the Fable pair;
   4. the core grow rule: attempt 3 for every core cell;
   5. bonus cells: mini-swe-agent on Sol, then on Opus.
   - **Where the extension rules are:** under Extension below.

## Extension (descriptive)

- **Cells:** each extension model gets its home harness plus OpenClaw:
  - GPT-6 Astra: Codex and OpenClaw;
  - Gemini 4 Argon: Gemini CLI and OpenClaw;
  - Claude Fable 5.1: Claude Code and OpenClaw.
  - OpenClaw was fixed before any trial, from external data (the leaderboard's largest home-harness gap), not from this run.
- **Size:** 1 attempt on the first n tasks of the shared order. n is the largest of 52, 40 or 26 that fits. Below 26 the pair is skipped. Home and OpenClaw trials alternate task by task, and the report uses the largest complete paired prefix.
- **Probe:** the home harness on the first 6 tasks, counted as attempt 1. It runs only if the projection leaves at least the probe plus a 26-task pair for that model. The OpenClaw cell is projected from the probe times the OpenClaw-to-home cost ratio on the same family's core model: Sol for Astra, Opus for Fable, both pooled for Argon.
- **Drop order:** Fable first, then Argon, then Astra.
- **Headroom:** a family's pair is skipped if its core model hit the headroom gate. A pair stops when its home harness passes at least 90% of its first 26 tasks, keeping a cost-only row.
- **Leases:** extension cells run after the core, under their own lease. Concurrency is sized so that concurrency times the largest per-call reservation fits that lease. Astra's per-call reservation is $37.60 and Fable's is $19.73, from plan.ts perCallReserveUsd at this commit.
- **Argon:** runs only if a paid-tier Gemini key is present before its first probe. Otherwise it is skipped and its slot goes to Fable. The Gemini path (a Google upstream in the metering proxy and a Gemini CLI Harbor class) comes in its own amendment, only if an Argon pair is projected to fit and a key is provided. Every Argon trial is repriced at the standard rate ($4 input, $0.20 cached, $20 output per million tokens), with billed cost shown separately. OpenRouter is not used anywhere.
- **Claims:** estimates with intervals only. No test and no non-inferiority claim. Rerun flip, pass^2 and drift are not available for one-attempt rows. MDD bands at 80% power, recomputed from the same family's core variance after stage 0:
  - Fable and Argon: about 21 points at 52 tasks, 24 at 40, 30 at 26;
  - Astra: about 22 to 25 at 52 and 32 to 36 at 26.

## Sharding and leases

- **Placement:** one Ubicloud standard-16 VM per shard, through `scripts/ubicloud/fanout.sh --workload frontier-harbor`, with UBI_OWNER=HARN-50. Each shard holds one core cell and its kept cell. No cell is split across machines within a stage. Stage 0 and the main stage of a shard may run on different VMs, one after the other, at the same commit; this is declared here.
- **Concurrency:** 4 trials at a time per VM (Captain's call). Wall time is labelled "contended". Retries are off.
- **Timeouts:** UBI_TTL_HOURS is at least 14 on every VM. Results are copied off each VM while it runs, and the VM is destroyed on every exit.
- **Leases:** the planned shard leases sum to $1,247, within the $1,250 plannable. Each lease is at least concurrency times its cells' largest per-call reservation, so a trial is never refused for room that other running trials hold.

| Shard | Cells | Trials | Planned lease | Headroom floor |
|---|---|---|---|---|
| opus-cc | opus-cc, opus-cc-kept | 112 | $250 | $31.58 |
| opus-hermes | opus-hermes, opus-hermes-kept | 112 | $247 | $31.58 |
| opus-openclaw | opus-openclaw, opus-openclaw-kept | 112 | $215 | $31.58 |
| opus-pi | opus-pi, opus-pi-kept | 112 | $158 | $31.58 |
| sol-codex | sol-codex, sol-codex-kept | 112 | $78 | $16.32 |
| sol-hermes | sol-hermes, sol-hermes-kept | 112 | $120 | $16.32 |
| sol-openclaw | sol-openclaw, sol-openclaw-kept | 112 | $103 | $16.32 |
| sol-pi | sol-pi, sol-pi-kept | 112 | $76 | $16.32 |

## Money (R71, $2,000 all-in)

| Line | Ceiling |
|---|---|
| Own model use: planning, build, results | $40, $300, $150 |
| Ubicloud VMs | $90 |
| Paid trials | $1,420, of which $170 is a reserve never planned against |
| **Total** | **$2,000** |

- **Prior per trial** (repriced from the leaderboard's DeepSeek high token counts; probably high):
  - Opus 5.5: Claude Code $2.00, Hermes $1.98, OpenClaw $1.72, Pi $1.27;
  - GPT-6.1 Sol: Codex $0.63, Hermes $0.96, OpenClaw $0.83, Pi $0.61.
  - At the prior, the core is about $1,040 and the kept sample about $60.
- **Own-use overrun:** if own model use passes its ceilings, plannable paid money falls by the same amount before the main stage.
- **Spend before this preregistration:** $0 on paid trials and under $1 on VMs (two keyless install checks). Own model use is in the Captain drive report `reports/HARN-50.md`.

## Claims

- **Pass rate per cell:** the task mean (each task's mean over its scored attempts, then the mean over tasks), with a task-clustered percentile bootstrap 95% interval (10,000 draws, seed 7).
- **Pairs:** third-party minus home, over the attempts scored in both cells (runner/stats/paired.ts clusteredPairedDelta). Each pair gets a two-sided task-level sign-flip p, Holm-adjusted across the model's 3 primary pairs.
- **MDD** (80% power, from the leaderboard's per-task variance on these tasks, recomputed after stage 0):
  - unadjusted, 15 to 17 points;
  - at the first Holm step (alpha 0.0167), about 17 to 20 points;
  - up to about 23 on the noisiest pairs.
- **Non-inferiority:** a one-sided 15-point margin per pair, Holm-adjusted within model (nonInferiorityP). Only a lower bound above -15 is called "within 15 points". For a harness truly equal to its home harness, the chance of certifying "within 15" is about 60 to 70% at 52 tasks and 2 attempts.
- **Verdict tags** (scripts/frontier-harbor/analyze.ts VERDICT_RULES; the first that holds wins): home, incomplete, descriptive, behind, within-15, saturated, inconclusive. A pair with fewer than 10 paired tasks is not tested.
- **Cost per solve:** a cell's recorded USD over its scored passes, with a task bootstrap interval. Each pair also gets the paired task bootstrap of the cost-per-solve ratio. No size of difference is promised in advance.
- **Noise view:** per model, the rerun flip (two attempts of one harness disagree) and the harness flip (two harnesses disagree), each with an interval. Each cell also gets pass^2 and pass@2.
- **Drift:** each home cell's attempt 2 minus attempt 1. If its size is above **10 points**, the report discloses it as a deviation next to every pair of that model.
- **Kept sample:** per-cell pass rates with intervals, from analysis-spec-kept.json. These are descriptive only.
- **Results table:** harness by model, each cell with pass rate and CI, cost per solve and CI, median wall time (contended) and verdict tag.

## Scoring, exclusions and infra classes

- **Pass:** the TB2.1 verifier's reward is 1. A task's own agent time limit is a scored fail, as on the leaderboard (`timeout`, counted per cell).
- **Counts as a fail:** `harness_error` (the harness stopped with an error).
- **Excluded pairwise and counted per cell:**
  - `unfinished`: Harbor started the trial and never finished it;
  - `setup_failed`: the agent never bound its slot;
  - `no_model_response`: no request got an answer;
  - `effort_mismatch`: see the effort rule above;
  - `rate_limited`, when an upstream 429 made the harness stop with an error. A trial that recovered from a 429 is scored as it ended, and its 429s are counted.
- **Lease stop:** a trial refused by its shard's lease is `model_error` with cap_stop. It is excluded, counted, and reported in deviations.
- **An excluded attempt drops from both cells of its pair.** A task with no attempt scored in both cells drops from that pair and is listed.

## Contamination, keys and fairness

- **Hosted web search is off** in every cell (Claude Code WebSearch, Codex web_search). The proxy refuses any request that declares a hosted search tool (HE-PROXY-006).
- **Egress blocklist:** Harbor's sidecar refuses, by TLS SNI and HTTP Host:
  - the benchmark's own sources (Terminal-Bench repositories and datasets, tbench.ai, the Harbor hub, the leaderboard Space and its dataset viewer);
  - the direct provider hosts and both Google API hosts.
  - TB2.1 tasks keep general internet access, which is a declared deviation from methodology item 6.
- **Keys:**
  - each task container sees only the proxy URL and a per-trial dummy token, and Harbor runs with a scrubbed environment;
  - only the metering proxy holds provider keys;
  - the install check's canary key appears in no file of the run.
- **Audit** (scripts/frontier-harbor/audit.ts) over each trial's captured request bodies, the same source for every harness:
  - what it looks for: TB2.1 canary strings, requests for a copy of the benchmark, and answer-key lines the model received (fingerprints from the leaderboard's pinned TB2.1 list);
  - a reader blind to the harness confirms each flagged trial;
  - a confirmed answer-key receipt scores that trial a fail.
- **Clean arms:** every cell runs without gstack. vm-run.sh's preflight refuses a VM with a Capy drive or a gstack install (`preflight-clean-arm.json`). The audit counts per cell the trials that read a gstack file; a cell with one is reported as contaminated.
- **Memorization:** frontier models may have seen TB2.1 solutions. The paired design mostly cancels this within a model, and the report says so.

## Why null?

- **When:** for every pair tagged inconclusive, or behind for a harness layer.
- **The cycle:** the report runs one cycle of exposure, fit, power and saturation, and model.
- **The verdict:** it ends with one line, KEEP, FIX-METHOD (naming the fix) or CUT-CANDIDATE. A null that rests on saturation is FIX-METHOD with one named ceiling-raise.

## Outside terms

- **Terminal-Bench 2.1:** Apache-2.0. Task directories are never committed to results.
- **Harbor:** Apache-2.0, hash-pinned wheel and hashed dependency lock.
- **atif-scan:** MIT; not vendored or run.
- **The Harness Leaderboard Space:** Apache-2.0, read only.
- **The leaderboard bucket:** states no licence of its own. Only the derived per-task rates of the tasks used are kept, with attribution.
- **mini-swe-agent, Pi, Hermes and OpenClaw:** MIT.
- **Codex:** Apache-2.0.
- **Claude Code:** proprietary.

## Receipts

- **Where:** under `docs/benchmarks/2026-11-07-frontier-harness/results/`.
- **Run-level files:** the merged `trials.jsonl` and `manifest.json`.
- **Per shard, under its own name:** ledger, proxy usage, `run-summary.json`, `preflight-clean-arm.json`, `shard.json` and `shard-vm.json`.
- **Analysis files:** `analysis.json` and `analysis.md` from both specs, and `audit.json` (the blind reader's working file is never committed).
- **Separate PRs.** This preregistration merges to main before the first counted trial. Results come in a later PR.
- **Merge hold.** HARN-7 holds merges that touch runner, harnesses, scripts or tasks while this PR gates.

## Amendments

Each amendment is dated and committed before any cell it affects, and merges to main before those cells start. Amendments cover the stage-0 drop or grow level, each extension pair, and the Gemini path.

## Disclosures

This run features OpenAI's GPT-6.1 Sol (and GPT-6 Astra if its pair runs), Hermes and OpenClaw. The report and any finding file end with these lines, word for word from the disclosures list (CREW.md, R55). No QM, gstack, gbrain or Particle cell runs, so those lines are not used. No X post carries them.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

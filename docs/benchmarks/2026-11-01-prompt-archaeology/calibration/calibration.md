# internal-task calibration: prompt-archaeology-calib-2026-11 (uncounted)

**Superseded for the counted run (2026-11-02).** [../PREREGISTRATION.md](../PREREGISTRATION.md) uses design B (all 20 tasks by 2 repetitions, lane cap $600), the Hermes memory fix in #188 and a drop order. The numbers below are the calibration's, unchanged.

**The calibration is done, but there is one blocker.** All 160 trials ran at commit 5e82c87d5. Model spend was $32.39 against the $45 limit. The task rule keeps **9 tasks**.

- **Blocker:** the Hermes minimal cell is invalid. 14 of its 240 agent requests (5.8%) were partial matches, above the 5% bound. Details are under "Ablation validity".
- **Projection:** the counted run, plus its leases and the joint-cut run, fits the $467.61 left of the $500 cap. No drop order is needed.

Receipts are under ~/.capy/work/harness-evals/harn20/calibration/ (written "cal/" below). Every number cites its file.

## What ran
- **Scratch prereg:** cal/inputs/prereg.json, 8 cells.
  - Cells are full and minimal for each of four pairs: claude-code, openclaw and hermes on anthropic:claude-opus-5-5, and codex on openai:gpt-6.1-sol. Codex uses its adapter's reasoning effort, medium.
  - All 20 public v0.3 multi-user dev tasks, 1 repetition, network internal. No gbrain and no gstack.
  - Full binds the committed map with zero layers. Minimal binds every removable layer in that map: 7 layers, or 6 for Hermes, which has no identity layer.
  - The task path is tasks/multiuser/v0.3/dev only. No held-out task, sealed set, custody branch or custody identity was read.
- **OpenClaw housekeeping:** both OpenClaw cells declare utility_models ["anthropic:claude-haiku-5-5"]. This is harness housekeeping at its shipped default. It is metered, not an arm, and not scored.
- **Ubicloud:** run through scripts/ubicloud/fanout.sh with UBI_OWNER=internal-task (cal/inputs/fanout.json, fanout-cx-rerun.json).
  - 4 shards of whole cells, one pair per shard, one standard-16 VM each.
  - `--pre-smoke scripts/ablation-golden.sh` ran on every VM before the smoke.
  - `ubi-runner.sh usage` was checked before every fan-out. `list --mine` showed zero VMs at the end.
- **Merge:** cal/ is the merged directory (merge-shards.ts). summarize-run wrote cal/summary.md and summary.json. tables.ts wrote cal/prompt-archaeology-tables.md and .json. cal/inputs/analysis.ts wrote cal/calibration-analysis.json. cal/inputs/projection.py wrote cal/projection.json.

## Attempts (all keyless until a smoke)
1. **1c497ae69, 04:03Z.** All 4 VMs failed the pre-smoke with "ablation-golden: unknown argument". The docker-group re-exec passed an empty argument. $0 model spend, VM $0.1508. Receipts: cal/shard-receipts/attempts/attempt1-1c497ae69/. Fixed in af37a5075.
2. **af37a5075, 04:10Z.** All 4 VMs failed the golden check on the claude-code map (5 of 6 maps passed). $0 model spend, VM $0.4190. Receipts: attempt2-af37a5075/.
   - A keyless debug VM showed the cause: claude-code minimal was partial on 5 of 5 requests. Claude Code's "# Environment" section carries the host kernel line, which made it 9940 bytes against the map's fixed 9931. Receipts: cal/shard-receipts/golden-debug/golden-af37a5075.out, inputs/envdiff.py.
   - Fixed in 5e82c87d5: each removable paragraph is checked by its own range.
3. **5e82c87d5, 06:21Z.** First, a keyless golden check on one VM passed all 6 maps (golden-debug/golden-5e82c87d5.out). Then the fan-out ran.
   - cc, oc and he: golden passed, smoke passed, 40 trials each.
   - cx: golden passed, but the smoke failed (attempts/attempt3-cx-smoke-lease/cx/vm-shard.out). The minimal smoke trial was a model_error. The proxy refused a $1.4546 reservation that would have taken the derived $3.00 smoke lease to $3.1448, because two Sol reservations were in flight at once (that smoke's proxy-usage.ndjson line 29). Smoke spend $0.2782.
4. **cx rerun at 5e82c87d5, 07:41Z, config only.** `--smoke-lease-usd 5` and a $10 shard lease. Golden passed, smoke passed (2 of 2 completed, $0.2607), 40 trials. Receipts: cal/shard-receipts/fanout-cx-rerun.out, shard-receipts/cx/.

## Spend (proxy ledgers, `metering-proxy.ts summary`)
| Ledger | Lease | Committed | Requests |
|---|---|---|---|
| cc main (cal/cc.ledger.sqlite) | $11.5 | $6.6405 | 474 |
| oc main | $14 | $11.2872 | 515 |
| he main | $12 | $8.0754 | 477 |
| cx main (rerun) | $10 | $3.7880 | 467 |
| smokes cc / oc / he / cx (shard-receipts/<s>/smoke/results/ledger.sqlite) | $6 / $6 / $6 / $5 | $0.4963 / $0.9858 / $0.5792 / $0.2607 | 27 / 41 / 27 / 28 |
| cx failed smoke (attempt3-cx-smoke-lease) | $3 | $0.2782 | 32 |
| **Total model spend** | | **$32.3913** | 2,088 |

- **VM list price:** $2.49 metered, from the fanout tables in fanout*.out: $0.1508 + $0.4190 + $1.6172 + $0.3017. Two keyless debug VMs add about $0.10 each; shard-vm.json did not meter those.
- **Lane-spend line:** [lane-spend-line.jsonl](lane-spend-line.jsonl), committed with the preregistration.

## Results per cell (cal/summary.md; cost from trials.jsonl usage.usd)
| Cell | Scored | Passes | Pass rate [95% CI] | USD | USD per trial |
|---|---|---|---|---|---|
| claude-code full | 20 | 14 | 70% [50, 90] | $3.94 | $0.197 |
| claude-code minimal | 20 | 14 | 70% [50, 90] | $2.70 | $0.135 |
| openclaw full | 20 | 17 | 85% [70, 100] | $6.55 | $0.328 |
| openclaw minimal | 15 (5 model_error, cap_stop) | 11 | 73% [47, 93] | $4.74 | $0.237 |
| hermes full | 20 | 14 | 70% [50, 90] | $4.13 | $0.206 |
| hermes minimal | 20 | 15 | 75% [55, 95] | $3.95 | $0.198 |
| codex full | 20 | 14 | 70% [50, 90] | $2.33 | $0.117 |
| codex minimal | 20 | 14 | 70% [50, 90] | $1.46 | $0.073 |

- **OpenClaw minimal cap stop:** the oc shard's $14 lease ran out at the end of the openclaw minimal cell. 5 trials were recorded as model_error with cap_stop (HE-BUDGET-001). The refusals are in cal/oc.proxy-usage.ndjson.
  - Those 5 trials are excluded from scored trials. They were not rerun.
  - The full cells, which carry the task rule, the MDD and the projection, are complete.
- **Hermes refusals:** Hermes's 660 refused requests per cell (summary.md) are metadata probes the proxy does not allowlist, such as GET /v1/models, /api/show and /props (cal/he.proxy-usage.ndjson). None of them is a model call.
- **Minimal minus full (descriptive, prompt-archaeology-tables.md):** these are intervals, not verdicts.
  - Pass rate: claude-code +0.0 [-15, +15]; openclaw -6.7 [-20, 0]; hermes +5.0 [-10, +20]; codex +0.0 [0, 0].
  - Cost per trial: claude-code -$0.062 [-0.076, -0.049]; openclaw -$0.021 [-0.042, -0.000]; hermes -$0.009 [-0.024, +0.006]; codex -$0.044 [-0.052, -0.037].

## Ablation validity (prompt-archaeology-tables.md, "Treatment receipts")
| Cell | Agent requests | Did not take | Partial | Unknown families | Incomplete | Invalid trials | Unstable | Valid |
|---|---|---|---|---|---|---|---|---|
| claude-code full | 239 | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |
| claude-code minimal | 235 | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |
| openclaw full | 276 | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |
| openclaw minimal | 218 (15 scored trials) | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |
| hermes full | 237 | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |
| **hermes minimal** | 240 | 0 | **14** | 0 | **5.8%** | 0 | 0 | **no** |
| codex full | 231 | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |
| codex minimal | 236 | 0 | 0 | 0 | 0.0% | 0 | 0 | yes |

**Blocker: Hermes minimal is partial on 5.8% of its requests.** All 14 partial requests name span agent.system[1].s6. That span is the memory-skills `<available_skills>` block, mapped at a fixed 5366 bytes.

- **Where:** only in continuity trials, after the first session. cn-02 had 3 partial requests, cn-03 had 9 (requests 4 to 12) and cn-04 had 2 (trials/hermes-opus-minimal-mu-v03-dev/<task>/r1/ablation.ndjson).
- **Correlation:** each of these trials has a non-empty state/hermes/memories/MEMORY.md (428, 458 and 498 bytes). Trials without one have no partial requests.
- **Likely cause (inferred, since request bodies are not logged):** Hermes injects persisted memory between the skills index and "Conversation started:". That text then falls inside s6's fixed range, so s6 is not removed on those requests.
- **Fix:** this needs a filter or map change. It is not a config fix. It would hit the counted Hermes memory-skills cell and the Hermes minimal cell, and probably the Hermes Sol cross minimal cell too.

**OpenClaw housekeeping_requests:** 0 in openclaw full and 0 in openclaw minimal, summed over trial records. cal/oc.proxy-usage.ndjson has no claude-haiku-5-5 request at all: 276 + 239 forwarded and 5 refused, all claude-opus-5-5. The OpenClaw smokes were also opus only, 22 + 19 requests.

## Task rule: v0.3 pilot rule on the full cells (cal/calibration-analysis.json)
A family is kept when its pooled pass rate is 10% to 90%. The rate is pooled over the four full cells, scored trials only.

| Family | Passes / trials | Rate | Kept |
|---|---|---|---|
| approval_relay | 7 / 12 | 58.3% | yes |
| corrections | 3 / 16 | 18.8% | yes |
| shared_channel | 6 / 8 | 75.0% | yes |
| synthesis | 11 / 12 | 91.7% | no |
| continuity | 16 / 16 | 100% | no |
| scope_isolation | 16 / 16 | 100% | no |

**Kept tasks (9):** ar-01-thornbury-rate-hollis, ar-02-quarrendon-rate-hollis, ar-03-tansley-parcel-rate-tobias, cr-01-marrow-agrisupply-site-retraction, cr-02-quarrendon-seat-count-retraction, cr-03-brackenwater-renewal-date-retraction, cr-04-marrow-agrisupply-seat-count, sc-01-central-random-two-asks, sc-02-north-team-two-asks.

## Minimum detectable difference (resolution 5; cal/calibration-analysis.json)
Design: 9 kept tasks by 3 repetitions. Each task is set at its family's pooled calibration pass rate, using scripts/paired-mdd.ts's arithmetic (alpha 0.05, power 0.8) through tables.ts familyPooledMdd. Values are pass-rate points.

- **Per pair, with family rates from that pair's own full cell (tables.ts --calibration method):**
  - claude-code 37.3
  - openclaw 23.3
  - hermes 29.1
  - codex 23.3
- **Pooled over all four full cells (the task rule's rates):** 35.3 for every pair.
- **Check:** designMdd at p = 0.5 for 9 by 3 gives 40.4, which is the ceiling.
- **Caveat:** the openclaw and codex figures are lower only because some kept families sit at 0% or 100% in their own full cell, and those families add no variance.
- **Against the plan:** at 9 tasks, only paired pass differences of roughly 23 to 37 points will usually be resolved. Plan decision 7 expected 12 to 17 points at 13 to 20 tasks. For comparison, all 20 tasks at 3 reps would give 10.2 to 18.9.

## Cost per trial and projection (cal/projection.json)
**Correction (see Design options):** this section prices every task at its 20-task average cost. On the 9 kept tasks alone, the main run is $258.69, total leases plus smokes are $450.05, and the spare is $17.56.

**Measured cost per trial (full cells):**
- claude-code/opus: $0.197
- openclaw/opus: $0.328
- hermes/opus: $0.206
- codex/sol: $0.117

Minimal cells cost $0.135, $0.237, $0.198 and $0.073.

**Sol cross cells:** openclaw/sol is estimated at $0.196 per trial and hermes/sol at $0.123.
- Method: the Opus full cells' token counts, repriced at Sol rates, times 1.19.
- The 1.19 is codex's measured spend over its own flat-rate repricing, a correction for Sol's long-context tier.
- This is an approximation, labelled as such.

**Counted run:** 9 kept tasks by 3 reps, so 27 trials per cell. Every cell is priced as its pair's full cell, as in plan decision 7.
| Item | Cells | Projected |
|---|---|---|
| Layer grid | 9 / 9 / 8 / 9 (cc / oc / he / cx) | $200.34 (47.88 / 79.59 / 44.55 / 28.32) |
| Sol cross, full and minimal on openclaw and hermes | 4 | $17.21 |
| Official-minimal on claude-code and codex | 2 | $8.47 |
| **Main run** | 41 | **$226.02** |
| Smokes, one trial per cell | 41 | $8.37 |
| Joint-cut run (resolution 1): fresh full plus joint cell per pair, upper bound | 8 | $45.76 |
| Joint-cut smokes | 8 | $1.69 |
| **Projected spend** | | **$281.84** |

**Leases.** Each lease is projected spend times 1.25, plus one in-flight reservation per shard. A reservation is $2.9214 for Opus and $1.4546 for Sol (the largest refused reservations in the receipts). Shards hold about 3 whole cells each.
- Main run: 16 shards (4 per pair), so $226.02 x 1.25 + $40.88 = **$323.40**.
- Joint-cut run: 4 shards, so $45.76 x 1.25 + $10.22 = **$67.42**.
- Leases plus smoke spend: **$400.88**.

**Cap.** $500 minus $32.39 of calibration spend leaves **$467.61**.
- **It fits, with $66.73 to spare, so no drop order is needed.** The plan's trigger for the drop order was more than about 15 kept tasks or leases that do not fit; 9 tasks is below it.
- **Sensitivity:** two reservations in flight per shard, which the codex smoke showed can happen, bring leases to $451.97. That still fits, with $15.64 to spare.
- If it did not fit, the plan's drop order would apply: Sol cross cells first, then official-minimal, then tasks from the family nearest a bound (corrections at 18.8%), never a layer cell.
- **Lease sizing:** the calibration's $14 openclaw lease ran out at $11.29 because plan decision 7's $0.28 per trial was low against the measured $0.328.

## Deviations
- Two code fixes landed before any trial: af37a5075 (golden re-exec) and 5e82c87d5 (paragraph ranges, OpenClaw housekeeping at its shipped default). Every one of the 160 trials ran at 5e82c87d5.
- The cx shard ran twice. The first smoke failed on the derived smoke lease and no trial ran. The rerun changed only config: smoke lease $5 and shard lease $10.
- 5 openclaw minimal trials were stopped by the cap and not rerun.
- The smoke leases ($6 for each Opus shard and $5 for cx) sit outside the $45 shard leases. Their spend ($2.60 including the failed smoke) is counted in the $32.39.

## Design options (keyless; cal/design-options.json, made by cal/inputs/design-options.ts)

**Bottom line:**
- Only design (a), 9 tasks by 3 reps, fits the $467.61 left of the cap. It leaves $17.56 spare.
- **Correction:** the projection section above priced every task at its 20-task average. The 9 kept tasks cost more per trial: claude-code $0.22, openclaw $0.37, hermes $0.25 and codex $0.13. So (a) costs $258.69 for the main run, not $226.02, and its spare is $17.56, not $66.73.
- If each shard holds two reservations at once, (a) in full would need $501.15 and would not fit. Dropping the Sol cross and official-minimal cells, the first two steps of the drop order, brings it to $443.97.
- Under (a), a "cut" verdict is rarely reachable even when removing a layer truly costs nothing in pass rate.

**Method:**
- **MDD:** scripts/paired-mdd.ts's arithmetic through tables.ts familyPooledMdd. Each task is set at its family's pooled full-cell calibration rate.
  - "Per pair" uses that pair's own full cell, as tables.ts --calibration does.
  - "Pooled" uses the task rule's rates over all four full cells.
  - Alpha is 0.05 and power 0.8. Values are pass-rate points.
- **Spend:** the same projection as above, but with cost per trial measured on each design's own task set.
  - Sol cross cells: Opus token counts repriced at Sol, times codex's measured long-context factor (1.19).
  - Leases: projected spend times 1.25, plus one in-flight reservation per shard ($2.9214 for Opus, $1.4546 for Sol).
  - Shards: 16 for the full main run, 12 for grid only, 4 for the joint-cut run.
  - Smokes are one trial per cell. The joint-cut run is the upper bound: a fresh full cell plus a joint cell for every pair.
- **Cut reachability:**
  - Pass interval: with a true pass delta of 0, the observed delta is taken as normal with the design's null standard error. The bootstrap half-width h is taken as 1.96 times that error. The pass condition is the chance that the delta minus h is above -10 points.
  - Cost interval: the chance its upper bound is below 0, at two assumed true effects. One is the calibration's minimal-minus-full cost delta on the design's tasks, an upper bound for any single layer. The other is one-seventh of it, a typical single layer.
  - The cost error comes from the calibration's paired per-task cost differences. Each range runs from "all variance between tasks" (sd divided by the square root of tasks) to "all within tasks" (sd divided by the square root of tasks times reps).
  - P(cut) multiplies the two, treating them as independent. These are approximations, not simulations.

| Design | Pooled MDD | Per-pair MDD (cc / oc / he / cx) | Pass CI half-width, pooled | Main run in full: spend / lease | Grid only: spend / lease | Joint-cut: spend / lease | Total leases + smokes, full / grid only | Against $467.61 |
|---|---|---|---|---|---|---|---|---|
| (a) 9 kept tasks x 3 reps | 35.3 | 37.3 / 23.3 / 29.1 / 23.3 | 24.7 | $258.69 / $364.23 | $229.20 / $317.16 | $52.43 / $75.76 | $450.05 / $403.10 | fits ($17.56 spare) |
| (b) all 20 tasks x 2 reps | 20.0 | 23.1 / 12.4 / 15.5 / 12.4 | 14.0 | $334.84 / $459.43 | $296.80 / $401.66 | $67.79 / $94.96 | $564.44 / $505.72 | over by $96.83; grid only over by $38.11 |
| (c) all 20 tasks x 3 reps | 16.4 | 18.9 / 10.2 / 12.7 / 10.2 | 11.4 | $502.26 / $668.70 | $445.20 / $587.16 | $101.68 / $137.32 | $816.09 / $733.59 | over by $348.48; grid only over by $265.98 |
| (d) 9 kept tasks x 5 reps | 27.3 | 28.9 / 18.1 / 22.6 / 18.1 | 19.1 | $431.15 / $579.81 | $382.00 / $508.16 | $87.39 / $119.45 | $709.32 / $637.79 | over by $241.71; grid only over by $170.18 |

| Design | Pair | P(pass CI lower bound above -10), true delta 0 | P(cost CI excludes 0), effect = minimal | P(cost CI excludes 0), effect = minimal / 7 | P(cut reachable), effect = minimal / 7 |
|---|---|---|---|---|---|
| (a) | pooled rates | 12% | | | |
| (a) | claude-code/opus | 11% | 100% | 17% to 40% | 2% to 5% |
| (a) | openclaw/opus | 22% | 20% to 50% | 4% to 5% | 1% |
| (a) | hermes/opus | 16% | 10% to 21% | 3% to 4% | 0% |
| (a) | codex/sol | 22% | 100% | 15% to 36% | 3% to 8% |
| (b) | pooled rates | 29% | | | |
| (b) | claude-code/opus | 23% | 100% | 23% to 40% | 5% to 9% |
| (b) | openclaw/opus | 61% | 61% to 88% | 5% to 7% | 3% to 4% |
| (b) | hermes/opus | 44% | 20% to 36% | 4% to 4% | 2% |
| (b) | codex/sol | 61% | 100% | 35% to 61% | 22% to 37% |
| (c) | pooled rates | 40% | | | |
| (c) | claude-code/opus | 32% | 100% | 23% to 55% | 7% to 18% |
| (c) | openclaw/opus | 79% | 61% to 97% | 5% to 8% | 4% to 6% |
| (c) | hermes/opus | 60% | 20% to 50% | 4% to 5% | 2% to 3% |
| (c) | codex/sol | 79% | 100% | 35% to 78% | 28% to 61% |
| (d) | pooled rates | 17% | | | |
| (d) | claude-code/opus | 16% | 100% | 17% to 60% | 3% to 10% |
| (d) | openclaw/opus | 34% | 20% to 71% | 4% to 5% | 1% to 2% |
| (d) | hermes/opus | 24% | 10% to 32% | 3% to 4% | 1% |
| (d) | codex/sol | 34% | 100% | 15% to 54% | 5% to 18% |


**What it says:**
- **The pass bound is the binding constraint.** Under (a), the pooled pass half-width is 24.7 points, larger than the 10-point margin. So even with a true delta of 0, only 11% to 22% of comparisons can show a lower bound above -10.
- **Cut verdicts:** for a typical single layer, a cut is reachable in about 0% to 8% of comparisons under (a). Codex reaches 22% to 61% under (b) or (c), because its tasks sit at 0% or 100% and its cost differences are tight.
- **Hermes and openclaw:** a cut stays at or below about 6% in every design, because their per-trial cost differences are noisy.
- **Budget:** (b), (c) and (d) do not fit the remaining cap even as grid only, over by $38.11, $265.98 and $170.18. (b) would need about $38 more cap, or fewer cells.

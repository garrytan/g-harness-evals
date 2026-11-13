# gstack skill ablation: results (gstack-skill-ablation-2026-11)

**We learned that on Terminal-Bench 2.1 coding tasks, neither frontier model needs gstack's skill list.** Taking one skill out, or taking out the 52 skills no model opened in stage 0, moved pass rates by less than 4 points, and every 95% interval rules out a 10-point loss pooled across the two models.

**We also learned that Opus 5.5 in Claude Code never opened a gstack skill.** That was 0 opens in 504 main-stage gstack trials. GPT-6.1 Sol in Codex opened `verify` in 40% of its full-arm trials (64 of 160), and three other skills once each in the main stage. On Opus, the gstack arms differed only in the skill list the model was shown.

**You should read this as "the list buys nothing measurable here", not as a cut.** On Sol it is not free: gstack full cost 1.21x tokens per trial. No skill earned KEEP or CUT-CANDIDATE under the preregistered rule. Both tested removals are FIX-METHOD, because pooled tokens per trial did not fall.

- **Run:** [PREREGISTRATION.md](../PREREGISTRATION.md), with amendments 1 to 4 and amendment 4's addendum in [AMENDMENTS.md](../AMENDMENTS.md).
- **Tasks:** Terminal-Bench 2.1 subsets with headroom: 21 tasks for Opus, 20 for Sol.
- **Trials:** 8 attempts per task and arm. Arms: no gstack (`none`), every skill (`full`), `full` without `verify` (`minus-verify`), and `full` without the 52 skills no stage 0 trial opened (`diet`).
- **Frozen analysis:** [analysis.md](analysis.md) (`ablation.ts analyze`). Every number below comes from it unless a row names another receipt.

## What worked

- **gstack showed no measurable harm or good on pass rate.** Full against none: Opus -3.6 points [-10.7, +3.6], Sol +3.1 [-3.8, +10.0]. Neither is significant (Holm p 1.0), but Opus's interval still allows up to a 10.7-point loss.
- **The skill list can be cut by about 80% with no detectable pass-rate loss.** The diet arm removes 52 skills, which is 49 fewer listed for Opus and 51 fewer for Sol (Claude Code and Codex never list a few of them):
  - Opus: 5,919 to 967 listing bytes.
  - Sol: 28,282 to 5,678 listing bytes.
  - Pooled diet minus full: -1.5 points [-7.3, +4.0], with a 90% lower bound of -6.4. That clears the preregistered 10-point non-inferiority margin.
- **Removing `verify` cost no detectable pass rate either.** Pooled minus-verify minus full: -1.2 points [-5.5, +3.4], 90% lower bound -4.9.

## What didn't work

- **gstack made Sol about 21% more expensive in tokens, with no detectable pass-rate gain (+3.1 points [-3.8, +10.0]).** Full against none on Sol: 1.21x tokens per trial [1.10x, 1.42x]. On Opus it was 0.91x [0.67x, 1.21x].
- **Pooled, neither removal saved tokens, so neither is a cut candidate.**
  - minus-verify: 1.05x [0.93x, 1.21x].
  - diet: 1.03x [0.88x, 1.23x]. On Sol alone the diet used fewer tokens, 0.93x [0.86x, 1.00x]. On Opus it was 1.10x [0.85x, 1.46x], which is wide task-to-task noise, not a saving.
  - The preregistered rule needs "tokens per trial not higher" for CUT-CANDIDATE, so both are FIX-METHOD.
- **The diet arm cost more dollars per completed trial, but that gap is mostly a metering artifact, not tokens.** See the finding below.

## Results per model

| Model | Arm | Pass rate [95% CI] | Tokens per trial | Listing bytes | Cost per solve [95% CI] |
|---|---|---|---|---|---|
| Opus 5.5 | none | 70.2% [53.0%, 85.7%] | 841,050 | n/a | $0.96 [$0.50, $1.51] |
| Opus 5.5 | full | 66.7% [50.6%, 81.0%] | 763,343 | 5,919 | $0.97 [$0.56, $1.48] |
| Opus 5.5 | diet | 67.3% [49.4%, 83.3%] | 836,775 | 967 | $1.07 [$0.53, $1.78] |
| Opus 5.5 | minus-verify | 67.9% [51.2%, 82.7%] | 858,505 | 5,833 | $1.03 [$0.55, $1.64] |
| GPT-6.1 Sol | none | 63.7% [48.1%, 78.1%] | 459,591 | n/a | $0.45 [$0.27, $0.77] |
| GPT-6.1 Sol | full | 66.9% [49.4%, 82.5%] | 557,037 | 28,282 | $0.50 [$0.30, $0.93] |
| GPT-6.1 Sol | diet | 63.1% [47.5%, 77.5%] | 515,534 | 5,678 | $0.79 [$0.42, $1.41] |
| GPT-6.1 Sol | minus-verify | 63.1% [46.9%, 78.8%] | 529,996 | 27,939 | $0.49 [$0.29, $0.87] |

- Every cell has every planned trial scored: 168 per Opus cell and 160 per Sol cell.
- Pass rates are task means with a task bootstrap 95% interval (10,000 draws, seed 7).

**Paired differences (arm minus reference, points, over tasks in both arms):**

| Model | Comparison | Difference [95% CI] | Worse / better tasks | Token ratio [95% CI] |
|---|---|---|---|---|
| Opus 5.5 | minus-verify - full | +1.2 [-4.8, +7.7] | 5 / 6 | 1.12x [0.93x, 1.42x] |
| Opus 5.5 | diet - full | +0.6 [-7.7, +9.5] | 6 / 6 | 1.10x [0.85x, 1.46x] |
| Opus 5.5 | full - none | -3.6 [-10.7, +3.6] | 7 / 3 | 0.91x [0.67x, 1.21x] |
| GPT-6.1 Sol | minus-verify - full | -3.8 [-10.0, +1.9] | 7 / 5 | 0.95x [0.83x, 1.05x] |
| GPT-6.1 Sol | diet - full | -3.8 [-11.9, +2.5] | 5 / 4 | 0.93x [0.86x, 1.00x] |
| GPT-6.1 Sol | full - none | +3.1 [-3.8, +10.0] | 3 / 5 | 1.21x [1.10x, 1.42x] |

**Pooled over both models (both passed the headroom check):**

| Removal | Difference [95% CI] | 90% lower bound | Token ratio [95% CI] | MDD | Verdict |
|---|---|---|---|---|---|
| verify | -1.2 [-5.5, +3.4] | -4.9 | 1.05x [0.93x, 1.21x] | 4.4 points | FIX-METHOD |
| diet (52 skills) | -1.5 [-7.3, +4.0] | -6.4 | 1.03x [0.88x, 1.23x] | 5.6 points | FIX-METHOD |

## Verdicts and Why null?

**verify: FIX-METHOD.** The pass-rate removal is within 10 points, but pooled tokens per trial were 1.05x, not lower.
- **Did the model use it?** Sol opened it in 64 of 160 full trials, and in 95 of 160 diet trials. Opus opened it in 0 trials of any arm.
- **Do the tasks fit?** Yes. verify is fit=yes for autonomous terminal work ([fit.json](../fit.json)).
- **Enough samples and headroom?** Both models passed the headroom check. The MDD is 4.4 points pooled, and the interval rules out a 10-point loss.
- **Does the model already do it unaided?** On Opus, yes: it never reads the skill. On Sol the skill is read, but the read buys no measurable pass rate.
- **The fix:** judge tokens per model. On Sol, removing verify used 0.95x tokens [0.83x, 1.05x], while Opus's 1.12x is noise from arms that differ only in an 86-byte listing line. A per-model token rule, or more attempts on Sol, would give a verdict.

**The diet group (52 never-opened skills): FIX-METHOD.** The pass-rate removal is within 10 points, but pooled tokens per trial were 1.03x.
- **Did the model use them?** No. In the main stage, one Sol full trial opened `browse` and one opened `careful`, and one Sol minus-verify trial opened `cso`. Neither model opened any other diet skill. In 11 diet trials a de-listed skill's name or path still showed up in the trial's requests (`removed_seen`): 1 on Opus, 10 on Sol ([audit.json](audit.json)). None of them opened it.
- **Do the tasks fit?** Mostly no. 43 of the 52 are fit=no: product, design, iOS, deploy and browser workflows that a terminal task never calls for.
- **Enough samples and headroom?** Yes. The MDD is 5.6 points pooled, and the 90% lower bound is -6.4.
- **Does the model already do it unaided?** Yes. Neither model reached for these skills.
- **The fix:** the listing is a small share of each trial's tokens, so a token rule needs more power. On Sol the 22.6 KB the diet removes is about 3.8k to 4.1k tokens per request (22,604 bytes at 5.5 to 5.9 bytes per token, the Sol cells' median per-trial `bytes_per_token`), which predicts about 0.89x to 0.90x tokens per trial at sol-full's 15.05 requests per trial; the measured Sol ratio is 0.93x. Measure tokens per model, or use a fixed-prompt token count of the listing in place of a noisy per-trial total.
- **The fit=yes skills in the group** (careful, context-restore, context-save, freeze, guard, health, qa-only, spec, unfreeze) take the group's verdict. They are fit=yes skills nobody opened.
- **The fit=no skills in the group** are listing cost only, as preregistered.

**Skills with no arm:**
- qa, autoplan and plan-eng-review are not removable at the pin.
- The fit=no skills outside the diet, such as office-hours, ship and plan-ceo-review, are listing cost only.
- Full ranking: [analysis.md](analysis.md#skills-ranked-by-pooled-open-rate-then-listing-bytes).

**No skill is a cut candidate, and no skill earned KEEP.**

## Findings worth knowing

- **Opus 5.5 does not open gstack skills on terminal tasks.** That was 0 opens in 34 scored stage 0 full trials and 0 in 504 main-stage gstack trials.
  - **What this means:** for Opus in Claude Code, gstack's skill list is context the model reads and then ignores.
  - **What it doesn't mean:** this doesn't measure gstack's preamble or its interactive workflows, which these tasks never ask for.
- **Sol's verify reads did not raise its pass rate.** Without verify, Sol scored 63.1% against full's 66.9%, a gap of -3.8 [-10.0, +1.9]. That is within noise.
- **The diet arm's higher dollar cost per trial is mostly a metering artifact.** On Sol, the diet's recorded USD per completed main-stage trial was $0.44, against $0.27 for full. Its token counts were not higher (0.93x).
  - **Why:** the metering proxy charges a call's full reservation (input plus the 128k output cap, at list price) when the upstream stream returns no usage.
  - 22 such calls make up 50% of sol-diet's recorded spend, against 8 calls and 23% in sol-full ([charged-reservations.json](charged-reservations.json)).
  - In sol-none, sol-full and sol-minus-verify they are all in model-extraction-relu-logits trials the model refused. In sol-diet, 12 of the 22 are in completed trials: install-windows-3.11 (4), filter-js-from-html (3) and five other tasks (1 each).
  - We don't know what the provider billed for those calls. So the diet's cost per solve ($0.79 against $0.50) is an upper bound, not a measured cost.
  - On Opus no call was charged that way. Opus diet cost $0.81 per completed trial against full's $0.68, which sits inside its per-task spread (cost per solve intervals overlap).
- **Amendment 3's earlier "doubled cost per trial" figure is withdrawn.** Amendment 4 explains why: its denominator counted lease-refused trials.

## Sensitivity line: the selection the recorded zeros gave

- Amendment 2 fixed the Codex open detector after stage 0 and re-measured opens from the unchanged captures ([stage0/opens.json](stage0/opens.json)).
- With the opens as first recorded, the selection would have had **no minus arm and a 53-skill diet that includes verify** ([stage0/selection-recorded-zeros.md](stage0/selection-recorded-zeros.md), spec_sha256 `ab021fbd...`).
- The fixed detector gave a verify minus arm and the 52-skill diet without verify, which is what ran.
- **We didn't run the recorded-zeros arms.** Their diet differs from the one that ran only by also removing verify, so the minus-verify and diet readings above each measure part of it. Both were within the margin, but their combined effect was not measured.

## Deviations and incidents

- **Lease refusals, before and after the reruns.** A main-stage trial the proxy marked `lease_refused` reran once as rerun1 (amendment 4 and its addendum).

  | Cell | lease_refused before | after rerun1 | Rerun outcomes |
  |---|---|---|---|
  | sol-diet | 78 | 0 | 75 completed, 3 harness_error |
  | sol-minus-verify | 11 | 0 | 11 completed |
  | sol-none | 9 | 0 | 9 completed |
  | sol-full | 6 | 0 | 6 completed |
  | opus-none | 1 | 0 | 1 timeout |
  | opus-full, opus-diet, opus-minus-verify | 0 | 0 | none |

  - **Cause:** the proxy reserves input plus the full output cap for every open call, and parallel calls of about 1M input tokens did not fit the room left in the lease.
  - **Cap fit:** the addendum made the planned leases fit the $1,600 cap, for $1,599.32 planned.
- **Amendment 1's runner fault:** 8 opus-full stage 0 trials from launch 1 ran no verifier. All 8 reran once as rerun1. Results: 5 completed, 3 timeout.
- **Amendment 2's stopped trial:** opus-none train-fasttext a2 (stage 0) was stopped before its verifier ran. It is counted as infra_error, never scored and not rerun.
- **count_tokens refusals (amendment 3, every Claude arm):** Claude Code's POST /v1/messages/count_tokens calls were refused 403 because the route is off the proxy's allowlist ([count-tokens.json](count-tokens.json)). Counts: opus-none 10, opus-full 13, opus-diet 9, opus-minus-verify 10, out of about 2,700 to 3,400 message calls per cell.
- **Model refusals, scored as fails (harness_error):**
  - Opus refused protein-assembly, dna-assembly and dna-insert in every attempt of every arm.
  - Sol refused model-extraction-relu-logits in most attempts. The 4 sol-diet refusals amendment 4 names are not rerun.
- **One verifier timeout, scored as a fail:** opus-full model-extraction-relu-logits a5 (main stage) ended as harness_error with `VerifierTimeoutError` and no grade. It is a grader fault, not a model outcome, and it counts against full.
- **Agent time limits:** 12 to 15 per Opus cell in the main stage, scored by the verifier like any other trial (14 of the 54 still passed), mostly on extract-moves-from-video, train-fasttext and schemelike-metacircular-eval. Sol had none.
- **Contamination audit ([audit.json](audit.json)):**
  - None of the 1,476 trials carried the benchmark canary or asked for a copy of the benchmark.
  - The none arms read no gstack file.
  - One sol-full main trial (sanitize-git-repo a7) received 156 of 205 hidden-test lines from its own environment. It failed, so it adds nothing to full's pass rate.
- **Exposure checks:** every trial's listing matched its lock, stage 0 included: all 1,066 gstack-arm trials and all 410 none trials report exposure ok.
- **Truncated captures:** 2, both opus-minus-verify. No opens were seen in either.
- **The Codex batched-exec open over-count (follow-up from #421) didn't occur.** No main-stage Sol exec call named two or more skills' SKILL.md ([batched-exec-audit.json](batched-exec-audit.json)).
- **Merge:** `merge-stages.ts` now leaves each shard's tasks tree out of the run-plan comparison. Each model ran its own subset, so the Opus and Sol shards have different trees. The merged manifests record each shard's tree under `tasks_tree_sha256_by_shard`.
- **Infrastructure:** none of the following lost a record.
  - Two launches failed before any trial (missing `--done`, and a commit not on origin).
  - Three sol-diet rerun launches waited for Ubicloud capacity, so its rerun VM started about 4 hours after its main-stage VM was destroyed (shard-vm.json).
  - One controller slept while two finished shards' VMs sat idle for about 2.5 hours (sol-full and sol-minus-verify main, shard-vm.json).
  - Some teardown pulls failed on container-owned files on the VM, and changing their ownership on the VM fixed them.

## Receipts

- **Merged records:**
  - [merged/base/](merged/base/) is the none and full cells: stage 0, main and rerun1, merged with [merged/exclude-base.json](merged/exclude-base.json).
  - [merged/arms/](merged/arms/) is the minus-verify and diet cells, merged with [merged/exclude-arms.json](merged/exclude-arms.json).
  - Each holds trials.jsonl, manifest.json, merge.json, and each shard's ledger, proxy usage, run summary, attestation, preflight and VM record under `shards/`.
- **Stage membership:** [merged/stages.json](merged/stages.json), from `plan.ts show --stages-out` on both preregistrations.
- **Unedited per-stage records:** main/<cell>/ and rerun1/<cell>/.
- **Analysis:** [analysis.json](analysis.json) and [analysis.md](analysis.md), from `ablation.ts analyze --results <base + arms trials.jsonl> --spec ../ablation-spec.json --headroom stage0/headroom.json --selection stage0/selection.json --stages merged/stages.json`.
- **Spend lines** are in [../spend-internal.md](../spend-internal.md), an internal file kept out of the public copy.

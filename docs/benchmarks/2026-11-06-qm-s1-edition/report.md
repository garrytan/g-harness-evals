# Does gstack's QM edition help QM review code? (qm-s1-edition-2026-11): report

- **We learned that adding gstack's QM edition (gstack-review and gstack-plan) to QM didn't raise review-task success:** -0.2 points pooled [-5.4, 4.6], over 1,728 trials on Opus 5.5 and GPT-6.1 Sol. **You don't need gstack-review in QM's edition for this kind of task.**
- **We learned that forcing the review skill into every turn cost 27 points:** -27.4 [-38.3, -16.8] against plain (descriptive, 48 forced trials). With the skill read, models flagged more harmless code and listed more issues. **Test a review skill on your own review tasks before you force it into the system prompt.**
- **We learned that listing a skill isn't the same as a model using it:** Sol opened the skill in all 432 of its edition trials and Opus in none. Only the skill catalog in the system prompt reached Opus, so Opus's +5.8 can't be credited to the skill being used. **Measure skill opens before you credit a skill.**

**Answer: no. On 24 code-review tasks, plain QM and QM with gstack's QM-native edition showed no measurable difference (50.3 against 50.1 percent), and when the review skill was forced into every turn, scores fell.**

- **Pass rate** (24 tasks; 432 tries per main cell, 24 per forced cell; task-clustered bootstrap 95% range):
  - Opus 5.5: plain 47.7% [36.6%, 59.3%], edition 53.5% [41.7%, 65.0%], forced 16.7% [4.2%, 33.3%].
  - GPT-6.1 Sol: plain 53.0% [35.0%, 71.5%], edition 46.8% [28.7%, 65.3%], forced 29.2% [12.5%, 50.0%].
- **Cost per solved task** (list price through our metering proxy, QM's housekeeping calls included, no VMs; no range, because the frozen analysis computes none): Opus plain $0.15, edition $0.13, forced $0.46; Sol plain $0.09, edition $0.11, forced $0.19.
- **Median time per trial** (one trial at a time per shard VM): Opus plain 19.4 s, edition 19.3 s; Sol plain 20.1 s, edition 17.9 s.
- **Call:** edition minus plain, pooled over both models: **CUT** under the preregistered rule, -0.2 points [-5.4, 4.6], sign-flip p 0.97. Per model (descriptive): Opus +5.8 [1.4, 10.4], Sol -6.3 [-15.5, 1.6]. MDD 7.7 points pooled, 11.7 if the models react differently.
- **Verdict:** CUT-CANDIDATE: switch off gstack-review in QM's edition for this kind of review. Forced into every turn, it lowered review success; Sol read it in the main stage with no measurable difference; where Opus never opened it, there was no skill to credit. See [Why null?](#why-null).
- **Caveats:**
  - Invented single-defect review tasks, not held-out. The verdict is scoped to them.
  - Opus opened the skill in 0 of 432 edition trials. Its edition arm tests a skill list, not the skill.
  - Forced is 1 try per task and model: descriptive only.
  - Plan tasks left before the main stage, on a trigger the preregistration did not list (Deviation 1).
  - Pinned at QM main `90e4ced7` and gstack edition `6cf00aee`. Every counted trial ran at repository commit `fa9b6c999f`, not part 3's `357212197e` (Deviation 2).
- **Status:** draft until its results PR merges (branch `qm-gstack-skills-results`); claim check: one /ship reviewer on that PR. Words: [glossary](../../glossary.md).

**Verdict line (preregistered form):** CUT on 24 invented single-defect code-review tasks, QM main `90e4ced7`, gstack edition `6cf00aee`. The rule needed a pooled gain above 0 with p below 0.05 and neither model below 0. It failed all three ways.

## What ran

- **QM** is an agent harness. **gstack's QM edition** installs two gstack skills as QM skills: `gstack-review` and `gstack-plan`. QM lists them in its system prompt, and the model can open them.
- **Arms:** `plain` (QM as shipped, no gstack anywhere) and `edition` (plain plus the two skills). A third arm, `forced`, puts the whole matched SKILL.md in QM's system prompt every turn. It is a diagnostic, outside the rule.
- **Tasks:** 24 invented review requests. Each diff has one planted defect and some decoys (code that looks suspicious but is fine). A reply passes when it flags the defect with its location and mechanism, flags no decoy, and raises at most 3 issues. A deterministic grader scores it; no model judge.
- **Size:** 24 tasks x 18 tries x 2 arms x 2 models = 1,728 counted trials, plus 48 forced trials (24 tasks x 1 try x 2 models).
- **Run:** 8 Ubicloud shards (model x block of 6 tasks). Every trial ended `ok`: 0 excluded, 0 infra errors, 0 reruns, 0 contaminated, no cap stop.
- **Intervals:** the 95% range resamples whole tasks with replacement (task-clustered bootstrap, 10,000 draws, seed 7). The p value flips the sign of each task's difference at random (two-sided sign-flip test over the 24 tasks). There is one preregistered comparison, so there is no Holm family.
## Results

### Primary: edition minus plain

Pass rate in percent (the task mean). Difference in points, task-clustered bootstrap 95 percent interval (10,000 draws, seed 7), two-sided sign-flip p over the 24 tasks.

| Model | Plain | Edition | Difference | Interval | p |
|---|---:|---:|---:|---|---:|
| Opus 5.5 | 47.7 | 53.5 | +5.8 | [1.4, 10.4] | 0.033 |
| GPT-6.1 Sol | 53.0 | 46.8 | -6.3 | [-15.5, 1.6] | 0.216 |
| **Pooled (decides the verdict)** | **50.3** | **50.1** | **-0.2** | **[-5.4, 4.6]** | **0.967** |

- The per-model rows are descriptive. Only the pooled row and the sign of each model's estimate enter the rule.
- The pooled interval's upper end, 4.6 points, is below the 7.7-point minimum detectable difference the run was sized for.

### Did the skill reach the model? (exposure)

| Model | Skill list in the first request | Opened, read whole and ran step one of gstack-review |
|---|---:|---:|
| Opus 5.5 | 432 of 432 | **0 of 432** (0 percent, 95 percent CI 0 to 0) |
| GPT-6.1 Sol | 432 of 432 | **432 of 432** (100 percent, 95 percent CI 100 to 100) |

- Opus opened no skill of any kind in any edition trial. The exposure pilot (2 trials) showed the same.
- So Opus's edition arm measures the skill catalog in the system prompt, not the skill bodies. Its +5.8 points can't be credited to gstack-review being used. It is one unadjusted per-model number.
- The preregistered exposure line for Opus: "Exposure: the edition reached Opus 5.5 in 0 of 432 edition trials (0 percent, 95 percent CI 0 to 0), so its edition-minus-plain estimate measures an edition it did not use. Whether the skill helps when it is read is answered by forced minus plain on Opus 5.5 (descriptive)."

### Forced exposure (descriptive)

The forced arm answers "does the skill help when the model is sure to read it?" It ran once per task and model (24 trials per model), so these numbers are descriptive and wide.

| Model | Plain | Forced | Forced minus plain | Interval | p | Forced minus edition | Interval |
|---|---:|---:|---:|---|---:|---:|---|
| Opus 5.5 | 47.7 | 16.7 (4 of 24) | -31.0 | [-47.0, -14.1] | 0.002 | -36.8 | [-52.3, -21.1] |
| GPT-6.1 Sol | 53.0 | 29.2 (7 of 24) | -23.8 | [-41.2, -7.9] | 0.015 | -17.6 | [-32.4, -5.8] |
| Pooled | 50.3 | 22.9 | -27.4 | [-38.3, -16.8] | 0.0001 | -27.2 | [-37.2, -17.8] |

- **How these were computed:** the frozen analysis has a forced comparison built in. We ran it twice, once on the main trials only and once on main plus forced. The primary result and verdict are byte-identical in both runs. The forced rows above come from the combined run.

### Why the skill lowers the score on these tasks

How the replies failed (main stage, 432 trials per cell; forced, 24):

| Cell | Flagged the planted defect | Flagged a decoy | More than 3 issues | Issues per reply |
|---|---:|---:|---:|---:|
| Opus plain | 330 (76 percent) | 135 | 26 | 1.75 |
| Opus edition | 338 (78 percent) | 127 | 20 | 1.69 |
| Opus forced | 23 of 24 | 15 of 24 | 16 of 24 | 3.96 |
| Sol plain | 407 (94 percent) | 190 | 0 | 1.39 |
| Sol edition | 425 (98 percent) | 229 | 49 | 2.30 |
| Sol forced | 24 of 24 | 16 of 24 | 7 of 24 | 3.04 |

- **When the skill is read, models find the bug a bit more often but raise more false alarms.** Sol with the skill flagged the defect in 425 replies instead of 407, but flagged a decoy in 229 instead of 190 and went over 3 issues in 49 instead of 0.
- **The skill asks for this.** It tells the model to report a CRITICAL list and an INFORMATIONAL list. Every informational item that touches the diff counts as a raised issue here.
- Opus's edition cell barely moves on any of these counts, which fits a model that never opened the skill.

### Cost per trial and per solved task

List price through our metering proxy, QM's housekeeping calls included, VMs not included.

| Cell | Trials | Cost per trial (mean) | Cost per solved task |
|---|---:|---:|---:|
| Opus plain | 432 | $0.0725 | $0.1521 |
| Opus edition | 432 | $0.0718 | $0.1343 |
| Opus forced | 24 | $0.0762 | $0.4572 |
| Sol plain | 432 | $0.0455 | $0.0858 |
| Sol edition | 432 | $0.0492 | $0.1052 |
| Sol forced | 24 | $0.0545 | $0.1869 |

- On Sol the edition costs 8 percent more per trial and 22 percent more per solved task. On Opus, which never opened it, cost is flat.

### gstack-plan

The plan tasks left the main stage before it started (see Deviations). The preregistration's line for it, word for word:

> gstack-plan: FIX-METHOD: plain frontier plans sit at the floor of this rubric, so the plan family needs a new bank or rubric before any claim about gstack-plan.

## Why null?

1. **Exposure.** Split by model. Sol read the skill in 432 of 432 edition trials, so its -6.3 [-15.5, 1.6] is the skill's real effect on these tasks: no measurable difference. Opus opened it in 0 of 432. What reached Opus was the skill catalog in QM's system prompt (each skill's name and one-line description), not the skill bodies, so Opus's +5.8 can't be credited to gstack-review being used. The forced arm guarantees exposure and is negative on both models (-31.0 Opus, -23.8 Sol).
2. **Fit.** These are the tasks gstack-review is for: review a diff for a bug that passes tests. The scoring rewards precision as well as finding the bug: a decoy flag or a fourth issue fails the trial. gstack-review's two-list format (critical plus informational) runs into that directly. On finding the planted bug alone, the skill helps a little (Sol 94 to 98 percent, Opus forced 23 of 24). That count is descriptive and was not the preregistered outcome.
3. **Power and saturation.** Not saturated: plain sits at 50 percent (37.5 and 58.3 percent at the headroom check). The minimum detectable difference is 7.7 points pooled, 11.7 if the models react differently. The pooled interval tops out at 4.6. The per-model estimates point in opposite directions: Sol, which read the skill, -6.3 [-15.5, 1.6], no measurable difference; Opus, which never opened it, +5.8 [1.4, 10.4].
4. **Model.** Frontier models only: Opus 5.5 and GPT-6.1 Sol.

**Why cut.** Only forcing the skill into every turn clearly lowered review success (both models -24 to -31, pooled -27.4, descriptive), because it adds false alarms that cost more than the small gain in finding the bug. In the main stage Sol read it with no measurable difference (-6.3 [-15.5, 1.6]) and paid 22 percent more per solved task. Opus never opened it, so its +5.8 [1.4, 10.4] comes from the skill catalog, not the skill, and there is nothing in the skill to keep. Per the preregistration, a second attempt needs a new plan and Garry's approval.

**Verdict line:** CUT-CANDIDATE: gstack-review in QM's native gstack edition (gstack `6cf00aee`).

## Deviations

1. **The review-only fallback ran on a trigger the preregistration did not list.** Amendment 1 named two triggers: the plan judge failing calibration, or gstack-plan leaving the edition. Neither happened. Both judges passed calibration, and then plain plan replies fell below the 15 to 75 percent band (Opus 2 of 24, Sol 0 of 24). The band rule sent that back for a decision, and the fallback was chosen and recorded in Amendment 3 part 3 before any main-stage trial.
2. **Every counted trial ran at `fa9b6c999f`, not part 3's `357212197e`.** Part 3 named `357212197e` as the launch commit. The opus-b1 canary failed 7 times there before its first trial, so main and forced both ran from the lane-retry addendum `fa9b6c999f`, as that addendum's "which commit runs what" rule says. All 16 shard VM records name `fa9b6c999f`. The addendum changed only lane retries, with no trial-visible change.
3. **Seven failed canary launches, not six.** From 08:49 to 11:28 UTC on 2026-11-08, GitHub downloads answered 504 on and off. Seven opus-b1 VM launches at `357212197e` failed in bootstrap or the image build: at 08:49, 09:02, 11:08, 11:17 and 11:28 on the Bun download, and at 08:56 and about 09:16 on npm fetches. The addendum and its spend note say six; the 11:28 launch is the seventh. Two more attempts never created a VM (08:53 and 08:54). No paid call was made. GitHub 504s were also seen from Capy between 09:22 and 11:07. The controller machine restarted at about 09:16 with no counted runner live.
4. **Forced shards were relaunched after Ubicloud ran out of capacity.** At 15:24 UTC, 7 of 8 forced shards failed with "VM creation failed" (the project was at 254 vCPUs). Each was relaunched at `fa9b6c999f` on its own existing reservation between 15:43 and 16:34. One relaunch, sol-b2, failed its keyless smoke test (a fake upstream; QM's core did not answer its health check within 180 s). That was not a counted trial and made no paid call. It was relaunched at 16:53 and finished with 6 of 6 trials ok.
5. **The forced results overwrote main's replica copy, and main was restored from the controller copy.** Forced replicated into the same shard folders as main. Main was copied back from the controller's results into a separate `main-results/` folder. We verified from the controller machine that each shard's turns.jsonl sha256 matches the `main-results/` copy, for all 8 shards. We merged main from `main-results/`. Three checks show it is main's data: every main trial record names run id `qm-s1-edition-2026-11-main` (the merge refuses any other run id), each shard holds 216 trials, and each shard's metered spend matches the run log to the cent.
   - turns.jsonl sha256, first 12 characters: opus-b1 `ceec724035c7`, opus-b2 `807d640d0154`, opus-b3 `f3fd2659458d`, opus-b4 `db8f98ca3e2e`, sol-b1 `1a73dafccc19`, sol-b2 `981564cc21b6`, sol-b3 `0b63c89898c6`, sol-b4 `5d30555a96ea`.

Not a deviation: Amendment 3 parts 1 to 3 and the addendum were committed and pushed on this results branch before the data they govern, as the two-pull-request rule allows.

## Files

- `main/`: `turns.jsonl` (1,728 trials), `grades.jsonl`, `grades-secondary.jsonl` (identical deterministic grades, since no judge ran), `trials/` (each trial's session and first model request), `shards/<shard>/` (ledger, proxy usage, preflight, run record, task digests, VM record).
- `forced/`: the same for the 48 forced trials.
- `analysis/main-only/` and `analysis/main-plus-forced/`: the frozen analysis (`harnesses/qm/gstack/edition-analysis.ts --tasks 24 --reps 18`), JSON and Markdown.
- `analysis/exposure-rate.json`: `harnesses/qm/gstack/exposure-rate.ts` on main.
- `analysis/report-extras.py` and `report-extras.json`: the failure-mode counts, the skill-list counts and the median wall times, from the committed files. Its cost sums per cell and shard are in `spend-internal.md`.
- Merge: `harnesses/qm/gstack/edition-merge.ts`, main and forced merged apart under their own run ids.
- Spend: `spend-internal.md`, an internal file kept out of the public copy.

<details>
<summary>Commands</summary>

```
bun harnesses/qm/gstack/edition-merge.ts --run-id qm-s1-edition-2026-11-main --out <main> --shard opus-b1=<main-results>/opus-b1/results ... --shard sol-b4=<main-results>/sol-b4/results
bun harnesses/qm/gstack/edition-merge.ts --run-id qm-s1-edition-2026-11-forced --out <forced> --shard opus-b1=<replica>/opus-b1/results ... --shard sol-b4=<replica>/sol-b4/results
bun harnesses/qm/gstack/edition-analysis.ts --turns main/turns.jsonl --grades main/grades.jsonl --tasks 24 --reps 18 --out analysis/main-only
bun harnesses/qm/gstack/edition-analysis.ts --turns <main + forced turns> --grades <main + forced grades> --tasks 24 --reps 18 --out analysis/main-plus-forced
bun harnesses/qm/gstack/exposure-rate.ts --turns main/turns.jsonl --out analysis/exposure-rate.json
python3 docs/benchmarks/2026-11-06-qm-s1-edition/analysis/report-extras.py
```

Every command ran keyless under `env -i`. The main merge also refused a calibration shard twice in a test: once on its run record, and once with that record relabelled, on each trial's own run id.

</details>

## Disclosures

gstack is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

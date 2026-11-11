# gstack skill ablation preregistration: which gstack skills earn their context on coding tasks?

Status: written 2026-11-09 (America/Los_Angeles), before any counted trial of this run. Run id `gstack-skill-ablation-2026-11`. Cells, stages and shards are in [prereg-harbor.json](prereg-harbor.json); task subsets in [subsets.json](subsets.json); the fit table and single-removal render outcomes in [skills.json](skills.json); the analysis inputs in [ablation-spec.json](ablation-spec.json), read by `scripts/frontier-harbor/ablation.ts` (headroom, select, analyze).

**In one line:** install gstack in each model's home coding harness the way a user does, count which skills the model opens on hard Terminal-Bench 2.1 tasks, then remove the most-opened skills one at a time, and the never-opened skills as one group, and measure pass rate, tokens and cost per solve against full gstack and against no gstack.

**What this is not:** a test of gstack's workflows on the work they target (pull requests, reviews, deploys, browsers, iOS). Terminal-Bench tasks can't exercise those skills. They get a fit=no label and are reported for listing cost only, never cut on this evidence.

## Approval

- **Garry, 2026-11-09,** answering the plan's gate (run internal-task-20261109063631, gate rev 1): "do it". That took every recommendation, A1 to J1.
- **Captain (internal-task), 2026-11-09, before this preregistration froze:** per-model task subsets for the headroom check (see [Dated pre-freeze revision](#dated-pre-freeze-revision-2026-11-09)). Recorded as approval a-4d7b47ea068c.
- **Plan:** the approved plan with changes d1 to d9 applied, in the Captain drive at `handoffs/internal-task/autoplan/plan-approved.md` (sha256 77b0dda896382ada50c135766bda2930b3683b5247f15574eb57553eab043b38); its implementation section alone is `plan.md` there.

## Question

On autonomous terminal coding tasks, which installed gstack skills does each frontier model open, what does each skill cost in context, and does removing an often-opened skill, or the never-opened group, change pass rate?

- **Estimand, per model:** the task-mean pass rate on that model's subset, per arm; each arm minus full gstack; full gstack minus no gstack; tokens per trial and cost per solve per arm.
- **Primary comparisons** (pooled over the frontier models that pass the headroom check): each selected single removal minus full; diet minus full. **Reported beside them (R44):** full minus none, per model.

## Tasks

- **Source:** the 52 Terminal-Bench 2.1 core tasks pinned in `scripts/frontier-harbor/pin.json` (frontier-harness-2026-11), same digests and images.
- **Subsets (frozen in subsets.json):** for each frontier model, the tasks any of that model's four plain harnesses failed at least once in #337's trials, minus the floor task every one of the eight cells failed (make-doom-for-mips).
  - **Opus 5.5:** 21 tasks. Plain Claude Code on Opus scored 76.2% on them in #337 (2 mixed, 4 failed 0 of 2).
  - **GPT-6.1 Sol:** 20 tasks. Plain Codex on Sol scored 62.5% on them (3 mixed, 6 failed 0 of 2).
  - **Source file:** `docs/benchmarks/2026-11-07-frontier-harness/results/merged/trials.jsonl` on #337's branch at head fff579c2c12b7da6ad60f89a105734032b5651aa, sha256 52c4f3eca74edeac23b928fcd425c5da1d0501dee4123653f304f883fc5ae407 (an open results PR when this was written; last record per trial id, core cells, scored pass or fail).
  - **particle-1** (if its cells run) uses the Opus subset.
- **Selection uses plain-harness data from another run only.** Every arm here is measured fresh, so selection favours no arm. Stage 0 trials never enter the main comparisons.

## Arms and cells

| Arm | gstack | Notes |
|---|---|---|
| none | not installed | R44 control. Same harness, model, settings and task text. |
| full | every skill (`full` loadout) | What a plain `./setup` installs on Claude Code. Not the `lite` preamble loadout a Capy install serves Opus. |
| minus-<skill> | full minus one skill | Up to three, chosen by the rule below. Each runs on both frontier models. De-listed: the skill leaves the listing and the published skills folder; its source stays in the gstack checkout on disk, as with a gstack loadout change. |
| diet | full minus the never-opened group | The largest excludable set of fit=yes and fit=no skills that no model opened in stage 0, closed under the render rule below. De-listed: the skill leaves the listing and the published skills folder; its source stays in the gstack checkout on disk, as with a gstack loadout change. |

- **Models and harnesses:** Opus 5.5 in Claude Code 2.1.312, GPT-6.1 Sol in Codex 0.165.0, each at effort high, as in #337. particle-1 in Hermes v2026.9.24 is the labelled low-cost model. If the Particle route for the Harbor path has not merged to main when this preregistration merges, particle-1 does not run, and the report says so.
- **gstack pin:** garrytan/gstack at `68b1d056a4fcf300ca2b61a1406940c5dd336916` (`1.98.0.0`), installed with Bun 1.4.2. Every arm's lock file (spec_sha256 and per-file sha256) is committed under `locks/<host>/<arm>.lock.json`; minus and diet locks are added by the stage 0 amendment, from specs whose render outcome is already in skills.json. The committed `minus-retro` locks are the keyless install check's fixture (retro is fit=no); they are not an arm of this run.
- **Install:** the pinned gstack runtime is installed in the task container and the arm's loadout is published at the exact in-container skills root (Claude Code `~/.claude/skills`, Codex `$HOME/.agents/skills` with gstack's codex names, Hermes under `HERMES_HOME` with gstack's hermes registration), through Harbor's skills_dir. Eval markers are set; telemetry and the update check are off; brain sync does nothing; the egress blocklist is unchanged. gstack arms also install gstack's pinned Bun (1.4.2) and link it at /usr/local/bin/bun, as gstack's setup needs; the none arm does not. The image probe records which of the 52 images already ship bun or node.
- **Skill text per model:** gstack tunes some skill text per model family. Each host's arm is rendered with the cell's model id, as a user's config would select it: claude-opus-5-5 gets gstack's claude overlay and gpt-6.1-sol its gpt overlay (gstack's astra overlay applies only to gpt-6-astra). Hermes keeps the claude overlay it renders with, since particle-1 matches no gstack model family.
- **Prompt:** the task text only, in every arm. No arm is told gstack exists.

## Stages

- **Stage 0 (counted, not in the main comparisons):** per frontier model, on its subset, 2 attempts each of none and full.
  - **Headroom check, per model (R61):** the none arm's task-mean pass rate is at or below 75%, and at least 8 subset tasks are informative (mixed, or failed in both attempts, excluding the floor task).
  - **A model that misses still runs every arm.** Its pass rates are descriptive only and labelled "ceiling-limited"; its open rates and tokens are reported as its headline. Pooled pass-rate verdicts use only the models that pass. If neither passes, every pass-rate reading is descriptive and the verdicts rest on exposure and tokens (FIX-METHOD for any pass-rate claim).
  - **Open rates:** from the full arm's stage 0 trials (2 attempts per subset task).
- **Arm selection (applied mechanically, written as a dated amendment before the main stage):** a skill gets a minus arm if it is excludable (skills.json), fit=yes, and opened in at least 40% of the stage 0 full trials of either frontier model. Top three by pooled open count, ties broken by listing bytes (larger first). The diet group is every excludable skill opened in no stage 0 full trial on any model; pinned (ship, gstack, gstack-upgrade) and unsafe (qa) skills stay in the diet tree, and if the diet spec is refused, skills are put back smallest summed listing bytes first (ties by name), so the largest savings stay out, until it renders. Pooled open count is the number of full trials with at least one open of the skill.
- **Main stage:** per frontier model, on its subset, 8 attempts per task of none, full, diet and each minus arm. particle-1 runs the same arms on the Opus subset if it runs.

## Exposure checks

- **Positive (every gstack trial):** the skills listed in the first agent-loop request, mapped through the lock's name map, must equal the lock's skill set. A mismatch is `gstack_exposure_mismatch`: excluded pairwise and counted.
- **Removed skills:** any listing entry or skill path of a skill absent from the arm's lock, seen in any request of the trial, is recorded in removed_seen and reported per arm.
- **Clean none arm:** preflight refuses a gstack install or Capy drive; the audit counts trials that read a gstack file; a none trial with one is contaminated and reported.
- **Opens:** Claude Skill tool calls and Reads of a SKILL.md; Codex shell reads of `.agents/skills/*/SKILL.md`; Hermes skill and read_file calls; on every host, reads of a skill's SKILL.md in the gstack checkout the arm uploads. Section-file reads are counted apart.
- **Truncated captures:** a capture the proxy cut at its 256 MiB cap, or whose last line was cut mid-write, is flagged capture_truncated. Opens seen before the cap count as usual, opens after it are unobserved, and the report gives the number of truncated trials per arm and stage. The stage 0 amendment names any selected or diet skill whose reading rests on a truncated trial.

## Claims

- **Pass rate per arm:** task mean with a task-clustered percentile bootstrap 95% interval (10,000 draws, seed 7), as in #337.
- **Paired differences:** arm minus full (and full minus none) over tasks with at least one scored attempt in both arms, as differences of per-task mean pass rates, per model, with the count of tasks that got worse. Pooled: the mean of paired per-task differences across the models that pass the headroom check.
- **Non-inferiority:** one-sided 10-point margin on the pooled difference (90% lower bound above -10).
- **Holm family, per model:** the minus arms, the diet and full versus none.
- **MDD:** simulated from #337's per-task plain rates at 8 attempts. 95% half-width about 10 points per model and about 7 points pooled. Recomputed after stage 0 and stated in the report.
- **Tokens:** per trial, input, cached and output tokens from the proxy; listing bytes from the first agent-loop request; opened-body tokens from tool results that return skill text. **Cost per solve** with a task bootstrap interval and the paired ratio to full; descriptive.

## Verdicts (per skill)

- **fit=no skills:** listing cost and open rate only. No KEEP or CUT on this evidence.
- **Selected minus arms (fit=yes):** CUT-CANDIDATE when the pooled removal is within 10 points and tokens per trial are not higher. KEEP when the pooled removal's interval is wholly below 0. Otherwise FIX-METHOD, with the MDD and the fix named. When both the KEEP and the CUT-CANDIDATE conditions hold, the verdict is KEEP and the reason says the cut rule also held. A within-10 reading with higher tokens per trial is FIX-METHOD.
- A CUT-CANDIDATE means de-listing the skill (a loadout change) costs under 10 points; reads of a de-listed skill's files are counted in removed_seen and reported per arm.
- **Diet:** the same rule applied to the group. A diet CUT-CANDIDATE names the group's fit=yes skills as cut candidates for autonomous terminal work, and lists its fit=no skills as listing cost only.
- **fit=yes skills with no arm** (opened, but below 40% on every model): FIX-METHOD (exposure too low to measure), with their open rates.
- **Why null?** One cycle (exposure, fit, power and saturation, model) for every null, ending in one verdict line.

## Scoring, exclusions and infra classes

As in #337: pass is the TB2.1 verifier's reward 1; a task's agent time limit is a scored fail; `harness_error` counts as a fail. Excluded pairwise and counted: `unfinished`, `setup_failed`, `no_model_response`, `effort_mismatch`, `rate_limited`, `gstack_exposure_mismatch`, `gstack_install_failed` (the setup-time check found the arm's skill files missing), `gstack_contaminated` (the none arm's container held gstack at setup; reported per arm). A grader outage uses #337's "verifier never ran" signature, written before the run. A lease stop is `model_error` with cap_stop, excluded and reported.

## Sharding and leases

- One Ubicloud standard-16 VM per cell and stage, UBI_OWNER=internal-task, 4 trials at a time ("contended" wall time), retries off. No cell is split across machines. UBI_TTL_HOURS is 12 on every VM (Opus subset trials averaged 701 s and reached 3,969 s in #337). Results are copied off each VM while it runs, and each VM is destroyed on every exit.
- **Leases (stage 0 and main of none and full):** Opus none $170, Opus full $196, Sol none $72, Sol full $83. Total $521 plus a $180 reserve, inside the $1,600 cap. That leaves $899 for the minus and diet shards the stage 0 amendment adds; at the priors below they need about $742, about $890 with the same 20% margin.
- Every shard lease is at least its headroom floor (concurrency x the largest per-call price), as `plan.ts show` checks.

## Money (R71 guideline $2,000 all-in)

| Line | Ceiling |
|---|---|
| Own model use: plan, build, results | about $250 |
| Ubicloud VMs | about $90 |
| Paid trials | $1,600 cap, of which $180 is a reserve never planned against |

- **Prior per trial, from #337's subset trials (plain):** Opus in Claude Code $0.674, Sol in Codex $0.300. gstack arms are priced 15% higher for the listing and opened bodies.
- **Re-priced from those receipts at freeze:** stage 0 about $87 (164 trials); main stage none and full about $346 (656 trials); three minus arms and the diet about $742 (1,312 trials). About $1,175 of paid trials in all, plus VMs and own model use: about $1,515 against the $2,000 guideline.
- If particle-1 runs, its cells are priced from internal-task's receipts and added inside the same cap.
- No model judge, so R78's judge check does not apply.

## Dated pre-freeze revision (2026-11-09)

The approved plan checked headroom on one 28-task subset: every task any of #337's eight plain cells failed, minus the floor task. #337's own numbers said Opus would miss that check: plain Claude Code on Opus scored 82% on the 28 tasks, with only 6 informative tasks (22 solved 2 of 2, 4 failed 0 of 2, 2 mixed), against the 75% band and the 8-task floor. Sol was 73% there, with 9 informative tasks (3 mixed, 6 failed 0 of 2). Under the approved rule the Opus miss would likely have stopped the pass-rate comparison on Opus before it started. The Captain chose per-model subsets (Opus 21 tasks at 76.2%, Sol 20 tasks at 62.5%) and the rule that a model missing the band still runs every arm with descriptive, "ceiling-limited" pass rates. Every arm, model and threshold value is unchanged; only the tasks the threshold is checked on changed. The change serves R61: it keeps a cheap headroom check that can pass, instead of a check the source data already says fails. Source: #337's merged trials file at fff579c2c1, sha256 52c4f3ec (above).

## Receipts

Under `docs/benchmarks/2026-11-10-gstack-skill-ablation/results/`: merged trials.jsonl and manifest.json; per shard its ledger, proxy usage, run summary, preflight, shard and VM records; analysis.json and analysis.md; audit.json; the per-trial gstack records. Spend lines go in spend-internal.md only. This preregistration merges to main before the first counted trial; results and amendments come in one later PR (R77).

## Amendments

Each amendment is a dated commit on the results branch before any cell it affects. Planned: the stage 0 headroom reading and arm selection, with the minus and diet locks.

## Disclosures

The report and any finding file end with these lines, word for word from the disclosures list. No X post carries them in full.

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

If particle-1 in Hermes runs:

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

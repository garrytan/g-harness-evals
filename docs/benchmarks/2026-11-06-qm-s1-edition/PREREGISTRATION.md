# S1 rerun: does QM's native gstack edition solve more coding requests than plain QM, on Opus 5.5 and GPT-6.1 Sol?

Status: design preregistration, written 2026-11-05 (America/Los_Angeles), before any trial. Run id `qm-s1-edition-2026-11`. HARN-43 wrote it (GST-1514). No paid trial runs on this document alone.

**In one line: QM gets 48 new coding requests with and without gstack's QM-native edition (two QM skills: review and plan; Amendment 1 dropped investigate). If the edition doesn't solve clearly more of them, it's cut.**

- **Arms:** `edition` (the edition installed as QM skills), `plain` (QM as shipped, no gstack, R44), and `forced`, a diagnostic arm outside the rule that puts the matched skill's whole text in front of the model every turn.
- **Models:** Opus 5.5 (`anthropic:claude-opus-5-5`) and GPT-6.1 Sol (`openai:gpt-6.1-sol`). No Haiku, Sonnet or particle-1 arm (R54).
- **Size:** 48 tasks × 9 repetitions × 2 arms × 2 models = **1,728 counted trials**, plus 96 forced-arm trials (Amendment 1; was 72 × 6).
- **The rule:** KEEP only if edition minus plain task success, pooled over both models, is above 0 with a two-sided sign-flip p below 0.05 over the 48 task clusters (24 under Amendment 1's review-only fallback), **and** neither model's estimate is below 0. Otherwise **CUT**, with no second attempt.
- **Reported apart, never in the rule:** opens, first-step execution, cost per task and per success, reply length.
- **MDD:** 7.1 points pooled; 10.7 if the models react differently (model-by-arm interaction sd 0.4 logit). Amendment 1 figures; the original 72 × 6 design had 6.7 and 10.6.
- **Caps:** $1,510 all-in (R71), with $620 of paid calls across four stages, $40 of VMs and $850 of own model use.
- **Machine-readable design:** [design.json](design.json). It isn't a runnable `prereg.json`: the runner can't stage QM skills or count skill reads from QM's sessions, so the trials run through the QM driver in `harnesses/qm/gstack/`, as S1 did.
- **Two later stages freeze through dated amendments,** each its own PR, merged before the cells it affects:
  - the **pilot amendment**, once GSTA-36 says the edition is ready: the QM SHA, the edition commit, image digests, the task bank and keys, and the first-step markers;
  - the **main amendment**, after the headroom check and pilot: the judge, the task replacements if any, and the repetition count from the cost rule.

## Why this run

- **The first S1 probe ended FIX-METHOD.** At QM `b6786d67`, gstack's generic router, pasted into QM's org SOUL, got Sol to open the matched skill in 11/15 turns and Opus in 2/15. The skill's first step ran in 0 of 9 eligible turns on both models. Every open read SKILL.md through `execute` in pieces. ([report](../2026-11-03-qm-s1-gstack-probe/report.md))
- **Its progress score couldn't decide anything.** It was a form marker (for example "ran `git diff`") over 5 request clusters, where the smallest exact p is 0.0625.
- **The fix it named is now being built.** GSTA-320 builds a QM-native edition (GST-1492) as QM skills that QM reads whole, with no install step. Garry took A1 on 2026-11-05: build it, rerun S1 against plain QM, and cut it if it doesn't win.
- **This run informs:** whether gstack ships on QM (GSTA-36, CAPY-1). If it's cut, the run also says whether QM didn't open the skill or the skill didn't help when read.

## Approval

- Autoplan run `run-20261105232312`, one lean review (Opus 5.5, 21 findings: 6 High, 12 Medium, 2 Low, 1 Informational). The gate was answered at gate rev 1 with rec_hash `94ce35cddbc9`.
- Garry answered "Do it" (2026-11-05, web, relayed by HARN-1), which took every recommendation:
  - cost is report-only;
  - 72 tasks × 6 repetitions;
  - the forced-exposure arm;
  - the five High fixes (fanout result safety, length- and form-proof graders, a per-trial clean-arm check, and command-approval handling with a receipt).
- The approved plan is in the Captain drive, in the autoplan folder of HARN-43's handoffs (plan.md).

## Question

On invented single-turn coding requests in a DM, each about a small fixture repository in QM's sandbox:

1. Does QM with the edition solve more requests than plain QM? (primary, pooled over both models)
2. Does QM open the matched skill, and does it carry out the skill's first step? (descriptive, per model)
3. When the skill's text is forced into context, does it help? (forced vs plain, forced vs edition; descriptive)
4. What does the edition cost per task and per solved task?

## Arms

All arms share one QM SHA, one edition commit and one image set. The request text is the same in every arm, and only the arm differs.

| Arm | What QM has | In the rule |
|---|---|---|
| `plain` | QM as shipped at the pinned SHA: its default org SOUL and its own seeded skills, no gstack text in any layer (R44) | yes |
| `edition` | `plain` plus the pinned edition installed as QM skills through the deployment-layer route (text files, synced to `.agent-skills/<conv>/<name>/`); no SOUL change | yes |
| `forced` | `edition` plus the matched skill's whole SKILL.md in the org SOUL, so it is in context every turn | no (diagnostic) |

- **No name collision.** QM's seeded skills at main `850599e9` (`skills-seed/`) hold no investigate, review or plan skill. The pilot amendment rechecks this at the pinned SHA.
- **No router arm.** S1 measured the router at QM `b6786d67`, and Garry's rule compares the edition against plain QM.

## Tasks (invented)

- **72 tasks: 24 per family,** each a fixture git repository written by a seeded generator, with a plain-language DM request.
  - The request names neither gstack nor the skill.
  - Each trial stages only its own task's repository into the sandbox at `/root/workspace/repo`.
- **The families:**
  - **Investigate:** a failing test with one planted root cause and decoy suspects. "Find out why X broke."
  - **Review:** a branch diff with one planted defect and two decoy spots that look odd but are correct. "Review this before I merge."
  - **Plan:** a feature request whose repository holds 3 hidden constraints, for example a migration order, a feature flag, or a test that pins behaviour. "Plan how to add X."
- **The task bank is secret until the edition is pinned.** The generator engine ships on main with test-only templates.
  - The real templates, seed and keys sit in a private project-user drive folder. Their sha256 is committed here: bank file `bank.json` (bank_id `qm-s1-edition-2026-11-v1`, 72 templates) sha256 `3b3cfbd7b83205e4589e377337f8f869591beeb96ea3ee176ea637b073d660ad`, seed file `seed.txt` sha256 `c7e3dc087c8153956852d3f73f6ec4072b55db00037943f9e0b63f314f2ca423`. The generator at this commit accepts every key in it (72 tasks, 24 per family).
  - They are published for the first time in the pilot amendment, which checks them against this sha256. So the edition is frozen before anyone outside this lane can see the tasks.
- **Fixtures need no recursive delete,** which QM's command floor would hold for approval (see Command approval).
- **Why fresh tasks:**
  - S1's 5 requests are 5 clusters, only 2 of them match the edition's skills, and they score form.
  - v0.3 dev saturated in matrix-mu (#279).

## Scoring

**Task success is scored on substance, from each trial's final reply, by** [`edition-grade.ts`](../../../harnesses/qm/gstack/edition-grade.ts).

- **Extraction:** one arm-identical step splits the reply into sections at its headings, strips headings and markdown markers, and cuts trailing follow-up sections (next steps, questions) and courtesy lines. The same code runs for every arm.
  - A heading that names a file counts for the text under it, so "## src/price.js:17" locates the finding below it.
  - A clause that clears a candidate ("is fine", "not the cause", "ruled out") does not name it. A later clause clears the one before it only when it points back ("but it is fine"), not when it is about something else ("but the rest is fine").
- **Investigate:** the final answer is the last section that names a suspect. Success only when it names the cause alone (file and mechanism, with aliases). A hypothesis list that concludes wrong fails, and so does a correct hypothesis followed by a conclusion that blames another file.
- **Review:** the whole extracted reply counts. Success only when the planted defect is flagged with its location and mechanism, no decoy is flagged, and at most 3 issues are flagged.
  - An issue is a diff hunk (or a file, with no line) named in a unit that raises a problem, so a file overview is not an issue.
  - A decoy is flagged when its location is named in a clause that doesn't clear it; plain negation in a bug report ("does not validate") doesn't clear it. A line reference counts for the nearest spot in its file, and the generator keeps spots in one file at least 5 lines apart.
- **Plan:** the whole extracted reply counts. Success when at least 2 of the 3 constraints are named **and respected** by the plan, counting at most 6 named items (constraints and distractors; a dismissed distractor still counts toward the 6).
  - It's scored by an arm-blind judge on the stripped text, passed to the grader as a module (`--judge`). Every grade names the judge that made it, and the analysis reports the judges used.
  - The judge model and prompt are pinned in the main amendment after calibration (below). Its calls are metered under the main lease.
  - **If calibration fails, Amendment 1's review-only fallback applies** (24 review tasks × 18 repetitions, decided before the main stage starts). This replaces the earlier rule that plan left the verdict while investigate and review were pooled.
  - The alias key can't stand in for the judge: it checks naming, not respecting. On blind set A (below) it passed 34 of the 48 plans that fail the rule because they break their constraints. A respect check by violation phrases was tried and dropped: it matched the writer's break or respect label on all 72 plans of set A, which it was tuned on, but on only 60 of the 96 held-out plans of set C.
- **Wording check (keyless, done for this commit, rerun in the pilot amendment):** the private bank holds labelled replies for every template: the authors' correct and wrong replies, plus probes such as paraphrased correct answers. This agreement is the real check on a phrase-list grader.
  - The labels were written by the bank authors, not blind. The plan judge's blind calibration (below) is separate.
  - The pilot amendment reruns it on the pinned bank and reports any change.

| Family | Labelled replies in the private bank | Grader agrees at this commit | Where it disagrees |
|---|---:|---:|---|
| Investigate | 54 (24 correct, 24 wrong, 6 probes) | 53 (98 percent) | A correct reply that mentions a decoy's change as context is graded as naming the decoy. (A stale probe that named a file its template no longer uses was corrected.) |
| Review | 63 (38 correct, 25 wrong) | 63 (100 percent) | none |
| Plan, alias key | 58 (24 good, 24 bad, 6 paraphrased good, 4 that name their constraints while breaking them) | 54 (93 percent) | The 4 that break their constraints pass, because the alias key checks naming, not respecting (see the fallback above). |
| Plan, alias key, blind set A | 72 (3 per template, per-constraint labels; 24 succeed under the rule) | 38 (53 percent) | 34 plans that fail the rule pass: they name the constraints they break. |
| Plan, alias key, blind set C | 96 (4 per template, per-constraint labels; all 96 succeed under the rule, since each break breaks 1 constraint) | 94 (98 percent) | One template's naming misses 2 plans. |

- **Blind plan sets:** A (written by Opus 5.5) and C (written by GPT-6.1 Sol) are plans written from the request and constraint descriptions alone, by writers who never saw the keys, the grader or each other's sets. Each plan carries a respected, broken or absent label per constraint, and "succeeds" means at least 2 respected. They stay in the private bank folder with the other labelled replies.

- **Red team (keyless, before the pilot):** each of these must fail every grader:
  - an all-files-and-flags plan;
  - an every-hunk-but-the-decoys review;
  - a hypothesis list that concludes wrong;
  - padding and heading-only replies.
- **Judge calibration:**
  - It runs after the headroom check and the pilot, on at least 40 replies balanced by family and arm (pilot edition replies plus synthetic edition-style ones).
  - Labels are blind, by a reader on another model family who did not write the keys.
  - The labelled set includes plans that name a constraint while breaking it.
  - The judge must agree on at least 90 percent.
  - For plan, it must also agree on at least 90 percent of plan outcomes in each blind plan set (A and C, above), and its per-constraint agreement is reported. The 4 bank plans that name their constraints while breaking them must fail.

## Counting, from each trial's stored session

Counting runs in [`s1e-count.ts`](../../../harnesses/qm/gstack/s1e-count.ts), per trial, over each trial's stored session. The driver is [`s1e-probe.ts`](../../../harnesses/qm/gstack/s1e-probe.ts) and the frozen analysis [`edition-analysis.ts`](../../../harnesses/qm/gstack/edition-analysis.ts).

- **Open (matched):** a skill tool call naming the matched `gstack-<family>` skill that QM answered with its SKILL.md (GSTA-36's definition). **Open (any)** counts any edition skill. Reads of the synced SKILL.md with `read` or `cat` are kept in each trial's detail, not counted as opens.
- **Read whole:** the skill answer came back uncut, with no park marker. **Path rewrite:** QM replaced `skills/<id>/` with the synced folder.
- **Complete read:** the whole matched body reached the model: in the first system prompt (forced), in one uncut load, or a cut load plus reads of its parked copy.
- **First step:** an executed command matching the skill's `first_step_marker` in the pinned edition's `qm/edition.json`, run after the call that completed a complete read (from the start when the body is in the system prompt). A command run between a cut load and its completion doesn't count. The plain arm's rate of the same commands is reported as its baseline. At edition `eaf1701d` the markers are `\bgit\s+log\b` (investigate, plan) and `diff-base\.sh|\bgit\s+(diff|merge-base)\b` (review); the pilot amendment freezes them with the edition pin.
- **Contamination:**
  - In `plain`, any edition file in `.agent-skills`, or edition index text in the captured first request.
  - In `edition` and `forced`, the absence of either.
  - Contaminated trials are reported per arm.

## Endpoints

- **Primary: task success (0 or 1) per trial.** The statistic is edition minus plain, computed per task, averaged over that task's repetitions and over the two models, then averaged over the 48 tasks (24 under Amendment 1's review-only fallback).
  - The test is a two-sided sign-flip permutation over task clusters. Unequal repetitions are handled at the task level.
  - The interval is a task-clustered bootstrap 95 percent interval (10,000 draws, seed 7).
- **The rule (frozen now, with no data-dependent fork):**
  - **KEEP** if the run is complete, the pooled difference is above 0 with p below 0.05 **and** each model's own point estimate is at least 0.
  - **CUT** if the run is complete and any of these fails.
  - **INCOMPLETE**, with no verdict, if any model lacks a counted record for any task in either rule arm at the design's repetition count (a missing shard, arm or task, or a cap stop). An incomplete run is never retried as the same run (Spend).
  - The rule holds whatever model QM ships with. A model-specific question needs a new plan.
  - **The verdict line names the task type, the QM SHA and the edition commit.**
- **Secondary, descriptive, never in the rule:**
  - per-model differences with intervals;
  - opens, complete reads and first steps per skill and model;
  - `forced` minus `plain` and `forced` minus `edition`. Any comparison conditional on an open is labelled descriptive.
  - cost per task and per success, per arm and model: total metered USD at ledger prices, cache writes included;
  - input and output tokens, wall time and reply length per arm;
  - exclusion rate per arm, flagged when arms differ by more than 5 points.
- **What a CUT means:** no gain of about 7 to 11 points or more was detected on these task types (see Power).
- **An exposure null is still CUT** (Garry's A1). The opens, first steps and the forced arm say which part failed.

## Power

- Computed by [`power/power_rule.py`](power/power_rule.py), output [`power/power_rule.json`](power/power_rule.json) (numpy, seed 11). It simulates the whole KEEP rule under these assumptions:
  - logistic task effects with between-task sd 1.2;
  - within-task effect sd 0.5;
  - model offset sd 0.5;
  - 80 percent power, two-sided 0.05.
- **At 72 × 6:** MDD 6.7 points with no model-by-arm interaction, 10.6 with an interaction sd of 0.4 logit. S1 moved the two models in opposite directions.
- For comparison, 36 × 6 gives 9.6 and 12.4.
- **At 48 × 6** (the plan family left out after a failed judge calibration): 8.2 and 11.4.
- **Amendment 1 replaces these figures** for the amended bank: see [power_amendment.json](power/power_amendment.json).

## Headroom check (R61), before the main run

- **Plain arm only, not counted:** 48 tasks × 1 repetition × 2 models = 96 trials, cap $45 (Amendment 1; was 72 tasks and 144 trials).
- **Pass:** plain success between 15 and 75 percent on each model.
- **Above 75 percent:** replace the tasks plain QM solved on both models with harder variants from the generator, chosen without looking at any edition data.
  - The replacements and their keys are pinned in a dated amendment.
  - The check then reruns on the replacements only.
  - If it still fails, the eval stops and goes to HARN-1.
- **Below 15 percent:** the same procedure with easier variants of the tasks plain QM failed on both models.
- The check also measures plain cost per trial for the cost rule.

## Exposure pilot, before the main run

- **Edition arm, not counted:** 2 tasks (one per family) × 2 models = 4 trials, cap $10 (Amendment 1; was 3 tasks and 6 trials).
- It confirms the skills index is in the system prompt and a body loads.
- It also gives the edition's cost multiplier over plain.

## Cost rule

- After the headroom check and pilot: projected main cost = (plain cost per trial × (1 + edition multiplier) / 2 × 1,728 + judge cost per plan grade × 864) × 1.25.
  - The multiplier comes from the pilot, with 1.8 from S1 as the fallback.
  - The judge cost per grade comes from calibration; 864 is the plan family's share of the 1,728 trials (Amendment 1; was 576). Under the review-only fallback there is no plan grade.
- If the projection is above the $520 main cap, the main amendment drops to 6 repetitions (1,152 trials) before the main run (Amendment 1; was 4 of 6). Under the review-only fallback it drops from 18 to 12 repetitions (1,152 trials).

## Exclusions and invalid trials

- **Excluded, by cause only:** `model_error` (the turn ended because its last provider call failed) and `infra_error` (the stack, sandbox or VM failed). Each excluded trial is listed.
  - A provider error QM recovered from doesn't exclude the trial.
  - A turn QM finished is scored even if reading back its evidence failed; the failure is listed, and the clean-arm check reports what it couldn't see.
  - A trial whose driver or machine died after metered calls is recorded as `infra_error` when the driver next starts.
- **Reruns:** only an `infra_error` reruns, at most once, after a named repair, under the same cap.
  - The first record of a trial counts unless it ended `infra_error`; then its one rerun counts.
  - Any other rerun doesn't count and is listed as a problem. The spend of every attempt counts toward cost.
- **Counted as failures:** context-length errors, timeouts and turns past the approval cap.
- **Exclusion rate** is reported per arm, and arms more than 5 points apart are flagged.

## Command approval

- **QM's command floor:** at QM main `850599e9` (and at `b6786d67`), `src/policy/command-policy.ts` lines 7 to 21 set org floor rules:
  - they need approval for a recursive `rm`, a force push, destructive SQL, or `curl` piped to a shell;
  - they deny `mkfs` and a fork bomb.
  - `composePolicy` (line 27) adds them under every scope policy, so no scope setting removes them.
- **S1's one `pending_approval`** (`s1-r1-k1-sol-no-gstack`) was a Sol `execute` script that ran `npm test` among other commands.
- **Handling, the same in every arm:**
  - fixtures need no recursive delete;
  - the driver approves each pending command once through QM's approval route (`POST /v1/turns` with `approval: {requestId, approved: true, scope: "once"}`, `src/api/routes/turns.ts:334` at `850599e9`) and continues the turn;
  - at most 5 approvals per turn; a turn past the cap is a failure;
  - approvals are counted per arm.
- **Before the pilot:** a keyless gate at the pinned SHA runs one sandbox command and one floor-rule command in both arms, and the pilot amendment rechecks the file and line numbers.

## Keyless dry run (done at the rig's QM pin; reruns at the pinned SHA)

- **Receipt:** [`s1e-dry-run-b6786d67.json`](../../../harnesses/qm/gstack/receipts/s1e-dry-run-b6786d67.json), at QM `b6786d67` (the rig's pin) with the real edition at gstack `eaf1701d`, $0.
- **GSTA-36's claim 0, QM loads the edition: passed.** Each skill is in the system prompt index with its whole description, and a skill read returns 4,763, 7,657 and 11,009 bytes with no park marker.
- **Claim 1, the path rewrite: passed.** The review read names the synced folder `/root/workspace/.agent-skills/<hash>/<hash>/gstack-review`, and the synced `scripts/diff-base.sh main` runs with exit 0 and prints a merge base.
- **git on PATH:** `/usr/bin/git` 2.39.5 in every task image.
- **The layer matches QM's own CLI:** QM `850599e9`'s `deploymentLayerBody` over the deploy dir equals the driver's body byte for byte.
- **Not yet proven at the SHA the run will pin.** The pilot amendment moves the rig to that SHA, maps the skill tool's name there (`skill` at main, `skills` with action `read` at `b6786d67`), and reruns this dry run before any paid trial.

## Clean arms (CREW 2026-11-02)

- **Where trials run:** Ubicloud VMs with no Capy drive mounted and no gstack install (`~/.local/share/gstack`, `~/.claude/skills`).
- **Fresh stack per trial:** a new QM stack with volumes removed (S1's `nothing_left_behind` check).
- **Per-trial assertions:** see Counting. The canary checks one trial in each arm.
- **The plain arm's images:** hold no gstack or edition file (`image_checks`, as in S1).

## Sharding and run path

- **Cells:** a cell is one (model, task block): 2 models × 4 blocks of 18 tasks (6 per family) = 8 cells, one Ubicloud standard-16 VM each.
  - Within a cell, both arms of that model and every repetition run interleaved in a seeded order, with trials sequential.
  - No cell is split across machines. The forced arm runs in the same cells, after that cell's counted trials.
- **Run path:** `scripts/ubicloud/fanout.sh` with a `qm-driver` workload.
  - Results replicate off each VM during the run, and a VM whose final pull fails is kept (HARN-42's #288).
  - The workload and the replication come in their own PR before the pilot amendment.
  - `UBI_OWNER` is set to the lane's thread code, HARN-43, and `UBI_TTL_HOURS` is set above the measured wall time plus margin.
- **Canary first:** one shard runs before the rest. The other 7 start only after it has finished a scored trial and its results have replicated off the VM.
- **Teardown:** every VM is destroyed at the end, and `list --mine` is checked.
- **Pinned checkout:** each run executes from a worktree pinned at the amendment commit that names its cells. The run log records every restart and the commit each runner loaded.

## Harness housekeeping, shipped default

- QM's title, detect and judge auxiliaries run at their shipped defaults. They are metered and labelled "harness housekeeping, shipped default", and are never an arm or a score (HARN-1, 2026-11-01).

## Spend (R71, eval `qm-s1-edition`, $2,000 all-in)

| Stage | Expected | Cap |
|---|---:|---:|
| Headroom check, plain only (96 trials, Amendment 1) | $20 | $45 |
| Exposure pilot (4 trials, Amendment 1) | $1 | $10 |
| Main run (1,728 trials, judge included) | $260 | $520 |
| Forced-exposure arm (96 trials, Amendment 1) | $22 | $45 |
| Ubicloud VMs | $20 | $40 |
| Own model use (threads and subagents) | $600 | $850 |
| **Total** | **about $920** | **$1,510** |

- **Per-trial basis:** S1 measured $0.032 to $0.059 per turn (its report, section 2). C4 spent $23.76 on 240 trials. Substance tasks with test runs are assumed at about $0.15 expected and $0.30 capped per trial. The headroom check replaces the assumption with a measured figure.
- **Leases:** each paid stage runs under its own metering leases, one per shard. The driver takes the stage and the shard count and refuses a lease whose total over the shards is above the stage's cap (for example at most $65 per shard for 8 main shards). A cap stop ends the eval as incomplete, and it is never retried.
- **Not used to pad the run:** the $490 of the $2,000 that isn't allocated.

## Pins

| Pin | Value | Freezes |
|---|---|---|
| harness-evals | this preregistration's merge commit; then the amendments' commits | now |
| design, rule, graders' rules, power, caps, sharding | this document and design.json | now |
| task bank (templates, seed, keys) | bank.json `3b3cfbd7b832…`, seed.txt `c7e3dc087c81…` (full digests in Tasks) | now (published in the pilot amendment) |
| generator engine, graders, counters, driver, frozen analysis (`harnesses/qm/gstack/edition-*.ts`, `s1e-*.ts`, and `runner/stats/paired.ts` and `task-means.ts`, listed in `FROZEN_PATHS`) | this preregistration's merge commit | now |
| QM SHA | the SHA the edition targets, `066319ee` or later | pilot amendment |
| edition | GST-1492's commit and the sha256 of every file | pilot amendment |
| first-step markers | from the pinned edition's SKILL.md files | pilot amendment |
| image digests | core, the sandbox images per arm | pilot amendment |
| judge model and prompt | after calibration | main amendment |
| repetitions (9, or 6 by the cost rule, as Amendment 1 sets them) and any task replacements | after the headroom check and pilot | main amendment |

## Why null? (for the report)

If the verdict is CUT, the report runs CREW's cycle:

1. **Exposure:** opens, complete reads and first steps per model, plus the forced arm.
2. **Fit:** do the task types match the skills?
3. **Power and saturation:** the MDD, the plain arm's level from the headroom check, and n.
4. **Model:** Opus 5.5 and GPT-6.1 Sol only.

It ends with one verdict line. Per Garry's A1, a CUT here needs a new plan and his word before any second attempt.

## Limits

- **Seeded single-defect fixtures may not reflect real QM use,** so the verdict is scoped to these task types.
- **Single-turn DMs only.** No rooms, no multi-turn follow-ups.
- **One edition commit and one QM SHA.** A later edition is a new run.

## Amendments

Each amendment is dated and committed before any cell it affects runs, in its own pull request merged to main before those cells.

**Amendment 1, 2026-11-06 (America/Los_Angeles), the pilot amendment, before the headroom check, the exposure pilot or any paid trial.** HARN-43 wrote it (GST-1514), and HARN-1 decided its design change (option B, 2026-11-07). It freezes the five pilot-amendment pins in [Pins](#pins), publishes the task bank, and changes the bank and the repetition count because gstack retired one of the three skills. It changes no arm, grader rule, endpoint, cap, lease rule, analysis step or the KEEP rule. Every stage (headroom check, exposure pilot, main run, forced arm) runs from this amendment's merge commit on main.

- **Why the design changes.** After the draft pin `eaf1701d`, gstack retired /investigate (gstack `ef99eb5a`, #4110) and cut standalone /plan-eng-review (`3742ee95`, #4108). gstack main's QM edition now has two skills, `gstack-review` and `gstack-plan`, and no `gstack-investigate`. This run tests what will ship, so the investigate family goes.
- **Edition: gstack `6cf00aee9c0fdedc722f35c1f0032c3db9404104`** (gstack main at 2026-11-07 07:39 UTC). It contains `eaf1701d`, `ef99eb5a` and `3742ee95`, each checked with `git merge-base --is-ancestor`. Against `eaf1701d`, `gstack-investigate` is gone, `gstack-review/SKILL.md` changed by one line (its timing-test bullet no longer names gstack-investigate), and `gstack-plan/SKILL.md` is unchanged. The sha256 of every file under `qm/`:

  | File | sha256 |
  |---|---|
  | `qm/edition.json` | `404818e6fc2ab3e2000800206da1397e4f9f2fc927bd7323dc5dede151fe5205` |
  | `qm/README.md` (not installed) | `bbe3f688a72d93cd61f6fdcbc931c328411c1f2f5c0887c8b31eb4bd1e479f28` |
  | `qm/sandbox/skills/gstack-review/SKILL.md` | `d25690404277c61df7c57e359858518f6e05de3e56bd4abea71b337b675034d3` |
  | `qm/sandbox/skills/gstack-review/scripts/diff-base.sh` | `78728ae9c8282f4cecef0a56f5c2ccd4122c0f60805e8a964076a67909eae765` |
  | `qm/sandbox/skills/gstack-plan/SKILL.md` | `9dc375055b0efe230e09933504581c7f0ee5f81db529a2907dccf083ef4204fe` |

  - `EDITION_REF` in `harnesses/qm/gstack/s1e-probe.ts` names this commit, so a paid run refuses any other edition checkout. That is a change to a file in `FROZEN_PATHS`, made here before any cell. The driver's dry-run task list drops its investigate task in the same change, and nothing else in the driver changes.
  - The second `FROZEN_PATHS` edit, also made here before any cell: one printed sentence in `harnesses/qm/gstack/edition-analysis.ts` about the plan-judge fallback now says the primary comparison uses the review tasks only, not "the investigate and review tasks". No computation changes.
- **First-step markers, frozen** from that commit's `qm/edition.json`: `diff-base\.sh|\bgit\s+(diff|merge-base)\b` for review and `\bgit\s+log\b` for plan.
- **Task bank: review and plan, 48 templates. The 24 investigate templates are removed from every arm, with no remap:** inv-01, inv-02, inv-03, inv-04, inv-05, inv-06, inv-07, inv-08, inv-09, inv-10, inv-11, inv-12, inv-13, inv-14, inv-15, inv-16, inv-17, inv-18, inv-19, inv-20, inv-21, inv-22, inv-23, inv-24.
  - The run bank is [bank/bank-review-plan.json](bank/bank-review-plan.json), sha256 `d7adb136519d30f1ba5f07d645f3ecf354e97e77bd2494b97d9022abff9e1976`. It is the preregistered bank ([bank/bank.json](bank/bank.json), sha256 `3b3cfbd7b83205e4589e377337f8f869591beeb96ea3ee176ea637b073d660ad`, published here as Tasks promised) with those templates removed and nothing else changed. `JSON.stringify(bank, null, 2)` plus a newline reproduces `bank.json` byte for byte, and writes the reduced file the same way.
  - The review-only bank for the fallback below (24 templates, same rule) has sha256 `d8ce0440032a32430a39eab9bf1cc30cd64f813d4c8dec8cc502c1790acdbde0`. It is not committed; `tests/qm-s1-edition-bank.test.ts` rebuilds it from `bank.json` and checks this digest, the reduced file and the removed ids.
  - **No remap, checked:** the generator, run on the reduced bank with the same [seed](bank/seed.txt), writes the same 48 review and plan tasks (ids, requests), keys and fixture commits as on the full bank.
  - The keys are inside the bank files. The private bank folder is unchanged, and no labelled reply, probe or blind plan set is published.
- **Design (option B).** Caps and the KEEP rule are unchanged; the rule is decided on the pooled result over 48 task clusters.

  | | Was | Now |
  |---|---|---|
  | Families | investigate, review, plan (24 each) | review, plan (24 each) |
  | Repetitions | 6 | 9, the most that fit the unchanged $520 main cap |
  | Cost-rule fallback | 4 | 6 (the same 2/3 ratio) |
  | Counted trials | 72 × 6 × 2 arms × 2 models = 1,728 | 48 × 9 × 2 × 2 = 1,728 |
  | Forced-arm trials | 144 | 96 |
  | Headroom check | 144 trials, cap $45 | 48 × 1 × 2 = 96 trials, cap $45 |
  | Exposure pilot | 3 tasks, 6 trials, cap $10 | one task per family, 2 × 2 = 4 trials, cap $10 |
  | Cells | 2 models × 4 blocks of 18 tasks | 2 models × 4 blocks of 12 tasks (6 per family) |

- **MDD at 48 × 9:** 7.1 points pooled (full rule; power_amendment.json mdd_full_rule), and 10.7 with a model-by-arm interaction sd of 0.4. At the cost-rule fallback of 48 × 6: 8.2 and 11.8.
- **Per-family results (review, plan) are a labelled secondary.** Each family alone at 24 × 9 has an MDD of 9.9 (13.0 with the interaction). Neither family can carry a verdict alone.
- **Fallback to review only, preregistered here: 24 review tasks × 18 repetitions, the same caps (1,728 counted trials).** It applies only if one of these happens before the main stage starts:
  - (a) the plan judge fails its calibration on blind set A or C against the existing pass bar (Scoring, Judge calibration);
  - (b) `gstack-plan` leaves the QM edition on gstack main. Then the layer is also re-pinned, by its own amendment.
  - Once the main stage starts, nothing switches. MDD at 24 × 18: 7.7 pooled, 11.7 with the interaction. At its cost-rule fallback of 24 × 12: 8.8 and 12.4.
- **Power receipt:** [power/power_amendment.py](power/power_amendment.py) runs [power/power_rule.py](power/power_rule.py)'s model for each configuration above; its output is [power/power_amendment.json](power/power_amendment.json). `power_rule.py` and `power_rule.json` are unchanged. The amendment script seeds each configuration fresh with seed 11, so 48 × 6 with the interaction reads 11.8 there against 11.4 in the original's single seeded sequence.
- **Plan judge: kept, since plan stays.** Its model and prompt are pinned in the main amendment after calibration. **A requirement on the main amendment:** the judge's calls go through the metering proxy under the main stage's per-shard leases, the same ledger as the trials, and the main amendment says how the judge reaches the proxy. A judge call outside a lease is not allowed.
- **QM SHA: main `90e4ced75dba0f711e9737e5bb2f2d718870fb0f`** (2026-11-07 06:18 UTC, yc-software/qm#3192), the newest QM main when this amendment was first drafted, 265 commits after the rig's `b6786d67`.
  - Pins asked for `066319ee` or later. It holds `066319ee` (#3005), and `f3577189` (#2837), `037018e2` (#2838), `9848ee51` (#2694), `a1b35369` (#2987), `b286d5dc` (#2754), `5546fa13` (#3111), `e0aabb59` (#2899), `aad84a57` (#3008) and `c9d5acd5` (#2940), each checked with `git merge-base --is-ancestor`.
  - `harnesses/qm/Dockerfile`, `harnesses/qm/Dockerfile.sandbox` and `harnesses/qm/pin.json` name it. The core build follows QM's `deploy/core/Dockerfile` at this SHA, which adds a web UI build stage and the files it copies.
- **No name collision at the SHA.** QM's `skills-seed/` holds 30 skills (admin, browse, cloud-cli, composio, connect-apps, define-loop, dropbox, email-draft-in-voice, email-voice-profile, github-gitlab, google-drive-sheets, google-workspace, hand-off, interactive-login, linear, memory, miniapp, morning-digest, persona-fork, popular-web-designs, publish, request-access, secret-drop, send, slack-drafts, taste-skill, ui-canvas, ui-state, use-shared-credential, zoom), plus the plugin skill `onboarding`. None is a review or plan skill, and none is named `gstack-*`.
- **The skill tool's name at the SHA.** The model sees `skills` with action `read` (`src/agent/agent-tools.ts:156` wraps the `skill` tool defined at `src/agent/agent-tools/workspace.ts:61-62`), as at `b6786d67`. So the driver's call and the stored shape the counters read are unchanged.
- **File and line numbers rechecked at the SHA** (Command approval asked for this):
  - the org floor rules are still `src/policy/command-policy.ts:7-21`, unchanged, and `composePolicy` is still line 27;
  - `POST /v1/turns` is now `src/api/routes/turns.ts:340` (`:334` at `850599e9`), the `approval` field `src/types.ts:421`, read at `src/core/orchestrator.ts:717-718`;
  - the skills index is set at `src/core/orchestrator.ts:1226` from `src/skills/materialize.ts:143`, the path rewrite is `rehomeSkillPaths` at `src/skills/materialize.ts:22`, and `PUT /v1/deployment-layer` is `src/api/routes/deployment-layer.ts:84`.
- **One read-side change in the rig.** QM #2964 and #2971 (2026-11-03) answer `GET /v1/admin/sessions/:id` with `items` (and `hasMore`) where it answered `entries`. The first dry run at this SHA stopped at evidence read-back for that reason.
  - `sessionEvidence` in `harnesses/qm/gstack/s1-probe.ts`, which the frozen driver imports, now maps `items` to entries with `entryFromItem` in `harnesses/qm/gstack/s1-count.ts`. That is a port of QM `b6786d67`'s own read-side converter, so the counters get the entry shape they were written for. A page with `hasMore` true is refused as unreadable evidence.
  - Neither file is in `FROZEN_PATHS`. `tests/qm-session-items.test.ts` covers the converter.
- **Keyless dry run and approval gate at both pins: passed** ([receipt](../../../harnesses/qm/gstack/receipts/s1e-dry-run-6cf00aee.json)), $0, fake models behind the metering proxy, QM `90e4ced7`, edition `6cf00aee`.
  - 12 trials (one dry-run task per remaining family, 3 arms, 2 models), every check true. Edition: 4 of 4 opened the matched skill, read it whole and ran its first step. Forced: 4 of 4 complete reads and first steps. Plain: no opens, no contamination. The injected edition-in-plain trial was caught as contaminated, and nothing was left behind.
  - **The gate Command approval asks for:** every trial, in all three arms, made two `execute` calls in its sandbox: one ordinary command (the skill's first step in edition and forced) and one floor-rule command, `rm -rf /tmp/s1e-approval-probe`, which QM held for approval and the driver approved once through `POST /v1/turns`. All 12 approvals answered 200.
  - QM's own `deploymentLayerBody` at `90e4ced7` over the deploy dir gives the driver's layer sha256 `78040d9f...`. The review read names the synced folder and the synced `diff-base.sh main` exits 0. git 2.39.5 is on PATH in every task image.
  - The earlier dry run at edition `eaf1701d` (three skills, 18 trials, also all checks true) stays as history: [receipt](../../../harnesses/qm/gstack/receipts/s1e-dry-run-90e4ced7.json).
- **Image digests.** Local image ids from this machine's build at this amendment's tree; nothing was pushed to a registry. Every arm uses the same images, as Arms says: the arms differ by deployment layer and SOUL, not by image.

  | Image | Id |
  |---|---|
  | core `harness-eval/qm:dev` | `sha256:107dbba0d103cf7d6c8a88090a41f94cffb962edb4a2184230396f6d0347a723` |
  | sandbox base `harness-eval/qm-sandbox:dev` | `sha256:861f144029b41da96f662d269c5ab1a215310976d2cda276bafbc836b1620573` |
  | task `dry-rev-01` | `sha256:a6cf320380de74f70952b5dfee0e9dbd1d0dd8c5cfa79e2db72e2dcdc12ad34d` |
  | task `dry-plan-01` | `sha256:2cc09fdbfa21f229e7065088140c272b2a02317572820edf3cc7cf05da78b320` |

  - Docker builds are not byte-reproducible across machines, so each shard's VM builds its own images from this amendment's commit (the VM smoke builds them and the counted run reuses them). The binding pin is the QM SHA and the build files at that commit. Each shard's `preflight.json` records its image ids and the QM commit label, and the report lists them.
- **Wording check rerun on the run bank at this commit: no change for the families that remain.** Review 63 of 63, plan alias key 54 of 58, blind set A 38 of 72, blind set C 94 of 96, the same replies as the table in Scoring. The investigate rows no longer apply.
  - **Known misses, added to the check and not fixed** (the grader is frozen; labels are by construction, not blind):

  | Case (on every review template) | Labelled replies | Grader agrees |
  |---|---:|---:|
  | HARN-1, partial blame read as clearing: a decoy flagged as a bug with "cannot be related to its user"; should fail | 24 | 0 |
  | HARN-1, mechanism wording read as clearing the defect: "cannot be responsible for"; should pass | 24 | 0 |

  - Both come from `edition-grade.ts:145`, which reads "can't", "cannot" or "couldn't be" followed by related, relevant or responsible as clearing whatever comes after it. The same code grades every arm. The report lists these misses next to the agreement table.
  - The check's script and output are in the private bank folder next to the labelled replies (sha256 `211050ab...` and `b4ad0e3b...`).
- **Spend wording (HARN-1).** No cap, lease or expected figure changes.
  - The summary line said $630 of paid calls across four stages. The four stage caps (Spend) sum to $620, and $620 + $40 + $850 is the $1,510 all-in cap, so the line now says $620.
  - **#304 checked.** #304 retired the program-wide $2,000 cap and kept R71's $2,000 all-in ceiling per eval. The $2,000 in Spend, and the $490 of it left unallocated, is that per-eval ceiling. No line here names the program cap, so nothing contradicts #304.
- **The fan-out's stage cap (HARN-1's lane fixes, `docs/ubicloud.md`).** A `qm-driver` fan-out manifest must name its stage cap (`stage_cap_usd`): $45 headroom, $10 pilot, $520 main, $45 forced. `fanout.sh` refuses it before any VM call when the shard leases, plus leases launched earlier from the same destination, sum above that cap. A shard VM whose cleanup isn't done stops a new fan-out until it is attached, and `--resume` needs cleanup done.
- **Limit: QM's general adapter at this SHA.** QM #2801 refuses MCP servers on private network addresses, so the adapter's `serve` entry can't register the world MCP server at this SHA (a keyless capture on 2026-11-07 got 400 `unreachable`). This run's driver registers no MCP server, so it is unaffected. See [harnesses/qm/README.md](../../../harnesses/qm/README.md).
- **Limit: the frozen analysis's plan fallback after the main stage starts.** Nothing switches once the main stage starts, but `edition-analysis.ts:184` still moves its primary to the review tasks when any plan grade came from the alias judge. If that happens after the main stage starts, its review-only primary is reported only as a labelled deviation. The verdict stays on the preregistered pooled 48-task primary, recomputed by hand in the report, with the alias-graded plan trials named. The frozen code is not changed for this.
- **Edits above this section,** each marked "Amendment 1" where it changes a number: the one-line summary, Size, the rule's cluster count, MDD, the $620 in Caps, the plan-calibration fallback, the Primary statistic's task count, a pointer in Power, the headroom check, the exposure pilot, the cost rule's plan share and fallback, the trial counts in the Spend table and the repetitions row in Pins. In Approval, the plan's drive location, and in Sharding, the `UBI_OWNER` line, are reworded to keep the lane's code out of longer tokens, which the public export stops on.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

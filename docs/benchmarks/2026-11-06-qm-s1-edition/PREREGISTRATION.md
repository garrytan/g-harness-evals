# S1 rerun: does QM's native gstack edition solve more coding requests than plain QM, on Opus 5.5 and GPT-6.1 Sol?

Status: design preregistration, written 2026-11-05 (America/Los_Angeles), before any trial. Run id `qm-s1-edition-2026-11`. internal-task-a wrote it (internal-task-b). No paid trial runs on this document alone.

**In one line: QM gets 72 new coding requests with and without gstack's QM-native edition (three QM skills: investigate, review, plan). If the edition doesn't solve clearly more of them, it's cut.**

- **Arms:** `edition` (the edition installed as QM skills), `plain` (QM as shipped, no gstack, R44), and `forced`, a diagnostic arm outside the rule that puts the matched skill's whole text in front of the model every turn.
- **Models:** Opus 5.5 (`anthropic:claude-opus-5-5`) and GPT-6.1 Sol (`openai:gpt-6.1-sol`). No Haiku, Sonnet or particle-1 arm (R54).
- **Size:** 72 tasks × 6 repetitions × 2 arms × 2 models = **1,728 counted trials**, plus 144 forced-arm trials.
- **The rule:** KEEP only if edition minus plain task success, pooled over both models, is above 0 with a two-sided sign-flip p below 0.05 over the 72 task clusters (48 if plan leaves the verdict; see Plan below), **and** neither model's estimate is below 0. Otherwise **CUT**, with no second attempt.
- **Reported apart, never in the rule:** opens, first-step execution, cost per task and per success, reply length.
- **MDD:** 6.7 points pooled; 10.6 if the models react differently (model-by-arm interaction sd 0.4 logit).
- **Caps:** $1,510 all-in (R71), with $630 of paid calls across four stages, $40 of VMs and $850 of own model use.
- **Machine-readable design:** [design.json](design.json). It isn't a runnable `prereg.json`: the runner can't stage QM skills or count skill reads from QM's sessions, so the trials run through the QM driver in `harnesses/qm/gstack/`, as S1 did.
- **Two later stages freeze through dated amendments,** each its own PR, merged before the cells it affects:
  - the **pilot amendment**, once internal-task says the edition is ready: the QM SHA, the edition commit, image digests, the task bank and keys, and the first-step markers;
  - the **main amendment**, after the headroom check and pilot: the judge, the task replacements if any, and the repetition count from the cost rule.

## Why this run

- **The first S1 probe ended FIX-METHOD.** At QM `b6786d67`, gstack's generic router, pasted into QM's org SOUL, got Sol to open the matched skill in 11/15 turns and Opus in 2/15. The skill's first step ran in 0 of 9 eligible turns on both models. Every open read SKILL.md through `execute` in pieces. ([report](../2026-11-03-qm-s1-gstack-probe/report.md))
- **Its progress score couldn't decide anything.** It was a form marker (for example "ran `git diff`") over 5 request clusters, where the smallest exact p is 0.0625.
- **The fix it named is now being built.** internal-task-a builds a QM-native edition (internal-task-b) as QM skills that QM reads whole, with no install step. Garry took A1 on 2026-11-05: build it, rerun S1 against plain QM, and cut it if it doesn't win.
- **This run informs:** whether gstack ships on QM (internal-task-a, internal-task-b). If it's cut, the run also says whether QM didn't open the skill or the skill didn't help when read.

## Approval

- Autoplan run `run-20261105232312`, one lean review (Opus 5.5, 21 findings: 6 High, 12 Medium, 2 Low, 1 Informational). The gate was answered at gate rev 1 with rec_hash `94ce35cddbc9`.
- Garry answered "Do it" (2026-11-05, web, relayed by internal-task), which took every recommendation:
  - cost is report-only;
  - 72 tasks × 6 repetitions;
  - the forced-exposure arm;
  - the five High fixes (fanout result safety, length- and form-proof graders, a per-trial clean-arm check, and command-approval handling with a receipt).
- The approved plan is in the Captain drive at handoffs/internal-task/autoplan/plan.md.

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
  - **If calibration fails, plan leaves the verdict (a deviation, decided before the freeze).** The primary then pools the 48 investigate and review tasks, with an MDD of 8.2 points pooled (11.4 with a model-by-arm interaction). Plan results are still reported, graded by the deterministic alias key, labelled "named", not "respected", and marked descriptive.
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

- **Open (matched):** a skill tool call naming the matched `gstack-<family>` skill that QM answered with its SKILL.md (internal-task's definition). **Open (any)** counts any edition skill. Reads of the synced SKILL.md with `read` or `cat` are kept in each trial's detail, not counted as opens.
- **Read whole:** the skill answer came back uncut, with no park marker. **Path rewrite:** QM replaced `skills/<id>/` with the synced folder.
- **Complete read:** the whole matched body reached the model: in the first system prompt (forced), in one uncut load, or a cut load plus reads of its parked copy.
- **First step:** an executed command matching the skill's `first_step_marker` in the pinned edition's `qm/edition.json`, run after the call that completed a complete read (from the start when the body is in the system prompt). A command run between a cut load and its completion doesn't count. The plain arm's rate of the same commands is reported as its baseline. At edition `eaf1701d` the markers are `\bgit\s+log\b` (investigate, plan) and `diff-base\.sh|\bgit\s+(diff|merge-base)\b` (review); the pilot amendment freezes them with the edition pin.
- **Contamination:**
  - In `plain`, any edition file in `.agent-skills`, or edition index text in the captured first request.
  - In `edition` and `forced`, the absence of either.
  - Contaminated trials are reported per arm.

## Endpoints

- **Primary: task success (0 or 1) per trial.** The statistic is edition minus plain, computed per task, averaged over that task's repetitions and over the two models, then averaged over the 72 tasks (48 if plan leaves the verdict).
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

## Headroom check (R61), before the main run

- **Plain arm only, not counted:** 72 tasks × 1 repetition × 2 models = 144 trials, cap $45.
- **Pass:** plain success between 15 and 75 percent on each model.
- **Above 75 percent:** replace the tasks plain QM solved on both models with harder variants from the generator, chosen without looking at any edition data.
  - The replacements and their keys are pinned in a dated amendment.
  - The check then reruns on the replacements only.
  - If it still fails, the eval stops and goes to internal-task.
- **Below 15 percent:** the same procedure with easier variants of the tasks plain QM failed on both models.
- The check also measures plain cost per trial for the cost rule.

## Exposure pilot, before the main run

- **Edition arm, not counted:** 3 tasks (one per family) × 2 models = 6 trials, cap $10.
- It confirms the skills index is in the system prompt and a body loads.
- It also gives the edition's cost multiplier over plain.

## Cost rule

- After the headroom check and pilot: projected main cost = (plain cost per trial × (1 + edition multiplier) / 2 × 1,728 + judge cost per plan grade × 576) × 1.25.
  - The multiplier comes from the pilot, with 1.8 from S1 as the fallback.
  - The judge cost per grade comes from calibration; 576 is the plan family's share of the 1,728 trials.
- If the projection is above the $520 main cap, the main amendment drops to 4 repetitions (1,152 trials) before the main run.

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
- **internal-task's claim 0, QM loads the edition: passed.** Each skill is in the system prompt index with its whole description, and a skill read returns 4,763, 7,657 and 11,009 bytes with no park marker.
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
  - Results replicate off each VM during the run, and a VM whose final pull fails is kept (internal-task's #288).
  - The workload and the replication come in their own PR before the pilot amendment.
  - `UBI_OWNER=internal-task`, and `UBI_TTL_HOURS` is set above the measured wall time plus margin.
- **Canary first:** one shard runs before the rest. The other 7 start only after it has finished a scored trial and its results have replicated off the VM.
- **Teardown:** every VM is destroyed at the end, and `list --mine` is checked.
- **Pinned checkout:** each run executes from a worktree pinned at the amendment commit that names its cells. The run log records every restart and the commit each runner loaded.

## Harness housekeeping, shipped default

- QM's title, detect and judge auxiliaries run at their shipped defaults. They are metered and labelled "harness housekeeping, shipped default", and are never an arm or a score (internal-task, 2026-11-01).

## Spend (R71, eval `qm-s1-edition`, $2,000 all-in)

| Stage | Expected | Cap |
|---|---:|---:|
| Headroom check, plain only (144 trials) | $20 | $45 |
| Exposure pilot (6 trials) | $1 | $10 |
| Main run (1,728 trials, judge included) | $260 | $520 |
| Forced-exposure arm (144 trials) | $22 | $45 |
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
| edition | internal-task's commit and the sha256 of every file | pilot amendment |
| first-step markers | from the pinned edition's SKILL.md files | pilot amendment |
| image digests | core, the sandbox images per arm | pilot amendment |
| judge model and prompt | after calibration | main amendment |
| repetitions (6, or 4 by the cost rule) and any task replacements | after the headroom check and pilot | main amendment |

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

None yet.

## Disclosures

gstack is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

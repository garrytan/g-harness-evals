# gstack delivery preregistration: do agents follow gstack's review and ship steps more when the steps arrive by hook or startup file instead of as skill text?

Status: written 2026-11-09 (America/Los_Angeles), before any counted trial of this run. Run id `gstack-delivery-2026-11`. Cells, shards and leases are in [prereg-harbor.json](prereg-harbor.json); the pinned files in [pins.sha256](pins.sha256); the headroom check's per-trial grades and step markers in [headroom/](headroom/).

**In one line:** gstack's /review and /ship steps reach the agent four ways (not at all, as gstack's installed skills, as a short steps card on every model request through the harness's hook, or as the same card in the harness's startup file), in Claude Code, Codex, Hermes, OpenClaw and Pi, on Opus 5.5 and GPT-6.1 Sol with particle-1 as the low-cost model. We measure whether the agent did the steps (from its tool calls), whether it solved the task (hidden tests), and what each solved task cost.

**Read this first: what "followed" means on ship.**

- **Ship compliance mostly reads one step: looking at the final diff after the last commit.** Ship "followed" needs two steps: `final_diff_after_commit` (a full diff against the base after the last commit and before the push) and `fresh_verification` (a full test-suite run after the last change and before the push).
- With no gstack, agents already ran the fresh test suite in 93% of ship trials, and never looked at a full final diff (0 of 32). So almost all the room for a ship gain is that one diff step.
- By our scan of the headroom captures, 6 ship trials ran some `git diff` after their last commit and before the push. None counted: every one was `--stat`, `--check` or limited to named files, which the marker does not count as a full diff. The two Sol trials that ran `git diff --check` also ran `--stat`.
- `tests_after_merge` (tests rerun after merging the base) is reported, but only as a description: the no-gstack arm already did it in 100.0% of ship trials.

**What this is not:** a test of gstack's other skills, of gstack's own Claude Code hooks (that cell does not run, see [Cells that do not run](#cells-that-do-not-run)), or of a model judge. No model grades anything here.

## Approval

- **Garry, 2026-11-09,** answering the plan's gate (the autoplan run started 2026-11-09 06:38:06, gate_rev 1, rec-hash 1ea7c054dd5d): "do it". That took every recommendation and applied gate changes d1 to d15.
- **Plan:** the approved plan with the d1 to d15 section, from the autoplan checkpoint (generation g000009, `run/plan-active.md`, sha256 797e4267192bcd3758809ae24fa7847a1b29de40927c55cf60391aa20b831d5d), also in the coordinating agent's drive under this lane's autoplan handoff (`plan.md`). Where the plan and this file differ, this file says why (see [Deviations](#deviations-from-the-plan)).
- **Garry's rulings after the headroom check (relayed by the coordinating agent, 2026-11-10):** A1, B1 and C1, each described in [Deviations](#deviations-from-the-plan).

**The steps cards:**

GSTA-36 approved 2026-11-09, one edit to review line 4

- review.md sha256 `92ff952d1f76d6871c8a97c9dcd885332bf3510de7ebf6eab1e72334252efaaf`, ship.md sha256 `dfae5c36ffcc64460eba35b5e0a76025ebe9e6339d33bf724c689903abb1a697`.
- Review line 4 now reads: "For an approved defect regression, write the test and prove it fails for the original defect before changing product code."
- ship.md is measured as it reads at gstack pin `68b1d056a4fcf300ca2b61a1406940c5dd336916`.

## Question

When gstack's key review and ship steps are put in front of the agent on every request (hook) or in its startup file, does the agent do more of them than when gstack is installed as skills, and does that change how many tasks it solves and what a solved task costs, against both skill text and no gstack?

## Arms

| Arm | What the agent gets | Notes |
|---|---|---|
| none | nothing from gstack | Required control (R44). Same harness, model, settings and task text. gstack must be absent. |
| skill | gstack installed with its own `./setup` at the pin, unattended, plus one fixed "told" sentence before the task ("Use gstack's /review skill for this task." or "/ship") | Today's delivery, in its strongest form (told). Pi has no gstack host, so Pi's skill arm is labelled "manual install, not a gstack route" (d2). |
| hook | the kind's steps card on request 1 and on every tool follow-up, through the harness's hook | No gstack skills installed. |
| startup | the same card bytes in the harness's global startup file | No gstack skills installed. |
| placebo | the hook route carrying length-matched unrelated text ([harnesses/routes/placebo.md](../../../harnesses/routes/placebo.md), sha256 `b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34`) | Claude Code on Opus and Hermes on Sol only. Shows whether the card's words, not just extra text, carry any effect. |

- **Every delivery and skill file is written outside `/work`** (d8). A route that could only write into the workspace is refused. The `/work` tree hash at agent start is checked identical across a harness's arms by the keyless smoke.
- **One driver** (d9): every harness runs through `scripts/frontier-harbor/agents.py` on Harbor 0.24.0, no user simulator. Hermes runs the same `--yolo` entry in every arm, a declared deviation from stock interactive Hermes (d10); Tirith would-flag counts are logged per trial as descriptive data.
- **Before ready:** each route's health checks run before the agent starts, and a failure stops the trial (HE-DELIVERY-005). A gstack skill file in a control arm refuses the trial (HE-DELIVERY-006).

## Cells

| Harness (version) | Opus 5.5 | GPT-6.1 Sol | particle-1 (low-cost, secondary) |
|---|---|---|---|
| Claude Code 2.1.312 | none, skill, hook, startup, placebo | can't run (Anthropic only) | can't run |
| Codex 0.165.0 | can't run (OpenAI only) | none, skill, hook, startup | can't run |
| Hermes v2026.9.24 | none, skill, hook, startup | none, skill, hook, startup, placebo | none, skill, hook, startup |
| OpenClaw 2026.10.6 | none, skill, hook | none, skill, hook | none, skill, hook |
| Pi 1.5.0 | none, skill, hook, startup | none, skill, hook, startup | none, skill, hook, startup |

- **43 cells, each 32 tasks x 2 tries = 64 trials, 2,752 trials in all.** Effort high and a 128,000-token output cap, as in #337 (`scripts/frontier-harbor/pin.json`).
- **Primary pool:** the frontier pairs (Opus and Sol) except Pi's. **Pi joins only if its delivery test passes** (d2, [Pi delivery test](#pi-delivery-test)). particle-1 pairs are always reported apart, never pooled.

### Cells that do not run

- **OpenClaw startup (all three models): not run.** Harbor's OpenClaw class sets the agent workspace to the task's working directory, and OpenClaw reads its startup file only from the workspace, so the only startup file would be `/work/repo/AGENTS.md`, inside `/work` (d8). `python3 scripts/frontier-harbor/delivery.py cant-run` prints the refusal (HE-DELIVERY-004) with its evidence lines.
- **gstack's existing Claude Code hooks (the plan's add-on A3, one descriptive cell): not run.** That arm was not built on this branch (`scripts/frontier-harbor/delivery.py` has no such arm). A3 is first in the d15 descoping order, so this applies the first descoping step, for a build reason rather than a cost reason.

## Tasks

- **Set:** [tasks/repo/gstack-delivery-v1/dev](../../../tasks/repo/gstack-delivery-v1/README.md), 16 review and 16 ship tasks, generated from new published seeds in real MIT-licensed Python repositories (bottle, cachetools, inflection, jmespath, more-itertools, peewee, schedule, tabulate, tinydb), labelled dev. Every file is pinned in [pins.sha256](pins.sha256). `bun scripts/repo-tasks/delivery/build.ts --check` rebuilds the set byte for byte.
- **Review tasks:** a branch with planted defects and decoys. Reward is planted defects found with a test that fails before and passes after, over planted, graded by hidden tests.
- **Ship tasks:** main has moved since the branch was cut. The merge needs care, CONTRIBUTING asks for things a plain push skips, and a base change breaks the feature until it is adapted. Pass is the existing ship grader.
- **Acceptance:** every task's ACCEPTANCE matrix passes its oracle, no-op, red-team and steps-followed-oracle checks; the scripted solution that does every card step scores 1 on 5 of 5 runs (d7).
- **One ceiling-raise before the second headroom check** (R61), commit `f529f969b0` ("Make the delivery review and ship tasks harder, once, before the second headroom check"): every review task plants one more defect outside the logic class, on top of the seed's unchanged pick; every ship task gets one more commit on main that merges cleanly and breaks the feature until it is adapted, with a check that the unadapted finish scores 0. The tasks both cells passed in the first check got the subtlest additions.

## The steps cards and what counts as following a step

- **Cards:** [harnesses/routes/gstack-cards/review.md](../../../harnesses/routes/gstack-cards/review.md) and [ship.md](../../../harnesses/routes/gstack-cards/ship.md), every line quoted from gstack at `68b1d056`, at most 700 bytes each (539 and 590). [selection.json](../../../harnesses/routes/gstack-cards/selection.json) lists the source line of each. The card's sha256 is checked at image build and at trial start.
- **Markers come only from card lines the task does not already demand** (d5), scored by [scripts/gstack-delivery/probes.ts](../../../scripts/gstack-delivery/probes.ts) from the metering proxy's request captures. No model reads them.

| Kind | Marker | Card line | In "followed" |
|---|---|---|---|
| review | `review.full_diff_first`: a full diff against the base before the first write of review.json | Read the FULL diff before commenting | yes |
| review | `review.check_before_finding`: a check run before review.json that is not a reported finding's test | Verify claims or flag them as unknown | yes |
| review | `review.test_per_finding`: each reported finding's test written and run before that finding is written up | For an approved defect regression, write the test and prove it fails ... | yes |
| ship | `ship.final_diff_after_commit`: a full diff against the base after the last commit and before the last push | Use `git diff origin/<base>` ... to see the full proposed change | yes |
| ship | `ship.fresh_verification`: a full test-suite run after the last change to the repository and before the last push | IRON LAW: NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE | yes |
| ship | `ship.tests_after_merge`: a full test-suite run after the last merge of the base and before the last push | Run tests (on merged code) | no, descriptive only |

- **Compliance** is markers met over markers that apply. **Followed** means every applicable marker met. The compliance primary uses compliance; "followed" and every single marker are reported per arm (ruling C1).
- **Delivery counts as infra when it fails** (d12): on a hook, startup or placebo trial, the card (or placebo) must be in request 1 of the captures. If it is not, the trial gets the infra class `route_not_delivered`, excluded pairwise and counted.
- **A capture that cannot be read never scores as 0 steps** (d13): it is "unparsed" with a stable code (PROBE_CAPTURE_MISSING, PROBE_CAPTURE_EMPTY, PROBE_LINE_JSON, PROBE_CHAIN_BROKEN, PROBE_TRUNCATED, PROBE_INCOMPLETE, PROBE_WIRE_UNKNOWN, PROBE_RESPONSE_UNPARSED), excluded from compliance and counted. A marker that one unobserved last action could flip reads "unobservable", not "not met". The same holds for a chained step: a test, check or diff after `&&` or `||` counts only when the call's result shows exit 0 and the step closes an all-`&&` chain; when the result shows the call failed, the step earns nothing and the marker reads "not met"; when no exit status settles it (Codex's exec tool, a step after `||`, a chain that more commands follow), a marker only that step would meet reads "unobservable".

## Calls (preregistered)

All contrasts are paired: per harness-model pair and task, each arm's mean over its kept tries, clustered on the task, with a 95% task-clustered percentile bootstrap (10,000 draws, seed 7), the task-level sign-flip p, and the count of tasks that got worse. Exclusions are pairwise. A contrast with fewer than 10 task clusters is not tested. Code: [scripts/gstack-delivery/analyze.ts](../../../scripts/gstack-delivery/analyze.ts) on `runner/stats/paired.ts`.

- **Primary 1, compliance, per kind:** hook minus skill and startup minus skill, for review and for ship, Holm over these 4. A claim needs a Holm p at or under 0.05 and the interval's lower bound above 0.
- **Primary 2, pass rate, review only** (ruling B1): hook minus none, startup minus none, skill minus none, hook minus skill, Holm over these 4. An interval that includes 0 reads "no measurable difference".
- **Non-inferiority, 5-point margin** (d14): hook and startup against none and against skill, on review pass rate, one-sided at 0.05 on the same bootstrap, Holm over these 4.
- **Ship pass rate is descriptive only** (ruling B1): the same pass-rate contrasts, non-inferiority readings and cost per solve on ship are reported in their own section and never tested against a claim.
- **Secondary:** cost per solved task per arm (all spend of the arm's trials over its passes, task bootstrap interval, paired difference against skill); pass^2 (both tries pass); per-harness and per-model readings of the primary contrasts, each with its minimum detectable difference; placebo minus hook; particle-1 pairs apart; Pi pairs apart when not pooled; gstack-file reads per arm.

### Decision table (d14)

| Question | Rule |
|---|---|
| Does the card replace skill auto-load for review? | Only if the card's review pass rate is non-inferior to skill at 5 points (Holm over the non-inferiority family) **and** its cost per solved review task is lower (the interval of the difference below 0). |
| Does the card replace skill auto-load for ship? | No pass-rate call (B1). Ship's non-inferiority and cost readings are descriptive, so ship's verdict rests on compliance: a ship card default needs the ship compliance claim below. |
| Is a hook or startup default recommended? | Only where that delivery's primary 1 compliance claim holds for that kind. |
| Is per-host advice given? | Only for contrasts whose per-host minimum detectable difference is reported. |

A null result gets one "Why null?" cycle (did the model use the card, do the tasks fit, enough samples and headroom, does the model already do the step unaided) and one verdict line: KEEP, FIX-METHOD or CUT-CANDIDATE (R48).

### Minimum detectable difference, stated in advance

From the headroom check's no-gstack trials (Opus on Claude Code and Sol on Codex, 1 try over all 32 tasks), with `bun scripts/paired-mdd.ts --delivery --headroom headroom/trials.jsonl --probes headroom/probes.jsonl --pairs <n> --reps 2`: two-sided alpha 0.05 with Holm over 4 (first step), power 0.8, arms and pairs taken as independent given the task.

**At the planned size (8 frontier pairs, 2 tries): 6.2 points pass rate, 10.3 points compliance** (both kinds pooled). The calls above are narrower than that pool, so their own floors are larger:

| Endpoint, scope | 8 pairs (planned) | 6 pairs (hook, Pi held out) | 4 pairs (startup, Pi held out) |
|---|---|---|---|
| pass, both kinds | 6.2 | 7.2 | 8.8 |
| pass, review (primary 2) | 10.1 | 11.6 | 14.3 |
| pass, ship (descriptive) | 7.6 | 8.8 | 10.8 |
| compliance, both kinds | 10.3 | 11.9 | 14.6 |
| compliance, review (primary 1) | 14.7 | 17.0 | 20.8 |
| compliance, ship (primary 1) | 15.0 | 17.3 | 21.2 |

Points, smallest difference the design detects. With Pi held out, the hook contrasts pool 6 pairs and the startup contrasts 4 (OpenClaw startup does not run). The rule-placement run (H10) saw compliance gains of 20 points or more. The report restates these from the counted trials.

### Pi delivery test

- Pi joins the primary pool only if its delivery test passes (d2). The test reads delivery records only, never pass rates or markers: over Pi's Opus and Sol hook and startup trials, a trial is delivered when its probe is scored, the card is in request 1, and on hook every agent request carries a copy (d1). **It passes when at least 95% of those trials are delivered.**
- `analyze.ts --pi-delivery-from-probes` runs it and prints its counts before the analysis. Either way, Pi's readings are reported per harness.

## What we'll do differently for each result

This turns the d14 decision table into the change gstack makes for each way the run can land. "Card" means the short review or ship steps card. The routes are the ones this run tests:

- **Hook routes:** Claude Code's UserPromptSubmit and PostToolUse hooks, Codex's hooks (with `--dangerously-bypass-hook-trust`), the Hermes `llm_request` plugin, the OpenClaw plugin and the Pi extension.
- **Startup routes:** `CLAUDE.md` in Claude Code's config folder, `AGENTS.md` in `CODEX_HOME`, Hermes's `SOUL.md` and Pi's `AGENTS.md`. OpenClaw has no startup route (see "Cells that do not run").

A route is named for a harness only where that harness's own minimum detectable difference is reported (d14, last row). Every verdict line goes to GSTA-36 with the harness, route, file and number. Every CUT-CANDIDATE also goes to Garry in plain words, with the evidence (R48).

| Result | What changes for gstack | Verdict on the step text |
|---|---|---|
| **Hook or startup is non-inferior to skill on review pass rate (5 points, Holm), its compliance claim holds, and its cost per solved review task is lower** | gstack ships the review card through that route as the default for /review on each harness where the reading holds. The card replaces skill auto-load for review there. The skills stay installed for the full workflow. For ship, the card becomes the default only where the ship compliance claim holds (B1). | KEEP |
| **Hook or startup is non-inferior and raises compliance, but costs the same or more per solved task** | gstack ships the card through that route next to the skills, not in place of skill auto-load. | KEEP |
| **Skill is best: hook and startup fail non-inferiority against skill, or their compliance claim fails** | gstack keeps skills as the only delivery route on every harness and ships no hook or startup card. The card routes are cut. | KEEP for the skill text. CUT-CANDIDATE for the card routes. The card routes get one "Why null?" cycle first (was the card delivered and used, do the tasks fit, were there enough tasks and headroom, does the model already follow the steps unaided), and only then a CUT-CANDIDATE. |
| **No arm beats none on review pass rate (every primary 2 interval includes 0)** | gstack ships no new route. We run one "Why null?" cycle: did the model get and use the card (delivery records, step markers), do the tasks fit, were there enough tasks and headroom (against the minimum detectable differences above), and does the model already do the steps with no gstack (none-arm compliance)? | CUT-CANDIDATE if none-arm compliance is already at the ceiling and the run had the power to see a gain. Before the cut, we make one honest attempt to raise the ceiling with harder review tasks (R61). FIX-METHOD, naming the fix, if the card wasn't delivered or the run lacked power. |
| **Compliance goes up but pass rate doesn't change** | Following d14's third row, the route becomes the default only for the kind whose compliance claim holds. It replaces skill auto-load for review only if it's also non-inferior and cheaper (first row). For ship, the compliance claim alone decides (B1). | For each step whose marker rose with no gain in pass rate or cost: CUT-CANDIDATE if the review pass-rate interval excludes any gain as large as the minimum detectable difference (10.1 points at 8 pairs), meaning the run could have seen a gain and didn't; FIX-METHOD otherwise. |
| **Placebo matches hook (placebo minus hook interval includes 0, with hook ahead of skill)** | The gain comes from extra text, not from the card's words, so gstack doesn't ship the card text as written. | FIX-METHOD: rewrite the card's step text and retest it against the placebo. |
| **Pi fails its delivery test (under 95% of hook and startup trials delivered)** | Pi stays out of the pooled result and gets no route advice. gstack doesn't ship the Pi extension or Pi startup file. GSTA-36 gets the failed check, the extension file and the count. | FIX-METHOD for the Pi route. |
| **OpenClaw can't run a route** | Startup never runs on OpenClaw (HE-DELIVERY-004: its startup file would be inside `/work`), so gstack gives no OpenClaw startup advice. If the OpenClaw hook fails its health checks too, OpenClaw stays on skills (`./setup --host openclaw`). Either way, GSTA-36 gets the refusal and its evidence lines as an OpenClaw install note. | FIX-METHOD for any OpenClaw route that didn't run. |

## Headroom check and its results

The plan's gate (Big decision 7 and d5), run uncounted on Ubicloud before freeze, on the no-gstack arm of Claude Code (Opus) and Codex (Sol), 1 try over all 32 tasks:

- **Pass-rate gate, per kind:** no-gstack passes between 15% and 80%, and at least half the tasks (8 of 16) vary across the two cells.
- **Compliance gate (d5), per kind:** "followed" at most 50%, and at least 2 markers met in at most 60% of trials.

| Check | Review | Ship |
|---|---|---|
| H1 (first check, 64 trials, from its report; archive lost) | 21/32 pass (66%), 7 of 16 tasks vary: fails the vary floor | 29/32 (91%): over the ceiling |
| H1 compliance gate (from its report) | passes | fails: only 1 of 2 markers at or under 60% (`tests_after_merge` was 87.5%), so the marker moved to `fresh_verification` (commit `db5b101d4d`) |
| Rerun after the ceiling-raise, at `f529f969b0` (64 trials, [headroom/](headroom/)) | Opus 9/16, Sol 4/16, pooled 41%; 7 of 16 tasks vary: fails the vary floor | Opus 16/16, Sol 12/16, pooled 87.5%; 4 of 16 vary: over the ceiling |
| Rerun compliance gate | followed 3.3%; `full_diff_first` 10.3%, `check_before_finding` 90.3%, `test_per_finding` 67.7%: fails (1 marker at or under 60%) | followed 0%; `final_diff_after_commit` 0%, `fresh_verification` 93.3% (`tests_after_merge` 100.0%, descriptive): fails (1 marker at or under 60%) |

H2 (44 trials, uncounted, from its report; archive lost) checked delivery on every harness: the card at request 1 on 22 of 22 hook trials and the told sentence on 22 of 22 skill trials, and every skill trial opened gstack's skill. particle-1 ran on Hermes, OpenClaw and Pi.

The plan's fallback for a review set without headroom was the QM edition's single-defect generator, and a kind with no headroom reports compliance only. Garry ruled instead (A1, B1, C1), below.

## Deviations from the plan

- **A1, keep the repo review set although it misses the vary floor.** Only 7 of 16 review tasks vary on the no-gstack arm, and the gate needed 8. Rerun: Opus 9/16, Sol 4/16, pooled 41%. The set stays, with its pass rate inside the band, and the review pass-rate call runs on it. The plan's QM single-defect fallback is not used.
- **B1, ship is a compliance-only kind.** Opus ship is at 16/16 on no gstack (Sol 12/16, 4 of 16 tasks vary), so a ship pass-rate gain cannot show on Opus. Ship's pass rate, non-inferiority and cost per solve are reported as descriptive. Primary 2 and the non-inferiority family run on review only (`analyze.ts --pass-kinds review`), which this PR adds.
- **C1, the compliance primary stays on "followed" markers, and every marker is reported.** The d5 gate wanted at least 2 markers per kind at or under 60% on no gstack. Each kind has one: review `full_diff_first` 10% (followed 3%); ship `final_diff_after_commit` 0% (`fresh_verification` 93%, followed 0%). So ship compliance mostly reads the final-diff step, as said at the top.
- **The first headroom archives are lost.** H1 and H2's archives (78 MB) were only on a subagent machine that stopped answering, and are treated as lost. Their numbers above come from their written reports only. The rerun's archive is kept, with its checksum verified, on the coordinating agent's primary machine (`~/.capy/work/harness-eval/h61-headroom-2`), not in the drive (the drive copy never synced). Raw captures stay private; the committed [headroom/](headroom/) files hold only per-trial grades and markers.
- **Headroom ran before the egress read-timeout fix.** HARN-57's commit `e4acedadaa` sets a 900 s read timeout on the Harbor egress sidecar. Before it, gost's 15 s default cut any model reply that took more than 15 s to start, the harness resent it, and the cut call was still paid. All three headroom checks ran without the fix, so slow replies there were cut and resent; we did not measure how many. This branch merges that fix, and the counted run uses the fixed sidecar.
- **One R61 ceiling-raise was used,** before the rerun (commit `f529f969b0`, described under [Tasks](#tasks)). No second raise.
- **The ship marker moved** from tests-after-merge to fresh verification after H1 (commit `db5b101d4d`), because no gstack already did tests-after-merge in 87.5% of H1's ship trials. Card text is unchanged.
- **A3 (gstack's existing Claude Code hooks) does not run** (see [Cells that do not run](#cells-that-do-not-run)).
- **Two analysis additions in this PR:** `analyze.ts --pass-kinds` (B1) and `--pi-delivery-from-probes` (the d2 test as a script), and [scripts/gstack-delivery/collect.ts](../../../scripts/gstack-delivery/collect.ts), which turns the Harbor results into the analysis inputs. It replaces the uncommitted helper the headroom checks used, and reproduces the rerun's probe output exactly (64 of 64 trials).

## Scoring, exclusions and infra classes

- **Pass:** the task's hidden-test grade is pass with no consent violation; a harness error or timeout is a fail.
- **Excluded pairwise and counted:** a trial ending `model_error`, `infra_error` or `exam_fault`; on hook, startup and placebo, `route_not_delivered` or a delivery that could not be confirmed; for compliance, an unparsed capture or an unobservable marker. A lease stop is a model error with `cap_stop`, excluded and reported.
- **Fetching this eval's own files:** A trial whose trace fetches the dev split's oracle, or any file from this eval's own repository (garrytan/harness-evals or its public copy), over the network is counted as contaminated and excluded, and the contaminated count is reported per arm. The results PR's URL audit applies this rule as written here.
- **Verifier timeouts:** a trial whose verifier runs out of time is reported as its own class, counted per arm, apart from the agent's own timeouts and from model errors.
- **Clean control arms:** every trial runs on an Ubicloud VM in a container with no Capy drive and no gstack install. The setup-time preflight refuses a gstack skill file in a non-skill arm, and the probe counts tool calls naming a gstack file per arm. A non-skill arm with any such read is reported as contaminated.
- **No model judge.** Nothing here is graded by a model, so R78's judge check does not apply.

## Sharding, leases and order

- **Ubicloud, whole cells per shard, no cell split** (CREW.md): one standard-16 VM per cell (43 shards), UBI_OWNER set to this lane's thread code, trials one at a time inside a shard, retries off, each shard under its own metering lease, the repository pinned at this preregistration's merge commit with images built there.
- **Canary shard first:** `opus-hermes-skill` (a non-Claude Code harness on the skill arm, the slowest and dearest cell type). The other 42 shards launch only after the canary has finished at least one scored trial and copied its results off the VM.
- **Timeouts:** headroom trials averaged 215 to 239 s and reached 378 s, so a 64-trial cell needs about 4 to 5 hours on Claude Code and Codex. UBI_TTL_HOURS is 16 with `--timeout-hours 15`. If the canary's measured wall time per trial x 64 x 1.5, plus 1 hour of setup, exceeds 15 hours, both are raised before the other shards launch, and the run log says so.
- **Batching:** `fanout.sh --parallel 12` (192 vCPUs at a time; the project quota is shared). About 4 waves, so about 1 to 1.5 days of calendar time.
- **Results leave each VM during the run** (replicated outside the drive), the VM-to-shard map is kept beside them, and every VM is destroyed on exit; `ubi-runner.sh list --mine` is empty at the end.
- **Leases:** each shard's lease is its own cells' projection (skill arm at 3.5x) times 1.3, at least its headroom floor, as `bun scripts/frontier-harbor/plan.ts show --prereg docs/benchmarks/2026-11-10-gstack-delivery/prereg-harbor.json` prints and checks: $1,527.50 in all, plus the $180 reserve, inside the $1,800 cap. Caps are runaway protection: a lease stops its shard, and no lease or cap is raised mid-run.

## Money

| Line | Projection | Cap |
|---|---|---|
| Paid trials (2,752) | about $990 (skill at 2.5x), about $1,170 (skill at 3.5x) | $1,800, of which $180 is a reserve never planned against |
| Ubicloud VMs (43 standard-16, about $0.50 an hour) | about $250 | $400 (the plan's ceiling) |

- **Measured cost per trial on no gstack** (the rerun's metering ledgers): review Opus on Claude Code $0.276, review Sol on Codex $0.164, ship Opus on Claude Code $0.346, ship Sol on Codex $0.203.
- **Assumptions, not measurements:** Hermes, OpenClaw and Pi cost 1.5x the same model's Claude Code or Codex mean (no rerun cost exists for them; H2's per-harness figures were lost with its archive). particle-1 costs $0.04 a trial (the plan's prior). The skill arm costs 1.5x to 3.5x the hook arm (H2's report), so the projection uses 2.5x and the leases 3.5x; hook, startup and placebo cost about the same as no gstack (H2).
- **Descoping order (d15),** applied before launch if the re-cost exceeded the cap: A3, then particle-1, then placebo, then Pi. The re-cost is under the cap, so only A3 is dropped, and for a build reason.
- The coordinating agent hears before the thread passes $3,000 all-in. Spend lines go in spend-internal.md beside the report, not here.

## Commands

From a worktree pinned at this preregistration's merge commit:

1. Fan-out: `scripts/ubicloud/fanout.sh --manifest <manifest> --workload frontier-harbor --parallel 12`, the canary first, each shard running `scripts/frontier-harbor/vm-run.sh --prereg docs/benchmarks/2026-11-10-gstack-delivery/prereg-harbor.json --name <cell> --lease-usd <lease>`.
2. Collect: `bun scripts/gstack-delivery/collect.ts --prereg docs/benchmarks/2026-11-10-gstack-delivery/prereg-harbor.json --out <results>/delivery <each shard's results dir>`.
3. Probes: `bun scripts/gstack-delivery/probes.ts --batch <results>/delivery/probe-batch.jsonl --out <results>/delivery/probes.jsonl`.
4. Analysis: `bun scripts/gstack-delivery/analyze.ts --trials <results>/delivery/trials.jsonl --probes <results>/delivery/probes.jsonl --pass-kinds review --pi-delivery-from-probes --seed 7 --draws 10000 --out <results>/delivery/analysis`.
5. Contamination audit: `bun scripts/frontier-harbor/audit.ts --results <each shard's results dir>`.

## Pinned files

[pins.sha256](pins.sha256) lists, in `sha256sum` format, every file the run's tasks, cards, graders, delivery routes, run path and analysis depend on: `tasks/repo/gstack-delivery-v1/`, `scripts/repo-tasks/delivery/`, `harnesses/routes/gstack-cards/`, the placebo, `scripts/gstack-delivery/`, the frontier Harbor run path and delivery routes under `scripts/frontier-harbor/`, `scripts/paired-mdd.ts`, `runner/stats/paired.ts`, and this folder's [prereg-harbor.json](prereg-harbor.json) and [headroom/](headroom/) files. `sha256sum -c docs/benchmarks/2026-11-10-gstack-delivery/pins.sha256` checks them, and `tests/gstack-delivery-prereg.test.ts` runs that check in CI. Any change to a pinned file before the report is a dated amendment or a new run id.

## Receipts

Under `docs/benchmarks/2026-11-10-gstack-delivery/results/`: per shard its trials, ledger, proxy usage, run summary, clean-arm preflight, shard and VM records; the collected trials, probe batch and probes; the analysis JSON and Markdown; the audit. Raw request captures stay private. This preregistration merges to main before the first counted trial; results and any amendments come in one later PR (R77).

Each trial's harness_settings.json carries the frontier matrix's frozen settings record. Its `gstack` field belongs to that matrix's gstack ablation arms and is `null` on every trial of this run, the skill arm included. This run's arm, route and files are in its `delivery` field, which is what the analysis reads.

## Amendments

Each amendment is a dated commit on the results branch before any cell it affects. None is planned.

## Outside terms

Task source repositories are MIT-licensed, and each task keeps its upstream licence text (`tasks/repo/gstack-delivery-v1/LICENSES`). The cards quote gstack (MIT, Garry Tan's own project). Harbor is Apache-2.0. Harnesses and Particle are pinned and routed as in #337 and HARN-57.

## Disclosures

The report and any finding file end with these lines, word for word from the disclosures list. No X post carries them in full.

gstack is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

# docs/

harness-evals v0.0.12. The index of this directory: one line per page, saying what the page answers. The repository's own front page is [../README.md](../README.md); the writing rules every page follows are in [../CLAUDE.md](../CLAUDE.md). Every published number on these pages is tied to a committed receipt, and [receipts-manifest.json](receipts-manifest.json) is the machine-readable list of those receipts.

Codes like internal-task in receipts name internal work lanes.

## Pages

- [adapters.md](adapters.md): the adapter protocol. What a harness's `adapter.sh` receives, how a `run` turn and a `serve` trial proceed, which exit codes mean what, and how the conformance test checks an adapter against the fake harness.
- [attack/fence-matrix.md](attack/fence-matrix.md): the keyless gbrain fence matrix: which gbrain reads wrap third-party text in gbrain's quote fence and which return it raw, at six gbrain commits, with the receipts and the script that measures it.
- [benchmarks/](benchmarks/): one folder per counted run, each with `PREREGISTRATION.md`, `prereg.json`, and for every run that has executed, `report.md` and `results/`. One folder, `2026-11-01-opus-gstack-follow/`, holds uncounted checks instead: a report and `results/`, with no preregistration. `2026-11-03-investigate-gate/` holds a report and `results/` for a run preregistered outside this repository (internal-task, in the org drive), so it has no `PREREGISTRATION.md` here either. The order check reads `preregistrations.json` and `preregistrations.d/`. Folders, by run id and the dates the trials ran (UTC):
  - [2026-10-22-m0-smoke/](benchmarks/2026-10-22-m0-smoke/PREREGISTRATION.md): `m0-smoke-2026-10`, preregistered 2026-10-22; the M0 smoke, preregistration only, no results directory.
  - [2026-10-23-m2-pilot/](benchmarks/2026-10-23-m2-pilot/report.md): `m2-pilot-2026-10`, 2026-10-22 to 2026-10-23; the dev-split pilot, three harnesses on Sonnet, 150 trials, a pilot and not a comparison.
  - [2026-10-24-m3-heldout/](benchmarks/2026-10-24-m3-heldout/report.md): `m3-heldout-2026-10`, 2026-10-23; the first counted comparison, 20 sealed held-out tasks, three harnesses on Sonnet, 300 trials.
  - [2026-10-24-m3-sensitivity-haiku/](benchmarks/2026-10-24-m3-sensitivity-haiku/report.md): `m3-sensitivity-haiku-2026-10`, 2026-10-23; the same exam with the model fixed to Haiku, 300 trials.
  - [2026-10-24-gbrain-arm/](benchmarks/2026-10-24-gbrain-arm/report.md): `gbrain-arm-2026-10`, 2026-10-24 to 2026-10-25; each harness with and without gbrain installed and unmentioned on Haiku and Sonnet, plus a told cell per harness on Haiku; 15 cells, 1,500 trials.
  - [2026-10-25-company-brain/](benchmarks/2026-10-25-company-brain/report.md): `company-brain-2026-10`, 2026-10-24 to 2026-10-25; scope leaks through an unscoped company brain against gbrain-side scoping, three harnesses on Haiku, 900 trials.
  - [2026-10-25-gbrain-ladder/](benchmarks/2026-10-25-gbrain-ladder/report.md): `gbrain-ladder-2026-10`, 2026-10-24 to 2026-10-25; the install ladder: `none`, `mcp` and five rungs (`told`, `docs`, `verbs-told`, `semantic-told`, `docs-semantic`) for OpenClaw and Hermes on Haiku, 14 cells, 1,400 trials.
  - [2026-10-25-gbrain-verbs/](benchmarks/2026-10-25-gbrain-verbs/report.md): `gbrain-verbs-2026-10`, 2026-10-25; told against verbs-told at ten repetitions, 800 trials.
  - [2026-10-25-gbrain-installer/](benchmarks/2026-10-25-gbrain-installer/report.md): `gbrain-installer-2026-10`, 2026-10-25; told against gbrain's own installer output, 400 trials.
  - [2026-10-25-gbrain-installer-hook/](benchmarks/2026-10-25-gbrain-installer-hook/report.md): `gbrain-installer-hook-2026-10`, 2026-10-26; the installer with its per-turn hook against told, the first run on the Ubicloud lane, 400 trials.
  - [2026-10-25-gbrain-scoped/](benchmarks/2026-10-25-gbrain-scoped/report.md): `gbrain-scoped-2026-10`, 2026-10-26; per-request scope (told-scoped) against told-company, 400 trials.
  - [2026-10-25-qm-inner-harness/](benchmarks/2026-10-25-qm-inner-harness/report.md): `qm-inner-harness-2026-10`, 2026-10-25; QM's Pi engine against its Claude Agent SDK integration on Haiku, 200 trials.
  - [2026-10-25-qm-probes/](benchmarks/2026-10-25-qm-probes/report.md): `qm-probes-2026-10`, 2026-10-25; nine QM product claims, each its own check, 96 trials, nothing pooled.
  - [2026-10-25-qm-probes-qp07/](benchmarks/2026-10-25-qm-probes-qp07/report.md): `qm-probes-qp07-2026-10`, 2026-10-25; the `qp-07` sandbox probe rerun with the directory seeded, 6 trials.
  - [2026-10-25-v02-pilot/](benchmarks/2026-10-25-v02-pilot/report.md): `v02-pilot-2026-10`, 2026-10-25; the v0.2 dev-split pilot on Haiku, four cells, 180 trials.
  - [2026-10-25-v02-heldout/](benchmarks/2026-10-25-v02-heldout/report.md): `v02-heldout-2026-10`, 2026-10-26; gbrain-told against none on the 15 sealed v0.2 tasks, three harnesses on Sonnet and Haiku, 900 trials.
  - [2026-10-26-gbrain-memory/](benchmarks/2026-10-26-gbrain-memory/report.md): `gbrain-memory-2026-10`, 2026-10-26 to 2026-10-27; a member brain that fills during the scenario against none, three harnesses on Sonnet and Haiku, 12 cells, 900 trials on nine Ubicloud shards (preregistered in #89). Beside it, [recall-rereading/](benchmarks/2026-10-26-gbrain-memory/recall-rereading/README.md) is a labelled re-reading of its receipts (written by `scripts/recall-audit.ts`), not a counted result.
  - [2026-10-31-harness-zero-select/](benchmarks/2026-10-31-harness-zero-select/PREREGISTRATION.md): `harness-zero-select-2026-11`, preregistered 2026-10-31 and revised 2026-11-04; Harness Zero's Phase C, which drops one switch at a time from `zero-full` and labels each keep, cut or can't tell against a measured noise floor, on the 20 public v0.3 dev tasks: 7 Opus 5.5 cells at 5 repetitions and 3 GPT-6.1 Sol cells at 3 (one conditional), 880 trials, cap $213. The rules are in its loop file, [loops/2026-10-31-harness-zero.md](loops/2026-10-31-harness-zero.md). Preregistration only, no results yet.
  - [2026-10-31-v03-opus-dev/](benchmarks/2026-10-31-v03-opus-dev/report.md): `v03-opus-dev-2026-10`, 2026-11-01; the whole v0.3 dev set on Opus 5.5 under opening 1's scoped gbrain config, OpenClaw and Hermes, six cells, 440 trials on six Ubicloud shards. Outcome B: 2 of 6 families informative and four above 90 percent, so no opening runs on v0.3 and v0.3 is too easy for frontier models (the v0.4 brief).
  - [2026-11-01-installer-cc-codex/](benchmarks/2026-11-01-installer-cc-codex/report.md): `installer-cc-codex-2026-11`, 2026-11-02; gbrain's installer against told and no brain on Claude Code (Opus 5.5) and Codex (GPT-6.1 Sol), 17 v0.3 dev tasks, gbrain `a590ad07` with no access rules, six cells, 306 trials on six Ubicloud shards, $56.67 of the $155 cap ([preregistration](benchmarks/2026-11-01-installer-cc-codex/PREREGISTRATION.md), amendments 1 and 2). The installer raises cross-scope exposure via gbrain on Claude Code (+25 [+8, +45], p 0.039); Codex not distinguished at 17 tasks (+16 [+2, +33], p 0.125). Why null? verdict FIX-METHOD: rerun on gbrain 0.60.554.0 (or 0.60.551.0) with the fixture's scopes as gbrain access rules, each trial's token bound to its member, and a keyless per-member access check that fails closed. That rerun is the next line.
  - [2026-11-01-installer-cc-codex/, access rules](benchmarks/2026-11-01-installer-cc-codex/report-acl.md): `installer-cc-codex-acl-2026-11`, 2026-11-03; amendment 3, the same six cells on gbrain `f650eac5` (v0.60.554.0) with per-member access rules and member-bound tokens, 306 trials on six Ubicloud shards, $55.57 of the $85 cap ([preregistration](benchmarks/2026-11-01-installer-cc-codex/PREREGISTRATION-acl.md)). Cross-scope exposure via gbrain 0 of 51 in all four gbrain cells, so installer against told is not distinguished, by construction, on both hosts. Against no brain, pass +8 [+0, +22] (Claude Code installer) and +12 [+0, +24] (Codex installer), descriptive. Why null? verdicts KEEP (gbrain with access rules) and FIX-METHOD (installer against told, saturated).
  - [2026-11-01-opus-gstack-follow/](benchmarks/2026-11-01-opus-gstack-follow/report.md): Opus 5.5, uncounted follow-rate checks. `gn-follow-2026-11`, `gn-follow-preset-2026-11` and `gn-hard-follow-2026-11`, 2026-11-01 to 2026-11-02, 120 trials, $30.41 on the ledgers, from never-merged scratch branches with no preregistration pull request. gstack sessions followed their skill 0 of 46 times; the preset check decided STOP and the hard SWE-bench Verified check is VOID (no gstack passed 8 of 8).
  - [2026-11-01-prompt-archaeology/](benchmarks/2026-11-01-prompt-archaeology/report.md): `prompt-archaeology-2026-11`, preregistered 2026-11-02; the metering proxy cuts one layer of each harness's built-in prompt at a time and the run measures what each cut does to pass rate and cost per trial against the full prompt. Claude Code, OpenClaw and Hermes Agent on Opus 5.5 and Codex on GPT-6.1 Sol, no gstack and no gbrain in any cell, all 20 public v0.3 dev tasks at 2 repetitions, 41 cells, 1,640 trials on 15 Ubicloud shards, cap $458.50. Reported 2026-11-04 from launch 3 at `ef4c997755c7` (amendment 3, #249; launch 1 lost, launch 2 stopped at the pre-smoke), $328.76 of the $548.50 bound ([preregistration](benchmarks/2026-11-01-prompt-archaeology/PREREGISTRATION.md)). No keep on pass rate in any pair; cuts for Claude Code memory-skills (-19 percent cost per trial) and tool-descriptions (-8 percent) and Codex identity (-3 percent); Hermes keep (safety) on 5 of 7 arms, all from task ar-03. Why null? verdicts CUT-CANDIDATE, FIX-METHOD and KEEP. The uncounted calibration is in its `calibration/` folder.
  - [2026-11-01-tool-discipline-start/](benchmarks/2026-11-01-tool-discipline-start/report.md): `tool-discipline-start-2026-11`, 2026-11-01; gstack's start hook on OpenClaw and Hermes chat, Opus 5.5, no gstack against gstack `482ffd14` against gstack `b9fda18c` with the hook on, 144 trials, $16.90 of the $28 cap ([preregistration](benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION.md)). OpenClaw passes, starts 16 of 16 against 1 of 16; Hermes fails, 0 of 16, because its approval gate blocked every start the agent issued; task success 16 of 16 in every arm. The same folder holds the [report](benchmarks/2026-11-01-tool-discipline-start/report-hermes-r2.md) of `tool-discipline-start-hermes-r2-2026-11` ([preregistration](benchmarks/2026-11-01-tool-discipline-start/PREREGISTRATION-hermes-r2.md)), 2026-11-02, a new run id that reruns the Hermes cells with the candidate moved to gstack `e2d9c798` and Tirith 0.4.2 pinned, 72 trials, $5.76 of the $19 cap. Hermes passes, starts 8 of 16 against 0 of 16, all on task 1; task success 16 of 16 in every arm.
  - [2026-11-02-qm-brain-native/](benchmarks/2026-11-02-qm-brain-native/PREREGISTRATION.md): `qm-brain-native-2026-11`, preregistered 2026-11-02; the K8 design preregistration: QM with gbrain (recall, the brain tool, the turn card) against the same authorized notes as files, arms F, R, T, TC and N on Opus 5.5 and GPT-6.1 Sol, with particle-1 as a labelled low-cost primary. Design only: the folder holds `design.json` instead of a `prereg.json`, which comes with the pilot cells, and no trial has run. The corpus and checks are in [world/brain/](../world/brain/README.md).
  - [2026-11-03-investigate-gate/](benchmarks/2026-11-03-investigate-gate/report.md): `gates938-phase3`, 2026-11-02 to 2026-11-03; gstack's /investigate reproduce-first gate (internal-task), no gstack against gstack against gstack with the gate, Opus 5.5 and GPT-6.1 Sol, 11 tasks per model, 162 counted trials, $254.31 of the $300 cap. Pooled H-S +1.28 points [-3.80, +6.35]; the rule reaches FIX (Opus follow 7.1%), the repair does not fit the cap, so NOT ADDED.
  - [2026-11-03-qm-c4-told-live/](benchmarks/2026-11-03-qm-c4-told-live/PREREGISTRATION.md): `qm-c4-told-live-2026-11`, preregistration frozen 2026-11-04 on main after #254 (`dcbf03e0`); the C4 told-live tasks on QM through Pi, Opus 5.5 and GPT-6.1 Sol, three gbrain routes (QM's notebook only, gbrain as registered tools, gbrain as QM's per-turn memory provider), 240 trials, cap $56.
  - [2026-11-03-qm-s1-gstack-probe/](benchmarks/2026-11-03-qm-s1-gstack-probe/PREREGISTRATION.md): `qm-s1-gstack-probe-2026-11`, design preregistration frozen 2026-11-04 on main after #254 (`dcbf03e0`), with gate 6's one-VM pre-launch check run at its merge commit before the first turn; whether QM on Opus 5.5 and GPT-6.1 Sol opens gstack skills through gstack's paste-in router, with a no-gstack arm, cap $20. Its folder holds `design.json` instead of a `prereg.json`, because the probe runs through a driver, not the runner.
  - [2026-11-04-matrix-mu/](benchmarks/2026-11-04-matrix-mu/PREREGISTRATION.md): `matrix-mu-2026-11`, preregistered 2026-11-04; the harness x model matrix on the 20 public v0.3 dev tasks: Claude Code, OpenClaw, Hermes and QM on Opus 5.5, Codex, OpenClaw and Hermes on GPT-6.1 Sol, 7 cells, 4 repetitions, 560 trials, cap $160 with smokes included. The Particle-1 row left this run under its drop order and becomes its own later run. No trial has run.
- [budget-ledger.md](budget-ledger.md): the program's spend ledger, one row per lane of paid work (written 2026-10-26 beside this index).
- [comparing-runs.md](comparing-runs.md): how two cells or two runs are compared: the paired, task-clustered estimator, the sign-flip test, Holm, the minimum detectable difference, what "not distinguished at N tasks" means, each comparison script's flags and outputs, and the exact commands every counted run's report names.
- [decisions.md](decisions.md): the decisions by Garry Tan and the coordinating agent that shaped a counted run, one line each (written 2026-10-26 beside this index).
- [errors.md](errors.md): every error code the runner, proxy and adapters print, what it means, the fix, and where it lives.
- [gbrain-arm.md](gbrain-arm.md): the gbrain arm: what a sidecar per trial runs, the world's `/gbrain` tap, the install ladder, how the arm is wired into the runner and adapters, the smoke evidence, and the status of each gbrain run.
- [gbrain-evals-conventions.md](gbrain-evals-conventions.md): which conventions this repository takes from gbrain-evals as they are, which it adapts, and which it leaves out, with the reason for each.
- [methodology.md](methodology.md): the trial contract, the normative copy of the plan's contract section: isolation, metering, grading, termination and grade as separate fields, metrics, budget, artifacts, with its amendments in the changelog.
- [methods.md](methods.md): the fine print behind the README's plain summaries: how to read the numbers (intervals, paired differences, sign-flip tests, Holm, the openings ledger), the complete harness and gbrain comparison text, the complete limits, how every harness runs, the world and the tasks, what paid work costs, and what a results directory holds. Moved word for word from the README on 2026-10-28.
- [plans/](plans/2026-10-21-harness-eval-v0/plan.md): the approved plan (v2), its review record, decisions D1 to D10, findings, open tasks and every reviewer file, one folder per plan.
- [publishing-checklist.md](publishing-checklist.md): what was audited before the repository can be made public (`bun scripts/publish-audit.ts`), how to run it again, the merge record, and what the owner still decides.
- [qm-findings.md](qm-findings.md): product observations about QM v0.1.15 from the source read, the smokes, the inner-harness run and the probe suite, each with its trials and smallest reproduction.
- [receipts-manifest.json](receipts-manifest.json): the machine-readable receipts list, one entry per counted run with its preregistration commits and hashed artifacts (generated 2026-10-26 beside this index).
- [report-v0.1.md](report-v0.1.md): the one-page account of the v0.1 multi-user cell: finding, limits, interests, tables with intervals, taxonomy and spend, with every number copied from a named receipt.
- [repo-tasks.md](repo-tasks.md): the repository task format (fix, review, qa and ship tasks graded by hidden checks on the container), its acceptance rules, and the gstack-native-v1 set's public dev split and sealed held-out split.
- [shared-rig.md](shared-rig.md): where the canonical copy of each shared rig part lives (stats kit, price table, metering proxy, per-trial usage, trial bundle, fan-out), for the repositories that vendor them.
- [tasks.md](tasks.md): the multi-user task format: families, the access model, the predicate library, oracles and the mutation contract, task sets (v0.1, v0.2, the generated v0.3 set, the QM probes) and how a cell selects one.
- [replicate.md](replicate.md): how to check a finding from its trial bundle with `scripts/replicate.ts`: the two free checks (`--reanalyze`, `--estimate-only`), a paid rerun of one cell under a hard `--max-usd` cap, the replication band and its coverage evidence under [replicate/](replicate/band-coverage-m3-heldout-openclaw.json), verdicts, exit codes and limits.
- [trial-bundle.md](trial-bundle.md): the trial-bundle format: one reproducible archive per finding with the run's trial-level data and a digest, what goes in and what is left out by rule, and what `scripts/bundle.ts verify` checks.
- [gstack-laneb.md](gstack-laneb.md): the Lane B bridge: runs the pinned gstack-evals Lane B agent on gstack-native and Terminal-Bench 2 tasks under our metering, leases and Ubicloud lane.
- [gstack-native-format.md](gstack-native-format.md): the gstack-native repo task format the bridge materializes.
- [tool-discipline/](tool-discipline/README.md): free mining over committed receipts of invented tools, bad arguments, wrong names, broken helper calls and skipped gstack skill starts, with the hand-check rules, the labellers' agreement and what each harness replies to a bad call ([replies.md](tool-discipline/replies.md)).
- [ubicloud.md](ubicloud.md): the Ubicloud shard lane: the scripts that put one shard per VM, how a run fans out and comes back, the check lane, costs and limits.

## Changelog

### 2026-11-04: replicate.md listed (internal-task)

Added the line for the new page on checking a finding with `scripts/replicate.ts`, with its band coverage evidence under `replicate/`. Why: the index says one line per page, and the page is new on this branch.

### 2026-11-05: harness-zero-select-2026-11 listed (internal-task)

The benchmarks list gains a line for the Harness Zero Phase C preregistration, with a link to its loop file, saying that no trial has run. Why: the folder is new on this branch.

### 2026-11-03: attack/fence-matrix.md listed (internal-task)

Added the line for the gbrain fence matrix page, which lands without the memory-poisoning eval it was built for.

### 2026-11-04: matrix-mu-2026-11 listed (internal-task)

The benchmarks list gains a line for the harness x model matrix preregistration, saying that no trial has run and that the Particle-1 row left the run. Why: the folder is new on this branch.

### 2026-11-04: prompt-archaeology-2026-11 reported (internal-task)

The prompt-archaeology line now links the report and gives its result, in place of "Preregistration only, no results yet". Why: the run is complete and its report is in the tree.

### 2026-11-04: qm-c4-told-live-2026-11 and qm-s1-gstack-probe-2026-11 frozen (internal-task)

Both benchmarks lines now say the preregistration froze on 2026-11-04 on main after #254 (`dcbf03e0`), and the S1 line names gate 6's pre-launch check. Why: every freeze gate closed, and the freeze-gate receipts moved to each folder's `gates/`.

### 2026-11-03: qm-c4-told-live-2026-11 and qm-s1-gstack-probe-2026-11 listed (internal-task)

The benchmarks list gains a line for each of the two QM M1 draft preregistrations, saying that neither is frozen yet and that the S1 folder holds `design.json` instead of a `prereg.json`. Why: both folders are new on this branch.

### 2026-11-04: plain names for internal roles

Mentions of the project's coordinating agent, its private drive and its agent threads now use those plain names instead of internal role names. No number, link or claim changes. Why: the page is published, and the public export blocks internal role names in prose.

### 2026-11-03: installer-cc-codex-acl-2026-11 reported (internal-task)

The benchmarks list gains a line for the access-rules rerun of the Claude Code and Codex installer rung, and the first run's line no longer says the rerun waits on #229. Why: the rerun is complete and its report is in the tree.

### 2026-11-03: gates938-phase3 reported (internal-task)

The benchmarks list gains the investigate-gate folder and its report, and the folder description says it has no preregistration in this repository. Why: the folder is new on this branch.

### 2026-11-02: installer-cc-codex-2026-11 reported

The benchmarks list gains a line for the Claude Code and Codex installer rung and its report. Why: the run is complete and its report is in the tree.

### 2026-11-02: qm-brain-native-2026-11 listed

The benchmarks list gains a line for the qm-brain-native design preregistration, saying that its folder holds `design.json` instead of a `prereg.json` until the pilot cells exist. Why: the folder is new on this branch.

### 2026-11-02: prompt-archaeology-2026-11 listed

The benchmarks list gains the prompt-archaeology folder, preregistration only. Why: the folder is new on this branch.

### 2026-11-02: tool-discipline-start-hermes-r2-2026-11 reported

The start-hook panel's line now links the Hermes rerun's report and gives its outcome. Why: the run is complete and its report is in the tree.

### 2026-11-02: Opus 5.5 follow-rate checks listed

The benchmarks list gains a line for the three uncounted Opus 5.5 follow-rate checks and their report, and the folder description says that this one folder has no preregistration. Why: the folder is new on this branch.

### 2026-11-01: tool-discipline-start-hermes-r2-2026-11 listed

The start-hook panel's line also names the Hermes rerun's preregistration, which sits in the same folder. Why: the preregistration is new on this branch.

### 2026-11-01: tool-discipline-start-2026-11 reported

The start-hook panel's line now links its report and gives the outcome. Why: the run is complete and its report is in the tree.

### 2026-11-01: tool-discipline-start-2026-11 listed

The benchmarks list gains the start-hook panel's folder, preregistration only. Why: the folder is new on this branch.

### 2026-10-31: tool-discipline/ listed

Added the line for the new tool-discipline pages. Why: the index says one line per page, and the pages were new.

### 2026-10-29: repo-tasks.md listed

Added the line for the new repository task format page (harness-evals v0.0.39).

### 2026-10-29: tasks.md names the v0.3 set

harness-evals v0.0.32. The tasks.md line lists task set v0.3 among the sets that page describes.

### 2026-10-28: methods.md listed

harness-evals v0.0.29. The index gains a line for [methods.md](methods.md), the page that has held the README's fine print since the 2026-10-28 README rewrite. Why: the index says one line per page, and the page was new.

### 2026-10-27: gbrain-memory-2026-10 recall re-reading

harness-evals v0.0.16. The memory run's line also points at `recall-rereading/`, the labelled re-reading of its receipts that this release adds.

### 2026-10-27: gbrain-memory-2026-10 counted

harness-evals v0.0.14. The memory run's line points at its report instead of its preregistration.

### 2026-10-26: first version

harness-evals v0.0.12. The index did not exist before; pages were reachable only from the repository README's table. Written with [comparing-runs.md](comparing-runs.md) in the same change, beside the budget ledger, decisions page and receipts manifest, which the same lane added that day.

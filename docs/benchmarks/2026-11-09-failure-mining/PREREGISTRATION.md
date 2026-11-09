# Where frontier agents fail in trials we already ran, and which gstack or gbrain change would prevent it

Status: written 2026-11-09 (America/Los_Angeles), before any layer-2 label is paid for. Run id `failure-mining-2026-11`. The codebook is [codebook.md](codebook.md) (machine copy [codebook.json](codebook.json)), the corpus is in [corpus/](corpus/), layer 1 is in [layer1/](layer1/) and the power figures are in [mdd.md](mdd.md).

**In one line: no new agent trials. We label every failed frontier trial we already have with one root cause from a fixed 20-class codebook, check the labeller against an Opus 5.5 and GPT-6 Astra gold set, and test whether the gbrain arm cuts the failure classes gbrain says it prevents.**

- **2,088 failed multi-user trials on frontier models** (Opus 5.5 and GPT-6.1 Sol) across 6 harnesses and every counted run on main. 1,998 have transcripts and get a packet; 47 uncounted trials have no trial files; 43 are excluded rows (INFRA, replaced runs).
- **One labeller for the bulk pass:** `particle:particle-1`, a third model family, gated by R78 against gold labels from `anthropic:claude-opus-5-5` and `openai:gpt-6-astra`.
- **The gbrain test is 6 tests** with Holm across them, on 7 paired gbrain and no-brain arms (106 paired task units): the 5 classes gbrain claims to prevent that can happen in either arm, plus one pooled retrieval-failure measure. Every other class is descriptive.
- **gstack is not exposed in this corpus.** No multi-user cell ran gstack. The 12 failed HARN-14 Claude Code SDK trials (gstack, none and placebo arms) are labelled and reported as descriptive only.
- **Keyless except the labelling calls.** No VMs. Spend, the re-pricing from smoke receipts and the lease cap are in `spend-internal.md` beside this file (R79).

## Approval

- Plan of HARN-66 (issue GST-2020), autoplan run `20261109063628`, gate revision 1. Garry's reply was "do it": every recommendation taken, including decision 1 option b (the gstack verdict reads "not exposed in this corpus"). The plan's revised text (sha `d1c8467cf063`) binds this run; this file follows it as written, with the changes listed under "Changes from the plan".
- The coordinating agent's decisions, 2026-11-09: HARN-14's surviving SDK transcripts are labelled under the codebook and reported as descriptive (below); HARN-50's terminal-bench runs have no surviving trajectories, so #337's coding runs enter as outcome rows only; HARN-14's Haiku TB2 tarball stays out (Haiku, and it holds withheld solution files).

## Question

1. **What goes wrong** when Opus 5.5 and GPT-6.1 Sol fail a multi-user task, in the harnesses we already ran? One root cause per failed trial, from the codebook, with the first wrong step (turn and event seq) and the stage of work.
2. **How common is each cause** in the default (full-configuration) arms, weighted by cell, ranked by how many distinct tasks and harness x model cells show it?
3. **Does gbrain prevent what it claims to prevent?** On runs with randomized gbrain and no-brain arms on the same tasks, harness and model, is the per-trial rate of each class gbrain claims to address lower in the brain arm?
4. **Which concrete gstack or gbrain change would touch the most failures?** Each proposal names the file, the change, the install route, the failures it touches, and the cheapest rerun to prove it.

## Corpus (frozen in this commit)

- [corpus/manifest.jsonl](corpus/manifest.jsonl): every trial row in every results folder on main and on `origin/harn50/frontier-results` (#337), 21,549 rows, each with its run, results folder, cell, harness, model, grade, population, gbrain presence and exposure counts, and gstack presence. [corpus/runs.json](corpus/runs.json) records each results folder's trials.jsonl sha256 and says why each folder is in or out and how its population was set. Rerunning `bun scripts/failure-mining/corpus.ts` at this commit rewrites manifest.jsonl and runs.json byte for byte (checked).
- **Populations.** `default`: each run's shipped or plain configuration (matrix cells, the frontier and installer runs' main arms, a gbrain arm and its paired no-brain arm). `variant`: ablations and variants (prompt-archaeology cuts, harness-zero selection and head-to-head variants, h10 placements, v0.4 calibration rounds). `uncounted`: probes and smokes. `excluded`: INFRA rows and replaced runs. Only `default` is ranked and tested; `variant` and `uncounted` get the same tables, never pooled.

| Multi-user, frontier models | Trials | Failed | With a packet |
|---|---:|---:|---:|
| default | 3,162 | 784 (782 fail, 2 harness errors graded n/a) | 784 |
| variant | 3,605 | 1,090 | 1,090 |
| uncounted | 296 | 171 | 124 |
| excluded | 45 | 43 | none |

- Packets by model: Opus 5.5 1,435, GPT-6.1 Sol 563. By harness: OpenClaw 443, Claude Code 403, Hermes 398, harness-zero 323, Codex 277, QM 154.
- **Harbor rows** (terminal-bench and SWE-bench outcome rows, 1,179 on frontier models) have no trajectories and get no layer-2 label. They are reported as outcome counts only.

## Layer 1: observed failure mode (keyless, done)

- `scripts/taxonomy.ts` at `TAXONOMY_VERSION` 1.1.0, run with the new `--out` flag into [layer1/](layer1/) for every multi-user results folder, with `--tasks` pointed at the pinned task tree where the tree moved. No other run's folder and no `docs/receipts-manifest.json` flag changed. [corpus/layer1-status.json](corpus/layer1-status.json) lists each folder's status and its unclassified share.
- 1.1.0 adds one rule (`forbidden_event`, for `no_event` predicates) placed just before `unclassified`; no 1.0.0 label changes, and unclassified predicates fell from 1,926 to 22.

## Packets (keyless, done)

- `scripts/failure-mining/build-packets.ts` writes one packet per failed trial: task prompt, each member turn and the bot's reply, every world event with seq and turn, the grader's failed predicates and evidence, the layer-1 label, and the trial's gbrain exposure counts. Capped at 20,000 tokens; dropped events are recorded in the packet. Packets stay outside the repo because v0.4 task text is private; [corpus/packet-index.jsonl](corpus/packet-index.jsonl) records each packet's sha256, and a second build is byte-identical.
- `scripts/failure-mining/sdk-packet.ts` does the same for the 12 failed HARN-14 SDK trials ([corpus/sdk-packet-index.jsonl](corpus/sdk-packet-index.jsonl)), one numbered step per agent message or tool call.

## Samples (frozen in this commit)

[corpus/samples.json](corpus/samples.json), from the 1,874 default and variant packets, stratified by layer-1 primary label x harness x model (47 strata):

- **Codebook sample:** 150 trials, seed 2020. Five Opus readers drafted classes from it; it is never used for checking.
- **Gold sample:** 200 trials, seed 2021, disjoint from the codebook sample.
- **Extra gold draw, only if needed:** 100 more trials from the trials neither sample took, seed 2023, same rule.

## Codebook (frozen in this commit)

[codebook.md](codebook.md), version `2026-11-09-layer2-v1`: 20 classes in four groups (11 agent, 2 brain, 3 harness, 4 task or grader), each with a definition, include and exclude rules, two examples, its usual stage, and the gstack (G1 to G13) and gbrain (B1 to B14) claims that say they address it. When two classes explain a failed predicate, the one earlier in the list wins. Task-or-grader classes are never ranked as prevention targets; they are reported as repository fixes.

**The gbrain test family is 6 tests:**

- **5 classes,** each with a gbrain claim and able to occur in either arm: `did_not_look`, `gave_up`, `wrong_place`, `found_ignored` and `leak`.
- **One pooled measure, `retrieval_any`:** a failure labelled with any of `did_not_look`, `brain_miss`, `gave_up`, `wrong_place`, `found_ignored`, `unscoped_brain_search` or `cross_scope_read`. It includes `cross_scope_read` because it is the no-brain twin of `unscoped_brain_search` (the same out-of-scope read through a world tool instead of gbrain). Precedence cannot move a failure from one of these classes to another class outside the set. But a brain-arm failure that would otherwise be labelled a later class (for example `leak`, `over_refused` or a harness class) can move into the set through `brain_miss` or `unscoped_brain_search`, so the measure can still lean slightly toward "worse" for gbrain. The report states this limit beside every `retrieval_any` result.
- **The two brain-group classes (`brain_miss`, `unscoped_brain_search`) are never tested on their own.** They can only occur when gbrain is present, so a brain minus no-brain difference can never be negative. They are reported as brain-arm rates, descriptive.

## Labelling procedure

All calls go through the metering proxy under one lease for run `failure-mining-2026-11`, from `scripts/failure-mining/label.ts`, which attests this file (`runner/prereg/prereg.ts`) before the first paid call. Every step passes the same `--ledger` file, so the whole run, retests and any fallback included, draws on that one lease. Each labeller and each retest writes its own labels file; a resume refuses a file holding another model, codebook or prefix. The fallback's two labellers write two files, joined for the analysis, which checks that each trial was labelled by the other model family.

- **Call settings** (`scripts/failure-mining/llm.ts`): the fixed prefix (instructions plus the rendered codebook) is cached; Anthropic gets `cache_control` on the prefix block and `output_config.effort` low with no temperature, no thinking field and `tool_choice` auto (the 2026-11-08 Opus judge rule); OpenAI gets a strict JSON schema, reasoning effort low and explicit prompt caching with a prefix breakpoint and a `prompt_cache_key`; max output 8,000 tokens. One record per packet: root_cause, first_wrong_step, stage, brain_role, gstack_role, 1 to 3 evidence quotes, confidence, note.
- **Mechanical checks** (`check-labels.ts`): every cited seq is a bot event in the named turn, every quote appears verbatim in the packet, the class id exists, gstack_role is `absent` when the packet has no gstack. A failing record is asked again once with the failures named; it is then kept as `unverified` if it still fails. A reply with no valid record after one retry is `failed`.
- **Cache check:** each model's first 10 packets run one at a time (`--limit 10 --concurrency 1`), then the cache-read share is read from the proxy log. If it is under 20%, the run stops and the cache is fixed before more calls. Only then does the model run at concurrency 4.
- **Order:**
  1. Gold: Opus 5.5 and Astra each label the 200 gold trials.
  2. particle-1 labels the 200 gold trials, then the R78 check below runs.
  3. If particle-1 passes, it labels every other packet (1,798 multi-user and the 12 SDK packets).
  4. Test-retest: particle-1 relabels 100 gold trials and Opus 40, each with a fresh cache directory. The subsets are the first 100 and first 40 of the gold sample in a shuffle seeded 2024 (`analyze.ts` prints the ids).
- **Fallback, only if particle-1 fails the gate:** the cross-family frontier model labels the whole corpus (Astra for trials run on Opus, Opus for trials run on GPT-6.1 Sol). Gold is made of these same two models' labels, so the fallback cannot be scored against it. Instead it is gated on the Opus vs Astra kappa over all 200 gold-sample trials (a missing or failed label on either side counts as a disagreement), at least 0.6, and reported as "gated on agreement between the two frontier labellers, not on independent gold". If that fails too, every layer-2 number is descriptive and no verdict rests on it.
- **Tables come from the labeller that passed:** particle-1's labels if it passes, the fallback's if it passes instead. If neither passes, the tables use particle-1's labels and every layer-2 number is marked descriptive.

## Judge check (R78)

- **Gold** is every gold trial where Opus and Astra give the same root_cause. At least 40 gold items are needed; with fewer, the extra draw of 100 is labelled by both.
- **Gate:** particle-1's Cohen's kappa against gold on root_cause is at least 0.6, over every gold item: a gold item particle-1 left missing or failed counts as a disagreement. Reported beside it: the scored n and coverage, per-class catch rate and false-assignment rate, the Opus vs Astra kappa on all 200, test-retest agreement and kappa, and stage and first-wrong-step agreement (exact turn, exact seq), descriptive.
- particle-1 is a third family, so it is cross-family to every model under test. Every result names the labeller model.

## Analysis (`scripts/failure-mining/analyze.ts`, keyless and deterministic)

**Label status.** verified (valid and passed the checks), unverified (valid, failed a check after the retry), failed (no valid record), missing. The main analysis counts verified and unverified labels; the sensitivity counts verified only. Failed and missing labels count as class `unlabelled`, reported, never imputed.

**Mechanical regrade.** `bun scripts/regrade.ts` with the grader at this commit, over every frontier results folder in the corpus, writes [corpus/regrade.jsonl](corpus/regrade.jsonl) (every trial whose grade, consent violation or approval stop changes). It flips 105 failed trials to pass, all in the v0.4 runs (variant population: v04-cal-r1 22, r2 37, r3 30, r4 9, v04-transfer 7); no default-population trial regrades to pass (2 default harness-zero-h2h trials recorded as harness errors, grade n/a, regrade to fail, which changes nothing here). Each flipped trial is counted as `graded_before_fix` (status `mechanical`), overriding its model label. A second sensitivity treats them as passes. No counted run's trials.jsonl changes.

**A. Prevalence (default population).** Per class: failed trials, distinct task clusters (task tree, task), distinct harness x model pairs, and the cell-weighted per-trial rate over all default trials (passes included): the mean over cells (task tree, task, harness, model) of the share of the cell's trials labelled with the class. 95% interval by a task-cluster bootstrap, 10,000 resamples, seed 2020. Also per harness and per model. **Ranking:** classes outside task_or_grader by distinct tasks, then harness x model pairs, then trials. Layer-1 by layer-2 crosstab.

**B. gbrain prevention (default population).** Pairs are (run, harness, model) with a gbrain arm and a no-brain arm on the same tasks: v03-opus-dev (Hermes Opus, OpenClaw Opus), installer-cc-codex (Claude Code Opus, Codex Sol), qm-c4-told-live (QM Opus, QM Sol), harness-zero-h2h (Claude Code Opus). Only tasks run in both arms count; a unit is (pair, task cluster).

- **Estimand per class:** brain-arm per-trial rate minus no-brain rate, per unit, averaged over units with equal weight.
- **Interval:** unit bootstrap, 10,000 resamples, seed 2021. **p:** two-sided sign-flip permutation over units, 10,000 draws, seed 2022. **Holm** across the 6 tests at alpha 0.05. Every class is reported; untested classes and the brain-only classes are descriptive.
- **Reading:** an interval that includes zero reads "no measurable difference". A tested class significantly higher in the brain arm reads "gbrain made this worse". Each row reports the number of units where the brain arm was worse.
- Per pair and per install route: the same difference, descriptive, with intervals.

**C. Exposure (descriptive, not randomized).** Within brain arms: class rates for trials with at least one in-turn gbrain call against trials with none.

**D. gstack (descriptive).** SDK packets: class and gstack_role counts by arm (gstack, none, placebo; 4 failed trials each). The multi-user corpus has no gstack cell. The only other gstack-present failures are 99 terminal-bench outcome rows (95 from the investigate gate's gstack arms, 4 from HARN-14's lane B), which have no trajectories, so they get no class; their own reports carry their gstack results.

## Power (minimum detectable differences)

Computed from the frozen manifest before any label exists, with `bun scripts/failure-mining/analyze.ts --mdd --codebook docs/benchmarks/2026-11-09-failure-mining/codebook.json`: `scripts/paired-mdd.ts`'s variance rule (per unit p (1 - p) (1/n_brain + 1/n_none), cluster-robust over units), alpha 0.05 two-sided, power 0.8, at assumed per-trial class rates of 2, 5 and 10%. Percentage points:

| Scope | Units | Trials (brain / none) | MDD at 2% | MDD at 5% | MDD at 10% | Holm first step (m=6) at 2% | Holm first step (m=6) at 5% | Holm first step (m=6) at 10% |
|---|---|---|---|---|---|---|---|---|
| 2026-10-31-v03-opus-dev, hermes, claude-opus-5-5 | 20 | 160 / 60 | 6.1 | 9.5 | 13.1 | 7.6 | 11.8 | 16.2 |
| 2026-10-31-v03-opus-dev, openclaw, claude-opus-5-5 | 16 | 128 / 48 | 6.9 | 10.7 | 14.7 | 8.5 | 13.3 | 18.2 |
| 2026-11-01-installer-cc-codex, claude-code, claude-opus-5-5 | 17 | 204 / 102 | 4.9 | 7.6 | 10.5 | 6.1 | 9.5 | 13.0 |
| 2026-11-01-installer-cc-codex, codex, gpt-6.1-sol | 17 | 204 / 102 | 4.9 | 7.6 | 10.5 | 6.1 | 9.5 | 13.0 |
| 2026-11-03-qm-c4-told-live, qm, claude-opus-5-5 | 8 | 80 / 40 | 8.1 | 12.6 | 17.4 | 10.1 | 15.7 | 21.6 |
| 2026-11-03-qm-c4-told-live, qm, gpt-6.1-sol | 8 | 80 / 40 | 8.1 | 12.6 | 17.4 | 10.1 | 15.7 | 21.6 |
| 2026-11-06-harness-zero-h2h, claude-code, claude-opus-5-5 | 20 | 60 / 100 | 6.6 | 10.2 | 14.1 | 8.2 | 12.7 | 17.5 |
| pooled | 106 | 916 / 492 | 2.4 | 3.7 | 5.1 | 2.9 | 4.6 | 6.3 |

**What this means:** pooled, the 6-test family can detect a drop of about 3 to 6 points in a class's per-trial rate; single pairs only see drops of 6 to 22 points. A smaller true effect reads "no measurable difference", not "no effect".

## Verdicts (R48, one line each)

- **gbrain:**
  - **KEEP** if at least one of the 6 tests is lower in the brain arm after Holm and none is higher.
  - **CUT-CANDIDATE** (naming the gbrain part) if one of the 6 tests is higher in the brain arm after Holm, none is lower, and brain arms made in-turn calls in at least half their failed trials (so it is not an exposure null).
  - **FIX-METHOD** (naming the fix) otherwise: every interval includes zero, or the result is mixed, or exposure is under half. The "Why null?" cycle (exposure, fit, power, model) is written for it, and R61 applies if the null rests on saturation.
- **gstack:** **FIX-METHOD**, preregistered: gstack is not exposed in this corpus, so no number here can keep or cut it. The fix named in the results is a gstack arm with a no-gstack arm (R44) on the frontier tasks where the top-ranked gstack-claimed classes occur, with its cost and MDD. The SDK labels can change the named fix, not the verdict.
- **Change list.** Every proposal names the component, file, change, install route, the count of default failures it touches (distinct tasks, harness x model pairs, trials), and the cheapest rerun to prove it: an existing set, a no-gstack or no-brain arm, Opus 5.5 and GPT-6.1 Sol, a headroom check and its MDD.

## Changes from the plan

- **Population size:** the plan said about 2,070 frontier failures from a rougher query; the frozen manifest has 2,088, of which 1,998 have packets.
- **HARN-14 SDK transcripts** (dated 2026-11-09, before any label): the 12 failed trials of `gn-follow-2026-11` and `gn-follow-preset-2026-11` are labelled under this codebook and reported as descriptive. `gn-hard-follow-2026-11` had no failed trial (its no-gstack arm passed all 8 bugs), so it adds no packet. These runs were uncounted checks, so nothing from them is tested.
- **Mechanical regrade** (above) is added; it was not in the plan. It only moves trials into `graded_before_fix`, a class the codebook already has.
- **The gbrain test family** is narrower than the plan's "every class gbrain claims to address": the two brain-group classes can only occur with gbrain present, so testing them alone would be biased toward "worse". They are reported descriptively and covered by the pooled 7-class `retrieval_any` measure, which also includes `cross_scope_read`, the no-brain twin of `unscoped_brain_search`.
- **prereg.json** from the plan's file list is not written: the machine-readable parts are codebook.json, corpus/samples.json, corpus/regrade.jsonl and the constants in analyze.ts (seeds, gold size, Holm family).

## Limits

- **Why is inferred from actions.** Packets hold the bot's tool calls, replies and world events, not its private reasoning.
- **No coding trajectories** beyond 12 SDK failures; terminal-bench and SWE-bench enter as outcome rows only.
- **gstack was present in no multi-user trial** and in 12 labelled coding failures, so this run cannot say whether gstack prevents anything.
- **The codebook comes from the data.** Its sample is seeded and disjoint from the gold sample, and it is frozen here.
- **The pairs are not all alike.** Install routes differ by pair (hook, told, installer rung), and harness and model are crossed only partly; per-pair results name their harness, model and route.
- **One label per trial.** A trial with two causes gets the earlier one in precedence order; the note records the other.
- **Exposure split is not randomized** (C), so it never carries a verdict.

## Outside terms and privacy

- The multi-user worlds and tasks are our own synthetic data. v0.4 task text is private and goes only to the labelling models through the proxy; packets stay outside the repo, and no finding file quotes v0.4 task text.
- Terminal-bench and SWE-bench rows are outcome rows under their published licences; no task content from them is used.

## Results PR

- A separate pull request after this one merges: labels under `results/`, `report.md`, a finding file, and the claim check. Takeaways first (R79). "Why null?" sections and one verdict line each for gbrain and gstack. Spend only in `spend-internal.md`. One reviewer, one round (R51).
- The report and finding file carry, at the end, the R55 disclosure lines word for word for **Particle** (particle-1 is the labeller and its agreement numbers are reported), **gstack**, **gbrain**, **QM**, **Hermes**, **OpenAI** and **OpenClaw**.

## Receipts

- [codebook.md](codebook.md) and [codebook.json](codebook.json): the frozen codebook.
- [corpus/](corpus/): manifest.jsonl, runs.json, layer1-status.json, packet-index.jsonl, sdk-packet-index.jsonl, samples.json, regrade.jsonl.
- [layer1/](layer1/): layer-1 labels per results folder.
- [mdd.md](mdd.md): the MDD command and output.
- `docs/benchmarks/preregistrations.d/failure-mining.json` registers the run for `runner/prereg/prereg.ts`.

## Amendments

Each amendment is dated and committed on the results branch, pushed, before any label it affects is paid for (R77).

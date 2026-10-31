# gstack-native-v1 dev pilot: preregistration

Status: written 2026-10-30 (America/Los_Angeles), before any trial of these runs. Labelled **dev**. It runs only the 8 public dev tasks of gstack-native-v1 ([tasks/repo/gstack-native-v1/dev/](../../../tasks/repo/gstack-native-v1/dev/), format in [docs/repo-tasks.md](../../repo-tasks.md)) and one public Terminal-Bench 2 task. It makes no claim about gstack. It never runs a held-out task.

**What it is for:** checking the task recipe and the Lane B bridge ([docs/gstack-laneb.md](../../gstack-laneb.md)) before the 32 held-out tasks are generated and sealed. This is step 4 of internal-task's approved plan (Garry, "rec both"; plan revision gate_rev 2).

## The three runs

| Run id | Preregistration file | Tasks | Models | Arms | Tries | Spend cap |
|---|---|---|---|---|---|---|
| `gn-pilot-2026-10` | [prereg-native.json](prereg-native.json) | 8 dev tasks | Opus 5.5, Haiku 5.5 | none, gstack, placebo | 1 | $16.10 |
| `gn-pilot-none2-2026-10` | [prereg-none2.json](prereg-none2.json) | 8 dev tasks | Opus 5.5, Haiku 5.5 | none | 1 (the second none try) | $8.40 |
| `gn-pilot-tb2-smoke-2026-10` | [prereg-tb2.json](prereg-tb2.json) | `filter-js-from-html` (Lane B's first TB2 task) | Haiku 5.5 | none | 1 | $1.10 |

- **Trials:** 48 + 16 + 1 = 65.
- **What gets attested:** each run's JSON file is what the bridge attests at run time. The rules below live in this file, committed in the same commit.
- **Agent side:** Lane B's pinned agent, arms, prompt wrapper, Claude Code 2.1.312 invocation and body-load probe (gstack-evals `443d582c`, Harbor `f3a5a923`), unchanged.
- **Grading:** each task's own verifier, in a separate container that sees only the agent's `/work`.
- **Arms:** `none` is an empty `~/.claude`. `gstack` is gstack `61e201ec`. `placebo` is gstack with every skill body replaced by matched filler. The gstack arm is the saved pack-equivalent rebuild listed in `scripts/gstack-laneb/pin.json` (dated deviation, 2026-10-29). Every gstack record carries `laneb.arm_deviation`.

## Money

**Hard cap for the whole pilot: $20, funded by harness-evals.**

- Every paid call goes through our metering proxy under a ledger lease. A shard's lease is its projected spend x 1.4 plus the Lane B session cap of its most expensive model ($5 Opus, $1 Haiku), as `plan.ts lease` prints.
- Projections use Lane B quick look 2's cost per trial: Opus $0.18 (none) and $0.31 (gstack, placebo), so $0.27 averaged over the three arms.
  - Haiku is projected at $0.03, above the plan's "about $0.02", so its lease has room.
  - Projected spend for all three runs: about $8.90.
- `gn-pilot-2026-10` runs first and leases $16.09 (opus $14.08, haiku $2.01).
- **Spent so far** means the sum of `spend.ledger_committed_usd` over the shards' `run-summary.json` files.
- **After `gn-pilot-2026-10` ends,** the other shards are considered in this order. Each starts only if spent so far plus its lease, plus the leases of the shards started and not yet ended, is at most $20:
  1. `haiku-none2` ($1.34)
  2. `tb2-smoke` ($1.05)
  3. `opus-none2` ($7.02)
- A shard that doesn't fit is dropped, and the report says so.

## Shards

- Each shard runs on its own Ubicloud VM through `scripts/ubicloud/fanout.sh --workload gstack-laneb`. Every VM uses a clean checkout at this preregistration's commit, `--network allowlist`, and one trial at a time.
- Shards are the ones listed in each JSON file. No cell is split across shards.
- Opus's three cells share one shard. Three separate Opus shards would lease $24.10 against the $16.10 cap. If trials run long, the Opus shard may pass four hours.

## What is measured, and the rules

**Which trials count.** A trial counts when its grade is pass or fail.
- Not counted: `infra_error`, `model_error` with `cap_stop`, and any grade `n/a`. They are listed by cell with their reason.
- A pass is reward 1 (`laneb.reward`). Mean reward is reported beside the pass rate.

**1. Difficulty band (decides whether the recipe changes).**
- For each kind (fix, review, qa, ship) and each model, take the none arm's pass rate over its counted trials. Planned: 2 tasks x 2 tries = 4.
- **Rule:** if a kind is below 20% or above 80% on either model, that kind's recipe is fixed and its dev tasks regenerated before any held-out task exists.
- With fewer than 2 counted trials in a cell, that kind's band is **undecided**. No held-out task of that kind is generated until a rerun under a new run id decides it.
- Four trials per cell is coarse. The band checks the recipe; it is not an estimate.

**2. Body-load gate (reported only).**
- For each model, the share of invoked gstack and placebo sessions whose probe shows the skill body loaded. This is `gates.json`, from `to-trials.ts gates`, Lane B's `manip.ts` rule.
- It is also shown per skill (investigate, review, qa, ship), derived from each record's `laneb` block and the task's `skill`.
- A model below 90% is flagged. The pilot changes nothing because of it; the Lane B preregistration's gate rule applies unchanged at opening 1.

**3. Placebo token match (reported only).** For review, qa and ship, the placebo's loaded body against gstack's, in tokens, as Lane B reports it.

**4. Cost per trial, by model and arm.**
- Taken from each record's `usage.usd` (our proxy log within the session's window). Lane B's meter is shown beside it.
- Each shard's ledger total is the authoritative spend.

**5. Format failures, by arm.** A counted fail is a format failure when the verifier's `verifier/result.json` shows one of these:
- `stage` is `no_repo`, `no_remote`, `no_branch`, `clone`, `too_many_findings` or `too_many_repros`;
- `findings` is `"unreadable"` or `0` (review);
- `repros` is `0` (qa).

A not-counted trial with `HE-LANEB-008` (no `/work`) is listed with them. A verifier `error` field is listed separately as a verifier fault to fix. Measures 5 and 6 can count the same trial: a review with no findings is a format failure here and may also be substantive below.

**6. Contract or substantive.** A neutral reviewer on a fresh machine classifies every counted gstack-arm fail as **contract** (the agent did the work but missed the task's output contract) or **substantive** (the work is wrong or missing). The reviewer is not the task author and not a gstack developer. The same reviewer classifies the none-arm and placebo-arm fails on the same tasks.
- **Rule:** an instruction is fixed and its task regenerated when the gstack trial fails as contract and neither the none nor the placebo trial on the same task and model failed with a contract miss of the same kind.

**7. Opening 1 projection (the start rule).**
- **Measured cost per trial:** for each model and arm, the mean `usage.usd` over every native trial of `gn-pilot-2026-10` and `gn-pilot-none2-2026-10` that has a `usage` record, counted or not, since a cap stop or an infra error also costs money. A model and arm with no such trial takes Lane B's rate above, and the report says so.
- **Projection:** 32 tasks x the opening's tries (Haiku 5; Opus 2, or 3) for each model and arm, summed. The report gives two numbers:
  - (a) projection x 1.4, the approved plan's rule;
  - (b) the lease total `plan.ts lease` prints for the opening's shard layout, using these costs. This adds the session caps. The layout is fixed here: one shard per model, holding all three arms (2 shards, so $5 + $1 of session caps).
- **Rule:** opening 1 starts with Opus at 2 tries only if both (a) and (b) are at most $90. Opus runs 3 tries only if both are at most $90 at 3. If 2 tries do not fit, the Lane B preregistration goes back to internal-task for a larger cap before any trial.
- At Lane B's own rates (a) is about $85 with Haiku at $0.02, and about $93 at the $0.03 used for this pilot's leases. So the measured Haiku cost decides it, and (b) adds $6 on top.

**8. The TB2 smoke** passes if its one trial is counted (pass or fail) and both our ledger and Lane B's meter show its spend. If it fails, the TB2 re-execution waits until the cause is fixed and a new smoke passes.

## Checks before this preregistration (no spend)

Logs are in [prechecks/](prechecks/).

- **Lane B root:** fetched on 2026-10-30 at `443d582c`, with the saved gstack rebuild that pin.json lists.
  - A fresh rebuild gives a new pack every time: `5f4f832a...` and `b70e7308...` that day. So every run uses the saved one.
  - Logs: `fetch-rebuild-1.txt`, `fetch-rebuild-2.txt`, `fetch-saved.txt`.
- **Keyless dry run:** `vm-run.sh --fake-upstream --uncounted` ran 4 dev tasks x none and gstack on Haiku through Harbor. All 8 records were graded (fail, as expected from an agent that does nothing), with no `infra_error`, and the body-load gate passed (`dry-run.txt`).
- **Oracle through Harbor:** each task's oracle, run as Harbor's oracle agent with separate verification, scored reward 1 on all 8 dev tasks (`oracle.txt`).
  - The materializer copies only `solve.sh` into Harbor's `solution/`. So for this check, `oracle/fix.patch` was copied beside it and the `/oracle` paths were mapped to `/solution`.
  - This affects only the oracle agent, never an agent trial. The bridge fix comes in a separate pull request.
- **Bridge fix in this pull request:** `vm-run.sh` made the preregistration path absolute before attesting it, and `attestPreregistration` then joined it onto the repository path. Every counted shard would have stopped at "attestation refused". It now attests the repository-relative path, and a test covers it.

## Not done

- No held-out task.
- No significance test.
- No Sonnet.
- No model outside Lane B's pinned `cells.json` and the anthropic routes in `proxy.json`. The bridge meters only anthropic-routed models, so particle-1 and DeepSeek cannot run here.

## Report

The report and results come in a later pull request, under this directory: `results-native/`, `results-none2/`, `results-tb2/` and `report.md`. It covers every measure above with its receipt, the spend, the VM time, and any restart or deviation.

## Amendment 1 (2026-10-30): the TB2 smoke again, as `gn-pilot-tb2-smoke2-2026-10`

Written after `gn-pilot-2026-10` and `gn-pilot-none2-2026-10` ended, before any trial of the new run.

- **What happened:** `gn-pilot-tb2-smoke-2026-10` ran no trial and spent nothing on the model.
  - `vm-run.sh` passed the preregistration's task list to the materializer for native runs only. The TB2 run materialized all 20 TB2 tasks of Lane B's `final.json` instead of `filter-js-from-html`.
  - The lease check then priced 20 tasks ($1.84) against the $1.10 cap and stopped the shard with `HE-LANEB-003` before the proxies started. The keyless smoke before it passed.
  - The VM ran 8m18s ($0.08 list price) and was destroyed.
- **Fix, in the same pull request as this amendment:** `vm-run.sh` reads the task list before it picks the source, so both sources materialize only the listed tasks. Test in `tests/gstack-laneb.test.ts`.
- **Measure 8 still applies.** The TB2 re-execution waits until a smoke passes. This new run is that smoke.
- **New run:** `gn-pilot-tb2-smoke2-2026-10`, in [prereg-tb2-2.json](prereg-tb2-2.json). It is `prereg-tb2.json` with only the run id changed: the same task, Haiku 5.5, the none arm, 1 try, shard `tb2-smoke`, lease $1.05 and cap $1.10.
- **The old run** stays registered with no trials. The report says so.
- **Money:** the pilot has spent $6.52 of its $20 hard cap, by the ledgers: $5.19 (Opus) and $0.28 (Haiku) in `gn-pilot-2026-10`, then $1.01 (Opus) and $0.05 (Haiku) in `gn-pilot-none2-2026-10`. The parts are rounded to the cent, and the total is the unrounded ledger sum ($6.5245). With this lease the worst case is $7.57.
- **Results** go to `results-tb2-2/`.

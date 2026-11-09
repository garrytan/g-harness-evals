# Amendments: frontier harness run (frontier-harness-2026-11)

The preregistration is [PREREGISTRATION.md](PREREGISTRATION.md). It is not edited after its merge, so its hash in the preregistration ledger keeps matching. Each amendment below is dated and committed before any cell it affects.

## Amendment 1 (2026-11-07): three tasks with a broken reference solution, and how amendments land

**Approved by** the Captain (internal-task) on 2026-11-07. **Committed** before any counted trial: this is the first commit of the results branch, and stage 0 launches from it.

### 1. Three tasks whose own reference solution fails today

**The baseline gate (Run order step 2) failed on 3 of 60 tasks.** `install-check.sh --baselines all` ran at 0ffe34f on one Ubicloud standard-16 VM, behind the egress blocklist:

- **Nop:** 60 of 60 scored 0, as required.
- **Oracle:** 57 of 60 scored 1. The three below scored 0.

| Task | Place in the shared order | Why the reference solution fails | Outside source |
| --- | --- | --- | --- |
| `mcmc-sampling-stan` | 32 | The solution installs rstan from CRAN with its dependencies unpinned. RcppParallel 6.x needs CMake, and the task image has none, so rstan never installs and `/app/analysis.R` is never written. | terminal-bench-2 PR #73 |
| `build-cython-ext` | 38 | pyknotid's dependency planarity is unpinned. planarity 1.0.0 breaks one of pyknotid's own upstream tests (`KeyError: 'pos'`), and the verifier runs that suite, so 1 of 11 verifier tests fails. | terminal-bench-2 PR #73; the TB2.0 oracle audit of 2026-10-16 |
| `protein-assembly` | 10 | The solution queries live RCSB data, and RCSB renamed a field. The sequence it gets back cannot be translated (dnachisel: "Wrong translation"), so `/app/gblock.txt` is never written. | the TB2.0 oracle audit of 2026-10-16 |

- **Sources:** [terminal-bench-2 PR #73](https://github.com/harbor-framework/terminal-bench-2/pull/73) and [One in eight: Terminal-Bench 2.0 tasks whose own reference solution fails](https://shreyashgondane.com/research/tb2-oracle-audit.html) (2026-10-16).
- **Re-check (2026-11-07):** the three oracles ran again on a fresh VM, 3 attempts each behind the blocklist and 1 each without it. All 12 scored 0 with the same error as above. So each failure repeats every time, and the egress blocklist plays no part.
- **Still solvable by an agent?** Two of them are. An agent can install CMake or pin RcppParallel for `mcmc-sampling-stan`, and it can work around the renamed field for `protein-assembly`. `build-cython-ext` passes only if the agent happens to pin planarity below 1.0, so expect it near 0 for every cell.

**Decision: keep all 60 tasks and score them as they are.**

- **No task changes:** no task, pin or verifier file changes.
- **Why this is fair:** every cell runs the same tasks at the same pins. Each comparison pairs cells task by task, so the drift hits both sides of every pair.
- **Headline:** the all-task figures, as preregistered. Verdict tags, the Holm families, the stage-0 headroom gate, the drop levels and the projection all use every task.

**Sensitivity check (preregistered here).**

- **How:** make a copy of the merged results with every trial of the three tasks removed, from `trials.jsonl` and from the manifest's planned trials. Run it through `scripts/frontier-harbor/analyze.ts` with the same two specs (`analysis-spec.json` and `analysis-spec-kept.json`). The output goes to `results/sensitivity-without-drifted-tasks/`.
- **Reported:** for every cell, the pass rate with and without the three tasks, plus each pair's difference without them, with intervals.
- **Descriptive only:** the check sets no verdict tag and changes no headline number. The kept sample holds none of the three, so its copy is unchanged and says so.

### 2. How amendments land (this corrects the Amendments section and Run order step 8)

The preregistration says each amendment "merges to main before those cells start". At most two pull requests are merged per experiment: the preregistration (#329, merged as 4ca3a47) and the results. So, instead:

- **Where:** an amendment is a dated commit, pushed to the results branch `harn50/frontier-results` before the cells it affects start. Those cells launch from that commit.
- **Branch:** the results branch was cut from #329's merge commit 4ca3a47, and this amendment is its first commit.
- **Later amendments:** the stage-0 drop or grow level, each extension pair and the Gemini path come the same way. None gets its own pull request. They reach main with the results pull request.
- **Launch commit:** stage 0 launches from this commit. `scripts/frontier-harbor/` and the preregistration files here are byte-identical to 0ffe34f, the commit the install check and the baseline gate ran at. Between 0ffe34f and 4ca3a47, main also gained #323's stage-cap and resume guards in `scripts/ubicloud/fanout.sh` and `scripts/ubicloud/run-shard.sh`. Every shard runs under these guards.

### 3. Dated deviations from the approved plan, and one stated limit

The Captain (internal-task) approved each of these on 2026-11-07. The preregistration already applies them. They are listed here because the approved plan said otherwise.

- **QM bonus cell dropped:** QM's agent loop cannot work on the task container's files (PREREGISTRATION.md, Cells).
- **Rate limits:** an upstream 429 makes a trial `infra_error` only when the harness then stopped with an error. A trial that recovered is scored as it ended (Scoring).
- **Task time limit:** a task's own agent time limit is a scored fail, as on the leaderboard (Scoring).
- **Stated limit, egress:** the blocklist matches TLS SNI and HTTP Host. It does not block a connection to a raw IP address, or a TLS connection that sends no SNI. The backstop is the answer-key audit of every captured request body (Contamination). The report states this limit.

## Amendment 2 (2026-11-08): run the Opus cells despite the headroom gate; refusals and the Opus ceiling; main-stage logistics

**Approved by** the Captain (internal-task) on 2026-11-08. **Committed** after stage 0 and before the main stage. **This amendment was made after seeing stage 0's results.**

### 1. Stage 0, in brief

- **Ran:** from c5c9951, 2026-11-08 01:26Z to 04:16Z, on 8 VMs. All 140 trials completed: 0 infra errors, no upstream 429s, and every agent-loop request sent effort high. Paid spend was $60.39, and the ledger matches the proxy on every shard.
- **Home cells at attempt 1:** Claude Code on Opus passed 47 of 52 (90.4%). Codex on Sol passed 44 of 52 (84.6%).
- **MDD** (Run order step 4: the powerNote formula on the home cell's per-task variance at 52 tasks and 2 attempts):
  - Opus: 11.5 points, or 13.2 at the first Holm step.
  - Sol: 14.0 points, or 16.2 at the first Holm step.

### 2. The Opus cells run as planned, although the Opus headroom gate tripped

- **The gate:** Run order step 4 stops a model's remaining cells when its home harness passes at least 90% of the 52 tasks at attempt 1. Opus passed 47 of 52, which is 90.4%, so the gate tripped. One more fail would not have tripped it.
- **Decision:** the Opus cells run as planned anyway, with nothing moved to Sol's attempt 3.
- **Why:**
  - The gate was there to save money on saturated cells. Garry's 2026-11-07 guideline ("don't cut corners to stay just under the limits") removes that purpose.
  - The trip rests on one task, and 3 of the 5 Opus fails are safety refusals (section 3).
  - Cost per solve and reliability don't saturate. In the stage-0 probes, Hermes on Opus cost about 2.5 times as much per trial as Pi on Opus.
- **The Sol gate:** it did not trip (84.6%, MDD 14.0), and Sol is unchanged.

### 3. Safety refusals

- **What happened:** in stage 0, Opus 5.5's safeguards refused three biology tasks in the Claude Code cell (protein-assembly, dna-assembly, dna-insert). GPT-6.1 Sol refused model-extraction-relu-logits in the Codex cell. Harbor records each as `AgentSafetyRefusalError`.
- **Scoring is unchanged:** a refusal is still `harness_error`, which is a scored fail, as preregistered. The headline and every verdict use that scoring.
- **Sensitivity line (added in this amendment):** for every cell, the pass rate with every trial whose Harbor exception is `AgentSafetyRefusalError` left out, and each pair's difference without them. It is reported next to each cell's headline figure and labelled "added in amendment 2, after stage 0". It is descriptive only and sets no verdict tag. The report also counts refusals per cell.

### 4. The Opus ceiling caveat

- **On every Opus comparison:** each pass-rate comparison on Opus carries the home cell's ceiling caveat, "Claude Code on Opus passed 90.4% of the 52 tasks at stage 0", wherever it appears.
- **No overclaiming:** no "harness X beats Claude Code on Opus" claim is made unless that pair clears the preregistered test (the two-sided task-level sign-flip p, Holm-adjusted across Opus's 3 primary pairs).

### 5. The Fable pair stays eligible

The Extension section skips a family's pair "if its core model hit the headroom gate". Since section 2 sets the Opus trip aside, the Fable pair (Claude Code and OpenClaw on Claude Fable 5.1) stays eligible. Argon is skipped because no paid-tier Gemini key is present, and its slot goes to Fable, as preregistered. After the core, the order is the Astra probe, then the Fable probe.

### 6. Main-stage logistics

- **Launch commit:** the main stage launches from this commit.
- **Leases:** each shard's main-stage lease is its planned lease less its recorded stage-0 spend, rounded down to whole dollars: opus-cc $223, opus-hermes $239, opus-openclaw $210, opus-pi $155, sol-codex $63, sol-hermes $118, sol-openclaw $100, sol-pi $74.
- **Stage-0 records:** each shard's stage-0 `trials.jsonl` is committed here at `results/stage0/<shard>/trials.jsonl`. The main stage passes it as `--done`, so no stage-0 trial runs again.
- **Canary:** sol-codex is the canary shard (Run order step 7). The other seven start once it has finished cleanly.
- **Mirror:** `scripts/ubicloud/run-shard.sh` now leaves every `proxy-capture/` directory and `results/run/` out of a frontier-harbor shard's mid-run mirror, because the stage-0 mirror pushed a 2 GB Capy drive over its limit. The mirror keeps `trials.jsonl`, the ledger, `run-summary.json`, the per-trial records and the VM map, and the pull into the controller's dest still brings everything back. This changes no task, grader, scoring or pin; it is tested in `tests/ubicloud-run-path.test.ts`. Stage 0's captures are kept as compressed archives in the run's drive folder.

## Amendment 3 (2026-11-08): the extension pairs (Astra and Fable)

**Approved by** the Captain (internal-task) on 2026-11-08. **Committed** before any extension trial, so it is a pre-data change for these cells. The core main stage was running from 72f967e when this was committed, and this commit does not touch it.

### 1. Cells and shards

- **New files:** `prereg-harbor-extension.json` holds the extension cells, under the same run id, and `analysis-spec-extension.json` is their analysis.
- **Cells:** each runs 1 attempt on the 52 tasks of the shared order.
  - GPT-6 Astra: Codex (`astra-codex`, home) and OpenClaw (`astra-openclaw`).
  - Claude Fable 5.1: Claude Code (`fable-cc`, home) and OpenClaw (`fable-openclaw`).
- **Shards:** one per model. `astra` has a $450 lease and `fable` a $300 lease, with concurrency 4. Each lease is above its floor (concurrency times the per-call reservation): $150.40 for Astra and $78.94 for Fable.
- **Argon:** skipped, because no paid-tier Gemini key is present. Its slot goes to Fable, as preregistered.

### 2. Order and size

- **Probe:** stage `probe`, the home cell on the first 6 tasks (attempt 1). It runs first on each shard.
- **Then the rest:** the remaining home trials and every OpenClaw trial, on the same shard.
- **Size:** the full 52 tasks, if the probe projection fits the money. That is the largest of the preregistered sizes (52, 40 or 26).
- **Not interleaved:** the two cells of a pair run as two Harbor jobs, not task by task. The report still uses the largest complete paired prefix, as preregistered.
- **Money:**
  - The core's paid trials are projected at about $390.
  - Adding these leases ($750) and the $170 reserve keeps the run within the preregistered $1,420 paid cap.
  - If the core finishes above about $500, the leases are lowered before launch.

### 3. The 90%-of-first-26 stop is removed

- **What changes:** the Extension section says a pair stops when its home harness passes at least 90% of its first 26 tasks, keeping a cost-only row. That rule is removed.
- **Why:** the stop was there to save money on saturated pairs. Garry's 2026-11-07 guideline ("don't cut corners to stay just under the limits") supersedes it, as in amendment 2.
- **When decided:** before any extension trial.
- **Ceiling caveat instead:** any extension pair whose home cell passes 90% or more of its tasks carries the same ceiling caveat as amendment 2. Every pass-rate comparison in that pair names the home cell's rate.

### 4. Unchanged

- **Claims:** extension claims stay descriptive, with estimates and intervals only, no test, and no non-inferiority claim.
- **Sensitivity lines:** the amendment 1 drift line and the amendment 2 refusal line also cover the extension cells.


## Amendment 4 (2026-11-08): a GitHub outage left 318 main-stage trials ungraded; a mechanical exclusion and one rerun

**Approved by** the Captain (internal-task) on 2026-11-08. **Committed** after the main stage and before any rerun trial. **This amendment was made after seeing the main stage's results.** The exclusion rule is a log signature fixed here, and its list is committed in this commit, before any rerun result exists.

### 1. What happened

- **The verifier's download failed:** each task's verifier script downloads `uv` from github.com before it runs the tests. From 2026-11-08 08:45Z to 12:07Z, GitHub answered that download with 503 and 504 errors. The script then printed `uvx: command not found`, ran no test, and wrote reward 0. The converter recorded each of these as a scored fail.
- **GitHub's incident:** "Increase in timeouts for some unauthenticated users" (githubstatus.com/incidents/pyynvrm1vskw), first posted at 10:36Z and resolved at 12:32Z. Our failures started earlier than GitHub's first post.
- **Scale:** 318 of the 676 main-stage trials. Stage 0 (01:26Z to 04:16Z) and the sol-codex canary (ended 07:23Z) have none. Every shard running in the window has some.

### 2. The exclusion rule (`verifier_unavailable`)

- **Signature:** a trial's `verifier/test-stdout.txt` contains `failed to download https://github.com/astral-sh/uv/` and does not contain `test session starts` (pytest's start line). Nothing else is read: not the reward, not the cell, not the first attempt's outcome.
- **Class:** such a trial is `infra_error` with infra class `verifier_unavailable` and grade n/a. It is excluded pairwise and counted per cell, like the other infra classes. In the converter it comes after `unfinished`, a lease refusal and `effort_mismatch`, and before every other class, because a trial with no grade cannot be a timeout fail or a harness-error fail either.
- **The list:** `scripts/frontier-harbor/to-trials.ts scan-verifier` applies the signature to the stored verifier output of every stage-0 and main-stage record. Its output is committed here as [results/verifier-unavailable.json](results/verifier-unavailable.json): 318 trials.

| Cell | Listed | | Cell | Listed |
|---|---|---|---|---|
| opus-cc | 30 | | sol-codex | 0 |
| opus-hermes | 40 | | sol-hermes | 48 |
| opus-openclaw | 36 | | sol-openclaw | 48 |
| opus-pi | 40 | | sol-pi | 46 |
| opus-hermes-kept | 4 | | sol-hermes-kept | 7 |
| opus-openclaw-kept | 6 | | sol-openclaw-kept | 5 |
| opus-pi-kept | 6 | | sol-pi-kept | 2 |

- **Retried and graded:** 2 more trials (one opus-openclaw, one sol-hermes) logged the failed download, but the script's retry reached the tests, and both passed. They stay scored as recorded and are listed under `retried_and_graded`.
- **Records are not edited:** the first-run `trials.jsonl` of every shard stays as written. The main-stage files are committed here at `results/main/<shard>/trials.jsonl`. The exclusion is applied when the stages are merged (`scripts/frontier-harbor/merge-stages.ts`).

### 3. One rerun of each listed trial

- **What runs:** each of the 318 trials runs once more. It uses the same cell, task, attempt number, harness settings, pins and shard, on a fresh VM per shard, launched from this commit.
- **Ids and marker:** a rerun record keeps its trial's id and carries `frontier.stage` `rerun1` and `frontier.rerun` 1. Its Harbor jobs are `<cell>__a<n>__rerun1`, under the lease `<run_id>:<shard>:rerun1`.
- **Scored as a first run:** the same scoring and infra classes, `verifier_unavailable` included. No outcome of the first run is consulted.
- **The merge:** a listed trial takes its rerun record. A listed trial whose rerun is missing or hits the signature again stays excluded. There is no second rerun.
- **When:** only once GitHub's status page shows all systems operational and a test download of the same `uv` release from a Ubicloud VM returns HTTP 200.
- **Leases:** each shard's rerun lease is at most its planned lease less what its stage-0 and main-stage trials spent (`plan.ts check-shard --rerun` enforces this, and requires every listed trial's first run in a `--done` file). The leases are about three times the listed trials' first-run spend, with a floor at the shard's headroom floor and a cap at its remaining planned lease:

| Shard | Trials | First-run spend | Lease |
|---|---|---|---|
| opus-cc | 30 | $13.59 | $41 |
| opus-hermes | 44 | $26.21 | $79 |
| opus-openclaw | 42 | $29.70 | $90 |
| opus-pi | 46 | $24.28 | $73 |
| sol-hermes | 55 | $17.72 | $54 |
| sol-openclaw | 53 | $26.55 | $50 |
| sol-pi | 48 | $10.36 | $32 |

- **Expected cost:** about $148 paid, plus about $8 of VMs. With the extension, the run stays inside the preregistered $1,420 paid cap.

### 4. In-window and out-of-window line (descriptive)

- **Why:** agents running between 08:45Z and 12:07Z may also have hit GitHub during the task itself, for example a `pip` or `git clone` from github.com. The verifier evidence cannot separate that.
- **The window:** 2026-11-08 08:45:00Z to 12:08:00Z, the first and last listed trial's end time rounded outward to the minute.
- **Reported:** for every cell, the pass rate over the graded first-run trials that ended inside the window, and over every other scored trial. Also, the full analysis rerun on a copy of the merged results with every in-window first-run trial removed, from `trials.jsonl` and the manifest's planned trials, with `analysis-spec.json` and `analysis-spec-kept.json`. The output goes to `results/sensitivity-outside-outage-window/`.
- **Descriptive only:** it sets no verdict tag and changes no headline number.

### 5. Also covered

- **Extension cells:** the converter's new class applies to every extension trial run from this commit. The Astra and Fable probe trials ran from 06f3bd9, before it, so the same `scan-verifier` is run over them, and a listed probe trial is excluded and rerun the same way.
- **The report:** it says that 318 of 676 main-stage trials hit a GitHub outage between 08:45Z and 12:07Z (GitHub's incident resolved at 12:32Z) and were rerun once, and that agents may also have hit GitHub mid-task in that window.
- **Tooling, all keyless-tested in `tests/frontier-harbor-rerun.test.ts`:**
  - `to-trials.ts`: the `verifier_unavailable` class, the `rerun` field and `scan-verifier`.
  - `plan.ts` and `vm-run.sh`: `--rerun`.
  - `merge-stages.ts`: the staged merge with the exclusion list, which `merge-shards.ts` cannot do for a shard with two stage directories.
- **Unchanged:** no task, pin, verifier, harness or scoring rule changes, apart from the new exclusion class.


## Amendment 5 (2026-11-08): the Fable lease rises to $420 after the probe priced Fable at 2.4 times the prior

**Approved by** the Captain (internal-task) on 2026-11-08. **Committed** after the Astra and Fable probes and before any other Fable trial, so it is a pre-data change for the remaining Fable cells. The Astra pair's remaining trials were already running from afc29cf under the earlier extension preregistration, and this commit does not touch them.

### 1. Why the cost estimate moved

- **The probe:** Claude Code on Claude Fable 5.1 passed 3 of its first 6 tasks for $14.64, about $2.44 a trial. That is about 2.4 times the prior used in amendment 3.
- **Projection for the rest:** about $112 for the other 46 Claude Code trials, and about $176 for the 52 OpenClaw trials (OpenClaw cost about 1.4 times Claude Code per trial on Opus in the main stage). The pair comes to about $303.
- **The old lease:** $300 less the probe's $14.64 leaves $285 for the rest. On this projection the shard would likely hit its lease near the end of the OpenClaw cell, and lease-refused trials are excluded, so the pair would be incomplete.
- **Astra:** its probe (Codex passed 5 of 6 for $6.73) projects the pair at about $159, under its $450 lease. Nothing changes for Astra.

### 2. What changes

- **`prereg-harbor-extension.json`:** the `fable` shard's lease goes from $300 to $420, and `cap_usd` from $820 to $870 (the two leases, with no reserve).
- **Size:** all 52 tasks, as amendment 3 planned. Nothing is cut to fit the money.
- **Paid cap, in amendment 3's terms:** core paid of about $546 after amendment 4's reruns, plus Astra's $450 lease, plus Fable's $420 lease, is $1,416. That is inside the preregistered $1,420 paid cap, with no reserve.
- **Expected paid total for the run:** about $1,010.

### 3. The merge exception

- **Why:** the probe stage of both extension shards, and the Astra pair's other trials, ran under the earlier extension preregistration. Their `manifest.json` carries its hash.
- **Old hash:** `51b859752ab2afcef1681921a7405f8a5b27f170d8a9fb23966517ac31e4bb5e` (the extension preregistration as committed in amendment 3, 06f3bd9).
- **The exception:** `scripts/frontier-harbor/merge-stages.ts --prereg-sha 51b859752ab2afcef1681921a7405f8a5b27f170d8a9fb23966517ac31e4bb5e` lets those directories differ from the new manifest in `prereg_sha256` only. Any other difference is still refused. This is tested in `tests/frontier-harbor-rerun.test.ts`, and `merge.json` records the accepted hash.

### 4. Unchanged

Cells, tasks, attempts, order, scoring, the analysis spec, and amendments 3 and 4's rules for the extension cells.

## Amendment 6 (2026-11-08): amendment 4's outage signature was incomplete; 35 more trials are excluded and rerun once

**Approved by** the Captain (internal-task) on 2026-11-08. **Written after** amendment 4's 318 reruns had finished and their results had been merged and analysed. So this is not a pre-data change, and the report says so in its main text. **Committed** before any of the 35 trials below is rerun, with the list the widened signature produces.

### 1. What was missed

- **Amendment 4's signature** matched one form of the outage: the verifier's download of uv itself from github.com failed, so `uvx` was missing and no test ran.
- **The second form:** in 35 more trials, uv downloaded, and then uv's own download of a Python build from github.com failed (`Failed to download https://github.com/astral-sh/python-build-standalone/...`, mostly `504 Gateway Timeout`). pytest never started, and the verifier wrote reward 0. These trials were scored as agent fails.
- **How it was found:** the in-window line of amendment 4 section 4. Graded first-run trials that ended inside the window failed far more often than the rest (53 of 177 completed trials, 30%, against 78 of 652, 12%, outside it). Reading the in-window verifier output showed the 35. The widening was chosen because that gap pointed at it.
- **Where they are:** all 35 are main-stage first runs that ended between 08:54Z and 11:46Z, all graded fail. By cell: opus-cc 3, opus-hermes-kept 3, opus-openclaw 2, opus-openclaw-kept 1, opus-pi 6, opus-pi-kept 1, sol-hermes 1, sol-openclaw 9, sol-pi 6, sol-pi-kept 3. With them removed, the in-window completed trials fail 18 of 142 times (13%), in line with the rest.

### 2. The widened signature (`verifier_unavailable`)

- **Two parts, both must hold**, on the trial's `verifier/test-stdout.txt`:
  1. no pytest summary line (a line of `=` framing "N passed", "N failed", "N error(s)", "N skipped" and the like, or "no tests ran");
  2. a failed download from github.com (`failed to download https://github.com/`, any case).
- **Code:** `verifierUnavailable` in `scripts/frontier-harbor/to-trials.ts` (`PYTEST_SUMMARY`, `GITHUB_DOWNLOAD_FAILED`). It replaces amendment 4's uv-only form for every trial converted from this commit on.
- **Outcome-blind:** every trial it lists has reward 0 by construction, because its tests never ran. No pass or fail is consulted.
- **Applied to every scored trial**, with `to-trials.ts scan-verifier`:
  - **Core** (stage 0, the main stage and amendment 4's reruns, with `--previous results/verifier-unavailable.json`): 353 first-run trials, which are amendment 4's 318 (all found again) plus the 35 above. It also finds the same 2 retried-then-graded trials as before, and 0 amendment-4 rerun records.
  - **Extension probes** (Astra and Fable, from 06f3bd9): 0.
  - **The Astra and Fable pairs** were still running at this commit. The same scan runs over each when its shard finishes. A first-run trial it lists gets one rerun under these rules, with its list committed before that rerun runs.
- **Files:** `results/verifier-unavailable-a6.json` (the full core list, the merge's `--exclude`) and `results/verifier-unavailable-a6-rerun.json` (the 35, the `--rerun` list).

### 3. One rerun of each of the 35

- **Same rules as amendment 4 section 3:** same trial ids, same pinned commit for tasks, harnesses and grader, scored exactly as first runs, and no first-attempt outcome consulted. None of the 35 had been rerun before, so each gets its first and only rerun.
- **Stage name:** `rerun1-a6` (`vm-run.sh --rerun <list> --rerun-stage rerun1-a6`), so each shard's lease is its own, `<run_id>:<shard>:rerun1-a6`. The records carry `rerun: 1`.
- **No third attempt:** after the reruns finish, the same scan runs over them, and `merge-stages.ts` checks every rerun record's own verifier output too. A rerun that hits the signature again stays `verifier_unavailable` and is excluded pairwise.
- **Spend accounting:** each shard's check counts its stage 0, main-stage and amendment-4 rerun spend (`results/rerun/<shard>/trials.jsonl`, committed here) against its preregistered lease.
- **Leases:** opus-cc, opus-hermes, opus-openclaw and opus-pi $32 each (the headroom floor is $31.58), sol-hermes $25, sol-openclaw $35, sol-pi $30, so $218 in all. sol-codex has none of the 35.
- **Paid cap:** the reruns launch only after the Astra shard has finished and its unspent lease is released. Core paid so far (about $546), plus Astra's actual spend, plus Fable's $420 lease, plus these $218 must stay inside the preregistered $1,420. Expected cost is about $15 paid and $4 of VMs, so the expected run total stays about $1,010 paid.

### 4. What the report shows

- **In the main text:** amendment 4's signature was incomplete. Amendment 6 was written after amendment 4's rerun results existed, and the widening was chosen because the in-window failure gap pointed at it.
- **Next to the headline:** every verdict under amendment 4's classification alone (the 35 scored as the fails they were recorded as), with each verdict that differs named in both directions.
- **Amendment 4 section 4's in-window line** is reported as specified, over the trials this amendment leaves in the window.

### 5. Unchanged

Cells, tasks, attempts, order, scoring, the analysis specs, the headline being the all-60 figure, and amendments 1 to 5.

## Erratum (2026-11-09): amendment 2's mirror sentence held only after `finish()`

Amendment 2's **Mirror** line says the mirror keeps `trials.jsonl`, the ledger, `run-summary.json`, the per-trial records and the VM map; that held only after `vm-run.sh` wrote the records at `finish()`. Mid-run, the mirror held the ledger, the attestation and logs and the VM map, but no `trials.jsonl`, `run-summary.json` or per-trial records, because `results/run/` (left out of the mirror) was their only copy until then. No trial was lost: every shard was pulled at teardown. The tool fix belongs to internal-task, before the next frontier-harbor run.

# Regression canary preregistration: does a new stable gstack or gbrain release do worse than the one before it?

Status: written 2026-11-09 (America/Los_Angeles), before any counted trial. Run id `regression-canary-2026-11`. The frozen rule, tiers, lists and leases are in [prereg-canary.json](prereg-canary.json); the code is `scripts/canary/`; how to read and run it is [docs/canary.md](../../canary.md).

**In one line:** each time gstack's or gbrain's stable release moves, check that the new release still installs, still reaches the model, costs no more and passes no fewer tasks than the previous one, with the same model and harness, and with a no-gstack or no-brain arm run in the same window.

**The public lesson it is after:** how cheap a release regression check for an agent tool can be while still catching the failures that matter (a broken install, a skill that no longer loads, a cost jump, a large pass-rate drop), and how often it cries wolf on a release that did not change.

Every result is labelled dev. No held-out set is opened.

## Approval

The plan went through autoplan (gate rev 1) and was approved with every recommendation. Garry Tan's words on 2026-11-09, relayed by the Harness Evals coordinating agent:

> "do it"

That takes: tasks the model's home harness passed reliably (A1), the full pass-rate screen monthly and on any flag rather than weekly (B1), release gating as a proposed change to gstack and gbrain rather than something built here (C), and the reviewer fixes, including the gstack arm on the frontier Harbor rig.

## Question

1. **Breakage (every stable move).** Does the new release install, and does its first captured model request carry gstack's skills and router, or gbrain's tools?
2. **Exposure and cost (every stable move).** On 4 fixed tasks per model, did the skill-load or gbrain tool-call rate fall, or did cost per task rise by a quarter or more?
3. **Pass rate (monthly, and after any flag).** On the full list per model, did more tasks get worse than better, and does a fresh rerun confirm a drop of 10 points or more?
4. **Safety (gbrain).** Does the new release show a cross-scope read or a hidden-fact leak that the previous one did not?

Each comparison is inside one model and one harness: the previous release against the new one. The plain arm is the headroom reading and never changes a verdict.

## Design

| Suite | Model | Harness | Tasks | T1 probe | Digest | Source receipts |
|---|---|---|---:|---:|---:|---|
| gstack | claude-opus-5-5 | Claude Code 2.1.312 | 30 | 4 | 4 | frontier-harness merged trials |
| gstack | gpt-6.1-sol | Codex 0.165.0 | 30 | 4 | 4 | frontier-harness merged trials |
| gbrain | claude-opus-5-5 | Claude Code 2.1.312 | 12 | 4 | 4 | harness-zero-h2h trials |
| gbrain | gpt-6.1-sol | Codex 0.165.0 | 14 | 4 | 3 | harness-zero-h2h trials |
| gbrain | particle-1 (labelled, never raises REGRESSION) | Hermes Agent v2026.9.24 | 14 | none | 3 | Sol's list |

- **Arms, in the same window:** plain (no gstack, no gbrain, default preamble), the previous stable release and the new one. Each release is pinned by commit sha.
- **gstack tasks:** Terminal-Bench 2.1 (pin d49e28f1) tasks the model's home cell passed on both attempts, at $1.00 a trial or less, 30 drawn in a seeded order (seed `regression-canary-2026-11-09`). Lists and pools: [tasks-gstack.json](tasks-gstack.json).
- **gbrain tasks:** task set v0.3 dev-draw-2 (public dev tasks), every task the model's home cells passed on every repetition, at $1.00 or less. Lists: [tasks-gbrain.json](tasks-gbrain.json). gbrain installs told-scoped over the sidecar MCP route, member brain under member-sources scope.
- **T1 tasks** are the 4 cheapest of each list. **Digest tasks** are mid-difficulty tasks reported in a weekly line only, never in a verdict.
- **Install routes:** gstack `./setup --host claude` and `./setup --host codex`; gbrain's installer, told-scoped, per harness.

## Tiers

| Tier | When | Runs | Attempts |
|---|---|---|---:|
| T0 install | every stable move | all three arms install; skills, router or tools present; no model calls | none |
| T1 probe | every stable move | T1 tasks, previous and new, Opus and Sol | 1 |
| T2 screen | every 30 days per product, and at once after a T1 or safety flag | full list plus digest, all three arms, every model | 1 |
| T3 confirm | after a T2 pass-rate, cost or safety flag | full list, previous and new, the flagged model | 2 |

When T3 confirms and more than one stable move lies between the two releases, T3-size comparisons find the first bad release by binary search.

## The rule (frozen)

The thresholds are `thresholds` in prereg-canary.json and the code is `scripts/canary/decide.ts`.

- **BROKEN:** T0 fails, or any trial's first captured request is missing gstack's skills or router, or gbrain's tools.
- **WATCH:** at T1 or T2, more tasks got worse than better with an exact one-sided sign test p of 0.10 or less; or cost per task rose 1.25 times or more with a 90% lower bound of 1.10; or the skill-load or tool-call rate fell with Fisher p of 0.05 or less; or, for gbrain, a cross-scope read or leak the previous release did not have.
- **REGRESSION:** T3 confirms: a paired drop of 10 points or more with exact sign-flip p of 0.05 or less over task clusters, or the cost rise again with a 95% lower bound of 1.10, or the leak again.
- **REGRESSION at once (gbrain at or above 0.60.621.0):** gbrain 0.60.621.0 fixed the member-bound write leak into the default source, so on any release at or above it (`gbrain_leak_free_from`) one cross-scope read or hidden-fact leak on a frontier model is a REGRESSION without T3, whether or not the previous release leaked. The canary can only see this leak on tasks where a member's write could reach another member's read.
- **INCOMPLETE:** infra errors above 20% of an arm's trials, a crashed suite, a held lock, or a stable ref that moved during the run.
- **Clean plain arm:** the plain arm's images are checked before the run for any gstack install, and its traces are audited after it (`scripts/v04/clean-arm-audit.ts`). A plain trial that reached gstack or gbrain is contamination and is reported as such.

**Expected power** ([power.md](power.md), 10,000 seeded draws): on gstack, a 30-point drop is confirmed about 87% of the time and a release with no change is flagged by one screen about 4% of the time, under 0.1% after T3. On gbrain's shorter lists a 30-point drop is confirmed 31% (Opus) and 52% (Sol) of the time. Small pass-rate drops get through; install, exposure, cost and safety carry most of the sensitivity.

## The baseline

`scripts/canary/run.sh --baseline` runs T0, then T2 at 3 attempts on every arm, for:

- gstack previous 1.97.0.0 (e75a69c9e15164d090e080fa001dc515495ec350) and new 1.98.0.0 (910093087dec4877f99dfaed6600784942ed7a7b);
- gbrain previous 0.60.593.0 (`stable-v0.60.593.0`) and new 0.60.613.0 (`stable-v0.60.613.0`).

It sets the first screened release and reports, per suite and model:

1. **The real screen:** the rule above on previous against new, trials paired by task and attempt number, as `run.sh` computes it.
2. **Flip rate:** the share of tasks whose pass or fail differs between two attempts of the same arm, averaged over the three attempt pairs, per arm.
3. **False alarms, measured:** the T2 screen rule applied to every pair of attempts within one release arm (3 pairs, 2 release arms, per model), where nothing changed. Any flag there is a false alarm.
4. **False alarms, modelled:** `bun scripts/canary/simulate.ts --flip <measured flip rate>`, the screen and joint rates at the measured flip rate.
5. **Headroom:** plain-arm pass rate with its interval, and exposure rates per release arm.

## Verdict for the results pull request

- **KEEP** when T0 passes for every arm, every release-arm trial shows exposure, the plain arm is shown clean, infra errors stay at or under 20%, the measured false alarms are no more than 1 in the 12 same-release pairs of a suite, and the modelled screen rate at the measured flip rate is 10% or less with the joint rate 1% or less.
- **FIX-METHOD** when any of those fails and the cause is in the canary (name the fix): for example a flip rate high enough that the screen flags more than 10% of unchanged releases, or exposure that the capture cannot show.
- **CUT-CANDIDATE** for a suite's pass-rate tier (T2 and T3, not T0 or T1) when, at the measured flip rate, the chance of confirming a 30-point drop is under 30% for every frontier model of that suite. The install, exposure, cost and safety checks stay.

## Deviations from the approved plan

- **gbrain lists are 12 and 14 tasks, not 20.** Only that many tasks passed every repetition of the home cells. The lists take every one.
- **gbrain uses the v0.3 dev-draw-2 receipts** while the newer brain sets are being regenerated. A move to the new sets is a dated amendment with new lists.
- **gstack lists come from the frontier receipts as they stood on `harn50/frontier-results` at 85e32529** (trials sha256 in tasks-gstack.json), before that run's reruns. The results have since merged to main (#337, e947f7fbdf), with reruns of some attempts. Every row on main for every listed task and home cell is still a pass, so the lists stand as frozen here.
- **Plain-arm traces.** The trace audit now reads Claude Code and Codex event streams (`turn-NNNN.claude.jsonl`, `turn-NNNN.codex.jsonl`); before, it could not show a plain Claude Code or Codex trial clean even when nothing was found.

## The rig commit

`run.sh` refuses unless HEAD is `canary_rig`. That commit is this pull request's squash commit on main, which does not exist until it merges. So `canary_rig` is set by a dated amendment, committed and pushed on the results branch before the first counted trial, and the baseline runs from a worktree at `canary_rig` with `--prereg-ref` naming that amendment commit. The amendment changes `canary_rig` and nothing else. Any later rig change is another dated amendment and resets the previous-screened release.

## Receipts

- Full trial receipts go to the orphan branch `canary-receipts`, one directory per run plus `history.jsonl`. It is never merged, exported or opened as a pull request.
- Only this preregistration and the baseline results go through pull requests. Nightly results are not public.
- Every paid call goes through the metering proxy under a ledger lease (`leases` in prereg-canary.json).

## Amendments

**Amendment 1, 2026-11-09: the rig commit and two lease-safety fixes.** Committed on the results branch before the first counted trial.

- **canary_rig** names the results-branch commit that carries the fixes below, not this pull request's squash commit. The preregistration review left two critical findings open as disclosed notes, and the coordinating agent ruled that no canary run uses a rig without them.
- **A cut-off lease read** (`receipts.sh cat`) no longer leaves a partial ledger behind. It writes to a temporary file and moves it into place only when the read succeeds. `run.sh` then drops the ledger path, so the closing publish cannot push a truncated lease.
- **A receipts push that fails** no longer unlocks and drops the month's spend. `run.sh` pushes the lease ledger alone (`receipts.sh put-lease`, with the same token scan) and unlocks only when that lands. Otherwise it keeps the lock, and the next run stops on the stale lock (`receipts.sh lock` exit 7) with no tier until someone reconciles it (docs/canary.md).
- **The automation** stays disabled until the results pull request carrying this amendment has passed /ship and merged. Until then runs are supervised only, with the lease file reconciled by hand after each one. This replaces "enabled after its first manual run passes" in `schedule.automation`.
- **Deviation:** "The rig commit" above says the amendment changes `canary_rig` and nothing else. This amendment also changes the `schedule.automation` wording, on the coordinating agent's ruling. Thresholds, task lists, tiers and leases are unchanged.
- Tests: `tests/canary-core-run.test.ts` covers the cut-off read, the refused publish and the kept lock, using `tests/fixtures/canary-core/stub-git.sh`.

**Amendment 2, 2026-11-12: arms interleaved in time, and the exposure rule paired by task.** Committed on the results branch before the first trial of the re-baseline, on the coordinating agent's approval (option A).

- **Why.** The first baseline (run baseline-2026-11-11-r2) flagged 2 of the 12 same-release attempt pairs of the gstack suite, both on GPT-6.1 Sol's new-release arm (attempt 1 against 3 and 2 against 3), both on the skill-load rule. Sol's new arm loaded a skill in 12 of 34 trials in attempt 1, 13 in attempt 2 and 4 in attempt 3, and attempt 3 ran in one block, 15:00 to 16:00 UTC on 2026-11-12. The arms ran one after another, so a change over time in the model or the network lands on one arm alone and reads as a release effect. The cause of the attempt 3 drop is not known.
- **gstack: arms interleaved.** The tier spec sets `interleave_chunk` to twice its concurrency. `scripts/frontier-harbor/plan.ts` then runs each attempt chunk by chunk: chunk i of every cell (each model's plain, previous and new arm), at most that many tasks a job, the cell order reversed on odd chunks. Every arm's trials are spread over the tier's wall time. Trials, task lists and attempts are unchanged; only the order and the Harbor job names (`<cell>__a<n>__k<i>`) change.
- **gbrain: arms at the same time.** `scripts/canary/gbrain/run-tier.sh` builds the harness images once and runs the previous, new and plain shards at once on the same VM. Each arm's spec has its own run id (`<run-id>-<arm>`), so each has its own Docker network. The tier lease is split by weight, 1.6 for a release arm and 1.0 for the plain arm (the product-to-plain cost ratio the leases are priced on), and a shard never spends past its share. When any share would be below $8 (one worst-case Opus call, which the metering proxy would refuse), the arms run in turn as before.
- **gbrain T1 lease: $15 to $20.** At $15 the two release arms' shares ($7.50 each) are below $8, so T1 would run in turn. At $20 they are $10 each. Every tier still reserves its lease and settles to the metered spend.
- **Exposure rule paired by task.** The skill-load (gstack) and gbrain tool-call rule now pairs trials by task and attempt, as the pass screen does. A task is lost when the new release loaded a skill or called a gbrain tool in fewer of its paired trials than the previous one, and gained in the reverse case. The rule flags WATCH when more tasks were lost than gained with an exact one-sided sign test p of 0.05 or less (`exposure_alpha`, unchanged). This replaces the unpaired Fisher test in "The rule (frozen)". Consequence: a T1 list has 4 tasks, so the smallest possible p at T1 is 0.0625 and the rule cannot fire at T1. A release that stops loading skills is caught at its next T2, or at once by BROKEN when its skills or tools drop out of the first request.
- **What pairing alone does on the first baseline.** Re-scored with the paired rule before this amendment was frozen, the two Sol pairs still flag: attempt 1 against 3 has 9 tasks lost and 1 gained (p 0.0107), and 2 against 3 has 9 lost and 0 gained (p 0.0020). The real screen also changes: Sol's skill loads went from 40 of 102 trials (1.97.0.0) to 29 of 102 (1.98.0.0), Fisher p 0.069 and not flagged under the frozen rule, but 13 tasks lost and 4 gained under the paired rule, sign test p 0.0245, a WATCH. Attempt 3 of the new arm, with its 4 loads, sits inside that comparison too. Pairing removes differences in task mix, not drift over time, so the interleaving is the fix this amendment tests, and the re-baseline shows whether the drop between releases holds once the arms share their hours.
- **Opus.** Claude Opus 5.5 loaded no gstack skill in any of the 203 release-arm trials of the first baseline. While that holds, the skill-load rule cannot fire on Opus, and for Opus the canary measures the cost of listing gstack, not of using it.
- **The re-baseline.** One supervised run of `scripts/canary/run.sh --baseline`, same releases and commits as "The baseline", from a worktree at the `canary_rig` this amendment sets, under a new ledger, `leases.baseline_ledger` = canary-baseline-2 (the first baseline's ledger, canary-baseline, keeps its $400 cap and its spend). `leases.baseline_usd` is unchanged. The verdict rules in "Verdict for the results pull request" are applied to the re-baseline. The first baseline is reported in full beside it, with its 2 of 12 false alarms.
- **Receipts.** `scripts/canary/receipts.ts prepare` also keeps a gbrain tier's raw trial trees (`shards/<arm>/trials`) and its mid-run VM copy (`vm-replica`) off the receipts branch, with their hashes, and records a symbolic link by its target instead of following it. The first baseline's gbrain T2 publish stopped on a dangling link Codex left in its trial state. This changes what is published, never a trial or a verdict.
- **Smoke before freezing.** The gbrain arms at once ran on one real Ubicloud VM from dcb70d8dfc, which differs from the rig commit only in the receipts fix above: T1, one task, Opus only, all three arms (run smoke-amend2-gbrain, uncounted, $0.54 metered by its shard ledgers, outside the canary ledgers). All three shards started within a minute of each other on their own networks, each trial completed, both release trials showed gbrain exposure and the plain arm's audit passed.
- **canary_rig** is set to this amendment's code commit (a3db97a265bf050c37efe781645c8a680320031b) by the commit that follows it, as in amendment 1. The tag `canary-rig-2` on origin keeps that commit reachable after the results pull request is squash-merged.
- **Unchanged:** thresholds other than the exposure test, task lists, tiers, attempts, arms and the automation, which stays disabled until the results pull request has passed /ship and merged.
- Tests: `tests/canary-gstack.test.ts` and `tests/frontier-harbor-rerun.test.ts` (interleaved jobs, the chunk suffix is not a stage), `tests/canary-gbrain.test.ts` (arms at once or in turn, per-arm run ids), `tests/canary-core.test.ts` (the paired exposure rule) and `tests/canary-core-run.test.ts` (the baseline ledger name).

**Amendment 3, 2026-11-13: gstack cells in parallel lanes, after the first re-baseline attempt ran too slowly.** Committed on the results branch before the first trial of the second re-baseline attempt. It replaces amendment 2's gstack chunks for every tier whose lease holds one worst-case call per cell. The rest of amendment 2 stands.

- **Why.** Under amendment 2, each gstack Harbor job waits for its slowest task before the next job starts. The first chunks (8 tasks each) took 80, 71 and 88 minutes, about as long as a whole 34-task job took in the first baseline (63 to 95 minutes). At that rate the re-baseline's 90 jobs would have run for about four days.
- **The stopped attempt.** Run baseline-2026-11-13-a2 ran from 01:14 to 06:05 UTC and was stopped by hand after 3 Opus chunk jobs (24 trials) had finished and the first Sol plain chunk had started. The results were lost with the VM. The controller was told to stop before the remote session ended, so its exit handler skipped the results pull, and the VM's ledger went with the VM. Its spend was metered on the VM but never read back. The estimate from the first baseline's mean cost per trial in each cell is about $9, and at the first baseline's most expensive trial per cell it would be $44. The canary-baseline-2 ledger keeps that run's $300 reservation unsettled. Its receipts (runs/baseline-2026-11-13-a2) hold only the logs and an INCOMPLETE verdict, and no trial of it is counted.
- **gstack: one lane per cell.** When the tier lease holds one worst-case call for every cell, the spec sets `parallel_cells` and concurrency 1. `scripts/frontier-harbor/vm-run.sh` then runs one lane per cell, all lanes at once, and each lane runs its cell's attempts in order, one trial at a time. The previous, new and plain arms of a model share the same hours from the first trial to the last. The headroom floor counts one worst-case call per lane. Smaller leases (the gstack T1 lease, $10 for 4 cells) keep amendment 2's chunks.
- **Load.** The VM runs 6 trials at once (one per cell), where the first baseline ran 4.
- **The re-baseline** runs as baseline-2026-11-13-a3 under a new ledger, `leases.baseline_ledger` = canary-baseline-3, $400 cap, with `leases.baseline_usd` unchanged.
- **canary_rig** is set by the commit that follows this one, and the tag `canary-rig-3` on origin keeps that commit reachable.
- **Pre-smoke.** Run smoke-amend3-gstack (uncounted) ran T1 at rig cb982929 on one Ubicloud VM with one task (code-from-image) for each model, the three arms and a $50 lease. The 6 lanes started within half a second of each other (06:26:42 UTC) and ended between 06:29:10 and 06:29:36. All 6 trials passed, the release arms had gstack in their first request and the plain arms did not, the spend was $0.47 and the VM was destroyed. An earlier try of the same smoke stopped before any VM or paid call because the controller machine's disk was full.
- Tests: `tests/canary-gstack.test.ts` (a lease of $60 runs 6 lanes at concurrency 1, the floor counts 6 calls, and `parallel_cells` and `interleave_chunk` can't both be set).

**Amendment 4, 2026-11-14: a full gstack rerun after a provider outage drained the re-baseline's lease.** Committed on the results branch before the first trial of run baseline-2026-11-14-a4. It changes only the baseline ledger and the gstack baseline lease. The rig (`canary_rig`, cb982929), the tasks, the arms, the attempts, the parallel lanes of amendment 3 and every rule stay as they were.

- **What happened in baseline-2026-11-13-a3.** Between about 09:47 and 11:00 UTC on 2026-11-13, Anthropic answered 47 Opus calls in 15 gstack trials with HTTP 503 ("credential validation failed"). Those trials ended as harness or infra errors. The metering proxy settles a 5xx at $0 only when its body is a known not-billed error envelope, which for Anthropic means a 500 or 529, so each of those 503s kept its full worst-case reservation (about $3.16 per call). That held $143.61 on Opus, and 8 Sol calls that came back without usage held $12.85 more. The ledger booked $298.58 for gstack, of which about $142 was metered spend, and the $300 gstack lease stopped the run at 18:53 UTC. The last 167 trials, mostly attempt 3, ended as lease stops.
- **Result of a3.** gstack: INCOMPLETE. 175 of 612 trials are infra failures, so the same-release comparisons can't be scored, the previous-release ones not even for attempts 1 and 2. Its receipts (runs/baseline-2026-11-13-a3) are kept and reported, and none of its gstack trials is counted. gbrain ran after gstack in the same run and finished clean (450 trials, verdict OK), and that result stands as the gbrain re-baseline.
- **The rerun.** baseline-2026-11-14-a4 runs gstack only (`run.sh --baseline --products gstack`), T0 then T2 at 3 attempts, all 6 cells at once in their own lanes, from the same rig.
- **Ledger and lease.** `leases.baseline_ledger` = canary-baseline-4 and `leases.baseline_usd.gstack` = $450, up from $300, so that a provider outage of the same size can be held without stopping the run. `leases.baseline_usd.gbrain` stays at $100. run.sh caps a baseline ledger at the sum of the baseline leases, so canary-baseline-4's cap is $550. gbrain doesn't run in a4, so the $450 gstack lease is the binding limit.
- **Not changed here.** How the proxy settles provider error responses is out of scope for this experiment and is handled separately. The canary's lease remains the runaway guard.

**Amendment 5, 2026-11-15: rig 4, four fixes to the canary's own plumbing before the nightly is switched on.** Committed before the nightly automation is enabled and before any nightly run. It changes `canary_rig` and nothing else, as "The rig commit" requires. No rule, threshold, task list, tier, attempt count, arm, lease or model changes.

- **Why.** The baseline runs hit four faults in the canary's plumbing, none of them in a trial or a verdict. Unattended, each would make a nightly fail, hide why it failed, or leave a paid VM running.
- **Receipts staging.** `scripts/canary/receipts.sh publish` copied the whole run dir (about 10 GB for a gbrain baseline) into a temporary directory before `receipts.ts prepare`, which then leaves the big trial trees out anyway. On baseline-2026-11-13-a3 that filled the disk and the publish failed. It now stages the run dir with hard links, which is safe because prepare only reads its source, and copies only the files that cannot be linked (another filesystem, or a file `fs.protected_hardlinks` refuses). When staging fails anyway, publish exits 8 with "could not stage the run dir for publishing: ... check free disk space".
- **The alert's reason.** When the receipts push failed, the alert line "Receipts push failed (...)" quoted the last line of the publish log. On a3 that line was blank, so the alert read "()". It now quotes the last non-blank line with colour codes stripped, and says to check free disk space when publish exited 8.
- **No VM left behind by a capacity retry.** `scripts/canary/gbrain/remote.sh` and `scripts/canary/gstack/lib.sh` move a tier to the next location when its VM never got past "waiting for capacity". They now do that only when the runner confirmed the VM gone: a `UBICLOUD: left=0` line, and no "failed to destroy" or "cleanup not confirmed". At the end they check every VM name any try used or reported, take down any that is still listed, and log the exact down command when that fails. Before, remote.sh checked only the last VM name, after a retry had renamed it, and lib.sh checked none.
- **Stopping a gbrain tier.** `scripts/canary/gbrain/run-tier.sh` runs its arm shards at once (amendment 2) but had no handler for TERM or INT, so stopping it left the shards running. While the arms run it now sends TERM to every process under each arm, the shard and the `bun runner/run.ts` it runs in the foreground included (the shard's own TERM trap acts only once that runner exits), on TERM or INT, waits up to 10 minutes, kills whatever still runs, and exits non-zero (143 or 130). It also removes the tier's `trials.jsonl`, which may hold only some of the shards' rows, so `run.sh` settles the tier at its whole reservation instead of $0 or a subtotal; the shards may already have spent money it would not record. The handler stays set until every arm's rows have been added to that file.
- **A failed results copy.** When copying a tier's results back from its VM fails (a full disk, for example), `remote.sh` used to exit under `set -e` before its final VM check, and `lib.sh` could leave a partial `trials.jsonl`. Both wrappers now log the failure, remove `trials.jsonl` so the lease charges the whole reservation, exit non-zero (3, unless the tier had already failed with another code), still run the VM check, and keep the pulled results where they landed. Before, `lib.sh` deleted them after a failed copy, and the VM holding the originals was already gone.
- **The omitted-manifest line.** Rig 3 (cb982929) predates the `receipts.sh` line that moves `omitted-manifest.json` into `runs/<id>/`, so on rig 3 the list of files prepare left out, with their hashes, never reached `canary-receipts`. Rig 4 carries that line.
- **How rig 4 is built.** Commit 5462712fec735b7adc060b09187e99e1abe04efe starts from cb982929 (tag `canary-rig-3`) in four commits (5c739e2c; fc4e5e7d with the review fix to stopping a gbrain tier; then 17460ec3 with the final review's fixes to a stopped tier's lease settlement and to a failed results copy; then 5462712f with the last review's fixes to a stop during aggregation and to keeping the pulled results after a failed copy) and takes this branch's `scripts/canary/`, `tests/canary-*`, `tests/fixtures/canary-core/` and `prereg-canary.json` (as it stood before this amendment), except `scripts/canary/gstack/spec.ts` and `tests/canary-gstack.test.ts`, which keep rig 3's gstack parallel cell lanes (amendment 3). In the canary's own files the rig differs from main only in that gstack lane code until the lanes move to main. The rest of its tree is still cb982929's, including the frontier-harbor files the gstack suite runs through (among them `plan.ts`, `broker.ts` and `vm-run.sh`, which carry the lanes and chunks), so later changes on main outside the canary's files reach the canary only when a rig is cut from main.
- **What the reset of the previous-screened release means for the first nightly.** `canary_rig_rule` says a rig change resets the previous-screened baseline. Nothing is deleted or rerun to do that. `run.sh` reads its state from `history.jsonl` on `canary-receipts`, which does not record a rig, so the first nightly from rig 4 takes the last screened releases there as the previous release: gstack 1.98.0.0 (91009308, from baseline-2026-11-14-a4) and gbrain 0.60.613.0 (98dda48f, from baseline-2026-11-13-a3). Those were screened on rig 3 only, so that first run screens them again on rig 4: T0 on both arms, then T1 with the previous release and the current stable release side by side, from the same rig. No verdict compares trials from two rigs, because every tier runs both releases in the same run. T2 is not due until 30 days after the baselines (gbrain 2026-12-13 06:32 UTC, gstack 2026-12-13 22:28 UTC), so before then a T2 runs only after a T1 or safety flag. The one reading carried across rigs is particle-1's "two screens in a row" on gbrain, which reads the a3 T2 verdict; particle-1 never raises REGRESSION.
- **Not run.** No Ubicloud smoke ran on rig 4. The fixes are covered by keyless tests only.
- **canary_rig** is set to 5462712fec735b7adc060b09187e99e1abe04efe by this commit. The tag `canary-rig-4` on origin will keep that commit reachable.
- Tests: `tests/canary-receipts-staging.test.ts` (hard links, copies of what cannot be linked, exit 8 on a staging failure, source files untouched), `tests/canary-core-run.test.ts` (the alert's reason from a blank, colour-coded log, and a staging failure end to end), `tests/canary-remote-capacity.test.ts` with `tests/fixtures/canary-core/stub-ubi-runner.sh` (no retry when cleanup was not confirmed, every reported VM taken down, the down command logged on failure, for both wrappers) and `tests/canary-gbrain-stop.test.ts` (TERM and INT stop the arm shards and the runners they run in the foreground and leave no `trials.jsonl`, including a stop while the shards' rows are being added, with --fake); `tests/canary-remote-capacity.test.ts` also covers a failed results copy (no `trials.jsonl`, the leftover VM taken down, and the gstack wrapper keeping the pulled results).

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

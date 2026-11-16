# Regression canary baseline: can a cheap check catch a worse gstack or gbrain release?

**Takeaways**

- **gbrain's canary is ready to run (KEEP).** Two full baselines, 900 trials, found 0 false alarms in 24 same-release comparisons, gbrain tools in every release-arm trial and no infra errors. You can trust a gbrain WATCH from it.
- **gbrain's pass-rate tier is weak, and the other checks carry it.** On gbrain's short task lists (12 and 14 tasks) a 30-point pass-rate drop is confirmed only 42% of the time on Opus and 55% on Sol. Install, tool-call, cost and safety checks do most of the catching there.
- **gstack's canary is ready to run too (KEEP), once every arm runs in the same hours.** The first gstack baseline raised 2 false alarms in 12 (FIX-METHOD), both on Sol's skill-load rate, when arms ran one after another. The rerun ran all six cells side by side and raised 0 false alarms in 12, with 0 infra errors in 612 trials. If you build a release canary, run old and new side by side, not one after the other.
- **Claude Opus 5.5 in Claude Code never loaded a gstack skill on these tasks: 0 of 203 trials in the first baseline and 0 of 204 in the rerun.** The skills were listed in every first request. So for Opus the canary measures the cost of listing gstack, not of using it. If you ship skills to Opus, check that they get loaded at all.

**What this is.** gstack and gbrain publish a new stable release every few days. The canary reruns a fixed set of tasks on the previous and the new release, plus an arm with neither installed ("plain"), and flags a release that does worse. This page reports its baseline: the one supervised run that sets the first screened release and measures how often the canary would cry wolf when nothing changed. The design is in [PREREGISTRATION.md](PREREGISTRATION.md), with four dated amendments made during the baseline.

## What ran

| Run | Suite | Trials | Status | Counted |
|---|---|---:|---|---|
| baseline-2026-11-11-r2 | gstack | 612 | finished | baseline 1 |
| baseline-2026-11-12-gbrain-t2 | gbrain | 450 | finished | baseline 1 |
| baseline-2026-11-13-a3 | gbrain | 450 | finished | re-baseline |
| baseline-2026-11-13-a3 | gstack | 612 planned | stopped at its lease, INCOMPLETE | no |
| baseline-2026-11-14-a4 | gstack | 612 | finished | re-baseline |

- **Releases:** gstack 1.97.0.0 (e75a69c9) against 1.98.0.0 (91009308); gbrain 0.60.593.0 (27f8b9d6) against 0.60.613.0 (98dda48f).
- **Rig:** the re-baselines (a3 and a4) ran from commit cb982929 (tag canary-rig-3), the canary_rig the preregistration named then. Baseline 1 ran from the rig amendment 1 named, 338406c6. Amendments 5 and 6 move canary_rig to rig 5 (175a6a78, built on cb982929 with fixes to the canary's plumbing and its lease accounting), so the nightly will run from rig 5 once it is switched on, because run.sh refuses any other commit. The gstack suite's parallel cell lanes are in every rig commit since cb982929 but not yet on main.
- **Models and harnesses:** Claude Opus 5.5 in Claude Code 2.1.312 and GPT-6.1 Sol in Codex 0.165.0, plus particle-1 in Hermes Agent on gbrain, reported but never able to raise a flag.
- **Tasks:** 30 Terminal-Bench 2.1 tasks per model for gstack; 12 (Opus) and 14 (Sol) task set v0.3 dev tasks for gbrain; plus a few harder "digest" tasks reported on their own. Every task is one the model had passed every time before, so a drop stands out.
- **Every task ran 3 attempts per arm** (T2 at 3 attempts), on one Ubicloud VM per suite run.
- **Two runs don't count.** a2 was stopped by hand after 24 trials because it was too slow, and a3's gstack half was stopped by a provider outage (below).

## gbrain: KEEP

| | Opus 5.5, baseline 1 | Opus 5.5, re-baseline | Sol, baseline 1 | Sol, re-baseline |
|---|---|---|---|---|
| Passes, 0.60.593.0 to 0.60.613.0 (of 3 attempts x tasks) | 36 to 36 of 36 | 36 to 36 of 36 | 40 to 42 of 42 | 42 to 41 of 42 |
| Plain arm passes | 35 of 36 | 36 of 36 | 42 of 42 | 42 of 42 |
| gbrain tool called, per release arm | 48 of 48 | 48 of 48 | 51 of 51 | 51 of 51 |
| Flip rate, release arms | 0% | 0% | 2.4% | 2.4% |
| False alarms, of 6 same-release pairs | 0 | 0 | 0 | 0 |
| Chance a 30-point drop is confirmed (modelled) | 42% | 42% | 55% | 55% |
| Cross-scope reads or leaks | 0 | 0 | 0 | 0 |

- **The real screen is OK in both runs.** No frontier model's pass screen flagged (the closest was Sol in the re-baseline, 1 task worse and 0 better, p 0.50), cost didn't rise by a quarter (Opus cost rose 1.16 times in the re-baseline, 90% interval 1.09 to 1.24, under the 1.25 bar), and tool calls didn't fall.
- **Every KEEP condition holds** in both runs: install checks passed, every release-arm trial called a gbrain tool, the plain arm was clean, 0 infra errors, 0 false alarms, and the modelled false-alarm rate at the measured flip rate is under 0.1% for one screen.
- **Not a CUT-CANDIDATE:** the pass-rate tier would be one if a 30-point drop were confirmed under 30% of the time for every frontier model. It's 42% and 55%.
- **particle-1 (Hermes)** is noisier: 38 to 39 of 42 in baseline 1 and 40 to 36 in the re-baseline, with an 11.9% flip rate. In baseline 1 its new-release arm had 3 hidden-fact leaks and its previous-release arm none (0 in the re-baseline). It is reported only and can't flag a release.
- **Headroom is near zero on purpose.** The plain arm passes 35 to 42 of 36 to 42, because the lists hold tasks the model already passes. The canary asks whether a release got worse, not whether gbrain helps.

## gstack, baseline 1: FIX-METHOD

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Passes, 1.97.0.0 to 1.98.0.0 (of 90) | 85 to 83 (4 tasks worse, 2 better, p 0.34) | 84 to 86 (2 worse, 2 better, p 0.69) |
| Cost per task, new over previous (90% interval) | 0.92 (0.88 to 0.96) | 0.97 (0.94 to 1.00) |
| Plain arm passes (of 90) | 84 | 88 |
| Trials that loaded a gstack skill, previous / new | 0 of 101 / 0 of 102 | 40 of 102 / 29 of 102 |
| Flip rate, release arms | 8.9% | 5.6% |
| False alarms, of 6 same-release pairs | 0 | 2 |
| Chance a 30-point drop is confirmed (modelled) | 94% | 96% |

- **The real screen was OK** under the rule as first frozen: no pass-rate, cost or skill-load flag. 1 of 612 trials was an infra error.
- **It fails one KEEP condition: 2 false alarms in the 12 same-release pairs, where the bar is 1.** Both were Sol's new-release arm, attempt 3 against attempts 1 and 2, on the skill-load rule. Sol loaded a skill in 12 and 13 of 34 trials in attempts 1 and 2 and in 4 of 34 in attempt 3.
- **Why: the arms ran in separate hours.** Attempt 3 of the new arm ran as one block, 15:22 to 16:34 UTC on 2026-11-12 (amendment 2 says 15:00 to 16:00; it stays as frozen). Any change over time in the model or the network then lands on one arm and reads as a release effect. The cause of the drop itself is unknown; this design can't tell drift from chance.
- **Fix named and tested (amendment 2 and 3):** run every arm in the same hours, and pair the skill-load rule by task as the pass screen already was. Under the paired rule alone, the first baseline's real Sol screen becomes a WATCH: 13 tasks lost a skill load and 4 gained one, sign test p 0.025. Pairing removes differences in task mix, not drift, so the rerun is what decides.

## gstack, re-baseline (a4): KEEP

All six cells (each model's plain, previous and new arm) ran at once, one lane each, from 23:37 on 2026-11-13 to 15:22 UTC on 2026-11-14 (first trial start to last trial end).

| | Opus 5.5 | GPT-6.1 Sol |
|---|---|---|
| Passes, 1.97.0.0 to 1.98.0.0 (of 90) | 85 to 82 (3 tasks worse, 2 better, p 0.50) | 85 to 87 (1 worse, 3 better, p 0.94) |
| Cost per task, new over previous (90% interval) | 0.89 (0.80 to 0.98) | 0.97 (0.94 to 1.00) |
| Plain arm passes (of 90) | 83 | 88 |
| Trials that loaded a gstack skill, previous / new | 0 of 102 / 0 of 102 | 35 of 102 / 39 of 102 |
| Flip rate, release arms | 5.6% | 4.4% |
| False alarms, of 6 same-release pairs | 0 | 0 |
| Chance a 30-point drop is confirmed (modelled) | 96% | 96% |

- **The real screen is OK** under the amended rule: no pass-rate, cost or skill-load flag. Sol's paired skill-load comparison has 4 tasks lost and 7 gained (p 0.89).
- **Every KEEP condition holds.** Install checks passed, gstack was listed in the first request of all 408 release-arm trials, the plain arms were clean (no trial listed or called gstack), 0 infra errors in 612 trials, 0 false alarms in 12, and the modelled false-alarm rate for one screen is 0.5% (Opus) and 0.3% (Sol), with the joint rate 0.
- **Not a CUT-CANDIDATE:** a 30-point drop is confirmed about 96% of the time on both models.
- **Sol's skill-load drop did not come back.** In baseline 1, Sol's new-release arm loaded a skill in 12, 13 and 4 of 34 trials across attempts 1 to 3. Run in the same hours as the other arms, it loaded in 12, 15 and 12, and the previous release in 12, 13 and 10. So the first baseline's drop, and its WATCH under the paired rule, came from when that attempt ran, not from the release.
- **Opus cost per task fell 11% with 1.98.0.0** (interval 0.80 to 0.98), as it fell 8% in baseline 1 (0.88 to 0.96). A fall never raises a flag; it is reported because two runs agree on it.

## Why null? (no pass-rate difference between releases, or with and without the product)

Neither suite shows a pass-rate difference between releases, or between a release and the plain arm. One check of why, as our evals rule asks:

- **Did the model use it?** gbrain: yes, a tool call in every release-arm trial. gstack on Sol: a skill load in 28% to 39% of trials. gstack on Opus: never.
- **Do the tasks fit?** They were picked for stability, not for gstack or gbrain: tasks the model already passes every time. That is right for a canary and wrong for measuring benefit.
- **Enough samples and headroom?** Enough to see a 30-point drop on gstack (94% to 96%), not on gbrain's short lists (42% to 55%). Headroom is 2 to 7 failures in 90 on gstack's plain arm, and 0 to 1 on gbrain's for the frontier models (36 trials for Opus, 42 for Sol; particle-1 2 to 4 in 42).
- **Does the frontier model already do it unaided?** Yes, on these tasks, by construction.
- **So no verdict on whether gstack or gbrain helps comes from this page.** The verdicts above are on the canary as a method.

## How far to trust it

- **Skill loads are counted from tool-call arguments.** A trial counts as loading a gstack skill when a call reads a skill path, including a Codex shell command. A model that pasted a skill's body in some other way wouldn't be counted. A check of the captured request logs for skill text coming back in a tool result found none outside the counted trials. In baseline 1 (611 of its 612 trials had a request log): Sol 40 of 40 and 28 of 29 (the 29th made the calls but got no skill text back), Opus and plain 0. In the rerun, on the trials whose logs survived (see deviation 9): Sol previous 34 of 35 (same pattern), Opus 0 of 204. The method is in results/skill-body-scan.ts.
- **The exposure rule can't fire on a 4-task list.** With 4 tasks the smallest possible sign-test p is 0.0625, above the 0.05 bar, so the T1 probe can't flag a skill-load drop. A release that stops loading skills is caught at the next T2, or at once if its skills drop out of the first request.
- **Opus's skill-load rule can't fire while Opus loads none.** On Opus the canary checks install, listing, pass rate and cost.
- **Cost is the canary's own spend** through the metering proxy. Spend held by failed provider calls counts as spend in the ledger (see a3 below).

## Deviations and failures, in order

1. **Lost first attempt, 2026-11-11.** The first baseline run died after 6 hours when the controlling machine slept. Its keep-awake watcher had timed out. The VM's metered $47.26 over 144 trials (by trial key in its saved proxy log) is outside the ledger, and no trial counts. Rerun as r2.
2. **gbrain baseline 1 ran outside run.sh, in another region.** Ubicloud had no standard-16 capacity in eu-central-h1 or eu-north-h1, so gbrain T2 ran by hand at the same rig commit on a VM in us-east-a2, because run.sh can't reopen a shared baseline lease for one product.
3. **Receipts published by hand, with two corrections.** run.sh's own push refused r2: the gbrain T0 output holds token-shaped test values and the tree is about 9.4 GB. The hand publish withheld 54 token-matching files (each listed in WITHHELD.md), left 14 raw trees and tarballs on the controller with their hashes (10 trial and job trees and 4 arm install tarballs, in OMITTED.md), and corrected a phantom $100 charge for a gbrain VM that never ran (CORRECTIONS.md). Amendment 2 fixed the receipts step for gbrain trial trees.
4. **Amendment 1's wording.** It changed the automation wording as well as the rig commit, which "The rig commit" said an amendment would not. Disclosed in the amendment.
5. **a2 stopped by hand, results lost.** Amendment 2's chunked schedule was too slow (about four days for the run). The stop signal reached the controller before its results pull, so 24 finished trials and the VM's ledger were lost with the VM. Estimated spend about $9, at most $44; the canary-baseline-2 ledger still shows its $300 reservation unsettled. Amendment 3 replaced the chunks with one lane per cell and moved the rig tag (canary-rig-3).
6. **a3's gstack half stopped by a provider outage.** 47 Opus calls in 15 trials got HTTP 503 between 09:47 and 13:32 UTC on 2026-11-13, and 8 Sol streams failed before usage. The metering proxy kept each failed call's worst-case reservation, $156.46 in all, so the $300 lease began refusing calls at 14:02 UTC and stopped the run at 18:53 UTC, with $142.12 actually spent. 175 of 612 trials were infra failures, and the same-release pairs couldn't be scored. Full counts and method: [results/a3-gstack-incomplete.md](results/a3-gstack-incomplete.md). a3's gbrain half ran clean and stands.
7. **Amendment 4's outage wording overstates the 503 message and window.** It says "credential validation failed" for all 47 calls and a window to about 11:00. Claude Code printed that message in 8 of the 15 trials (its session logs record it in 14), and the last 503 came at 13:32. The amendment's "about $3.16" per call (the 47 averaged about $3.06) and "last 167 trials" (the lease stops began at 13:53 and ran in all six lanes) are wrong too, and 4 of the 15 trials did not end as harness or infra errors. Corrected in the a3 file; the amendment stays as frozen.
8. **a4's ledger cap is $550, not $500.** run.sh caps a baseline ledger at the sum of its baseline leases ($450 gstack plus $100 gbrain). gbrain didn't run in a4, so the $450 gstack lease was the binding limit.
9. **a4 lost 282 raw trial folders to a full disk on the controlling machine.** After the VM finished, copying its results onto the controller ran out of disk space. The scored records came through whole: every one of the 612 trial records (with the exposure and plain-arm checks computed on the VM), the proxy usage log and the ledger. The raw per-trial folders (logs, captured requests) were lost for all 102 of Sol's new-release trials and for 90 of each model's 102 plain trials, and the arm metadata and spec files were saved empty. The VM had already been destroyed, so they can't be recovered. Nothing in the verdict reads them, but the skill-text cross-check above could only cover the surviving trials.
10. **a4 held $24.13 on 12 failed calls**, under the same proxy rule as a3: 8 Sol streams that ended with invalid_request, all on the task model-extraction-relu-logits (as in a3), and 4 Opus connection errors. No provider 503s. All 4 Opus errors came in one trial, the run's last (Opus previous release, largest-eigenval, attempt 3). It ended as a harness error and counts as a fail under the frozen rule, so it is one of Opus's 2 better tasks. Counted as a pass instead, Opus would be 86 to 82 (3 worse, 1 better, p 0.31), still OK.

## Spend

| Run | Ledger | Booked | Notes |
|---|---|---:|---|
| baseline-2026-11-11 (lost) | outside | $47.26 | metered on the VM, 144 trials |
| baseline-2026-11-11-r2, gstack | canary-baseline | $202.61 | |
| baseline-2026-11-12-gbrain-t2 | canary-baseline | $57.99 | |
| baseline-2026-11-13-a2 (stopped) | canary-baseline-2 | unknown | about $9, at most $44; $300 reservation unsettled |
| baseline-2026-11-13-a3 | canary-baseline-3 | $353.58 | gstack $298.58, of which $156.46 held by failed calls; gbrain $55.00 |
| baseline-2026-11-14-a4 | canary-baseline-4 | $213.47 | $24.13 held by 12 failed calls, so $189.34 metered |
| Smokes (amendments 2 and 3) | outside | $1.01 | $0.54 and $0.47 |

A routine gstack T1 probe is leased at $10 and a gbrain one at $20; a monthly T2 (one attempt per arm) at $105 (gstack) and $40 (gbrain). These three-attempt baselines metered about $190 to $203 (gstack) and $55 to $58 (gbrain), so a one-attempt T2 should meter about a third of that.

## Receipts

- Full trial receipts are on the canary-receipts branch, one directory per run under runs/, with each run's ledger, proxy usage log, verdict and summary. That branch is never merged or exported.
- [results/trials/](results/trials/) holds each counted run's T2 trial records, the same files as on the receipts branch.
- [results/](results/) holds the scored reports this page reads:
  - baseline-1-gstack.json and baseline-1-gstack-paired.json (the first baseline under the rule as first frozen, and rescored with the paired exposure rule);
  - baseline-1-gbrain.json, rebaseline-gbrain-a3.json, rebaseline-gstack-a4.json;
  - a3-gstack-partial.json and a3-gstack-incomplete.md;
  - skill-body-scan.ts and skill-body-scan-r2.json and skill-body-scan-a4.json (the rerun's covers only the trials whose folders survived).
- Rebuild a report keylessly from a run's trials with scripts/canary/baseline-report.ts (command under Method); `bun run verify --run 2026-11-09-regression-canary` rebuilds all five that the current script can.

<details><summary>Method</summary>

- **Pairing.** Trials are paired by task and attempt number. A task is worse when the new release passed fewer of its paired attempts than the previous one, and better in the reverse case. The pass screen is an exact one-sided sign test over worse and better tasks, flagging at p 0.10 or less.
- **Skill-load rule.** Baseline 1 was scored first under the rule as frozen (Fisher's exact test on trial counts, p 0.05) and then under amendment 2's paired rule (the same sign test as the pass screen, over tasks that lost or gained loads, p 0.05). The re-baselines use the paired rule.
- **Cost.** The ratio of new to previous mean cost per task, with a 90% bootstrap interval over tasks. It flags at 1.25 times or more with a lower bound of 1.10.
- **Flip rate.** For each arm, the share of tasks whose pass or fail differs between two attempts, averaged over the three attempt pairs. The release flip rate is the mean of the previous and new arms.
- **Measured false alarms.** The screen rules applied to every pair of attempts inside one release arm (3 pairs, 2 arms, 2 models: 12 per suite), where nothing changed.
- **Modelled rates.** scripts/canary/simulate.ts at the measured flip rate, 10,000 seeded draws: how often one screen flags an unchanged release, how often the screen and the confirming rerun both do, and how often a 30-point drop is confirmed.
- **Rebuild.** `bun scripts/canary/baseline-report.ts --suite <gstack|gbrain> --trials <T2 trials.jsonl> --prev-sha <sha> --prev-version <v> --new-sha <sha> --new-version <v> --draws 10000 --out <file>`, with the release shas above. Run it from the baselines' rig commit (cb982929) for the paired rule and from commit b3a8523c, where the script first appeared, for the rule as first frozen.

</details>

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

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

None yet.

## Disclosures

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

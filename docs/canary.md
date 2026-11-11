# The regression canary

**What it is:** a nightly check that a new stable release of gstack or gbrain did not get worse than the one before it.

**What it answers:** did the new release break its install, stop reaching the model, cost more, leak more (gbrain), or pass fewer tasks?

**What it does not answer:** whether gstack or gbrain help at all. That is the job of the head-to-head evals. The canary only compares a release with the previous one.

Status: preregistered ([PREREGISTRATION.md](benchmarks/2026-11-09-regression-canary/PREREGISTRATION.md), rule and leases in `prereg-canary.json`). Its `canary_rig` commit is set by a dated amendment once the preregistration merges, so `run.sh` refuses to run for real until then. The nightly automation is created disabled and enabled after its first manual run passes.

## What it checks

Two exams, one per product, because gstack is for coding work and gbrain is for memory work:

- **gstack suite:** 30 Terminal-Bench 2.1 tasks per model, Opus 5.5 in Claude Code and GPT-6.1 Sol in Codex. Tasks are ones that model passed on both of #337's attempts, at $1.00 a trial or less, drawn with a fixed seed. Lists: `tasks-gstack.json`.
- **gbrain suite:** brain tasks from the harness-zero-h2h dev-draw-2 receipts, every task the model's gbrain cell passed: 12 for Opus, 14 for Sol. particle-1 runs Sol's 14 as a labelled third model; it never raises REGRESSION. Lists: `tasks-gbrain.json`.
- **Three arms in the same window:** plain (no gstack, no gbrain), the previous stable release and the new one. The plain arm is the headroom reading. It never changes a verdict.
- **Releases:** gstack's `stable` branch head with its VERSION file; gbrain's `stable` tag, peeled to its commit, with its `stable-v*` tag. Every arm is pinned by commit sha (`scripts/canary/releases.ts`).

## The tiers

Most nights nothing moved, and the run ends at about $0 with a quiet history line.

| Tier | When | What runs | Model calls |
|---|---|---|---|
| T0 install | every stable move | each arm installs; skills, router or MCP tools are present | none |
| T1 probe | every stable move | 4 fixed tasks per model, previous and new, one attempt | yes |
| T2 screen | every 30 days per product, and at once after a T1 or safety flag | the full list per model, all three arms, one attempt, plus the digest tasks | yes |
| T3 confirm | after a T2 pass-rate, cost or safety flag | fresh trials of previous and new, two attempts, on the flagged model | yes |

- **Bisect:** when T3 confirms and more than one stable move lies between the two releases, T3-size comparisons find the first bad release by binary search.
- **Baseline:** `run.sh --baseline` runs T0, then T2 at three attempts, for commits you name. It sets the first screened release and measures the flip rate.

## The rule

Frozen in the preregistration (`thresholds` in prereg-canary.json); the code is `scripts/canary/decide.ts`.

- **BROKEN:** T0 fails, or a trial's first captured request is missing gstack's skills or router, or gbrain's tools. One such trial is enough, because none of these is behaviour.
- **WATCH (a screen flag):** at T1 or T2, more tasks got worse than better and the exact one-sided sign test gives p 0.10 or less. Or cost per task rose by 1.25 times or more with a 90% lower bound of 1.10. Or the skill-load or gbrain tool-call rate fell (Fisher test, p 0.05 or less). Or, for gbrain, a cross-scope read or hidden-fact leak the previous release did not have.
- **REGRESSION:** T3 confirms it: a paired drop of 10 points or more with sign-flip p 0.05 or less, or the cost rise again with a 95% lower bound of 1.10, or the leak again.
- **REGRESSION at once (gbrain 0.60.621.0 and later):** that release fixed the member-bound write leak into the default source, so any cross-scope read or leak on it or a later release is a REGRESSION without waiting for T3, even if the previous release leaked too (`gbrain_leak_free_from` in the preregistration).
- **WATCH cleared:** T3 ran and did not confirm.
- **INCOMPLETE:** infra errors above 20% of an arm's trials, a suite that crashed, a lock held by another run, the stable ref moving during the run, or anything else that stopped the run. The next night retries.
- **OK:** nothing above.
- **Improvements** (the digest tasks) go into a weekly digest line, never an alert.

**How big a drop it catches** (from `power.md`, 10,000 seeded draws per row):

- gstack, 30 tasks per model: a 30-point drop is confirmed about 87% of the time, a 20-point drop about half the time. A single screen flags a release with no change about 4% of the time; with T3 the false alarm rate is under 0.1%.
- gbrain, 12 and 14 tasks: a 30-point drop is confirmed 31% (Opus) and 52% (Sol) of the time. Small lists only catch big drops.
- Small pass-rate regressions get through. Install, exposure, cost and safety carry most of the sensitivity.

## The alert

On anything but OK, `run.sh` prints the alert between `CANARY_ALERT_BEGIN` and `CANARY_ALERT_END`. The automation sends it to internal-task-a word for word, who relays it to internal-task-b (gstack) or internal-task-c (gbrain). Lines whose data does not apply are left out.

    Harness Evals canary: <BROKEN|REGRESSION|WATCH|INCOMPLETE> in <gstack|gbrain> stable <new version> (<new sha>), previous <prev version> (<prev sha>)
    - What moved: <model> in <harness>: pass <prev x>/<n> -> <new y>/<n> (<b> tasks got worse, <c> got better; screen p <p>; confirm <diff> points [<lo>, <hi>])
    - Cost per trial: <prev $> -> <new $> (x<ratio> [<lo>, <hi>]); tokens per trial <prev> -> <new>
    - Exposure: <listed or called in a/n -> b/n>; install route <command> at <sha>
    - Safety (gbrain): cross-scope reads <prev> -> <new>; leaks <prev> -> <new>
    - No-gstack/no-brain arm (same window): <x>/<n>
    - Tasks that got worse: <task ids, up to 10>
    - Releases in range: <list>; bisect: <first bad release or "not run">
    - Receipts: canary-receipts:<run dir>, drive canary/runs/<run id>/
    - Suggested owner: <internal-task-a | internal-task-b>; what to check first: <one line from the rule that fired>

## Reading a verdict

- **Start with the first line.** It names the status, the product and the two releases.
- **Then "what to check first".** It comes from the rule that fired, so it says where to look.
- **WATCH is not a regression.** It means a screen flagged and T3 is next (or the lease is used up and T3 waits; the verdict says so).
- **REGRESSION means T3 agreed.** Read the confirm interval: the drop is somewhere in it.
- **INCOMPLETE is about the canary, not the release.** Fix the cause in the line; the next night retries.
- **Files:** each run writes `verdict.json`, `alert.md` and `summary.md` to `canary/runs/<run id>/` in the coordinating agent's drive. Full receipts (trials, ledgers, proxy usage lines) go to the orphan branch `canary-receipts` of this repository, one directory per run plus `history.jsonl`. That branch is never merged, exported or opened as a pull request.
- **Exit codes:** 0 for OK, WATCH and REGRESSION; 10 for BROKEN; 30 for INCOMPLETE.

## Running it

    scripts/canary/run.sh --drive-dir <dir> [--run-id <id>] [--products gstack,gbrain] [--fake] [--local]
    scripts/canary/run.sh --baseline --gstack-prev <sha> --gstack-new <sha> --gbrain-prev <sha> --gbrain-new <sha> [same flags]
    scripts/canary/run.sh dead-man [--hours 48]

- **It refuses** unless HEAD is the preregistration's `canary_rig` commit (read from origin/main) and the task lists match their hashes. A rig change is a dated amendment that resets the previous-screened release.
- **One run at a time:** a lock on `canary-receipts` refuses a second run while the first lock is under 12 hours old.
- **State** (the last screened release, the last T2, a pending tier) comes from `history.jsonl` on `canary-receipts`, not from the drive.
- **Dead-man check:** `run.sh dead-man` alerts when no history line has landed for 48 hours.
- **Suites** plug in as `scripts/canary/<suite>/t0.sh` and `scripts/canary/<suite>/run-tier.sh`. `t0.sh --prev --new --out` writes `t0.json` and exits 10 on a failed check. `run-tier.sh --tier --prev --new --tasks --attempts --arms --models --out` writes `trials.jsonl` rows with a `canary` block. Without `--local` it gets `--remote` (one Ubicloud VM per tier; the caller sets `UBI_OWNER`).
- **Before every push** the receipts are scanned for token patterns, capture bodies are replaced by hashes, and `gstack-pregate sealed` runs when installed. Any hit refuses the push.
- **Keyless tests:** `bun test tests/canary-core.test.ts tests/canary-core-run.test.ts`, plus `tests/canary-gstack.test.ts` and `tests/canary-gbrain.test.ts` for the two suites. The end-to-end test runs `run.sh` against stub suites, a local receipts remote and recorded release refs.

## Cost

- **Monthly lease:** `canary-YYYY-MM`, $1,000. Every tier reserves its estimate from it and settles to the metered spend.
- **T1 reserve:** $200 of each month is kept for T0 and T1. When the rest is used up, T2, T3 and bisect wait, the verdict says so, and the pending tier runs when the lease renews next month.
- **Per run leases** (prereg `leases`, priced from the source receipts and the two T1 smokes): T1 $10 gstack, $15 gbrain; T2 $105 gstack, $40 gbrain; T3 $70 (gstack) or $25 (gbrain) per flagged model; baseline $300 gstack, $100 gbrain. Each lease is an upper bound that also leaves room for one worst-case call, which the metering proxy reserves before it forwards the call; spend settles to the metered cost.
- **Expected spend** at today's cadence (about 13 gstack and 12 gbrain stable moves a month): about $50 of T1 probes plus about $120 for the two monthly screens, so roughly $170 in a month with no flag. Each flag adds a screen and a confirm on one model, about $150 for gstack or $45 for gbrain. A night with no move costs only the automation's wake-up.

## Pausing it

- **To pause:** disable the nightly automation (Automations, then the canary automation, then disable). Nothing runs until it is enabled again; no state needs resetting.
- **To stop spend but keep install checks:** nothing to do by hand. A used-up monthly lease already drops the canary to T0 and T1.
- **After a pause longer than 48 hours,** the first dead-man check alerts once. That is expected.

## Limits

- Small lists only catch large pass-rate drops (see the power table).
- gstack's measured effect on Opus pass rate is small, so most gstack catches will be install, exposure and cost.
- The gbrain lists are older public dev tasks that frontier harnesses mostly pass. That suits a regression check, but the improvement digest has few tasks.
- particle-1 has no receipts of its own on these tasks; its readings are descriptive.
- Results are not public. Only the preregistration and the baseline results go through pull requests.

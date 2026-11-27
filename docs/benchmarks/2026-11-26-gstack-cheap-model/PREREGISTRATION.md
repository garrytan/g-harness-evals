# Does gstack help a cheap model more than a frontier model? Preregistration

Status: written 2026-11-26 (America/Los_Angeles), before any counted trial of this run. Run id `gstack-cheap-model-2026-11`. It rebuilds the plan of the same name first written on 2026-11-10, which never ran, on the current frontier Harbor path. Cells, shards and leases are in [prereg-harbor.json](prereg-harbor.json). The analysis inputs are [analysis-spec-installed.json](analysis-spec-installed.json) and [analysis-spec-told.json](analysis-spec-told.json). The power figures are in [mdd.json](mdd.json). The pilot this plan is priced from is in [pilot/](pilot/).

**In one line:** run particle-1, a low-cost model, and two frontier models (Opus 5.5 and GPT-6.2 Sol) on the same 52 coding tasks, with and without gstack, in two agent harnesses (Hermes and OpenClaw). Then measure how much gstack adds for each model.

## The three questions, and what each answer would mean

1. **Does gstack raise each model's pass rate?**
   - If yes for particle-1: builders running a cheap model should install gstack.
   - If no for every model: gstack's coding workflow does not pay off on these tasks in these harnesses, and the report runs the "Why null?" check below.
2. **Does gstack help particle-1 more than it helps Opus 5.5 or GPT-6.2 Sol?**
   - If yes: scaffolding matters most for weaker models, and gstack should be tuned and tested on cheap models, not only frontier ones.
   - If no: we found no sign that gstack helps weaker models more, so gstack keeps being tuned and tested on frontier models first. A no covers a smaller particle-1 lift and an interval too wide to tell either way; it does not show that the effects are equal.
3. **With gstack, does particle-1 pass nearly as many tasks as a frontier model without it (within 10 points), and at what cost per solved task?**
   - If yes: a cheap model plus gstack is a real alternative to a frontier model on this kind of work, at the cost ratio we report.
   - If no: gstack does not close the gap, and the report says how far apart they stay.

## What the result changes

Each way the result can come out, and what we do differently because of it.

- **gstack lifts particle-1 more than both frontier models (lift difference shown in either gstack arm):** we ask the gstack team to add particle-1 to gstack's own release checks beside the frontier models, so workflow changes get tested where they matter most. The README tells builders on low-cost models to install gstack, with the measured lift and cost per solved task.
- **gstack lifts every model about the same:** gstack keeps testing on frontier models only, and we make no claim that it suits cheap models better. The README reports the shared lift.
- **gstack shows no measurable lift for any model:** the "Why null?" cycle below runs, and its verdict (KEEP, FIX-METHOD or CUT-CANDIDATE) for gstack's build-check workflow in Hermes and OpenClaw goes to the gstack team with one concrete change. Any cut candidate goes to Garry in plain words.
- **gstack lowers any model's pass rate:** the trial-level failures go to the gstack team as a fix request, and we stop recommending gstack in that harness until a fix is measured.
- **The told arm lifts and the installed arm does not:** gstack's skills help once the model is pointed at them, so discovery is the gap. We send the gstack team one change to how gstack loads in Hermes and OpenClaw, such as having the start hook name the build-check workflow.
- **particle-1 with gstack comes within 10 points of a frontier model without gstack, at a lower cost per solved task:** we give the gstack-on-particle-1 cost ratio to the crew running particle-1 for implementation work and recommend installing gstack on those threads. If it doesn't, their current rule (a failed task goes to Opus 5.5) stays, and we report the gap.

## Words used here

- **Harness:** the program around the model that gives it tools and runs the loop: Hermes or OpenClaw here.
- **Arm:** one way of running a model in a harness. This run has three arms: no gstack, gstack installed, and gstack told.
- **Cell:** one model, one harness and one arm. There are 18.
- **Trial:** one attempt at one task. Each cell runs every task 3 times.
- **Shard:** the part of the run one machine does. Here each shard is one cell on its own VM.
- **Lift:** a gstack arm's pass rate minus the no-gstack arm's pass rate, for the same model, compared task by task.
- **MDD (minimum detectable difference):** the smallest true difference this design would detect 80% of the time. A real effect smaller than the MDD will often look like no difference.
- **Paired:** every comparison matches the same tasks on both sides, so easy and hard tasks cancel out.

## What runs

- **Tasks:** the same 52 Terminal-Bench 2.1 coding tasks as the [frontier harness run](../2026-11-07-frontier-harness/PREREGISTRATION.md), in the same shared order. Each task is graded by its own tests, which sit outside the agent's folder.
- **Models:** Opus 5.5 (`anthropic:claude-opus-5-5`), GPT-6.2 Sol (`openai:gpt-6.2-sol`) and particle-1 (`particle:particle-1`). GPT-6.2 Sol replaced GPT-6.1 Sol on 2026-11-21, when it became the frontier OpenAI model we test. Each model id is pinned in `pin.json`, and every trial is checked for the model that answered it (see Settings).
- **Harnesses:** Hermes and OpenClaw, the two harnesses that run all three models and that gstack installs into. Our usual rule runs GPT-6.2 Sol in Codex CLI and Opus 5.5 in Claude Code. This run uses Hermes and OpenClaw for all three models instead, under that rule's exception for evals where the harness is part of the comparison. The question needs particle-1 and the frontier models in the same harness, and particle-1 runs in neither Codex CLI nor Claude Code.
- **Size:** 52 tasks x 3 attempts x 3 arms x 6 model and harness pairs = **2,808 trials**.

### The three arms, in every model and harness

| Arm | Cell suffix | What the trial gets |
|---|---|---|
| **No gstack** | `none` | The plain harness and the plain task. |
| **gstack installed** | `installed` | gstack 1.104.0.0 installed by its own `./setup --host hermes` or `--host openclaw`, as a user installs it, with gstack's start hook at its default (on for a new Hermes or OpenClaw registration at this version). The task prompt is unchanged. |
| **gstack told** | `told` | The same install, and the prompt starts with one line. Hermes: "Use gstack's /gstack-build-check skill for this task." OpenClaw: "Use the gstack skill's build-check workflow for this task." |

- **build-check** is gstack's workflow for coding work: run the checks and tests, fix, and repeat until green. It was named verify in the 2026-11-10 plan; gstack renamed it before 1.104.0.0.
- **One install route in both harnesses.** The 2026-11-10 plan gave Hermes a separate start-hook arm, because at gstack 1.98 the hook was off by default and Hermes's model saw the skill list but never a skill body. At 1.104.0.0 the hook is on by default in both harnesses, so the installed arm is gstack's default install everywhere, and the separate Hermes hook arm folds into it.
- **What the model sees:** on Hermes, gstack registers every skill, so build-check is listed as `gstack-build-check`. On OpenClaw, gstack lists five skills (gstack, review, qa, ship, plan-eng-review), and build-check is reached through the `gstack` router skill. This is gstack's own registration, not ours.
- **The told line** goes before the task, followed by a blank line. Nothing else in the prompt changes.
- **We run our own no-gstack arm,** 3 attempts per task, on its own VMs, launched at the same time as the gstack arms of its pair. Comparisons with the earlier frontier harness run are descriptive only.

### Every arm starts in a git repository

- **The setup step, the same in every arm:** before the agent starts, the task folder becomes a git repository with one fixed commit, plus a local bare origin with a `main` branch, so `origin/main` resolves. Images without git get the pinned static git 2.56.0 from [pin.json](../../../scripts/frontier-harbor/pin.json) (`git_static`). The agent's own check, in its starting folder, must see git and that `origin/main`. A failure is `HE-FRONTIER-016`, infra class `workspace_git`.
- **Why:** gstack's build-check workflow cannot run in a folder with no git repository or no base branch. In a check of the 2026-11-10 plan without this step, every run of gstack's checker stopped there. A told arm that can never start its workflow would measure only that failure.
- **Fairness:** all three arms get the same step, so it cannot explain a lift. It may change pass rates a little compared with runs that had no git.

### Web tools are off

- Every harness runs with model-callable web search, extract and fetch turned off, with the settings the frontier harness runs use (`frontier_settings.py`).
- **Checked per trial:** the tool lists each trial actually offered the model are read from its captured requests (`web-tools-check.ts`'s detector). A trial offered any web tool is an infrastructure error, infra class `web_tool_offered`, excluded and counted per cell. Each shard also runs the existing web-tools check on its smoke before any trial.
- **Why:** an earlier run found that Hermes's built-in web search returned a task's answer key.

## What we expect, stated before the run

- **The told arm tests the build-check loop, not gstack's test choice.** In this plan's pilot (7 tasks, 42 told trials), gstack's checker reported no test command in 36 ([pilot/README.md](pilot/README.md)). Terminal-Bench keeps its graders outside the agent's folder, so we expect the same on the other 45 tasks, but the pilot shows it only for those 7. We will not add any. So the told arm measures the model running gstack's loop (the start step, the checks the model declares itself, the end step). It does not measure gstack picking tests. The report gives the checker's outcomes per cell as a secondary measure.
- **We will watch particle-1 on Hermes.** In earlier checks it timed out more often than the frontier models. The report gives its timeouts per arm beside its lift.
- **Frontier models have little room.** The frontier harness run passed 76% to 86% of these tasks on Opus 5.5 and GPT-6.1 Sol in these harnesses, so a frontier lift above about 15 points is unlikely. GPT-6.2 Sol's first reading on these tasks is the pilot below.

## How big a difference this run can see

MDD at 80% power, two-sided alpha 0.05, paired by task, pooled over both harnesses, 3 attempts on each side. In brackets: the MDD at the first Holm step of its family. Percentage points. Formula and inputs: [mdd.json](mdd.json).

| Comparison | MDD | Where the noise estimate comes from |
|---|---|---|
| Lift, Opus 5.5 | 4.9 (5.7) | per-task variance in the frontier harness run, Hermes and OpenClaw |
| Lift, GPT-6.2 Sol | 4.9 (5.7) | the same, from GPT-6.1 Sol |
| Lift, particle-1 | 7.3 (8.5) | uncounted particle-1 checks (below) |
| Lift difference, particle-1 minus Opus 5.5 | 8.8 (9.7) | both of the above |
| Lift difference, particle-1 minus GPT-6.2 Sol | 8.9 (9.7) | both of the above |
| Reach: particle-1 with gstack minus a frontier model without | 14.8 (16.2) | the Opus-to-Sol gap per task in the frontier harness run |

- **GPT-6.2 Sol's noise estimate** is GPT-6.1 Sol's from the frontier harness run, because GPT-6.2 Sol has none of its own on these tasks.
- **particle-1's noise estimate:** uncounted checks for the 2026-11-10 plan ran particle-1 on the first 6 tasks of the shared order, 3 trials per task in each harness. Per-task variance was 0.167 on Hermes and 0 on OpenClaw. We use 0.167 for Hermes and the frontier models' 0.048 for OpenClaw, because 0 from 6 tasks is surely too low.
- **If particle-1 were as noisy as possible** (variance 0.25 on every task), the MDDs would be 11.2 for its lift and 12.2 to 12.3 for the lift differences.
- **The lift difference is a primary result.** The plan made it primary only if its MDD is 10 points or less. With the estimates above it is 8.8 to 8.9 (9.7 at the first Holm step). This rests on a 6-task estimate for particle-1, and we say so now. The report gives the MDD computed from the run's own data beside each result, and the primary status does not change after the fact.
- **Reach-frontier is weak by design.** If particle-1 with gstack were truly equal to a frontier model, the chance of showing "within 10 points" is about 50% to 60%. A "not shown" result is therefore weak evidence that particle-1 falls short.

## Run order

1. **Keyless checks, $0 model spend, done before this plan froze** (receipts in [pilot/keyless/](pilot/keyless/)):
   - the image install check: gstack's setup from the bundle on all 52 task images for both harnesses, with no network, from a bundle whose content matches `delivery-pin.json` `bundle.content.sha256` ([gstack-bundle-images.json](pilot/keyless/gstack-bundle-images.json): 104 rows, pass);
   - the agent install check: every arm in both harnesses through Harbor against the fake upstream ([install-check-trials.jsonl](pilot/keyless/install-check-trials.jsonl)), with the bundle, the git step and the clean-arm probe, on one fresh VM through the same SSH path the fan-out uses.
2. **Pilot, one per arm, done before this plan froze** (see Pilot). Its spend prices this plan (see Cost projection).
3. **Canary shard:** `opus-hermes-told` launches first. Its arm has the most parts that could fail at setup, and it is that arm's costliest cell ($170.36 projected). The costliest cell overall is `opus-hermes-installed` ($188.77).
4. **The other 17 shards** launch only after the canary has scored at least one trial and that trial's results have been copied off its VM. They launch in batches that fit the room left under our vCPU limits (see Shards and leases). Before each counted launch, `scripts/launch-preflight.ts` prices the plan again and probes each provider.
5. **One interim look** at half the trials (see Interim look).
6. **Results** merge into one directory after every shard ends, then the analysis below runs.

## Eval loop

- Size: counted run
- Paid budget: $1,972 (the $1,800 counted-run cap plus $172 of pilot caps).
- Model judge: none. Each task is graded by its own tests. The blind reader that confirms answer-key flags (see Contamination) is a contamination check, not a judge.

## Pilot

Before this plan froze, each arm ran a pilot on all 6 model and harness pairs: the first 7 tasks of the shared order, 1 attempt each, so 42 trials per arm and 126 in all. Each arm's pilot ran on one VM, its cells one after another, at most three VMs (48 vCPU, keyless checks included) at a time, under its own lease, from a pushed commit of this plan's branch ([pilot/prereg-pilot.json](pilot/prereg-pilot.json), run id `gstack-cheap-model-pilot-2026-11`). Pilot trials are never counted and never enter the analysis.

| Arm | Arm budget | Pilot cap | Pilot spent |
|---|---|---|---|
| No gstack | $452 | $45 | $17.63 |
| gstack installed | $566 | $56 | $21.28 |
| gstack told | $718 | $71 | $21.65 |

- Arm budget is the sum of that arm's six counted leases as planned when the pilot launched, and each pilot cap is at most a tenth of it. Pilot spent is the settled model spend in that arm's pilot ledger. After the pilot, the counted leases were sized from its prices (see Cost projection): no gstack $523, gstack installed $608, gstack told $612. The $57 reserve is not in any arm.
- Part under test ran: no gstack: the clean-arm probe found no gstack in any trial's container and the audit finds no gstack file read. gstack installed: gstack's setup passed in every trial (setup exit 0, skills visible, start hook active), and its skill listing reached the model in every trial. gstack told: the told line reached the model in every trial, and build-check's start step ran in at least one trial of each of the 6 pairs. In every arm, every GPT-6.2 Sol answer names `gpt-6.2-sol` or its dated form, with no answer missing its model, and every agent-loop request carries effort high.
- Tasks can be supplied: every pilot trial gets a materialized task at its pinned digest, a passing git step and a model response, with no `HE-FRONTIER-016`, `HE-DELIVERY` or web-tool error. Each cell's pilot cost per trial prices its counted lease (see Cost projection).
- **A failing arm** is fixed and its pilot rerun, or left out and reported as left out.
- **Plan change, 2026-11-27, made after the pilot ran:** "every trial" in the two checks above means every trial where the harness itself installed. When a harness's own installer fails before gstack's setup starts, the trial is an infrastructure exclusion, counted and reported, and does not fail the arm's gate. The pilot had one: particle-1 on Hermes in the installed arm, task adaptive-rejection-sampler. Its record shows the harness install exiting non-zero (`NonZeroAgentExitCodeError`) before gstack's setup, no gstack health check and no model request (`no_model_response`). The VM's run log, which is not committed, gave Hermes's installer message as "app products or command publication failed". It was not rerun.
- **Result:** [pilot/README.md](pilot/README.md).

## Cost projection

- Spend stop: $1,972
- Pilot-priced projection: $1,478.39
- Projection receipt: plan-cost-receipt.json

- **What the total holds:** the pilot's settled model spend ($60.57 across its three ledgers), the pilot VMs' list price ($7.16 from the three committed `shard-vm.json` files), and the 18 counted cells at each cell's pilot cost per scored trial ($1,352.66), plus VM time still to come estimated from the pilot's median trial time ($58.00). It leaves out our own agent use, the keyless install checks' VMs and each counted VM's setup and smoke time, which the report adds from the receipts.
- **The receipt's upper figure,** $2,264.37, is the sum of the 18 cells' 95% upper estimates from resampling each cell's pilot trials ($2,138.64), plus the pilot's model spend ($60.57), its VMs ($7.16) and the counted VM time ($58.00). It is above the spend stop. A sum of per-cell quantiles is not a 95% bound on the total and can miss in either direction, so read it as a rough high case. The leases and the interim look are what keep the run under the stop if costs land high: a cell that reaches its lease stops (Shards and leases).
- **Leases:** each cell's projected spend plus its `plan.ts` headroom floor (4 trials at once times the largest per-call reservation: $31.58 for Opus 5.5, $30.08 for GPT-6.2 Sol, $1.92 for particle-1), rounded up to the dollar. The 18 leases add up to $1,743, and the reserve is $57, so the counted cap stays $1,800. `plan.ts check-shard` passes for every shard.

| Cell | Pilot trials scored | Pilot cost per scored trial | 95% upper | Projected for 156 trials | Lease |
|---|---|---|---|---|---|
| opus-hermes-none | 7 of 7 | $1.00 | $1.79 | $155.78 | $188 |
| opus-hermes-installed | 7 of 7 | $1.21 | $2.24 | $188.77 | $221 |
| opus-hermes-told | 7 of 7 | $1.09 | $1.72 | $170.36 | $202 |
| opus-openclaw-none | 7 of 7 | $0.77 | $1.09 | $120.61 | $153 |
| opus-openclaw-installed | 7 of 7 | $0.85 | $1.38 | $132.69 | $165 |
| opus-openclaw-told | 7 of 7 | $0.94 | $1.33 | $146.39 | $178 |
| sol-hermes-none | 7 of 7 | $0.31 | $0.45 | $47.75 | $78 |
| sol-hermes-installed | 7 of 7 | $0.43 | $0.68 | $66.42 | $97 |
| sol-hermes-told | 7 of 7 | $0.47 | $0.71 | $72.56 | $103 |
| sol-openclaw-none | 7 of 7 | $0.23 | $0.32 | $35.74 | $66 |
| sol-openclaw-installed | 7 of 7 | $0.33 | $0.42 | $51.51 | $82 |
| sol-openclaw-told | 7 of 7 | $0.36 | $0.47 | $56.13 | $87 |
| p1-hermes-none | 7 of 7 | $0.11 | $0.16 | $16.75 | $19 |
| p1-hermes-installed | 6 of 7 | $0.13 | $0.23 | $20.20 | $23 |
| p1-hermes-told | 7 of 7 | $0.11 | $0.15 | $16.61 | $19 |
| p1-openclaw-none | 7 of 7 | $0.10 | $0.18 | $16.30 | $19 |
| p1-openclaw-installed | 7 of 7 | $0.11 | $0.18 | $17.58 | $20 |
| p1-openclaw-told | 7 of 7 | $0.13 | $0.19 | $20.53 | $23 |

## Interim look

- Look at: 1,404 of 2,808 units. A unit is one trial. The look happens once, when every one of the 18 cells has finished at least 78 trials, half of its 156. It reads each cell's first 78 finished trials by finish time, 1,404 in all, excluded trials included (they count toward the infra rule and drop out of the lifts as in the final analysis), through both analysis specs (`scripts/frontier-harbor/interim.ts`) and reports no number publicly. Taking half of every cell, not the run's first 1,404 trials, matters because pairs launch in batches: the first batch could finish 1,404 trials on one harness alone, and a stop decided from it would reach cells that had not run yet.
- Stop bounds: there is no stop for success, so every cell that is not stopped runs to full size. The bounds can only stop cells. A model's two cells in one gstack arm stop when its lift in that arm, from at least 20 paired tasks, has a 99.5% task-bootstrap interval entirely below 0, meaning gstack clearly lowers that model's pass rate. All six cells of one gstack arm stop when each of the three models has at least 20 paired tasks in that arm and every model's lift has a 99.5% upper bound below 5 points. A cell also stops if more than 20% of its scored trials are excluded as infrastructure errors, or if any trial in a no-gstack cell read a gstack file. A stopped cell keeps its trials, the report says it stopped at the look, and its comparisons use the trials it ran.
- **No other look.** While the run is going, monitoring reads trial counts, errors, spend and VM health. It never reads pass rates.

## Shards and leases

- **One VM per cell, so 18 shards.** Each shard runs on its own Ubicloud standard-16 VM, through `scripts/ubicloud/fanout.sh --workload frontier-harbor`. The repository is pinned at this preregistration's merge commit, and each VM is destroyed on every exit. A shard has its cell's name.
- **No cell is split.** Each shard runs all 156 trials of its one cell.
- **The three arms of a model and harness run side by side in time, on separate VMs.** Shards launch in batches of whole model and harness pairs (3 VMs, 48 vCPU), so every arm of a pair runs over the same hours, against the same providers, and no arm slows another down by sharing its machine.
- **Batches fit our vCPU limits.** 18 standard-16 VMs would need 288 vCPU, more than our share of the shared Ubicloud project allows (208 for our evals at once, 464 for the project). Before each launch we check the current total and start as many whole pairs as fit. Pairs go longest first: particle-1 on Hermes, Opus 5.5 on Hermes, GPT-6.2 Sol on Hermes, Opus 5.5 on OpenClaw, particle-1 on OpenClaw, GPT-6.2 Sol on OpenClaw. Within a shard, Harbor runs one job per attempt (attempt 1, then 2, then 3), and each job walks the shared task order.
- **4 trials at a time per VM** (`concurrency: 4`), retries off, as in the frontier harness run. Wall time is reported as "contended", because 4 trials of one cell share a VM.
- **The gstack bundle** is built once on the controller with `scripts/frontier-harbor/gstack-bundle.sh` and uploaded to the installed and told shards only (`run-shard.sh --gstack-bundle`). `vm-run.sh` checks its content digest against `delivery-pin.json` before any lease or trial, and refuses a bundle on a no-gstack shard.
- **The smoke before each shard** is the repository's whole keyless install check (every pinned harness and model pair against a fake upstream, about two hours on a standard-16 VM). No trial runs and nothing is spent until it passes. In the pilot, one shard's smoke failed on a pair outside this plan (Hermes on Grok 4.7, whose Hermes install failed), and that shard was launched again at the same commit. A counted shard whose smoke fails is launched again the same way, which is not a deviation, because no counted trial ran.
- **Time limits:** `run-shard.sh --timeout-hours 17` and `UBI_TTL_HOURS=18` on every VM, so the reaper never destroys a VM before its shard ends. A shard stopped by its time limit resumes once on a fresh VM at the same commit with `run-shard.sh --resume`. Planned trials are never rerun, and the restart is recorded as a deviation.
- **Results leave each VM while it runs,** and the VM-to-shard map lives outside the controller machine.
- **Cap:** the paid cap for counted trials is **$1,800**: the 18 leases plus a reserve that no shard is planned against. Only a dated amendment can lease the reserve. The report gives the whole eval's cost: paid calls, VMs and our own agent use.
- **How the leases are sized:** each lease is its cell's projected model spend (156 trials at its pilot cost per scored trial) plus room for 4 requests in flight, one per concurrent trial. The metering proxy reserves a request's full 128,000-token output allowance before forwarding it. A lease with too little room refuses requests (HTTP 402) near its end while other trials still hold reservations. Every lease is above `plan.ts`'s floor, and `plan.ts check-shard` passes for all 18 shards.
- **If a cell costs more than expected,** its last trials are refused. Those trials are `model_error` with `cap_stop`, excluded and counted. They are the cell's last trials, which can fall in any attempt: at the pilot's upper cost per trial, `opus-hermes-installed` passes its $221 lease within its first 104 trials. The report states where each cell's refusals began. Each cell has its own lease, so one cell running over takes no trials from another. Nothing is backfilled.

## Disclosures

This run features particle-1 (Particle), gstack, OpenAI's GPT-6.2 Sol, Hermes and OpenClaw. The report and any finding file end with these lines, word for word from the disclosures list. No X post carries them.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

gstack is Garry Tan's own project.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

<details>
<summary><strong>Method details</strong></summary>

## Approval

- **Garry Tan, 2026-11-09:** approved the plan, taking every recommendation, and the same day approved adding a told arm.
- **Coordinating agent, 2026-11-10:** approved three arms in every model and harness, our own no-gstack arm in place of reused trials, the git step in every arm, web tools off in every harness, one VM per cell at 4 trials at a time, and re-priced leases with a reserve.
- **Coordinating agent, 2026-11-21:** approved GPT-6.2 Sol in place of GPT-6.1 Sol with a per-trial model check, Hermes and OpenClaw for all three models under the harness exception, launching in batches that fit our vCPU limits, and the decision, pilot and interim-look sections.
- **Coordinating agent, 2026-11-26:** approved rebuilding the plan on the current frontier Harbor path with one gstack install route, new error codes, gstack's current stable release (rebundled, with the keyless install check rerun on one VM), and the frozen settings of the newest frontier runs (web search off, the pinned Hermes release).

## Settings

- **Benchmark:** Terminal-Bench 2.1 at commit `d49e28f1e4ddd13d289e85a5f312a66750951932`, through Harbor 0.24.0. Every task's source and image digests are pinned in `scripts/frontier-harbor/pin.json`, and `materialize.ts` refuses a task that does not match.
- **The 52 tasks and their order:** `pin.json` `task_selection`, sorted by sha256("harn50-frontier-2026-11-07\0<task id>"), the order the frontier harness run used. No kept sample runs.
- **Harnesses:** Hermes v0.23.1 (commit `3b421578588243f920886e6fe79a6faa87ea026e`) and OpenClaw 2026.10.6, the versions `pin.json` pins for every frontier Harbor run today, each with the settings in `scripts/frontier-harbor/frontier_settings.py`, written to each trial's `harness_settings.json`. The 2026-11-10 plan named Hermes v2026.9.24; the frontier shootout moved every Hermes cell to v0.23.1 on 2026-11-16 (its amendment 1), and this plan follows that pin.
- **gstack:** version 1.104.0.0 at commit `e6dd567349e85506127c2f4cf69a0392923c032c`, gstack's stable release on 2026-11-26, from the offline bundle `scripts/frontier-harbor/gstack-bundle.sh` builds (the checkout, production `node_modules`, compiled binaries and Bun 1.4.2, the Bun version gstack tests at that commit), pinned in `scripts/frontier-harbor/delivery-pin.json` `bundle` by its content digest. In each installed and told trial, agent setup uploads the bundle into the task container and runs gstack's own `./setup --host hermes|openclaw --no-browser` there as the agent user, outside the agent's time limit, with telemetry, update checks and artifact sync off and gstack's state in a per-trial folder. Setup must exit 0 with gstack's own status reporting its skills visible and its start hook active, checked again when the agent launches. A failure stops the trial before the agent starts (`HE-DELIVERY-005` or `-006`): an infrastructure error, infra class `gstack_install_failed`, counted per cell.
- **The intervention is gstack as a user installs it, Bun included.** Bun is not in the no-gstack arm. The audit counts Bun use outside gstack per trial.
- **The cell's model, checked per trial:** the metering proxy records the model every OpenAI answer names, and a GPT-6.2 Sol trial with any answer from a model other than `gpt-6.2-sol` or `gpt-6.2-sol-<date>` is an infrastructure error (`model_mismatch`), excluded and counted per cell. Answers with no recorded model are counted per trial. Anthropic and Particle requests go to their pinned model ids through the proxy's slot check.
- **Limits:** each model's real context window and a 128,000-token output cap, injected by the proxy where the harness sends none. Effort high on every agent-loop request, checked per request; a miss is `effort_mismatch`, excluded and counted.
- **Housekeeping calls:** Hermes's session title stays at its shipped default. OpenClaw's housekeeping call does not: `frontier_settings.py` sets OpenClaw's `utilityModel` to the cell model, as on the earlier frontier Harbor runs, where OpenClaw's own default for the OpenAI provider is `openai/gpt-5.6-luna`. That is a declared deviation. Both are metered, labelled as harness housekeeping, and never scored.

## Analysis

The analysis is `scripts/frontier-harbor/analyze.ts` with each gstack spec on the merged results:

```
bun scripts/frontier-harbor/analyze.ts --results <merged results> --spec docs/benchmarks/2026-11-26-gstack-cheap-model/analysis-spec-installed.json --lookup-fails <audit list> --out <results>/analysis-installed
bun scripts/frontier-harbor/analyze.ts --results <merged results> --spec docs/benchmarks/2026-11-26-gstack-cheap-model/analysis-spec-told.json --lookup-fails <audit list> --out <results>/analysis-told
```

- **Two arms, two families.** The installed arm and the told arm are separate questions, each with its own spec and its own Holm families. Both share the no-gstack cells. No correction is made across the two arms, and the report says so.
- **Estimator:** per task and harness, each side's mean pass over its scored trials (up to 3). Differences are pooled over the two harnesses, with harness as a stratum, through `runner/stats/paired.ts` `clusteredPairedDelta`, clustered by task: task-clustered bootstrap 95% intervals (10,000 draws, seed 7) and a task-level sign-flip p. Every comparison is paired. A comparison with fewer than 10 paired tasks is not tested.
- **Lift, per model and arm:** gstack minus no-gstack. Holm over the 3 models. Labels: helps, hurts, or no measurable difference. Each lift also gives tasks better, worse and the same, a reading per harness, each side's pass rate with tasks and trials, the MDD from the run's own data, and the paired cost-per-solve ratio.
- **Lift difference, per arm (primary):** particle-1's lift minus Opus 5.5's, and minus GPT-6.2 Sol's, computed per task from the four cells, only within the same arm. Holm over the 2 frontier models. `lift_difference.primary` is true in both specs, from the MDDs above.
- **Reach-frontier, per arm:** particle-1 with gstack minus each frontier model without gstack. A one-sided non-inferiority test at a 10-point margin and a superiority test, each with Holm over the 2 frontier models. Labels: better, within 10 points, or not shown. Each row gives the paired cost-per-solve ratio, particle-1 with gstack over the frontier model without, with its task bootstrap interval.
- **No judge is used.** The tasks are graded by their own tests.
- **Headline rule for a result that favours particle-1:** the headline also gives the gap to the frontier model, with its interval.

## Scoring, exclusions and infra classes

- **Pass:** the verifier's reward is 1, with no answer-key receipt.
- **Counts as a fail:** `harness_error` (a harness that stops with an error, including a host port still busy after a mid-trial restart); an agent timeout (the task's own time limit, `timeout`, counted per cell); a trial a blind reader confirms received the answer key.
- **Excluded and counted per cell:** `model_error` and `infra_error`, including `unfinished`, `setup_failed`, `no_model_response`, `effort_mismatch`, `rate_limited` (when a 429 made the harness stop), `model_mismatch`, `workspace_git` (`HE-FRONTIER-016`), `gstack_install_failed` (an `HE-DELIVERY` stop of an installed or told trial), `gstack_contaminated` (gstack found in a no-gstack trial's container, also reported) and `web_tool_offered`.
- **A verifier that never ran its tests** (for example because a package source it downloads from was down at grade time) makes the trial an infrastructure error, excluded and counted. Such trials are rerun once from a rerun list committed as a dated amendment before the rerun.
- **An excluded trial drops only its own side.** Each side's per-task mean uses its scored trials. A task with no scored trial on one side drops from that comparison and is listed.

## Secondary measures, per cell

From `scripts/frontier-harbor/audit.ts` at this commit, over each trial's captured request bodies, against the fingerprints of gstack's own setup output at this gstack commit (`scripts/frontier-harbor/gstack-fingerprints.json`):

- **Exposure:** the skill listing reached the model, a skill body reached it, the model opened a skill, and the model followed one. For build-check, "followed" counts its steps: `gstack-checks` runs, and gstack's end step naming build-check.
- **gstack-checks outcome,** the furthest it got in each trial: `ran`, `no_tests`, `policy_unavailable`, `not_git_repo`, `unknown` or `none`.
- **Told line reached** (told arm), and **start note reached** (installed and told arms): gstack's start hook note in the model's context.
- **Also per cell:** Bun run outside gstack's own paths, calls to gstack telemetry or update hosts, agent timeouts, median wall time (contended), and cost per solved task.

## Why null?

- **When:** for every lift labelled no measurable difference, and for a lift difference that is not shown.
- **The cycle:** did the model see and use gstack (exposure above)? Do the tasks fit (the no-tests finding above)? Were there enough samples (MDD)? Was there headroom? Does the frontier model already do this without gstack?
- **The verdict:** one line, KEEP, FIX-METHOD (naming the fix) or CUT-CANDIDATE, with one concrete proposed gstack change (file, number and install route).

## Contamination, keys and clean arms

- **Keys:** each task container sees only the proxy URL and a per-trial dummy token. Only the metering proxy holds provider keys, and Harbor runs with a scrubbed environment.
- **Egress:** Harbor's sidecar refuses the benchmark's own sources and the direct provider hosts. Tasks keep general internet access, as in the frontier harness run, which is a declared deviation from methodology item 6.
- **Answer keys:** the audit looks for TB2.1 canary strings, requests for a copy of the benchmark, and answer-key lines the model received. A reader blind to the arm and harness confirms each flag, and a confirmed receipt scores the trial a fail.
- **Clean no-gstack arm:** the VM's preflight refuses a Capy drive or a gstack install on the host, and a no-gstack shard is never given the bundle. In every trial, agent setup probes the container for gstack before anything is installed, and a no-gstack trial with gstack in its container stops (`gstack_contaminated`). In a no-gstack cell, any read of a gstack file is contamination, and the cell is reported as contaminated.
- **Memorization:** frontier models may have seen TB2.1 solutions. The paired design cancels most of this within a model.

## Outside terms

- Terminal-Bench 2.1 and Harbor: Apache-2.0. Task directories are never committed with results.
- Hermes, OpenClaw and gstack: MIT. Bun: MIT.
- The static git: GPL-2.0-only, copied unmodified into containers that have none.
- Particle: the Terms of Service are read again for any clause on publishing benchmark results before the report is published, and the reading is recorded in `pin.json` `licences`.

## Receipts

- **Where:** `docs/benchmarks/2026-11-26-gstack-cheap-model/results/`.
- **Run-level:** the merged `trials.jsonl` and `manifest.json`.
- **Per shard, under its own name:** ledger, proxy usage, `run-summary.json`, `gstack-bundle-check.json` (installed and told shards), `shard.json`, `shard-vm.json` and each shard's `launch-preflight.json`.
- **Analysis:** both specs' `gstack-analysis.json` and `gstack-analysis.md`, the interim look's decisions, and the audit output. The blind reader's working file is never committed.
- **Separate pull requests:** this preregistration merges to main before the first counted trial. Results come in a later pull request.

## Amendments

Each amendment is dated, committed and merged to main before any trial it affects. Expected amendments: a rerun list for verifier outages, and any lease change or arm fix a counted canary calls for.

- **2026-11-27, before this plan froze and after the pilot ran:** the pilot gate's "every trial" now means every trial where the harness itself installed (see [Pilot](#pilot)). It changes no counted trial.

</details>

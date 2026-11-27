# Does QM do as well as other agent harnesses on the frontier coding tasks, on the same model?

Status: preregistered when this file merges to main, before any trial of this run. Run id `frontier-shootout-2026-11-qm`. Cells, shards and leases are in the three plan files `prereg-harbor-q1.json`, `prereg-harbor-q2.json` and `prereg-harbor-q3.json` beside this file, one cell each. The index entry is [frontier-shootout-2026-11-qm.json](../preregistrations.d/frontier-shootout-2026-11-qm.json).

**In one line:** run QM (yc-software/qm, a team agent service with its own agent loop) on the 52 Terminal-Bench 2.1 tasks of the [frontier shootout](../2026-11-16-frontier-shootout/PREREGISTRATION.md), 3 tries each, on Claude Opus 5.5, Gemini 4 Carbon and GPT-6.2 Sol, and compare QM on Opus with Hermes, OpenClaw and Pi on Opus, task by task.

**What this is not:** a gstack or gbrain test (no cell has either, and no cell can reach either), a change to the shootout's own calls, or a model comparison. The shootout's results stay as published; this run adds QM rows beside them.

## Approval

- **Garry, 2026-11-19, relayed by the coordinating agent:** "always include qm as a harness". Every harness comparison here now includes QM.
- **Garry, 2026-11-20, relayed by the coordinating agent:** approved this run as its own eval, outside the shootout's spend stop, at about $460 all-in: "Do it can you do it for me".
- **The coordinating agent, 2026-11-20:** run Carbon with the route difference labelled (below), and run QM's main branch as it stands when this plan freezes.
- **The coordinating agent, 2026-11-21 (repeated 2026-11-26):** the Sol cell runs GPT-6.2 Sol, the newest Sol, and is reported within QM only. The shootout's Sol rows ran GPT-6.1 Sol, a different model, so no harness comparison is made from it.

## What runs

| Shard | Cell | Model and route | Tries | Trials | Comparators: same model, same tasks and order (shootout shard) |
|---|---|---|---|---|---|
| q1 | qm-carbon | `openrouter:google/gemini-4-carbon`: OpenRouter pinned to Google AI Studio, standard tier, no fallbacks | 3 | 156 | Hermes s01, OpenClaw s02, Pi s03 (all on Google's Gemini API directly); Gemini CLI s04 (own harness, descriptive) |
| q2 | qm-opus | `anthropic:claude-opus-5-5`: Anthropic's API | 3 | 156 | Hermes s07, OpenClaw s08, Pi s09; Claude Code s06 (own harness, descriptive) |
| q3 | qm-sol | `openai:gpt-6.2-sol`: OpenAI's API | 3 | 156 | none: the shootout's Sol rows (Hermes s21, Pi s22) ran GPT-6.1 Sol |

**Totals:** 3 cells, 468 trials, expected paid spend about $327, leases $725 and shard caps $762 (leases plus reserves).

- **Same as the shootout:** Terminal-Bench 2.1 at `d49e28f1`, the 52 tasks and task order of `scripts/frontier-harbor/pin.json` with the shared order seed `harn50-frontier-2026-11-07`, Harbor 0.24.0, the same hidden-test grader, effort high on every agent-loop request (checked per request from the proxy log), a 128,000-token output cap (65,536 for Carbon), each model's real context window, the egress blocklist, and every model call through the metering proxy under a lease. No gstack or gbrain is installed, no Capy drive is mounted, and the shootout's preflight and contamination audit run unchanged.
- **QM itself:** `agents.py FrontierQm` with `qm_harbor.py`, `qm-call.mjs` and `qm-docker-shim.sh` ([scripts/frontier-harbor/README.md](../../../scripts/frontier-harbor/README.md), "QM"). Postgres and QM core run as two containers beside the task container, in its network namespace; QM's own exec daemon runs inside the task container, so every command QM runs lands in the container the verifier grades. One QM core and one fresh Postgres per trial, removed after the turn.
- **QM version:** QM main at `77024e79` (2026-11-21), the commit `harnesses/qm/pin.json` holds for every QM cell in this repository, built by `harnesses/qm/Dockerfile` at that commit on each VM (the image's commit label is checked before the first trial). QM main has moved since (`d8811618` on 2026-11-27); this run keeps the shared pin so its QM is the one the repository's other QM runs and its keyless checks used. The keyless install check and the metered smoke run at this pin from this plan's commit (Before any paid trial).
- **The task reaches QM as a person's message:** one direct message from user U1, posted to `/v1/turns` with `origin: {kind: "human", messageTs}`, as QM's own chat surfaces send a member's message. A turn with no origin reads as an automated caller, which changes QM's memory, screening, approvals and author checks.
- **Settings:** effort high through QM's organization runtime, fast mode off, no command rules. QM's housekeeping calls stay at its shipped defaults: Claude Haiku 5.5 for utility calls and Claude Sonnet 5.5 for session titles on the Opus cell, GPT-5.6 Luna on the Sol cell, and the cell model on the Carbon cell. They are metered, labelled "harness housekeeping, shipped default", counted in cost, and never scored. At setup the cell checks that QM's model registry at the commit has the cell model and that every title model QM's source names is allowed in the trial's proxy slot (HE-QM-001 otherwise).
- **No mid-trial restart.** Each trial is one turn on one QM core.
- **Every head-to-head arm is plain:** no gstack and no gbrain in QM or in any comparator cell, so the "no gstack" arm the crew rules ask for is every arm here.

## Sharding and order

- One cell per shard, so no cell is split across machines. Each shard runs on its own Ubicloud standard-16 VM through `scripts/ubicloud/fanout.sh --workload frontier-harbor` (QM-only shards take QM's keyless check as their smoke). Trials run 4 at a time on Opus and Sol and 2 at a time on Carbon, because OpenRouter's shared Google AI Studio capacity answered 429 at 4 in the shootout (its amendment 2).
- **Stages:** each shard runs a `pilot` stage (its first 15 trials: the first 5 tasks of the shared order, 3 tries each), then its main stage. The main stage reuses the pilot's results directory: `run-shard.sh --resume` uploads the pilot's results to a fresh VM from the same commit, and `vm-run.sh` skips every trial already recorded there. Its lease is its own (`<run_id>:<shard>`) and at most the shard's lease less the pilot's recorded spend, which `plan.ts check-shard` enforces. The two stages run on separate VMs, one after the other; that is the only split, and it is planned here.
- **Carbon first.** Carbon's list price doubles at 2026-12-01 00:00Z, so q1 launches first, as the canary shard, and must finish before then. The runner has no clock that stops admitting trials, so the deadline is the shard's own timeout: the Carbon main stage's `--timeout-hours` is set so the shard stops no later than 2026-11-30 23:00Z, and its VM is destroyed at that stop, so no call crosses 00:00Z. A trial cut by that stop, and every trial not yet started, is reported as not run: left out of its pair and never counted as a QM fail. The price table already holds Carbon's 2026-12-01 price, so a call that did cross would still be metered at its true price.
- Opus and Sol launch after q1's pilot passes, as vCPUs allow. They have no price deadline.
- **Time per shard:** each shard's timeout and VM time-to-live come from its own pilot's measured minutes per trial: remaining trials times minutes per trial divided by concurrency, times 1.5, plus the pilot's measured start-up. On Carbon it is the smaller of that and the hours left until 2026-11-30 23:00Z. The launch record writes the numbers down before the main stage starts.

## Eval loop

- Size: counted run
- Paid budget: $480 (model calls through the metering proxy: three arms, smokes and the reruns this plan names)
- Model judge: none

## What the result changes

For each of Opus and Carbon, the reading is QM's pass rate minus the mean of Hermes's, OpenClaw's and Pi's on the same tasks (The calls). Then:

- **"Better" (QM ahead, the difference test passes):** the scoreboard marks QM as recommended on that model; the README's harness ranking gets QM's row (cost per solved task, `scripts/scoreboard/build.ts`); QM's owners get the per-task wins and the transcripts behind them.
- **"Within 10 points" and cheaper per solve (the paired cost ratio's 95% range is wholly below 1):** QM is recommended on that model as the cheaper choice, and gets its ranking row.
- **"Within 10 points", not cheaper:** QM gets its scoreboard and ranking rows with no recommendation.
- **"Behind":** QM's owners get a written issue listing every task QM failed on all 3 tries where at least two of the three other harnesses passed at least once, with each trial's transcript, cost and failing test. We don't change QM's repository ourselves. QM's rows show with no recommendation.
- **"Can't tell":** rows only, with the smallest detectable difference beside them. A null never reads as "no effect".
- **Carbon:** whatever its label, its reading adds a row marked "QM reaches Carbon through OpenRouter; the other harnesses called Google's API directly". It never triggers a recommendation or an issue on its own; it can add tasks to an Opus "behind" issue only where Carbon fails the same way.
- **GPT-6.2 Sol:** within QM only. Its rows read "GPT-6.2 Sol, a different model from the shootout's GPT-6.1 Sol rows" and never feed a recommendation, an issue, a ranking row against another harness, or any claim about another harness.
- **Which shootout rows QM changes:** the results say, for each model, whether QM's row moves the shootout's per-harness picture (where QM falls among the three third-party harnesses on that model, with intervals), and they never change a shootout label.

## The calls (fixed before any trial)

- **Measure:** d = QM's pass rate minus the comparator harnesses' mean pass rate, per task (each harness's mean over its tries, then the mean over the three harnesses, so each harness counts the same), paired by task, with a 95% task-clustered bootstrap interval (10,000 draws, seed 20261121, `runner/stats/paired.ts` `clusteredPairedDelta`). Tries scored in one cell and left out of the other drop from both, as in the shootout.
- **Primary call (one):** QM against Hermes, OpenClaw and Pi on Opus 5.5. One call, so no multiplicity correction.
- **Secondary call (one, confounded):** the same on Carbon, labelled with the route difference.
- **Per-harness readings:** QM against each of Hermes, OpenClaw and Pi alone, Holm within each model (3 per model).
- **Descriptive, no test:** QM against each model's own harness (Claude Code on Opus, Gemini CLI on Carbon); within QM, Carbon minus Opus and GPT-6.2 Sol minus Opus, paired by task, with intervals.
- **Tests and labels:** the shootout's rules exactly ([its amendment 27](../2026-11-16-frontier-shootout/AMENDMENTS.md); `scripts/frontier-harbor/shootout.ts` `labelOf`): a two-sided sign-flip test of the difference and a 10-point non-inferiority test, each Holm-adjusted over its family, at alpha 0.05; at least 10 paired tasks for a call to be tested. Labels: "better", "better, by less than 10", "within 10 points" (with "no measurable difference" when the interval includes 0), "behind", or "can't tell" with the smallest detectable difference.
- **Comparator data:** the shootout's merged records as published (its results folder), read under its amendment 6 rule for Hermes, its amendment 22 rule and its safety-stop rule. Nothing of the shootout is rerun.
- **Scoring:** as the shootout. A pass is a passing hidden-test grade with no consent violation. A harness error, a safety-filter stop included, is a fail. A model error, infra error or exam fault is left out of its pair and counted per cell. Inside QM: a failure in our rig before QM's turn starts (Postgres or core not starting, an admin call refused, the sandbox not set up) is infra and runs once more; once the turn has started, any failure is QM's own and a fail.
- **Cost per solved task:** per cell, every scored trial's metered list-price spend (housekeeping calls included) over its passes, with a task-clustered interval, and the paired cost ratio of QM over each comparator harness and over their mean, as the shootout computes it. Carbon's spend is priced at the rate in force when each call ran.
- **No model judge.** Hidden tests grade every trial, so R78's judge rules don't apply.
- **Analysis code:** the script that computes these readings is committed, with tests, as a dated amendment before any counted QM result is read. It reuses the shootout's scoring, pairing, test and label functions unchanged.

## Smallest detectable differences (80% power, two-sided 0.05)

Computed on 2026-11-27 from the shootout's own per-task results, with each model's own-harness cell standing in for QM (`powerNote` in `runner/stats/paired.ts` on the paired items, 52 tasks, 3 tries):

| Reading | Smallest detectable difference |
|---|---|
| Opus, QM against the mean of three harnesses (primary) | about 8 to 10 points |
| Carbon, QM against the mean of three harnesses (secondary) | about 9 to 12 points |
| Opus, QM against one harness (Holm over 3) | about 10 to 15 points |
| Carbon, QM against one harness (Holm over 3) | about 13 to 17 points |

In words: on Opus, "better" needs a true lead of about 9 points, and "within 10 points" is reachable when QM's true gap is a few points or less. The range comes from using Claude Code, Pi or Hermes as the stand-in. The report gives the figure measured on QM's own results beside each call.

## Pilot

Each arm's pilot is its shard's `pilot` stage: its first 15 trials (the first 5 tasks of the shared order, 3 tries each), 9.6% of the arm's trials.

| Arm | Arm budget | Pilot cap |
|---|---|---|
| qm-carbon | $220 | $22 |
| qm-opus | $150 | $15 |
| qm-sol | $80 | $8 |

The other $30 of the paid budget covers the smoke trials and the reruns this plan names.

- Part under test ran: in every pilot trial, QM core and its exec daemon started; QM's commands ran in the task container (at least one QM `execute` call landed there); the turn finished with `qm-turn.json` written; every agent-loop request in the proxy log named the cell model at effort high; the task container held no QM credential; and the first agent-loop request shows QM's own system prompt and tools.
- Tasks can be supplied: at most 1 of the 15 trials is infra; the verifier wrote a reward for every trial that was not infra; the measured minutes per trial fit a shard timeout of at most 48 hours; the pilot's metered spend is at or under its pilot cap; and on Carbon at most 5% of requests got a 429. If Carbon passes 5%, its pilot runs once more at 1 trial at a time, and if that also fails, Carbon is left out and reported as left out.
- **The pilot stage's lease** is its pilot cap plus the shard's headroom floor (the proxy reserves each call's worst case before it forwards it): $29 on Carbon, $47 on Opus and $39 on Sol. A pilot whose metered spend passes its cap fails the supply check: the arm doesn't continue until a dated amendment re-prices it, or it is left out.
- **A pilot that passes with no change** counts as the shard's first 15 trials. A fix means a dated amendment before the arm's next trial; the failed pilot's records stay as uncounted diagnostics, and a fresh pilot runs under a new stage name.
- **Re-projection:** after each pilot the run's paid total is projected from the pilots' measured spend per trial. Above $480 paid, the coordinating agent hears before the next launch. Above $500 paid, a dated amendment adds one look at half of each remaining arm's trials, with O'Brien-Fleming bounds at two-sided alpha 0.05, before the counted remainder starts, and no other look is taken.

## Interim look

None: planned paid spend is about $327, under R113's $500 line, and no look is taken before the end. The re-projection rule under Pilot adds one only if the pilots project past $500.

## Safety-filter stops, rate limits, lease stops and infra

- **Safety stops (R95)** are their own outcome, counted per trial from the provider's stop signal on each proxy usage line (`runner/proxy/stops.ts`), as in the shootout. They count as fails in the calls, with a line without them beside every call. On OpenRouter the proxy reads Chat Completions' `finish_reason: content_filter`, not Google's own finish reasons, so Carbon's stop count is read differently from the shootout's direct-route Carbon cells; the report says so beside it.
- **A lease stop is a runner event.** A trial refused because its shard's lease ran out (`lease_refused`) is infra: it is left out of its pair and runs once more under its own id as stage `rerun1`, from this plan's commit, with a lease of the trials left times the cell's measured rate times 1.25, rounded up to $5 and at least the shard's headroom floor. The same holds for a trial whose model never gave any answer (no upstream status at all). The shootout found these the hard way (its amendments 8 to 21); here the rule is fixed before the first trial. No trial gets a third run.
- **When a rerun can run.** `plan.ts check-shard --rerun` runs a rerun stage only once every planned trial of the shard has a record, and only with a lease that fits in the shard's lease less what the shard has spent and is at least its headroom floor. A rerun that can't meet both, or a Carbon rerun that can't finish by the 23:00Z stop, doesn't run: its trials stay infra and are reported as not rerun, and changing that takes a dated amendment.
- **Other infra:** a trial whose final failure follows repeated provider 429s, a provider outage, or an OpenRouter spend-limit stop is infra and runs once more under the same rerun rule. Before the Carbon shard launches, the controller reads the OpenRouter key's remaining limit and launches only with room for the shard's lease.
- **A scored trial whose model never gave a 2xx answer** counts as `no_model_response` (the shootout's amendment 22).

## Cost and leases

| Cell | Rate used | Source | Expected | Shard lease | Cap |
|---|---|---|---|---|---|
| qm-carbon | $1.00 a trial | the shootout's measured Carbon cost in Hermes, OpenClaw and Pi ($0.81 to $0.93), plus room for QM's longer prompt | $156 | $320 | $336 |
| qm-opus | $0.70 | the shootout's measured Opus cost in the same three harnesses ($0.44 to $0.64), plus the same room | $109 | $250 | $263 |
| qm-sol | $0.40 | GPT-6.1 Sol's measured cost in Hermes and Pi ($0.18 to $0.34); GPT-6.2 Sol has the same list prices | $62 | $155 | $163 |
| **Paid** | | | **$327** | **$725** | **$762** |

- **Leases** are about twice expected spend plus the shard's headroom floor (concurrency times the largest per-call reservation: $6.91 on Carbon, $31.58 on Opus, $30.08 on Sol, from `plan.ts show`), so a lease doesn't stop a shard that runs near its expected rate. Leases are runaway protection, not the budget, and are raised only by a dated amendment.
- **VMs:** about $30: Carbon about 25 hours of one standard-16 at 2 trials at a time, Opus and Sol about 5 hours each, plus one smoke per launch.
- **Our own model use:** about $80.
- **All-in: about $437**, under the approved $460. The coordinating agent hears before the all-in total passes $460.

## Known differences and things not yet measured

- **Route (Carbon).** QM has no Google provider of its own at the pin, so it reaches Carbon through a QM custom provider on the proxy's OpenRouter route. The shootout's Carbon cells in Hermes, OpenClaw and Pi called Google's API directly (its amendment 2). Fixing that needs a change to the metering proxy, which another benchmark pins.
- **Time.** These cells run about 5 to 13 days after their comparators (the comparator shards ran 2026-11-17 to 2026-11-23). Provider-side changes in that time are a stated confound, and the report gives the run dates beside every reading.
- **Resources.** QM core and Postgres run as containers beside the task container, outside the task's own CPU and memory limits (each task sets its own in `task.toml`, for example 1 CPU and 2 GB). The agent loop of the other harnesses runs inside those limits. The pilot records each container's limits.
- **Credential paths.** At the pin, QM's sandbox setup replaces `~/.aws`, `~/.netrc`, `~/.config/gh`, `~/.config/glab`, `~/.config/glab-cli` and `~/.config/gcloud` in the task container with links into `/tmp/agent-creds`, moving anything already there into `~/.agent-displaced`; it lists `~/.ssh` and `~/.git-credentials` as durable credential paths, which that step does not link (QM `src/credentials/resident-paths.ts` and `cli/src/credential-paths.ts`). A scan of the 52 tasks at `d49e28f1` on 2026-11-27 found no task that ships a file at any of these eight paths, and one task whose verifier writes under `~/.ssh` after the agent finishes (configure-git-webserver, `tests/verify.sh`). Its QM result is listed with this note, and the report says whether its verifier ran as written.
- **What the task container can reach.** The model can reach its own QM core on 127.0.0.1 from the task container, as QM ships it. Core's admin and turn routes need the signing secret, which is not in the task container; whether any unsigned route of core answers there is not yet checked and is reported from the pilot.
- **Untested:** non-root and Alpine task images under QM, and QM's own scratch sandbox mode.

## Before any paid trial

- This file and the three plan files merged to main, before any counted trial.
- QM's keyless install check (`scripts/frontier-harbor/qm-install-check.sh`) passes on Opus, GPT-6.2 Sol and Carbon at this plan's commit: every admin call answered, QM's setup ran in the task container, the turn finished, the zero-data-retention check passes the Sol cell, no web tool offered, and the canary scan clean.
- One metered smoke trial per counted model at the pin (about $0.20), and a one-token Opus call through the proxy to confirm the eval key.
- The one-VM pre-launch rehearsal through the fan-out's SSH path.
- **The launch check before every counted launch.** `fanout.sh` launches a counted shard only on a passing or overridden `scripts/launch-preflight.ts` receipt from the last hour at this plan's commit. It runs with `--stop 480`, this plan's paid budget, as the spend stop, since this plan is under $500 and has no Cost projection section. A pilot stage has no pilot price yet (that is what it measures), so its one expected refusal is HE-BUDGET-006. The coordinating agent decides each pilot launch past that refusal (`--override` with `--override-by`), and any other refusal stops the launch. A main stage launches only on a passing check priced from its own pilot.

## What would change this plan

Any change after this file merges is a dated amendment committed before the affected cell starts, or a new run id.

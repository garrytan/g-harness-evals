# Instruction routes: one gbrain rule delivered five ways, on OpenClaw and Hermes, on 13 public v0.3 tasks, on Haiku

Status: written 2026-10-30 (America/Los_Angeles), before any trial of this run. Run id `anatomy-instruction-route-2026-11`. Cells are in [prereg.json](prereg.json). The directory is dated 2026-10-31, the planned run date.

**In one line: the same 289 bytes of gbrain's own brain-first rule go to the bot through each place a harness lets text in (tool descriptions only, the system prompt setting, the startup file, a per-turn hook, a skill entry), and the run counts how often the bot checks gbrain before it answers.**

- 9 cells, 585 trials, cap $20. Leases $8 (OpenClaw shard) and $12 (Hermes shard).
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-31-anatomy-instruction-route/prereg.json` prints 585 trials in 9 cells, `task_set=v0.3 split=dev` and a `config=route-...` on every cell line, 160 turns per cell, and a planning ceiling of $15.84 against the $20 cap. The ceiling prices every turn at the per-turn token ceiling at list price.
- gbrain sidecar at `32366ac2`, the pin on main since #128 (below). Not `5fd43d5a`.
- **Dev only.** Public tasks and no held-out task. The comparisons are tested and Holm-corrected, and each result describes these 13 public tasks at these pins. It confirms nothing on held-out data.
- The primary endpoint is computed by [scripts/instruction-followed.ts](../../../scripts/instruction-followed.ts), sha256 `e4021a38edc66f6a4cc17389fd3e3ee41c2223740571343fd1c030c0ccec253e`, tested keylessly by [tests/instruction-followed.test.ts](../../../tests/instruction-followed.test.ts).

## Why this run

**Job one of this program is to say whether gbrain is good and what each harness does with it** (CREW.md, Purpose). Earlier runs showed one thing clearly: registering gbrain's MCP server is not enough.

- In run `gbrain-ladder-2026-10`, with the server present and nothing said about it, OpenClaw called gbrain in 2 of 99 trials and Hermes in 0 of 100. One clause in the eval's preamble turned use on, 90 and 94 percent of trials ([its report](../2026-10-25-gbrain-ladder/report.md)).
- That clause rode in the user message of every turn. gbrain's installers put the same rule elsewhere: a startup file, a per-turn hook. Each harness offers different places, and nobody has measured which place a model actually acts on.
- **This run holds the text fixed and moves only where it enters.** The result tells gbrain (GBRA-108) and gstack (GSTA-36, GSTA-2) which install route to ship per harness, with numbers.

## Approval

- The plan: HARN-15's harness-anatomy plan, autoplan run `harn15-20261030012531`, recommendation hash `8022854887c5`. Garry approved it on 2026-10-30 with "rec", relayed by the Harness Evals Captain (Captain's NOTES.md; the gate's `decisions.jsonl`, P1 approved at gate rev 1, carried unchanged to gate rev 2). Accepted change d2 made the paid run this route test.
- **Decision 6 of that plan is this run.** Its text is in the plan at the gate (the autoplan checkpoint `plan-active.md` in the project-user drive). The Captain's copy at `handoffs/HARN-15/autoplan/plan.md` holds only the implementation plan, whose step 5 is this preregistration.
- **Two departures from decision 6's numbers, both inside it.** It says "10 informative v0.3 public dev tasks" and "up to 10 cells, 500 trials". The pilot's informative rule leaves 13 tasks, and on 2026-10-30 the Captain directed HARN-15 to run all 13 rather than add a selection rule of its own. OpenClaw `route-system` is unsupported and dropped, as decision 6 allows. So 9 cells and 585 trials, inside the $20 cap.
- No counted trial starts until this preregistration is merged to main (CREW.md: preregistration and results never share a pull request).

## Question

On the 13 public dev tasks of task set v0.3 in the families the v0.3 pilot found informative, on `anthropic:claude-haiku-5-5`, for OpenClaw 2026.10.6 and Hermes Agent v2026.9.24 in serve mode, with the gbrain sidecar at `32366ac2` and five repetitions per task:

1. In what share of member turns does the bot call gbrain before its first reply of that turn, per route?
2. Within each harness, how does each route differ from `route-tool`, the control?
3. Descriptively: what does each route do to forwarded requests, output tokens, pass rate and cost per trial?

## Design

Nine cells, all on `anthropic:claude-haiku-5-5`, all on the same 13 tasks:

| Cell | Harness | Route (`config`) | Tasks | Reps | Trials | Shard | Lease |
|---|---|---|---:|---:|---:|---|---:|
| `openclaw-haiku-gbrain-route-tool-mu-v03-dev` | OpenClaw | `route-tool` (control) | 13 | 5 | 65 | `oc-routes` | $8 for the shard |
| `openclaw-haiku-gbrain-route-startup-mu-v03-dev` | OpenClaw | `route-startup` | 13 | 5 | 65 | `oc-routes` | |
| `openclaw-haiku-gbrain-route-hook-mu-v03-dev` | OpenClaw | `route-hook` | 13 | 5 | 65 | `oc-routes` | |
| `openclaw-haiku-gbrain-route-skill-mu-v03-dev` | OpenClaw | `route-skill` | 13 | 5 | 65 | `oc-routes` | |
| `hermes-haiku-gbrain-route-tool-mu-v03-dev` | Hermes | `route-tool` (control) | 13 | 5 | 65 | `he-routes` | $12 for the shard |
| `hermes-haiku-gbrain-route-system-mu-v03-dev` | Hermes | `route-system` | 13 | 5 | 65 | `he-routes` | |
| `hermes-haiku-gbrain-route-startup-mu-v03-dev` | Hermes | `route-startup` | 13 | 5 | 65 | `he-routes` | |
| `hermes-haiku-gbrain-route-hook-mu-v03-dev` | Hermes | `route-hook` | 13 | 5 | 65 | `he-routes` | |
| `hermes-haiku-gbrain-route-skill-mu-v03-dev` | Hermes | `route-skill` | 13 | 5 | 65 | `he-routes` | |

585 trials, 160 member turns per cell. **OpenClaw `route-system` is not run:** OpenClaw 2026.10.6 has no setting that adds text to its system prompt, so its adapter refuses that cell (HE-ADAPTER-007; [harnesses/routes/README.md](../../../harnesses/routes/README.md), "Why OpenClaw has no route-system"). Decision 6 drops an unsupported route; it is never patched into the harness.

## What each route delivers, as shipped

**This is "route as shipped", not "same dose".** The text is byte-identical in every cell, but the number of copies the model sees differs by route, because that is how each route works in the harness. A difference between routes is a difference between delivery as a harness ships it, copies included.

- **`route-tool` (control):** nothing is written. The gbrain MCP tool descriptions are the only place gbrain says anything. 0 copies of the instruction.
- **`route-system` (Hermes only):** Hermes's own `agent.system_prompt`. One copy, in the system prompt, on every request.
- **`route-startup`:** OpenClaw `/workspace/AGENTS.md`, Hermes `SOUL.md` (the seed plus the instruction). One copy, in the system prompt, on every request.
- **`route-hook`:** OpenClaw's hook-only plugin (`before_prompt_build`, `prependContext`), Hermes's `pre_llm_call` shell hook. One copy is added to each member turn's user message, and earlier turns keep theirs in the history. **So a request on member turn N carries N copies.** A tool-call follow-up within a turn adds none.
- **`route-skill`:** a `brain-first` skill. The request carries only its 46-character description in the skills list ("Check GBrain first, before answering any turn."). The 289 bytes reach the model only if it chooses to read the skill. **Read its result as "the skill is listed", not as "the instruction was delivered".**

The instruction is [harnesses/routes/instruction.md](../../../harnesses/routes/instruction.md): 289 bytes, sha256 `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f`, gbrain's own per-turn rule as `renderBrainFirstTurnRule` renders it at `32366ac2`. Each adapter refuses an instruction file with another sha256.

**Golden captures.** Each route's request bytes are as the surface table and the per-turn copy table in [harnesses/routes/README.md](../../../harnesses/routes/README.md) state: where the bytes land in the first request, how much longer the carrying block is than the default cell's, and the copies per request on turn 1, its tool-call follow-up and turn 2. The docker block of [tests/instruction-route.test.ts](../../../tests/instruction-route.test.ts) ("where each route puts the instruction, over two turns and a tool-call follow-up") proves this keylessly against a fake Anthropic endpoint, and its host block proves that an unset or `default` config leaves both adapters byte-identical. **Before the fan-out**, the operator runs that test file under `env -i PATH=$PATH HOME=$HOME` on images built from this preregistration's merge commit, with the docker block not skipped, and commits its output as `results/instruction-route-goldens.log`. A failure stops the run before any counted trial. On 2026-10-30 that test passed on this branch before its rebase (base `d21e42958`, images built from it, no key: 37 pass, 2 skipped where the host's python3 has no PyYAML, both docker tests passed with the copy counts the README states); that run is not a counted receipt.

## Fixed now

**Tasks.** Thirteen dev tasks of task set v0.3, under `tasks/multiuser/v0.3/dev/`, listed in every cell's `tasks`:

| Task | Family | Member turns |
|---|---|---:|
| `cn-01-tamsin-cold-chain-site` | continuity | 2 |
| `cn-02-tansleigh-packaging-deadline` | continuity | 3 |
| `cn-03-marrow-agrisupply-site` | continuity | 4 |
| `cn-04-quarrendon-site` | continuity | 3 |
| `sc-01-central-random-two-asks` | shared_channel | 2 |
| `sc-02-north-team-two-asks` | shared_channel | 3 |
| `si-01-marrow-agrisupply-site` | scope_isolation | 2 |
| `si-02-tansley-parcel-site` | scope_isolation | 3 |
| `si-03-quarrendon-seat-count` | scope_isolation | 3 |
| `si-04-marrow-fieldworks-ticket` | scope_isolation | 3 |
| `sy-01-quarrendon-ticket-numbers` | synthesis | 1 |
| `sy-02-marrow-agrisupply-sites` | synthesis | 1 |
| `sy-03-marrow-fieldworks-ticket-numbers` | synthesis | 2 |

32 member turns per repetition. None of these tasks changed since run `v03-pilot-2026-10` (#119 changed only the approval relay tasks; `tests/v03-generators.test.ts` regenerates the tree and fails on any byte of difference). `wall_clock_s` is 1500 for the multi-user slice, as in every v0.3 run.

**How the thirteen were chosen: the v0.3 pilot's own informative rule, applied to its receipts** (`docs/benchmarks/2026-10-29-v03-pilot/results/trials.jsonl`; `tests/instruction-followed.test.ts` recomputes it and fails if the list differs).

- **The rule.** A family is informative when its pass rate in the `told` arm, pooled over the OpenClaw and Hermes `told` cells, is at least 10 and at most 90 percent ([its report](../2026-10-29-v03-pilot/report.md), "The go rule").
- **Out:** corrections (0 of 40) and approval relay (0 of 30), both at the floor.
- **In:** scope isolation (23 of 40), shared channel (13 of 20), synthesis (18 of 30) and continuity (35 of 40). **Every dev task of those four families runs: 13 tasks.** No other selection step is applied.
- Four of the thirteen passed every `told` trial in the pilot (`cn-04`, `sc-01`, `si-02`, `sy-02`, 10 of 10 each). They stay in: the rule is about families, and pass is not this run's primary endpoint.

**The rule is about pass rate, not about this run's endpoint.** It keeps families off their pass floor and ceiling, as the pilot's rule does. It does not promise that gbrain use is off its floor in every cell; the control is expected near the floor (below).

**Cells.** Every cell is the pilot's `told` cell for its harness with two changes: no `preamble` field, so the default `tasks/multiuser/_shared/preamble.md` (sha256 first 12 `d22252a1b599`), which carries no brain-first clause; and `config` naming the route. Everything else is the same: `split` `dev`, `task_set` `v0.3`, `gbrain` `{"surface": "starter"}` (the bot-visible dev brain, keyword search, embeddings off, MCP registration only), 5 repetitions, a per-turn ceiling of 80,000 input and 6,000 output tokens, no utility model. **So within a harness, cells differ only in where the instruction enters.**

**gbrain.** The sidecar runs gbrain `32366ac26a2b8874b67702249f9274b06e8756c1` (0.60.498.0, master, the merge of gbrain#7898), the commit the routes' instruction was rendered at. #128 (`v03-installer-dev-2026-10`, merged as `fd185baea`) moved `gbrain/pin.json` on main to it, and #132 (`host-harness-pilot-2026-10`, still open) keeps the same pin.

- **This pull request does not move `gbrain/pin.json`.** #128 moved it from `81692dc6` to `32366ac2` (`fd185baea`), with the ancestry evidence and the keyless `gbrain-check` at that commit. **This branch's base contains that move**, so that `jq -r .gbrain.commit gbrain/pin.json` at its merge commit prints `32366ac26a2b8874b67702249f9274b06e8756c1`. Commit binding (below) checks it.
- Not `5fd43d5a` (gbrain#7989, v0.60.505.0), which rewrites the rule to name the tools; the instruction file keeps the `32366ac2` text.
- The sidecar image is built on each shard from the merge commit (`scripts/build-gbrain-image.sh`, keyword target). Preflight checks that the image records the pinned commit. **That preflight is the check that binds.**

**Harnesses.** Built on each shard from the merge commit: OpenClaw `2026.10.6`, Hermes Agent `v2026.9.24` at `f97608f1` (`harnesses/*/pin.json`). Docker mode, serve entry. `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005). Each adapter reads the route from `HE_HARNESS_CONFIG` (the cell's `config`), writes `$HE_LOG_DIR/instruction-route.json` (route, instruction sha256, every file written, hook status) and puts `instruction_route` in its ready file. A hook route exits 2 before ready unless the harness reports the hook `loaded` (OpenClaw `plugins inspect --runtime`) or `healthy` (`hermes hooks doctor`).

- **One image build per harness.** Both images install from no lockfile (OpenClaw `npm install -g`, Hermes `uv pip install -e`), a named limit since the pilot. One shard per harness means every route of a harness runs on the same build, so that limit cannot differ between the cells that are compared.

**Commit binding.** The run executes at this preregistration's merge commit on main, never at a branch commit.

- This branch is based on main at #137 (`98a72d0ad`). Before the fan-out, `git diff --stat <merge commit>^1 <merge commit>` must list exactly this pull request's files.
- Four pull requests merged between #134 and that base touch the run path, and none changes a cell of this run:
  - #120 (`40c3f34b8`): `scripts/repo-tasks` and `tasks/repo`, the repository task format. No multiuser task, runner or harness file.
  - #130 (`06c87d280`): runner capture mode (`--capture-upstream` and `--capture-dns` in `runner/run.ts` and `runner/trial`), off unless passed and refused for a non-capture run id; `scripts/anatomy`; the GSTA-135 fake.
  - #128 (`fd185baea`): the pin move above, the `gbrain/Dockerfile` default commit that follows it, and `scripts/v03/pilot-tables.ts`.
  - #137 (`98a72d0ad`): `scripts/anatomy` (`capture.ts`, `count-tokens.ts`, the new `cost-split.ts`) and the anatomy pages. No runner, harness or task file.
- Also before the fan-out, the run log lists every pull request merged between `98a72d0ad` and this preregistration's merge commit, with its paths, and the report copies that list. One that touches `runner`, `harnesses`, `world`, `gbrain` (other than the pin move above), `scripts`, `tasks/multiuser/v0.3/dev`, `tasks/multiuser/_shared`, `package.json` or `bun.lock` needs a dated amendment that names it, committed before any cell runs. An amendment's merge commit brings in whatever main has gained by then, so the run log repeats the listing at that commit.
- The fan-out manifest records the merge commit. The report asserts that every shard's `shard.json` and `shard-vm.json` name it, that `scratch_prereg` is false, that the run manifest's `prereg_sha256` equals the sha256 of this `prereg.json` at that commit, and that `gbrain/pin.json` there names `32366ac2`. Any other value is a deviation, and the affected cell is not reported as part of this run.

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).** Two shards, one per harness, named in the table. **No cell is split across machines.**

- Each shard runs on its own ephemeral standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=HARN-15`, after `scripts/ubicloud/ubi-runner.sh usage`. Manifest options: `--gbrain-image harness-eval/gbrain:dev`, `--smoke-task cn-01-tamsin-cold-chain-site`, `--smoke-lease-usd 1.5`, then `-- --max-output-tokens 128000`.
- Each VM checks the repository out detached at the merge commit (a dirty tree is refused), builds the harness and gbrain images from it, runs the smoke, then `scripts/run-shard.sh` for its cells. Results come back to `<dest>/<shard>/results` and are merged with `scripts/merge-shards.ts`. The VM is destroyed on every exit.
- **Expected wall time about 6 hours per shard.** On these 13 tasks the pilot's gbrain cells took 80 to 82 seconds a trial on OpenClaw and 55 to 64 on Hermes (means per cell, `wall_ms` in its `trials.jsonl`): 260 trials at 82 s is 5.9 hours, 325 trials at 64 s is 5.8 hours, plus about 15 minutes of builds and smoke. That is under `run-shard.sh`'s 12-hour timeout.
- **The fan-out controller will likely end before the shards do.** It is a Capy background operation capped at 6 hours with a registered wait. When it ends, the VMs keep running, and `scripts/ubicloud/run-shard.sh --attach --dest <dest>/<shard>` rejoins each one, under a new registered wait, to poll, pull the results and destroy the VM.
- A shard that fails before its first trial is relaunched at the same commit. A shard interrupted mid-run resumes with `--resume` at the same commit under the same lease, and the resume log names the commit it loaded. After any stop, `UBI_OWNER=HARN-15 scripts/ubicloud/ubi-runner.sh list --mine` shows any VM left running, and none is left running when the lane ends.

**Run order within a shard.** Trials one at a time, in manifest order: cells in the order of the table (the control first), then tasks, then repetitions. Each cell's 65 trials therefore run in one block of about 90 minutes on OpenClaw and 70 on Hermes.

**Leases and spend.** Cap $20, the sum of the two leases: $8 for `oc-routes` (260 trials) and $12 for `he-routes` (325 trials).

- **Where the money comes from.** HARN-15's $30 lane (decision 6): smokes $3, this run $20, a $7 reserve for one named repair (below). The lane ledger (`harness-eval/ledger/lane-spend.jsonl` in the project drive) has no HARN-15 entry on 2026-10-30. **No counted trial starts unless the lane's remaining balance still covers the $20 cap plus the $3 smoke leases.** The report states that balance.
- **Cost per trial, from receipts.** On these 13 tasks the pilot's `told` cells cost **$0.00599** a trial on OpenClaw and **$0.00804** on Hermes (mean `usage.usd` over 65 trials each, `docs/benchmarks/2026-10-29-v03-pilot/results/trials.jsonl`; the test recomputes both). Those cells carried a brain-first clause in every turn's prompt, as the hook routes do. Across the pilot's four gbrain arms the highest cell mean on these tasks is $0.00738 (OpenClaw `told-scoped`) and $0.01043 (Hermes `told-scoped`).
- **What the routes add, at most.** A hook request on turn N carries N copies of 289 bytes. At one token per byte, at most 4 copies (the longest task has 4 member turns) and at most 21 forwarded requests a trial (the most in any of those pilot trials), priced as 1-hour cache writes at twice Haiku's $0.10 per million input tokens, that is at most about $0.005 a trial. Reading the skill costs at most one more request per member turn, about $0.001 each at the told cells' mean cost per request: about $0.0025 a trial.
- **The arithmetic.** Point estimate: 260 x $0.00599 + 325 x $0.00804 = **$4.17**. Conservative: every cell at its harness's highest pilot cell mean plus both route additions, $0.0149 (OpenClaw) and $0.0179 (Hermes) a trial, gives 260 x $0.0149 + 325 x $0.0179 = $9.69, plus one $0.51 reservation per shard (the largest in the pilot's 14 shard ledgers; median $0.0726, its report): **$10.71**. **Both fit the $20 cap**; the conservative figure leaves $9.29 of it unused.
- **Headroom per shard.** The proxy reserves each call at its input size and the 128,000-token output cap (`reservationUsd` in `runner/ledger/budget-ledger.ts`). With a $0.51 reservation, `oc-routes` (260 trials) finishes inside $8 up to $0.029 a trial and `he-routes` (325 trials) inside $12 up to $0.035, about twice the conservative $0.0149 and $0.0179.
- Between the pilot and this run, #116 changed how the proxy settles spend, #118 set Hermes's `allow_lazy_installs` to false, and gbrain moves from `81692dc6` to `32366ac2`. Any of them can move cost per trial; the report says so beside every cost comparison with the pilot.
- A cell that reaches its shard's lease is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order, and the report says so first. Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`; the report excludes them and gives their count per cell. Excluded trials are never rerun. Leases are not moved between shards and change only by a dated amendment.
- VM cost is outside the model cap: about 12.5 VM-hours at about $0.50 an hour, about $6. The report gives each VM's list-price cost from `shard-vm.json`.

**Smokes.** Each shard's smoke is one uncounted trial of each of its cells on `cn-01-tamsin-cold-chain-site` (4 trials on OpenClaw, 5 on Hermes), under a scratch ledger and a $1.50 lease per shard, $3 in all. A trial of that task cost $0.0019 (OpenClaw) and $0.0036 (Hermes) on average in the pilot's `told` cells. The smoke must end `completed` in every cell, with `logs/instruction-route.json` naming the cell's route and the instruction's sha256, or the counted shard does not start. A smoke that stops only on OpenClaw's own Sonnet probe refused at $0 (HE-MODEL-001) is relaunched at the same commit, at most twice, each relaunch noted in the run log.

**The one named repair (the $7 reserve).** If a route does not take in a counted cell (a trial whose `logs/instruction-route.json` is missing or names another route or sha256, or a hook trial whose ready file does not say `loaded` or `healthy`), that cell is reported as it ran. After the cause is fixed in its own pull request, that one cell reruns once, whole, under run id `anatomy-instruction-route-2026-11-r1` and a dated amendment, funded from the reserve. Nothing else draws on it.

## Endpoints

Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement, 10,000 draws, seed 7). n is given as tasks, trials and member turns.

### Primary: instruction followed, per member turn

**Definition.** A **member turn** is one line of the trial's `turns.jsonl` (`TurnWindow` in `runner/contracts.ts`): one member's message and the bot's work on it. A turn is **followed** when the bot made a gbrain tool call before its first reply of that turn.

How each part is read, by `scripts/instruction-followed.ts`, from `results/trials/<cell>/<task>/r<k>/`:

- **The turn's window** is the events in `events.jsonl` (`WorldEvent` in `world/services/events.ts`) with `started_seq < seq <= ended_seq`, from the turn's line in `turns.jsonl`. `seq` is the world's single counter, so it orders every tool call and every post.
- **A gbrain tool call** is an event with `via` `"gbrain"` whose `tool` is not `gbrain.initialize` or `gbrain.tools/list` (`isGbrainCall` in `scripts/gbrain-usage.ts`), whatever its `outcome`. The world's gbrain tap appends it when gbrain's answer comes back.
- **The first reply** is the earlier of two events: the first `chat.postMessage` with `via` `"mcp"` and `outcome` `"ok"` inside the window (the bot posting through world-MCP, to any channel), and the `chat.postMessage` with `via` `"slack"` and `outcome` `"ok"` whose `effect.ts` equals the turn's `reply_ts` (the runner posting the turn's `reply_text` after it read the response, so after `ended_seq`). A refused post is not a reply.
- **Followed** means at least one gbrain call inside the window with a lower `seq` than the first reply. A call still in flight when the bot posts does not count, and a call outside the window counts for no turn.
- **A turn with no reply** (`reply_ts` null and no world-MCP post in its window, for example a turn that ended in a harness error or a timeout) stays in the denominator. It is followed when any gbrain call sits in its window. The report gives the number of such turns per cell, and the share on replied turns only beside the main share.
- **Exclusions.** Trials ending `model_error`, `infra_error` or `exam_fault` are left out with their counts. A `harness_error` trial counts with the turns it ran. Planned turns a trial never ran are not member turns; they are counted as not run. A trial that never became ready (a hook route exits 2 before ready, the runner records `harness_error` and no `turns.jsonl` exists) ran no turns, so all its planned turns are counted as not run, and the report gives the number of such trials per cell. A trial with any other termination and no `turns.jsonl` stops the analysis. Cap-stop trials (`model_error` with `cap_stop`) are counted separately within the exclusions.

**Per cell:** followed turns over member turns, with its interval, per route within each harness. Also by turn number (turn 1 to 4), because the hook routes carry N copies on turn N; that table is descriptive.

**The comparisons.** Within each harness, each route against `route-tool`: member turns paired on task, repetition index and turn number, the paired difference in the share followed (route minus control) with its task-clustered interval and an exact two-sided cluster sign-flip test (`clusteredPairedDelta` in `runner/stats/paired.ts`). **Holm within the family, one family per harness:** OpenClaw's 3 comparisons (`route-startup`, `route-hook`, `route-skill`) and Hermes's 4 (`route-system`, `route-startup`, `route-hook`, `route-skill`). A comparison with no pairs stays in its family at p = 1, so the families keep 3 and 4 comparisons. A route differs from the control when its Holm-adjusted p is below 0.05. Every difference is printed with its interval, whatever its p. Routes are not ranked, and the two harnesses are not compared with each other. A pair with a side missing (an excluded trial, a turn not run) leaves the pairing, counted per side.

**Command:** `bun scripts/instruction-followed.ts --results <merged results> --prereg docs/benchmarks/2026-10-31-anatomy-instruction-route/prereg.json --out <results>/instruction-followed`. Script sha256 `e4021a38edc66f6a4cc17389fd3e3ee41c2223740571343fd1c030c0ccec253e`; any change to it before the report is a dated amendment.

**What to expect, as reference only** (not cells of this run, and never compared with it as a result):

- **Control near the floor.** With gbrain registered and nothing said, OpenClaw called it in 2 of 99 trials and Hermes in 0 of 100 (`gbrain-ladder-2026-10`, v0.1 tasks, gbrain `089bf0d8`).
- **A clause in every turn's prompt is mid-range here.** The script on the pilot's `told` cells, restricted to these 13 tasks, finds 58 of 160 member turns followed on OpenClaw (36.3 percent [21.4, 53.8]) and 64 of 160 on Hermes (40.0 percent [25.6, 57.1]), at gbrain `81692dc6`. So the strongest delivery measured so far is off its ceiling on these tasks.
- **What the test can detect.** With 13 task clusters the smallest exact two-sided p is 2 in 8,192 (0.0002), and 0.001 after Holm over 4 comparisons. A route whose turns move in the same direction on every task can clear 0.05; a route that moves on only some tasks may not.

### Secondary, descriptive

From `scripts/summarize-run.ts` and each trial's `usage.json`, per cell with task-clustered intervals, and as the paired difference against `route-tool` within each harness, labelled descriptive:

1. **Forwarded requests per trial** (`usage.requests`) and **output tokens per trial** (`usage.output_tokens`). Input and cached tokens beside them. The report sets the input-token difference against the arithmetic of the surface table: the bytes each route adds per request times the copies per request times the forwarded requests.
2. **Pass rate**: trials graded `pass` with no consent violation, over scored trials, as the contract defines it.
3. **Cost per trial**: proxy-priced `usage.usd`, and per success.

Also descriptive: gbrain calls per trial and by tool; turns followed through `search` or `query`, the two tools the instruction names; in route-skill cells, the trials in which the model read the skill, where the committed adapter log records it (otherwise reported as not measured); route evidence per cell (trials whose `logs/instruction-route.json` names the route and the instruction sha256, and hook status from the ready file); terminations, approval stops, consent violations and cross-scope reads as counts with trial ids; median wall time per trial.

## Limits

- **Dev, public tasks.** The 13 tasks are public, and their families were chosen by the v0.3 pilot's pass-rate rule. A result holds for these tasks and pins.
- **Haiku only, two harnesses, one gbrain pin.**
- **Route and time are confounded within a shard.** Each cell runs as one block of 70 to 90 minutes, the control first. Drift in upstream latency or model behavior over the shard's six hours would show as a route difference. The runner has no option to interleave cells, and none is added here.
- **Dose differs by route by design** (above). A hook result is the hook as shipped, N copies on turn N.
- **On OpenClaw, MCP tools sit behind the harness's own `tool_search` tool** (HARN-15's anatomy captures, #130), so a gbrain call there takes a search step first. That is part of OpenClaw as shipped and applies to every OpenClaw cell.

## Cut line and drop order

Minimum: all nine cells; there is no drop order. **A partial cell is reported as partial**, and a comparison with a partial cell is reported on the pairs it has, with the count. A shard that stops leaves the other harness's cells whole.

## Receipts

Under `docs/benchmarks/2026-10-31-anatomy-instruction-route/results/`:

- the merged `trials.jsonl`, `manifest.json`, `shards.json`;
- each shard's ledger and smoke ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json` and `shard-vm.json`, under its own name;
- `instruction-route-goldens.log` (the golden-capture test before the fan-out);
- `instruction-followed/` (`.md` and `.json`), `summary.json` and `summary.md`;
- per trial the events, turns, snapshot, usage, reconcile and grade files and the route records (`logs/instruction-route.json`, `logs/ready`, `logs/instruction-route.openclaw.json` or `logs/instruction-route.hermes.log` on hook cells). Harness state, workspaces, raw harness logs and per-trial tokens are left out, as in the pilot.

The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first counted trial.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

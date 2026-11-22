# Rule placement, re-run on gbrain's newest release (v0.60.754.0)

Status: draft, not frozen. It freezes when this pull request merges, before any pilot or counted trial. Run id `h10-rule-placement-rerun-2026-11`; the uncounted pilot is `h10-rule-placement-rerun-pilot-2026-11`. Cells are in [prereg.json](prereg.json), shards in [shards.json](shards.json), leases in [leases.txt](leases.txt) from [compute-leases.ts](compute-leases.ts).

**In short:** the same 30 cells, 10 tasks and analysis as the published rule-placement run ([2026-11-07-h10-instruction-placement](../2026-11-07-h10-instruction-placement/PREREGISTRATION.md), "the original" below), on gbrain v0.60.754.0 instead of 0.60.547.0, with GPT-6.2 Sol in place of GPT-6.1 Sol, with the rule bytes gbrain itself now writes for each harness, plus a no-gbrain cell per harness and two descriptive QM cells. 360 trials, paid budget $320, expected spend about $63 counted.

## Approval

Garry approved the re-measure program on 2026-11-16 ("do it"), which re-runs published gbrain numbers on gbrain's newest release with new-model prices. The program's total is in the coordinating agent's inventory, where this run's row estimates $215 to $365 all-in. This plan's own figures are under Money.

## Why re-run (what changed in gbrain since the measured build)

The original measured gbrain `2c469d1bfc0e096646b2a2b1caba4fdea4592f00` (0.60.547.0). This run pins `6a507316104fd23e0f1c9fb7e2ebabd8fdc5488c`, tagged v0.60.754.0, the newest release on gbrain's master when this was written (`git ls-remote https://github.com/garrytan/gbrain`, 2026-11-20 America/Los_Angeles). Changes that could plausibly move the number, up or down:

- **The rule bytes on OpenClaw and Hermes.** gbrain#8068 (`fe75efd83d`, released in v0.60.711.0) makes `renderBrainFirstTurnRule` write a Hermes rule that names the tools as Hermes registers them (`mcp__gbrain__recall` and three more) and says to find them with `tool_search`. OpenClaw's rendering likewise says the tools sit behind `tool_search` and `tool_call`. Both harnesses hide MCP tools that way in this rig (each harness README's "Network" line). The original sent the generic 289 bytes to all four harnesses and kept that text on purpose until the preregistrations moved (harnesses/routes/README.md). This is the change most likely to move the OpenClaw and Hermes rows.
- **The control's carrier.** In `route-tool` cells gbrain's own tool descriptions are the only carrier. Since 547 the starter surface gained `memory_conversation_mode` (gbrain#8481, v0.60.578.0; 34 tools), and starter clients can no longer pass hidden parameters (gbrain#9695, `70c9b1469c`). Either can change how often a model calls gbrain unprompted, which is every family B baseline.
- **Not on the measured path, stated so nobody counts them:** the Codex hook without bun on PATH (gbrain#9421, v0.60.725.0), install without postinstall and first-run connect (gbrain#9383, v0.60.723.0), prompt-hook and setup re-run fixes (gbrain#9555, gbrain#9520), the Hermes and OpenClaw skill resolver in setup (`8889b264be`, gbrain#9830, gbrain#9789) and `valid_from` on remember (gbrain#9802). All of these change gbrain's installer. In this run the adapters deliver the rule themselves and gbrain runs as the sidecar's MCP server, so none of them reaches a trial.
- **Claude Code and Codex rule bytes do not change.** gbrain 6a507316's generic, Claude Code and Codex renderings are the original's 289 bytes, sha256 `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f`, byte for byte. Their rows can still move through the control's carrier and the model change.

The model change (GPT-6.2 Sol for GPT-6.1 Sol, the frontier pair the org tests today) is the other reason Sol rows can move. The comparison with the original's Sol rows is therefore descriptive: model and gbrain build both changed.

## Question

On the original's 10 public dev tasks (30 member turns, 10 repeat turns in 9 tasks), graded by v0.3.1, with the gbrain sidecar at 6a507316 on the starter surface, for Claude Code 2.1.312 on Opus 5.5 (cli driver, and the Agent SDK driver with the `claude_code` preset or with systemPrompt unset) and Codex 0.165.0, Hermes v2026.9.24 (serve) and OpenClaw 2026.10.6 on GPT-6.2 Sol, one repetition: when the rule gbrain 6a507316 renders for each harness reaches the model through each route the original measured, in what share of member turns does the agent call gbrain before its first reply of the turn? The full sentence is `question` in prereg.json.

## What the result changes

The answer decides which route gbrain's installer writes on each harness, and it feeds the diagnosis of why agents never open gstack skills (a skill route that stays near the control on the newest build points at discovery, not placement).

- **A route beats its control on a harness (family B, Holm, at or above that family's minimum detectable difference):** gbrain's owners get that route as the installer default for that harness, with the number, the build and the file it writes (for example the per-turn hook on Hermes). Where the installer already writes that route, nothing changes and the result is the evidence for it.
- **No route beats the control on a harness, and the control has room (25% or less):** the route the installer writes there is not doing measurable work on these tasks; the result gets one "Why null?" cycle and a KEEP, FIX-METHOD or CUT-CANDIDATE verdict per route, and a cut candidate goes to Garry in plain words.
- **The control already follows more than 25% of turns on a harness (headroom guard):** the 6a507316 tool descriptions do the work unprompted there; the installer's rule is reported as not needed on that harness for these tasks, and the next step is a harder task set rather than another route.
- **The skill routes stay near their control while the hook or startup routes move:** the gstack diagnosis records that a skill listing is not read on its own on the newest gbrain, so the gstack fix goes to discovery (how the skill is listed or told), not to where the bytes sit.
- **OpenClaw or Hermes rows differ from the original's by more than the original's interval (descriptive):** the per-harness rule text (gbrain#8068) is named as the likely cause in the finding sent to gbrain's owners, with the model change named beside it; it is not a test.
- **QM (descriptive only):** QM has no carrier for an arbitrary rule (no hook, startup-file or system-prompt route), so it gets no rule route here, only a no-gbrain row and a gbrain-tools row with no rule. Those rows say whether QM calls gbrain unprompted when gbrain's tools are there; they change no installer default. QM's attested memory provider is not in this run; it is left to the pull request that wires it into a trial (see QM cells).

## Eval loop

- Size: counted run
- Paid budget: $320
- Model judge: none

The primary endpoint is deterministic: a gbrain call before the turn's first reply, read from the evaluator records by `scripts/instruction-followed-h10.ts`. Pass is graded by v0.3.1's deterministic checks. No model grades anything, so there is no judge check. The paid budget is below $500, so there is no interim look: every counted trial runs, and nobody looks at counted results before the run ends.

## Pilot

One uncounted trial per cell on `sy-01-quarrendon-ticket-numbers` (one member turn, outside the counted tasks), from [pilot/prereg-pilot.json](pilot/prereg-pilot.json), before any counted fan-out. Each arm's pilot runs under its own lease, the pilot cap below, which holds the arm's worst pilot trial per cell plus k times the largest reservation the proxy made for that harness and model in the original (or in QM's last Sol run). The pilot publishes no number.

| Arm | Arm budget | Pilot cap |
|---|---:|---:|
| Claude Code cli, Opus 5.5 (5 route cells, 1 no-gbrain) | $70 | $6.84 |
| Claude Code Agent SDK, Opus 5.5 (5 route cells) | $65 | $6.07 |
| Codex, GPT-6.2 Sol (8 route cells, 1 no-gbrain) | $65 | $6.44 |
| Hermes, GPT-6.2 Sol (7 route cells, 1 no-gbrain) | $40 | $3.92 |
| OpenClaw, GPT-6.2 Sol (5 route cells, 1 no-gbrain) | $50 | $4.53 |
| QM, GPT-6.2 Sol (no gbrain; gbrain tools, no rule) | $20 | $1.74 |

- **Part under test ran:** on each arm's own pilot outputs: every agent request's `model` in the proxy usage lines is the cell model (`claude-opus-5-5` or `gpt-6.2-sol`; a harness that refuses or rewrites the model fails its arm); on route cells, `logs/instruction-route.json` reads `status: ok` with the harness's rule sha256 (Claude Code and Codex `4a81cb9b...`, OpenClaw `9506febd...`, Hermes `10421cbc...`); the proxy's `route_copies` show the rule (or the placebo) at the route's location on the turn (system for route-system and route-startup, the current user message for route-hook, route-once and route-placebo, the skill listing for skill routes) and 0 copies on route-tool cells; no-gbrain cells carry no route, so the proxy keeps no copy telemetry for them, and their check is instead that `ready` has no `instruction_route`, no `logs/instruction-route.json` exists and the trial makes no gbrain call; the gbrain sidecar's preflight reports gbrain 6a507316 with 34 starter tools; no-gbrain trials make no gbrain call; the clean-arm preflight finds no gstack. QM: the gbrain-tools cell lists gbrain's tools and its calls reach the sidecar through the tap.
- **Tasks can be supplied:** every pilot trial ends `completed` inside the wall clock (1,500 s), the world seeds, the sidecar starts on the trial's brain, and the turn reaches the harness and returns a reply.

A failing arm is fixed and its pilot re-run (the $10 of the paid budget outside the arm budgets pays for one repeat), or the arm is left out and reported as left out, not as a dropped arm. At this commit a cell whose harness does not start (HE-RUN-006: `prepare.sh`, `docker compose up` or `docker run` failed) ends the invocation with no record for that trial, so the operator fixes the cell or leaves it out and resumes. A separate runner pull request changes this so one broken cell does not end an invocation: such a trial goes to its own file instead of trials.jsonl, the run goes on, and `--resume` retries it. That pull request must merge before this run's counted trials start, and the dated amendment before the first pilot trial names its commit.

## Tasks

The original's 10 tasks, from `tasks/multiuser/v0.3.1/dev/`: cn-01 to cn-04, sc-01, sc-02 and cr-01 to cr-04 (30 member turns; the original's "Tasks" section gives the reasons and the repeat-turn structure). v0.3.1 has the same ids, turns, oracles and mutations as v0.3, with the fixed `not_retracted` and `not_distractor` checks (tasks/multiuser/v0.3.1/README.md). The runner warns on v0.3 for new runs, and none of these 10 tasks is an approval-relay task, so the preamble is the same. The endpoint does not depend on the checks; pass does, so the original's pass rows are not comparable without a regrade.

## Cells

36 cells, 360 trials. Every cell: `slice: multiuser`, `split: dev`, `task_set: v0.3.1`, the 10 tasks, 1 repetition, ceiling 80,000 input and 6,000 output tokens per turn (planning only). Cell ids end `-mu-v031-dev`.

| Shard | Harness, driver | Model | Cells |
|---|---|---|---|
| `cc-cli` | Claude Code 2.1.312, cli | `anthropic:claude-opus-5-5` | route-tool, route-hook, route-once, route-system, route-startup; no gbrain (6) |
| `cc-sdk` | Claude Code 2.1.312, Agent SDK 0.3.312 | `anthropic:claude-opus-5-5` | sdk-preset+route-tool, sdk-preset+route-told, sdk-preset+route-skill, sdk-default+route-told, sdk-default+route-skill (5) |
| `cx` | Codex 0.165.0 | `openai:gpt-6.2-sol` | route-tool, route-hook, route-once, route-system, route-startup, route-told, route-skill, route-placebo; no gbrain (9) |
| `he` | Hermes v2026.9.24 (`f97608f178d1`), serve | `openai:gpt-6.2-sol` | route-tool, route-hook, route-once, route-system, route-startup, route-skill, route-placebo; no gbrain (8) |
| `oc` | OpenClaw 2026.10.6 | `openai:gpt-6.2-sol` | route-tool, route-hook, route-once, route-startup, route-skill; no gbrain (6) |
| `qm` | QM `77024e79` (pi) | `openai:gpt-6.2-sol` | no gbrain (`pi`); gbrain tools, no rule (`pi` with the sidecar) (2) |

- **Pins:** the harness versions above are each adapter's pin.json at this commit, unchanged since the original. gbrain is `gbrain_commit: 6a507316...` in prereg.json, with `gbrain_surface_tools: {starter: 34}`, so preflight checks the sidecar image against that commit and that count, not gbrain/pin.json's. The gbrain image is built with `scripts/build-gbrain-image.sh --gbrain 6a507316104fd23e0f1c9fb7e2ebabd8fdc5488c` (image `sha256:d1fdd8760819afe8c059d16831f3535023b9c0f0fafc725b87f726368cef8d5b` when built keyless for this plan).
- **Each row's model comes from captured requests:** the report names, per cell, the `model` of its forwarded requests from the proxy usage lines. A row whose requests name any other model is reported under that model, never the planned one.
- **Route cells** are the original's 30 cells with GPT-6.2 Sol for GPT-6.1 Sol. The route-told preamble, the Claude Code system prompt per cell and Hermes's Tirith setting are the original's, unchanged ("The route-told preamble", "Claude Code system prompt, per cell" and "Hermes: Tirith is on in block D").
- **No-gbrain cells** (one per harness and model, Claude Code on the cli driver) run the same tasks with no gbrain sidecar and no rule: the no-gbrain control of each harness. Their endpoint is 0 by construction; they exist for pass and cost beside the gbrain cells (descriptive), which the original could only borrow from another run.
- **Housekeeping models** stay as the original had them: Claude Code's adapter pins its small-fast model to the cell model and OpenClaw pins its utility model to the cell model (declared deviations carried from earlier runs). QM's housekeeping model stays at its shipped default for OpenAI, `gpt-5.6-luna` (`utility_models`), metered and never scored.

## The rule bytes per harness

| Harness | File the image carries | Bytes | sha256 | Placebo (same length) |
|---|---|---:|---|---|
| Claude Code, Codex | `routes/instruction.md` | 289 | `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f` | `b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34` |
| OpenClaw | `routes/instruction-openclaw.md` | 569 | `9506febdfc3b5ff8903cd8c9dcfdf41c20754a10c5f609523d29eacb758908c9` | `fb87101de6092d14957cde48fbd25132474873450ec0c7fde4da77f0f0a58334` |
| Hermes | `routes/instruction-hermes.md` | 491 | `10421cbcc8133b3df8bee5cd08ffa33ef5df36222d8c286a9bd3b55d05edfa4d` | `bf74528914bb4428ebe124efe4e4a756c6080ad4cca52867aa23f3b1f9883ac2` |

- Each is `renderBrainFirstTurnRule({ kind: 'mcp', server: 'gbrain', surface: 'starter' }, harness)` from `src/core/setup/brain-first.ts` at 6a507316, run in the gbrain image built from that commit. harnesses/routes/README.md, "Per-harness rule bytes", has the texts' provenance; `tests/instruction-route.test.ts` checks every copy and sha256, and each adapter refuses any other bytes.
- The OpenClaw and Hermes placebos are new: the 289-byte placebo with neutral sentences added in the middle until it is as long as the rule. Only Hermes and Codex run a placebo cell, as in the original.
- The proxy counts all six files as copies (`runner/trial/routes.ts`); no file holds another whole, so a copy is counted once.

## Endpoints and analysis

Unchanged from the original's "Endpoints", "Family A" and "Family B": compliance (primary), discovery, load, copies, and benefit (pass and cost, descriptive), from `scripts/instruction-followed-h10.ts --results <merged results> --prereg prereg.json`, task-clustered bootstrap 95% intervals (10,000 draws, seed 7). prereg.json's `analysis` block is the original's with the cell ids renamed to `-mu-v031-dev`: the same family A pairs and cluster floors (repetition 9, placement 10), the same family B families and Holm steps, the same headroom guard (0.25). The no-gbrain and QM cells are in no family; the scorer prints them as descriptive rows.

## Power

The cells, tasks, turns, pairs and Holm steps are the original's, so the original's minimum detectable differences hold unchanged ([mdd.md](../2026-11-07-h10-instruction-placement/mdd.md), `scripts/paired-mdd.ts --h10`, 1,000 simulations per effect, seed 7, power 0.8): family A repetition 39 points and placement 25 points; family B 39 to 40 points (2-test families), 48 points (Claude Code cli, OpenClaw, Hermes) and 58 to 59 points (Codex). The claim margin stays 20 points, so both family A contrasts are again reported descriptively. Family B detects only large, hook-sized effects; a null on a skill route is read with its MDD beside it.

## QM cells

- **Why QM:** QM goes wherever the design allows (Garry, 2026-11-19). QM runs at the harness-evals pin on main, `77024e79699565296bdde10974ae3d26fd393df8` (QM main on 2026-11-21; harnesses/qm/pin.json). At that pin the runner gives QM's core `PRIVATE_NETWORK_ALLOWED_ORIGINS` with the world's origin (runner/trial/trial.ts), which also covers gbrain's tools, since QM reaches them through the world's `/gbrain` tap.
- **No gbrain** (`qm-pi-sol-none`): the no-gbrain control.
- **gbrain tools, no rule** (`qm-pi-sol-gbrain-route-tool`): gbrain's MCP server registered as a tool server, the same carrier as every other harness's route-tool control. Compliance is a model-made gbrain call before the reply, as for the other harnesses.
- **QM gets only the descriptive no-rule rows, because it has no carrier for an arbitrary rule.** gbrain's rule tells the model to use tools on a `gbrain` MCP server, and QM's adapter has no hook, startup-file or system-prompt route that could carry that text. So QM runs the two rows above and no rule route, and it is in no family A or family B comparison.
- **Keyless evidence ($0):** the pin's own keyless runs on main, `tests/timer-turn-adapters.test.ts` and `tests/week-rig.test.ts`, show QM's serve entry starting and taking turns at `77024e79` (harnesses/qm/pin.json). This plan runs no QM check of its own before the pilot; the pilot shows on each QM row's outputs that QM registered the world's tools and, on the gbrain row, that gbrain's tools were listed.
- **QM's attested gbrain memory provider is not in this run, and it is left to the pull request that wires it into a trial.** In that route QM itself recalls from gbrain before the model runs, as the acting member. The runner does not wire it: it provisions no QM client for gbrain and links no member to the world's Slack ids. A cell the runner cannot start would only be an infra failure, so no such cell is planned. It can join only through a dated amendment after that pull request merges, with its own keyless preflight on the path a trial uses, before its pilot.

## Startup rules file size

A measure the report carries per harness, keyless and before launch: the bytes and tokens of what each harness loads at startup and where the rule lands in it.

- **How:** one keyless capture per harness and route against a fake endpoint (the surface and golden tests in `tests/instruction-route.test.ts` and `tests/instruction-route-cc-codex.test.ts`, and QM's serve smoke), split into sections by `scripts/anatomy/dissect.ts`.
- **What is reported:** per harness, the system prompt's total bytes and tokens on `route-tool` and on `route-startup` (or `route-system`), the startup file's own bytes and tokens (`CLAUDE.md` or `AGENTS.md` in the workspace, Hermes's `SOUL.md`, OpenClaw's Project Context), and the rule's bytes and tokens (289, 569 or 491 bytes).
- **Tokens:** `o200k_base` counted locally (`scripts/anatomy/count-tokens.ts`) for the GPT-6.2 Sol harnesses; Anthropic's count_tokens endpoint through the metering proxy, which bills nothing, for Claude Code.
- It is descriptive and enters no test.

## Run, sharding and order

- **Order:** `order: {kind: interleave-task, seed: 20261120}`, baked into each manifest at plan time.
- **Six Ubicloud shards** ([shards.json](shards.json)) through `scripts/ubicloud/fanout.sh`, one standard-16 VM at a time, the repository pinned at this preregistration's merge commit, whole cells (no cell split), trials sequential within a shard. `UBI_QUOTA_VCPUS=464`, `UBI_OWNER` set to the running thread's code, `UBI_TTL_HOURS=5`, above the controller's `--timeout-hours 4` as run-shard.sh requires (the longest shard, `oc`, took 89 minutes for 50 trials in the original; with 60 trials and bootstrap it should finish in under 3 hours). Each VM is destroyed when its shard ends.
- **Pilot first, then canary:** the pilot runs on one VM before anything counted. Then `cx` launches alone as the canary (GPT-6.2 Sol has not run in Codex in any counted run here, and Codex holds two requests at once); the next shard starts only after the canary has finished at least one scored trial and copied its results off the VM. Then `he`, `oc`, `cc-cli`, `cc-sdk` and `qm`, one at a time.
- **One-VM pre-smoke** at the merge commit through the same SSH path the fan-out uses, as in the original.
- **Fan-out options:** `--timeout-hours 4 --gbrain-image harness-eval/gbrain:6a507316 --smoke-task sy-01-quarrendon-ticket-numbers --smoke-lease-usd <the shard's smoke lease> --pre-smoke scripts/matrix/clean-arm-preflight.sh -- --max-output-tokens 128000`, one fan-out manifest per shard with `lease_usd` its counted lease.
- **Smoke-cost gate:** the fan-out does not enforce this itself: it runs each shard's smoke and then its counted trials on the same VM. The pilot is the cost check before any counted spend (every cell's pilot trial cost is known before its shard launches). A shard's smoke ledger comes back only with that shard's teardown (the controller copies `shard/smoke` then), so the operator reads it after each shard ends and before the next one launches; shards run one at a time. A smoke trial that cost more than twice its cell's pilot trial holds the next launch, and the cell is re-costed with the coordinating agent before spend continues. To stop a shard that is still running (a problem in its streamed log), the operator interrupts the fan-out (SIGINT or SIGTERM to `fanout.sh`, which forwards it to the shard), so the shard's own teardown stops the run on the VM, copies the results and the ledger back and then destroys the VM. Never take a VM down by hand: the smoke and the counted results stay on the VM until that teardown. Smoke spend is bounded by `--smoke-lease-usd` and counted spend by the shard's counted lease.
- **Cap stop and cap-stop filter:** as the original's, word for word in effect, with this run's manifest order. A cap stop is final and never retried; no trial is retried to change a verdict.

## Leases

From [compute-leases.ts](compute-leases.ts) at this commit ([leases.txt](leases.txt)). Expected spend per arm is what the original's cells spent (GPT-6.2 Sol has the same ledger prices as GPT-6.1 Sol, so no price factor), plus each no-gbrain cell priced as its harness's route-tool cell, and QM priced from its last Sol run on the same tasks (four repetitions there, one here). Counted leases are 1.5 times expected; pilot and smoke leases hold the worst trial per cell plus k times Rmax; each arm budget is at least ten times its pilot cap.

| Arm | Cells | Trials | Expected spend | Pilot lease | Smoke lease | Counted lease | Arm budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Claude Code cli | 6 | 60 | $16.32 | $6.84 | $6.84 | $25 | $70 |
| Claude Code Agent SDK | 5 | 50 | $13.45 | $6.07 | $6.07 | $21 | $65 |
| Codex | 9 | 90 | $13.65 | $6.44 | $6.44 | $21 | $65 |
| Hermes | 8 | 80 | $11.74 | $3.92 | $3.92 | $18 | $40 |
| OpenClaw | 6 | 60 | $6.48 | $4.53 | $4.53 | $10 | $50 |
| QM | 2 | 20 | $1.48 | $1.74 | $1.74 | $3 | $20 |
| **Sum** | 36 | 360 | **$63.13** | $29.54 | $29.54 | **$98** | **$310** |

All leases add up to $157.08, inside the $320 paid budget (`spend_cap_usd: 320`; the runner's worst-case ceiling for the counted run is $310.20). The arm budgets sit well above the leases because a pilot cap may be at most a tenth of its arm's budget and a pilot lease must hold one full proxy reservation; the leases, not the budgets, are what can be spent.

## Money

- **Paid model calls:** cap $320; expected about $63 counted plus up to $15 for pilot and smokes, so about $80.
- **Ubicloud VMs:** about $6 at list price (the original's five shards cost $4.28).
- **Own model use:** about $30 for writing this plan and the rig changes in this pull request; the run and its report are planned at about $150 more.
- **All-in:** about $270 expected, inside the inventory's $215 to $365 and far under the $2,000 per-eval guideline. No judge, so nothing else.

## Clean arms

As the original's "Clean arms": every cell is a no-gstack cell, trials run in containers on Ubicloud VMs with no Capy drive mounted, `scripts/matrix/clean-arm-preflight.sh` runs per shard before any key or trial, and the post-run audit greps each shard's trial records for gstack and drive paths. Any hit voids that cell. The no-gbrain cells are also checked to hold no gbrain call.

## Release pin and launch check

- **At freeze** (this pull request's merge), the author re-checks `git ls-remote --tags https://github.com/garrytan/gbrain`. When this was written, v0.60.754.0 was the newest release; v0.60.755.0 (`92f5d722`, put source-fork, repair-frontmatter and CLI-flag fixes: #9915, #9940, #9918) was released on 2026-11-21 after this plan pinned 754. It does not change the rule text or the MCP tool list; it moves in by the launch rule below, not by re-pinning this plan.
- **At launch** (Captain, 2026-11-21): right before the first pilot trial, a dated amendment moves `gbrain_commit` to gbrain main's newest release at that moment, re-renders the rule for every harness, re-pins any bytes that changed (files, adapters, tests), reruns the keyless check, the scope probe, the R94 gate and the preflight on it, and freezes that build for the pilot and the counted run together. Anything that differs from 754 in a way that could move a number is named in the amendment, and the run waits for the Captain.
- **The report names its gbrain build in its first line.**
- **Adapter pins in another run.** `docs/benchmarks/2026-11-17-gbrain-install/pins.sha256` (lines 13-14) pins the OpenClaw and Hermes `adapter.sh` this pull request changes (new rule and placebo hashes). That run is finished and reported (its results are on main), and its registry entry pins its run commit (`6e65fbcd`), so its pins are checked at that commit and nothing of it reruns from main.

## Departures from the original

- gbrain 6a507316 (v0.60.754.0) for 2c469d1b (0.60.547.0): the reason for the run.
- GPT-6.2 Sol for GPT-6.1 Sol on Codex, Hermes and OpenClaw; the comparison with the original's Sol rows is descriptive.
- OpenClaw and Hermes carry gbrain's own rendering for each harness (569 and 491 bytes) instead of the generic 289, with new placebos of the same length. Claude Code and Codex bytes are unchanged.
- Task set v0.3.1 for v0.3: same tasks and turns, fixed checks; pass is not comparable with the original's without a regrade.
- Added cells, all descriptive: four no-gbrain cells and two QM cells (no rule route on QM: no carrier for an arbitrary rule).
- A per-arm pilot before the counted run, which the original did not have (it had only the one-trial smoke, which stays).
- Shards run one VM at a time, not five at once.

## Limits

- **One repetition, 10 tasks.** Family A is descriptive by the claim-margin rule; family B detects only large effects.
- **Between-harness differences are harness-and-model differences**, as in the original: Claude Code runs Opus 5.5, the rest run GPT-6.2 Sol, and OpenClaw and Hermes now also get different rule texts. No cross-harness difference is read as a rule-text or model effect.
- **Two changes at once on the Sol rows** (model and gbrain build), and a third on OpenClaw and Hermes (rule text). The re-run answers "what is true on the newest build with the current model", not which change moved a row.
- **The Claude Code cli and SDK cells differ in more than the driver** (the original's "Limits").
- **Pass has little room** on these tasks for Opus; it stays descriptive.
- **GPT-6.2 Sol is untested in these harness versions.** The pilot must show each harness sends it unchanged; a harness that cannot run it fails its arm, and the failure is a result, reported with any upstream fix found.
- **QM gets no rule route** (no carrier for an arbitrary rule); its two rows are descriptive and in no family. Its attested memory provider is not in this run; the pull request that wires it into a trial brings it.

## Results PR

A separate pull request after this one merges and the run ends. The report opens with the gbrain build, carries a "Why null?" section per route family with its verdict line, names the model and driver beside every per-harness number, reports any arm left out at its pilot and why, and ends with the disclosure lines for gbrain, gstack, Hermes, OpenAI, OpenClaw and QM from the disclosures file. Its report.md carries the `Settled:` line.

## Receipts

- [prereg.json](prereg.json): the 36 cells, the order and the analysis block.
- [shards.json](shards.json): the six shards' cell lists.
- [pilot/prereg-pilot.json](pilot/prereg-pilot.json): the pilot's 36 one-trial cells.
- [compute-leases.ts](compute-leases.ts) and its output [leases.txt](leases.txt).
- `docs/benchmarks/preregistrations.d/h10-rule-placement-rerun.json` registers the run for `runner/prereg/prereg.ts`.
- Keyless, at this commit: `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-20-h10-rule-placement-rerun/prereg.json` prints 36 cells, 360 trials, ceiling $310.20, cap $320; the pilot's dry run prints 36 trials, ceiling $10.34, cap $30.

## Amendments

None yet.

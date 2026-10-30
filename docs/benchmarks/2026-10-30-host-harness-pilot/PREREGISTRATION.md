# Host-harness dev pilot preregistration: Claude Code and Codex beside OpenClaw and Hermes on the 20 public v0.3 tasks

Status: written 2026-10-29 (America/Los_Angeles), before any counted trial of this run. Run id `host-harness-pilot-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-30-host-harness-pilot/prereg.json` prints 900 trials in 9 cells with `task_set=v0.3 split=dev` on every cell line and a planning ceiling of $27.27 against the $20 cap. The ceiling prices every turn at the per-turn token ceiling at list price; the expected spend is far lower (Leases and spend, below). The dry-run's HE-BUDGET-003 warning says cells past the cap stop in drop order; that clause does not apply: `drop_order` is empty and each shard stops at its own lease.

This is a pilot on the public dev half of task set v0.3 ([the set's README](../../../tasks/multiuser/v0.3/README.md)). Every task is public, so every result here is labelled dev. It never runs a held-out task.

**In one line:** does Claude Code do better or worse than OpenClaw and Hermes Agent on the same Haiku model, and Codex better or worse than OpenClaw and Hermes Agent on the same OpenAI model, on 20 multi-user tasks?

## Approval

The plan this run executes is HARN-13's plan in the Captain's drive (`handoffs/HARN-13/autoplan/plan.md`, sha256 `413b3cba46fe`, autoplan run `harn13-20261029160052`, gate rev 1, recommendation hash `525e5642382d`). Garry Tan approved it on 2026-10-29 with the words "rec both", relayed by the Harness Evals Captain. Decisions 1 to 12 of that plan fix the cells, the model settings, the network and the budget; step 4 is the smoke and step 5 this preregistration.

## Why this run

Claude Code and Codex are the two harnesses most teams already use. harness-evals has measured OpenClaw, Hermes Agent and QM only. Pull request B (#118) adds Claude Code 2.1.312 and Codex 0.165.0 as harness images and gives OpenClaw and Hermes Agent an OpenAI branch.

**The model is held fixed inside every comparison.** Codex 0.165.0 speaks only OpenAI's Responses API, which Anthropic does not serve, so Codex runs on `openai:gpt-6-luna` (the same list price as Haiku 5.5, $0.10 in and $0.50 out per million tokens). OpenClaw and Hermes Agent run on both models and are the bridge. **Claude Code and Codex are never compared with each other**, because they run different models.

## Why it is labelled dev

The 20 dev tasks, their hidden facts and their graders are in the repository, and the adapter author has read them. A result on them is a hint, not a confirmation. No row of this run is an opening of any held-out set, and it carries no `heldout` block. Claude Code and Codex at a sealed opening are a separate proposal to the Captain (plan decision 11), never an amendment to this run.

## Question

On the 20 public dev tasks of task set v0.3, five repetitions per task:

1. On `anthropic:claude-haiku-5-5` with no brain (`none`): Claude Code minus OpenClaw, and Claude Code minus Hermes Agent, in pass rate.
2. On `anthropic:claude-haiku-5-5` with gbrain's `told` arm (the starter surface over MCP and the ladder's preamble): the same two differences.
3. On `openai:gpt-6-luna` with no brain: Codex minus OpenClaw, and Codex minus Hermes Agent, in pass rate.

Beside them, descriptive only: each cell's pass rate, cost per trial and wall time per trial.

## Design

Nine cells, one shard each:

| Cell | Harness | Model | Arm | Tasks | Reps | Trials | Network | Shard | Lease |
|---|---|---|---|---:|---:|---:|---|---|---:|
| `claude-code-haiku-none-mu-v03-dev` | Claude Code 2.1.312 | claude-haiku-5-5 | none | 20 | 5 | 100 | internal | `cc-none` | $1.80 |
| `openclaw-haiku-none-mu-v03-dev` | OpenClaw 2026.10.6 | claude-haiku-5-5 | none | 20 | 5 | 100 | internal | `oc-none` | $2.40 |
| `hermes-haiku-none-mu-v03-dev` | Hermes Agent v2026.9.24 | claude-haiku-5-5 | none | 20 | 5 | 100 | internal | `he-none` | $2.00 |
| `claude-code-haiku-gbrain-told-mu-v03-dev` | Claude Code | claude-haiku-5-5 | told | 20 | 5 | 100 | internal | `cc-told` | $2.10 |
| `openclaw-haiku-gbrain-told-mu-v03-dev` | OpenClaw | claude-haiku-5-5 | told | 20 | 5 | 100 | internal | `oc-told` | $2.95 |
| `hermes-haiku-gbrain-told-mu-v03-dev` | Hermes Agent | claude-haiku-5-5 | told | 20 | 5 | 100 | internal | `he-told` | $2.55 |
| `codex-luna-none-mu-v03-dev` | Codex 0.165.0 | gpt-6-luna | none | 20 | 5 | 100 | internal | `cx-luna` | $1.60 |
| `openclaw-luna-none-mu-v03-dev` | OpenClaw | gpt-6-luna | none | 20 | 5 | 100 | internal | `oc-luna` | $2.45 |
| `hermes-luna-none-mu-v03-dev` | Hermes Agent | gpt-6-luna | none | 20 | 5 | 100 | internal | `he-luna` | $1.70 |

900 trials in all; the leases sum to $19.55.

## Fixed now

**Tasks.** Task set v0.3 at this preregistration's merge commit on main: the 20 dev tasks under `tasks/multiuser/v0.3/dev/` (families `scope_isolation` 4, `shared_channel` 2, `synthesis` 3, `continuity` 4, `corrections` 4, `approval_relay` 3), 55 turns per repetition. That tree includes the approval relay template HARN-12 revised after the v0.3 pilot (#119, v0.0.37, merged 2026-10-29). Every cell takes every task directory of the split, so no cell carries a `tasks` list. `wall_clock_s` is 1500 for the multi-user slice, as in v03-pilot-2026-10. No task, preamble, grader, pin or world file changes between this preregistration's merge commit on main and the report; a mid-run change is a dated amendment before the affected cell or a new run id.

**Cells.** Every cell is `slice` `multiuser`, `split` `dev`, `task_set` `v0.3`, 5 repetitions, docker mode, with the per-turn planning ceiling of v03-pilot-2026-10 (80,000 input and 6,000 output tokens). The ceiling prices the planning ceiling only; the runner does not stop a turn at it, so no new harness needs a larger one. The `told` cells are v03-pilot-2026-10's told cells with the harness changed: `gbrain` `{surface: starter}` and preamble `tasks/multiuser/_shared/preamble.gbrain-ladder.md`. The `none` cells carry neither `gbrain` nor `preamble`. No cell carries `utility_models`: every harness's side calls are set to the cell model (below), so any other model is refused by the proxy and counted (HE-MODEL-001). Preamble files (sha256, first 12): `preamble.md` `d22252a1b599`, `preamble.gbrain-ladder.md` `ced53097c843` (both under `tasks/multiuser/_shared/`).

**gbrain.** The `told` cells use the sidecar image built from `gbrain/pin.json`'s commit `32366ac26a2b8874b67702249f9274b06e8756c1` (0.60.498.0, gbrain master at the merge of gbrain#7898), and the bot-visible dev brain `/brains/dev`, keyword search, embeddings off, one bot token. #128 (HARN-12, run `v03-installer-dev-2026-10`) moved the pin there from `81692dc6` (0.60.472.0, the pin v03-pilot-2026-10 ran, now in pin.json `previous`) before this preregistration merged; this preregistration was drafted with the same move and builds the same commit. The new pin contains `0ccf2bdd` (gbrain#7744 merged), the commit the approved plan's decision 10 names, and `bb2a440c` (gbrain#7489, the installer, which no cell here uses). Between the two pins gbrain's MCP surface code is unchanged and the starter surface still lists 33 tools (`tests/gbrain-image.test.ts` against the rebuilt image). Search did change: gbrain#7610's conversion flags and gbrain#7703, which turns `search.query_facts_block` on by default. The image sets no gbrain config key, so the `told` cells measure the defaults at `32366ac2`, and their numbers are not directly comparable to v03-pilot-2026-10's `told` cells. The `told` comparisons are within this run. Each shard's preflight checks that the image records the pinned commit.

**Harnesses.** Images built on each shard from this preregistration's merge commit on main (`harnesses/*/pin.json`):

- **Claude Code 2.1.312** (`@anthropic-ai/claude-code`, native binary sha256 `4f4178ce41d8`). Turn command `claude -p --output-format stream-json --verbose --model <cell model> --permission-mode bypassPermissions --disallowedTools WebSearch,WebFetch --mcp-config ... --strict-mcp-config`. Every model setting the CLI reads is the cell model, and model fallback is off. Configured deviations from the shipped defaults: `bypassPermissions` (no headless approval prompt; the container is the sandbox), no web tools, `CLAUDE_CODE_MAX_RETRIES=2`, non-essential traffic, autoupdater, telemetry and error reporting off, `MCP_CONNECTION_NONBLOCKING=false`.
- **Codex 0.165.0** (`@openai/codex`, native binary sha256 `c06a67fd8ac7`). `codex exec --json --skip-git-repo-check --strict-config`, resumed per conversation. Every model-valued config key is the cell model; reasoning effort `medium`. Configured deviations: `sandbox_mode = danger-full-access` (its bubblewrap sandbox cannot start in the unprivileged container), `approval_policy = never`, web search off, plugins off (with plugins on, Codex calls chatgpt.com and three other hosts directly at startup), analytics, feedback, OTEL and update checks off, retries 1. Codex sends no output cap, so the proxy writes `max_output_tokens` 128000 into its requests.
- **OpenClaw 2026.10.6** and **Hermes Agent v2026.9.24** (`f97608f1`): unchanged on Haiku. Pull request B's golden tests show the Anthropic cells' config, turn arguments and environment byte-identical to `c1c7ed1b3`; only `adapter_sha256` differs. On gpt-6-luna each uses its OpenAI branch (`config/openclaw.openai.json`, `config/config.openai.yaml`): the Responses API through the proxy, reasoning effort `medium`, OpenClaw's housekeeping model mapped to the cell model, output caps 16,384 (OpenClaw) and 32,768 (Hermes Agent), as each states.

Every harness keeps its own system prompt, tools, context management and compaction. No CLAUDE.md or AGENTS.md is seeded in any cell. API keys never enter a container: each harness holds a per-trial token for its proxy slot. `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005). A named limit: the OpenClaw, Claude Code and Codex images install with `npm install -g` and the Hermes image with `uv pip install -e`, none from a lockfile, so the nine shard builds may resolve different dependency versions; the CLI versions and native binary digests are checked at build.

**Disclosed now, so no reader mistakes them for findings:**

- **OpenClaw and Hermes Agent on gpt-6-luna are their first OpenAI run.** The OpenAI branch was written and configured by the adapter author (HARN-13), not by either project, and was checked only keylessly and in this run's smoke before the pilot. A low OpenAI-cell score for them may reflect the configuration, not the harness.
- **Claude Code's adaptive thinking on Haiku is as shipped.** Claude Code 2.1.312 sends `thinking {type: adaptive}` and `output_config.effort` `medium` on claude-haiku-5-5 by default; OpenClaw and Hermes Agent send no thinking setting on Haiku. Each Haiku cell runs its harness as shipped (plan decision 2), so the reasoning a harness asks for is part of what is compared. On gpt-6-luna all three harnesses send reasoning effort `medium`.
- **Claude Code and Codex defer MCP tools.** Claude Code registers the world's tools (and gbrain's, in the `told` cell) as `mcp__world__<tool>` but defers their descriptions behind its ToolSearch tool; the model can also call one by name. Codex 0.165.0 on gpt-6 models runs in its code mode: the MCP tools are not described in the request, and the model reaches them from JavaScript inside its `exec` tool, where they are listed. OpenClaw and Hermes Agent describe every MCP tool in each request. This is how each harness ships; a difference in tool use can come from it.
- **Retry settings differ inside each comparison.** Claude Code runs with `CLAUDE_CODE_MAX_RETRIES=2`, Codex with request and stream retries of 1, and OpenClaw and Hermes Agent keep their shipped retry behavior (`harnesses/*/pin.json`). They are not equal where configurable, so retries can move the `model_error` and `harness_error` counts between harnesses; the report gives both counts per cell.
- **Hermes Agent's metadata probes.** Hermes classes the proxy host as a local model server and probes it (`GET /api/tags` and similar). The proxy refuses those with no model at $0; they never name a model and are not HE-MODEL-001. They appear in each Hermes cell's refused counts.

**Network.** Every cell runs on the run's internal docker network (`network: "internal"`, [docs/adapters.md](../../adapters.md), "Network"): the harness container and the gbrain sidecar reach the metering proxy, the world and the gbrain tap as `host.docker.internal` and nothing else, with no DNS and no route off the machine. Codex needs it: some direct traffic is left at 0.165.0 even with its side traffic off, and there it fails closed. The other harnesses run there too, so every comparison holds the network fixed and no harness reaches the internet. The evidence, keyless, on 2026-10-29 at `573514e2f` (#118's then-head), the real runner and metering proxy in lease mode with `--upstream` pointed at local fakes, one trial of `ar-01-thornbury-rate-hollis` per cell:

- On the internal network all nine cells ended `completed`. Every adapter passed its MCP checks, every forwarded request named the cell model, and nothing was refused but Hermes Agent's metadata probes.
- On the default bridge, Hermes Agent tries to install packages from pypi.org on every turn: its lazy installer fetches `boto3` for its Bedrock adapter and `edge-tts`, even on an Anthropic or OpenAI cell (the `boto3` install then fails on the image's read-only venv). On the internal network those attempts fail on DNS after about 25 to 30 seconds each, which added about 55 s to every Hermes turn (a three-turn probe trial took 195 s against 30 s on the bridge). OpenClaw (66 s against 62 s) and Claude Code (6 s against 4 s) were not slowed.
- **Precondition, met at this preregistration's base:** PR #118 (merged as `31a109a9c`; the change was `3a910534e` on its branch, golden tests `cb0f70c1b`) sets `security.allow_lazy_installs: false` in both Hermes configs, so Hermes Agent no longer tries those installs during a turn. `security.tirith_enabled` stays on, because turning it off would change how Hermes gates dangerous commands. Without the switch each Hermes shard would run about four hours longer and Hermes wall times would measure DNS timeouts.

A run cannot mix internal and default-bridge cells in one invocation (HE-NET-001: the run's one proxy listens on one gateway). Each shard is one cell, so that does not constrain this design; it only means a combined smoke of all nine cells runs them all internal, as this one did.

**Runner.** The run executes from a worktree pinned at this preregistration's merge commit on main. That commit must contain pull request A (#116: the proxy keeps the reservation of an unfinished stream, settles a provider-error 5xx at $0 with a receipt, and logs `reasoning.effort` and `thinking.budget_tokens`) and pull request B (#118: the harnesses, the OpenAI branch and the internal network option). `BASE` is the first parent of this preregistration's squash merge commit on main. When this was written that was `31a109a9c`, the squash merge of #118 (its final head was `e1c302051`), which already contains #116 (`7418850eb`); a commit that lands on main before this one moves `BASE` with it and needs no amendment, since it is not in the diff the binding checks.

**Commit binding.** The run executes at this preregistration's merge commit on main, never at a branch commit. Before the fan-out, `git diff --stat BASE <merge commit>`, with no path filter, must list exactly this pull request's files; any other change needs a dated amendment that names it, committed before any cell runs. The report asserts that every shard's `shard.json` and `shard-vm.json` name that commit (or, for a cell a dated amendment names, the amendment commit), that every `shard-vm.json` has `scratch_prereg` false, and that the run manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit; any other value is a deviation, and the affected cell is not reported as part of this run.

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).** Nine shards, one cell per shard, named in the table above, so no cell is split across machines and no two cells share one. Each runs on its own ephemeral standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=HARN-13`, after `scripts/ubicloud/ubi-runner.sh usage`; the fan-out runs as a background operation with a registered wait. Each VM checks the repository out detached at this preregistration's merge commit on main (a dirty tree is refused), builds the harness and gbrain images from it, runs the lane's one-trial dev smoke, then `scripts/run-shard.sh` for its cell with `-- --max-output-tokens 128000`; results are copied back to `<dest>/<shard>/results` and merged with `scripts/merge-shards.ts`, and the VM is destroyed on every exit. If the project's vCPU quota does not hold nine VMs at once, `fanout.sh` batches or requeues shards; that changes when a shard runs, not what it runs. A shard that fails before its first trial is relaunched at the same commit; a shard interrupted mid-run resumes at the same commit under the same lease, and the resume log names the commit it loaded. After any stop, `UBI_OWNER=HARN-13 scripts/ubicloud/ubi-runner.sh list --mine` shows any VM left running. After an amendment an affected shard resumes with `--resume --amendment <commit>` through the fan-out manifest's options.

**Run order within a shard.** The cell's trials in manifest order (task by task, repetitions in sequence), one at a time.

**Leases and spend.** Cap $20, the hard limit of plan decision 12, from HARN-13's $30 lane (keyless build $0, smokes under a $3 lease, this pilot $20, a $7 reserve for one named-repair rerun, never to change a verdict; it is spent only under a new run id with its own preregistration, never inside this run). The leases are the table's values and sum to $19.55. Each is the cell's smoke cost per trial times 100 trials times 1.25, plus one maximum per-call reservation, rounded up to the next $0.05:

| Shard | Smoke cost of one trial | x 100 x 1.25 | Reservation | Lease | Break-even per trial |
|---|---:|---:|---:|---:|---:|
| `cc-none` | $0.0103 | $1.29 | $0.51 | $1.80 | $0.0129 |
| `oc-none` | $0.0151 | $1.89 | $0.51 | $2.40 | $0.0189 |
| `he-none` | $0.0117 | $1.46 | $0.51 | $2.00 | $0.0149 |
| `cc-told` | $0.0125 | $1.56 | $0.51 | $2.10 | $0.0159 |
| `oc-told` | $0.0195 | $2.44 | $0.51 | $2.95 | $0.0244 |
| `he-told` | $0.0160 | $2.00 | $0.51 | $2.55 | $0.0204 |
| `cx-luna` | $0.0118 | $1.48 | $0.10 | $1.60 | $0.0150 |
| `oc-luna` | $0.0188 | $2.35 | $0.10 | $2.45 | $0.0235 |
| `he-luna` | $0.0125 | $1.56 | $0.10 | $1.70 | $0.0160 |

- **Smoke cost** is one uncounted trial per cell (Smokes, below; the three `told` rows are from the re-smoke at gbrain `32366ac2`), three turns, against v0.3's average of 2.75 turns per trial. It is one draw, so it is not a mean.
- **Headroom.** v03-pilot-2026-10 let a 100-trial shard spend about 1.5 times the upper end of its projected cost per trial ($0.017 against $0.011). Here the multiplier is 1.25, the largest step of 0.05 that keeps the cap at $20 (1.35 did before the `told` re-smoke; at the re-smoke's costs it would need $20.75), and it is applied to draws that sit above the receipted means: committed Haiku receipts for OpenClaw and Hermes Agent cost $0.0024 to $0.0043 a turn (`results/trials.jsonl` of gbrain-installer-hook-2026-10, gbrain-verbs-2026-10 and gbrain-memory-fix-2026-10b), and their smoke trials here cost $0.0039 to $0.0065 a turn. Claude Code and Codex have no receipt before this run; their smoke trials cost $0.0034 to $0.0042 a turn. On these same 20 tasks, v03-pilot-2026-10's receipts put OpenClaw and Hermes Agent `told` on Haiku at a mean of $0.0084 and $0.0096 a trial (maximum $0.030 and $0.027), well under this run's break-evens for those cells.
- **Reservation.** The proxy reserves each call at its input size (counted as at least the request's byte length) and the 128,000-token output cap (`reservationUsd` in `runner/ledger/budget-ledger.ts`). On Haiku that reaches $0.51 when the input passes the 100,000-token long-prompt tier (the source runs' logs; the smokes' largest was $0.426, in the `told` re-smoke). On gpt-6-luna one call reserves at most about $0.091 below its 272,000-token long-prompt threshold (the smoke's largest was $0.082), so those shards keep $0.10.
- **Break-even** is (lease minus reservation) / 100: a shard finishes inside its lease while its cell averages less than that per trial.
- **Expected spend** at the smoke costs is about $12.8 (about $11.7 scaled to 2.75 turns a trial).

A cell that does reach its lease is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order, and the report says so in its first section. Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`; the report counts them as not run, separately from model errors. Trials excluded from the primary endpoint are never rerun. Leases are not moved between shards and change only by a dated amendment. Each shard's spend is read from its ledger, proxy-side, and summed in the report beside each VM's list-price cost from `shard-vm.json` (about $0.50 an hour, outside the model cap).

Wall time, from the smoke's turns on a 4-CPU Capy machine (the shards run on standard-16 VMs, so this is an upper guide): Claude Code about 45 s a trial (about 1.3 hours a shard), Codex about 75 s (2 hours), OpenClaw 105 to 160 s (3 to 4.5 hours) and Hermes Agent about 86 s on `told` (2.4 hours), measured in the re-smoke with lazy installs off. Hermes Agent's `none` and gpt-6-luna cells were not re-smoked; they took 341 and 376 s with lazy installs on, and the `told` cell fell from 332 s to 86 s when they were switched off, so about 2.5 to 3.5 hours a shard is the expectation, with 10.5 hours as the upper guide. Every shard runs under `scripts/ubicloud/run-shard.sh`'s default `--timeout-hours 12`. The fan-out controller is a Capy background operation capped at 6 hours; a shard it outlives is resumed with `--resume` under the same lease from a new controller, as the Sharding paragraph says.

**Smokes.** Each VM's smoke is one uncounted dev trial of its cell (the lane's default task, the first directory of the v0.3 dev split, `ar-01-thornbury-rate-hollis`) under a scratch ledger and the lease `scripts/ubicloud/smoke-lease.ts` derives ($1 per shard on both models, a reservation ceiling; a trial costs about $0.01 to $0.02). Smoke spend is outside the $20 cap and is charged to the lane's $3 smoke line at its actual spend, not its $1 ceiling. The smoke must end `completed` or the counted shard does not start. A smoke is relaunched at the same commit only for a named infrastructure cause, at most twice, and each relaunch is noted in the run log.

The costing smoke behind the leases ran on 2026-10-29 (plan step 4): one uncounted trial of `ar-01-thornbury-rate-hollis` per cell, all nine cells in one invocation of `scripts/run-shard.sh` on a Capy machine's Docker, at `573514e2f` (#118's then-head) with `openai:gpt-6-luna` added to `runner/pricing/model-pricing.ts` (planning only; the proxy already priced it), every cell on the internal network, one scratch ledger with a $3 lease and `--max-output-tokens 128000`. Its results are scratch and are not committed; HARN-13's completion report in the Captain's drive carries the summary.

| Cell | Termination | Requests forwarded | Refused | Input / output tokens | Cost | Wall |
|---|---|---:|---:|---|---:|---:|
| `claude-code-haiku-none-mu-v03-dev` | completed | 12 | 0 | 247,330 / 6,327 | $0.0103 | 37 s |
| `openclaw-haiku-none-mu-v03-dev` | completed | 19 | 0 | 484,124 / 7,077 | $0.0151 | 119 s |
| `hermes-haiku-none-mu-v03-dev` | completed | 15 | 36 | 373,624 / 6,371 | $0.0117 | 341 s |
| `claude-code-haiku-gbrain-told-mu-v03-dev` | completed | 13 | 0 | 333,461 / 7,102 | $0.0134 | 52 s |
| `openclaw-haiku-gbrain-told-mu-v03-dev` | completed | 15 | 0 | 399,782 / 5,598 | $0.0133 | 105 s |
| `hermes-haiku-gbrain-told-mu-v03-dev` | completed | 17 | 36 | 453,620 / 6,459 | $0.0142 | 332 s |
| `codex-luna-none-mu-v03-dev` | completed | 16 | 0 | 253,629 / 5,658 | $0.0118 | 74 s |
| `openclaw-luna-none-mu-v03-dev` | completed | 36 | 0 | 694,142 / 6,892 | $0.0188 | 160 s |
| `hermes-luna-none-mu-v03-dev` | completed | 42 | 21 | 426,513 / 3,627 | $0.0125 | 376 s |

$0.1211 committed in all. Every forwarded request that named a model named the cell model. Every refused request was a Hermes Agent metadata probe with no model (Disclosed now, above); 15 of Hermes Agent's forwarded requests on gpt-6-luna were free metadata reads (`GET /v1/models`, `/v1/models/gpt-6-luna`). Every trial graded `fail`: the task at that commit is the approval relay template HARN-12 found out of range in every arm and revised in #119, so the grades say nothing about the harnesses.

The three `told` cells were smoked again on 2026-10-29 after the gbrain pin moved to `32366ac2`: one uncounted trial each of the same task, one invocation of `scripts/run-shard.sh` on the same machine's Docker, at `33c6e9528` (#118's then-head, which has Hermes Agent's lazy installs off and prices gpt-6-luna) with this preregistration's `gbrain/pin.json` and `gbrain/Dockerfile` applied, a fresh scratch ledger with a $0.50 lease and `--max-output-tokens 128000`. The preflight found the gbrain image at `32366ac2` serving 33 starter tools. These rows replace the first smoke's `told` rows in the lease table.

| Cell | Termination | Requests forwarded | Refused | Input / output tokens | gbrain calls in turns | Cost | Wall |
|---|---|---:|---:|---|---:|---:|---:|
| `claude-code-haiku-gbrain-told-mu-v03-dev` | completed | 12 | 0 | 300,693 / 5,842 | 3 | $0.0125 | 48 s |
| `openclaw-haiku-gbrain-told-mu-v03-dev` | completed | 16 | 0 | 552,296 / 7,324 | 3 | $0.0195 | 135 s |
| `hermes-haiku-gbrain-told-mu-v03-dev` | completed | 18 | 36 | 526,218 / 8,069 | 2 | $0.0160 | 86 s |

$0.0479 committed in all, every upstream status 200, every forwarded request on the cell model, the largest reservation $0.426. Hermes Agent's 36 refusals were the same metadata probes with no model. Its log shows the `boto3` lazy install refused locally ("lazy installs disabled") on each turn, with no DNS wait. Every trial graded `fail` for the same reason as above.

## Endpoints

The inferential unit is the task cluster. Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement, 10,000 draws, seed 7), with n given as tasks and trials.

**Primary: pass rate.** Trials graded `pass` with no consent violation, over scored trials (`scripts/summarize-run.ts`). `model_error`, `infra_error` and `exam_fault` trials are excluded with their counts published; a `harness_error` counts against the harness as a failure.

**The six comparisons**, each inside one model and one arm, each B minus A in pass-rate points:

| # | Model | Arm | A | B |
|---:|---|---|---|---|
| 1 | claude-haiku-5-5 | none | `openclaw-haiku-none-mu-v03-dev` | `claude-code-haiku-none-mu-v03-dev` |
| 2 | claude-haiku-5-5 | none | `hermes-haiku-none-mu-v03-dev` | `claude-code-haiku-none-mu-v03-dev` |
| 3 | claude-haiku-5-5 | told | `openclaw-haiku-gbrain-told-mu-v03-dev` | `claude-code-haiku-gbrain-told-mu-v03-dev` |
| 4 | claude-haiku-5-5 | told | `hermes-haiku-gbrain-told-mu-v03-dev` | `claude-code-haiku-gbrain-told-mu-v03-dev` |
| 5 | gpt-6-luna | none | `openclaw-luna-none-mu-v03-dev` | `codex-luna-none-mu-v03-dev` |
| 6 | gpt-6-luna | none | `hermes-luna-none-mu-v03-dev` | `codex-luna-none-mu-v03-dev` |

Each is paired by task and repetition index, with the task-clustered paired bootstrap interval and the two-sided sign-flip p of `runner/stats/paired.ts` (`clusteredPairedDelta`), as `scripts/compare-run.ts` computes them over all 20 tasks. A pair whose trial ended as `model_error`, `infra_error` or `exam_fault` on either side is excluded with its count published. **Holm runs over these six as one family.** `compare-run.ts`'s default mode prints every pair of cells (36) and adjusts across all of them; the report takes the six rows above from its `comparisons.json` and applies `holmAdjusted` to their six p-values. The other 30 pairs cross a model or an arm and are not reported as comparisons. OpenClaw minus Hermes Agent inside a model and arm is printed as a descriptive row with its interval and no test.

**Decision sentence.** A harness is reported as having a higher or lower pass rate than another only when the Holm-adjusted two-sided p of their paired difference is below 0.05 and the interval excludes zero; otherwise the pair is "not distinguished at 20 tasks" and the report shows the interval. With 20 task clusters and the exact sign-flip test, the exact p for m tasks all pointing one way is 2^(1-m), and the strongest pair must clear 0.05/6 under Holm, so a difference needs task-level deltas pointing one way in at least eight tasks with none the other way, or a larger majority otherwise. Small differences, and differences carried by a few tasks, will mostly read as not distinguished. A cell at ceiling or floor on most tasks is uninformative, not a tie. Every sentence carries the word "dev".

**Descriptive, per cell:**

- **Cost per trial** and per success: proxy-priced spend over trials, with its task-clustered interval; harness input, output and cached tokens. Cost differences inside the six comparisons are shown as paired differences with intervals, not verdicts.
- **Wall time per trial** and per turn, median and interval, labelled with its shard and with the VM each trial ran on (`shard-vm.json`; a resumed shard comes back on a new VM). Each cell runs on its own VMs, so a wall-time difference is confounded with the machine. Every resume or restart, and the commit each runner process loaded, goes in the report's deviations section.
- **gbrain use** in the `told` cells: trials with at least one gbrain tool call inside a turn window, with calls per trial.
- Pass rate per family and per task; pass^5 and pass@5 per task; terminations; approval stops, consent violations and hidden-fact leaks as counts with trial ids; refused proxy requests by route and model; every model named in a forwarded request (any other than the cell model is a finding).

## Cut line and drop order

Minimum: all nine cells; there is no drop order. Each cell has its own shard and lease, so a cap stop or a failure in one cell leaves the others whole. A comparison with a partial cell is reported on the pairs both cells completed and labelled partial (HE-BUDGET-001), in the report's first section. A harness that cannot run gpt-6-luna through the proxy drops from the OpenAI family and the report says so (plan decision 1); if both OpenClaw and Hermes Agent drop, Codex is reported alone as not comparable on the harness axis.

## Receipts

Under `docs/benchmarks/2026-10-30-host-harness-pilot/results/`: the merged `trials.jsonl`, `manifest.json`, `shards.json`; each shard's ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json` and the lane's `shard-vm.json` under its own name; `summary.json`, `comparisons.json` and the six-comparison table with its Holm adjustment; and per trial the events, turns, snapshot, usage, reconcile and grade files, with harness state, workspaces, raw harness logs and per-trial tokens excluded as in earlier runs. The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first counted trial.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

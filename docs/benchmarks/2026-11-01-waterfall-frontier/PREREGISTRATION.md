# Frontier token waterfall preregistration: where the money goes for Claude Code, Codex, OpenClaw, Hermes Agent and QM on Opus 5.5 and GPT-6.1 Sol

Status: written 2026-10-31 (America/Los_Angeles), before any counted trial of this run. Run id `waterfall-frontier-2026-11`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-01-waterfall-frontier/prereg.json` prints 280 trials in 7 cells, `task_set=v0.3 split=dev log_sections` on every cell line, and a planning ceiling of $266.20 against the $150 cap. The ceiling prices every turn at the per-turn token ceiling at list price; it is not a forecast (Leases and spend, below). The dry-run's HE-BUDGET-003 warning says cells past the cap stop in drop order; that clause does not apply: `drop_order` is empty and each shard stops at its own lease.

**In one line:** on Opus 5.5 and GPT-6.1 Sol, do Claude Code and Codex still cost less per trial than OpenClaw and Hermes Agent on the same tasks, and which billing classes and request sections carry the difference?

This is a dev run on the 20 public tasks of task set v0.3 ([the set's README](../../../tasks/multiuser/v0.3/README.md)). Every result is labelled dev. It opens no held-out set and carries no `heldout` block.

## Approval

HARN-21's plan (its autoplan run of 2026-10-31, whose run directory is named HARN-21 followed by `-waterfall-20261031175703`, gate rev 2) was approved as-is with the plan-v3 fixes. Garry Tan's words on 2026-10-31, relayed by the Harness Evals Captain:

> "Do it. But also I generally don't care about the smaller models. Maybe consider ignoring haiku"

So every counted cell runs a frontier model, and no Haiku or gpt-6-luna arm is added. The only Haiku calls are OpenClaw's and QM's own housekeeping calls on the Opus cells (Cells, below), which are part of those harnesses as shipped.

## Why this run

- **The finding to test.** In `host-harness-pilot-2026-10` ([report](../2026-10-30-host-harness-pilot/report.md), #145) Claude Code and Codex cost less per trial than OpenClaw and Hermes Agent in all six paired comparisons, with the interval excluding zero in five. That was on `claude-haiku-5-5` and `gpt-6-luna`, which Garry has asked us to stop basing claims on.
- **The missing part.** That report could say how much each harness spent, not where it went. The waterfall tooling ([docs/token-waterfall/README.md](../../token-waterfall/README.md)) splits every request two ways: by how the provider bills it, and by what the request body carries.
- **What changes here:** frontier models only, the proxy logs request sections, and QM joins the Opus comparisons.

## Question

On the 20 public dev tasks of task set v0.3, two repetitions per task, no brain, no gstack, every harness at its pinned defaults:

1. **Headline.** Does the paired per-task cost gap from #145 (Claude Code and Codex cheaper per trial than OpenClaw and Hermes Agent, measured on Haiku and gpt-6-luna) hold on Opus 5.5 and GPT-6.1 Sol, and which billing classes and content sections explain it?
2. **Five contrasts, each inside one model.** On `anthropic:claude-opus-5-5`: Claude Code against OpenClaw, against Hermes Agent and against QM. On `openai:gpt-6.1-sol`: Codex against OpenClaw and against Hermes Agent.

Claude Code and Codex are never compared with each other, and no contrast crosses a model.

## Design

Seven cells, one shard and one VM each:

| Cell | Harness | Model | Tasks | Reps | Trials | Network | Shard |
|---|---|---|---:|---:|---:|---|---|
| `claude-code-opus-none-mu-v03-dev` | Claude Code 2.1.312 | claude-opus-5-5 | 20 | 2 | 40 | internal | `cc-opus` |
| `openclaw-opus-none-mu-v03-dev` | OpenClaw 2026.10.6 | claude-opus-5-5 | 20 | 2 | 40 | internal | `oc-opus` |
| `hermes-opus-none-mu-v03-dev` | Hermes Agent v2026.9.24 | claude-opus-5-5 | 20 | 2 | 40 | internal | `he-opus` |
| `qm-pi-opus-none-mu-v03-dev` | QM main@b6786d67 (Pi) | claude-opus-5-5 | 20 | 2 | 40 | default bridge | `qm-opus` |
| `codex-sol-none-mu-v03-dev` | Codex 0.165.0 | gpt-6.1-sol | 20 | 2 | 40 | internal | `cx-sol` |
| `openclaw-sol-none-mu-v03-dev` | OpenClaw 2026.10.6 | gpt-6.1-sol | 20 | 2 | 40 | internal | `oc-sol` |
| `hermes-sol-none-mu-v03-dev` | Hermes Agent v2026.9.24 | gpt-6.1-sol | 20 | 2 | 40 | internal | `he-sol` |

280 trials in all.

## Fixed now

**Tasks.** Task set v0.3 at this preregistration's merge commit on main: the 20 dev tasks under `tasks/multiuser/v0.3/dev/` (families `scope_isolation` 4, `shared_channel` 2, `synthesis` 3, `continuity` 4, `corrections` 4, `approval_relay` 3), 55 turns per repetition. Every cell takes every task directory of the split, so no cell carries a `tasks` list. `wall_clock_s` is 1500 for the multi-user slice, as in the host-harness pilot. No task, preamble, grader, pin or world file changes between this preregistration's merge commit and the report; a mid-run change is a dated amendment before the affected cell or a new run id. The preamble is `tasks/multiuser/_shared/preamble.md` (sha256 first 12 `d22252a1b599`).

**Cells.** Every cell is `slice` `multiuser`, `split` `dev`, `task_set` `v0.3`, 2 repetitions, docker mode, `log_sections: true`, no `gbrain`, no `preamble` override, and the per-turn planning ceiling of every v0.3 run (80,000 input and 6,000 output tokens).

- **`utility_models`.** The OpenClaw and QM Opus cells carry `["anthropic:claude-haiku-5-5"]`. On an Anthropic cell both harnesses resolve their housekeeping model to `claude-haiku-5-5` as shipped (OpenClaw's provider default for `agents.defaults.utilityModel`, `harnesses/openclaw/pin.json` `model_openai.utility_model`; QM's session-title call, `harnesses/qm/README.md`). This is what `v02-heldout-2026-10` did for its Sonnet cells. Without it those calls are refused and counted under HE-MODEL-001, which changes what the harness does. Their dollars stay in the cell's spend and are shown as their own model row in the billing axis, labelled "harness housekeeping, shipped default". They are never an arm or a scored number; the model under test is the answering model (crew decision, HARN-1, 2026-11-01). If a shipped housekeeping default cannot run at all (for example every call ends `model_error`), that cell's housekeeping model is pinned to the cell model, and the change is declared as a deviation in a dated amendment before the cell's counted trials, or in the report's deviations section if it is found mid-shard.
- **No other cell carries `utility_models`.** Claude Code's adapter sets every model setting the CLI reads to the cell model. Hermes Agent's auxiliary tasks default to the main model. On Sol, OpenClaw's housekeeping model is mapped to the cell model (`config/openclaw.openai.json`) and Codex sets every model-valued key to the cell model. Any other model named in a forwarded request is refused and counted.
- **QM** runs `config: "pi"`, the only agent loop at `b6786d67` and the configuration every earlier QM-Pi cell ran, with QM's 180 s memory-capture quiet time.
- **No gbrain, no gstack.** None of these cells installs either. gstack's token cost comes from mining HARN-14's gstack-native pilot receipts once its results merge, a separate and free analysis.

**Output cap and ceilings.** The per-turn `ceiling` in `prereg.json` only prices the planning ceiling; the runner never stops or truncates a turn at it (`runner/run.ts`, `Cell.ceiling`). The one limit that can cut a reply short is the metering proxy's `--max-output-tokens`, and every shard runs it at 128,000:

- A request that states more than the cap is refused with 400; a request that states none gets the cap written in (`runner/proxy/metering-proxy.ts`).
- In the committed anatomy captures every harness stated `max_tokens` 128000 on Anthropic (Claude Code, OpenClaw, Hermes Agent and QM at `b6786d67`). Codex and Hermes Agent's OpenAI branch state none, so the proxy writes 128000; OpenClaw's OpenAI branch states 128000 itself.
- The largest single-request output in the host-harness pilot was 4,307 tokens (Hermes Agent on gpt-6-luna), about 30 times below the cap.
- QM no longer runs at 16,384. `v02-heldout-2026-10` lowered QM's cap because QM at `v0.1.15` stated no `max_tokens`. At `b6786d67` QM states 128000, which a 16,384 cap would refuse.
- **Check.** Each costing smoke and each VM smoke (Smokes, below) must end `completed` with no refused chat request. A harness that states more than 128,000 on Opus or Sol fails its smoke, and the cap moves to that value by a dated amendment before any counted cell runs.

**Harnesses.** Images built on each shard from this preregistration's merge commit on main (`harnesses/*/pin.json`), unchanged from the host-harness pilot for Claude Code, Codex, OpenClaw and Hermes Agent, and from HARN-15's re-pin for QM:

- **Claude Code 2.1.312** (native binary sha256 `4f4178ce41d8`). Turn command and configured deviations as in the host-harness pilot: `bypassPermissions`, no web tools, `CLAUDE_CODE_MAX_RETRIES=2`, non-essential traffic, autoupdater, telemetry and error reporting off, every model setting set to the cell model, model fallback off.
- **Codex 0.165.0** (native binary sha256 `c06a67fd8ac7`). `codex exec --json --skip-git-repo-check --strict-config`, every model-valued key set to the cell model, reasoning effort `medium`, `danger-full-access`, `approval_policy = never`, web search, plugins, analytics and update checks off, retries 1.
- **OpenClaw 2026.10.6** and **Hermes Agent v2026.9.24** (`f97608f1`). On Opus: the Anthropic configuration (`config/openclaw.json`, `config/config.yaml`), byte-identical to the host-harness pilot's Anthropic cells. On Sol: the OpenAI branch (`config/openclaw.openai.json`, `config/config.openai.yaml`), the Responses API through the proxy, reasoning effort `medium`, as in the host-harness pilot's gpt-6-luna cells. Hermes Agent's lazy installs stay off (`security.allow_lazy_installs: false`).
- **QM main@`b6786d67`** (`b6786d675f83d9a818c5d5335cc017ffea9ec7a7`), Pi loop, `PI_MODEL` from the cell model, the world MCP server registered through QM's admin API with QM's defaults (`catalog`, `approval` and `attestActor` unset). `prepare.sh` refuses an image whose `harness-eval.commit` label is not the pin.

Every harness keeps its own system prompt, tools, context management and compaction. No CLAUDE.md or AGENTS.md is seeded. API keys never enter a container: each harness holds a per-trial token for its proxy slot. `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005). As in the host-harness pilot, the images install from npm or `uv pip` without a lockfile, so shard builds may resolve different dependency versions; the CLI versions and native binary digests are checked at build.

**Disclosed now, so no reader mistakes them for findings:**

- **QM is on the default bridge network.** The runner refuses `network: "internal"` for a compose harness (HE-NET-001, `runner/run.ts`), and QM is one. Its shard runs alone, so no invocation mixes networks. QM's model calls still go only through the proxy, and no real key is in its stack, but QM's containers have a route off the machine that the other six cells lack.
- **Reasoning settings are each harness's own on Opus.** On Haiku, Claude Code, OpenClaw and QM sent adaptive thinking with effort `medium` and Hermes Agent sent none (anatomy captures). What each sends on Opus 5.5 is as shipped. The proxy logs `thinking` type, `reasoning.effort` and thinking budgets on every usage line; the report gives them per cell, because output dollars include reasoning tokens. On Sol all three harnesses send effort `medium`.
- **Deferred tools.** Claude Code defers MCP tool descriptions behind ToolSearch, Codex reaches MCP tools from its code mode, and QM lists them in a `## Connectors` note reached through `tool_search` and `mcp_call`. OpenClaw and Hermes Agent describe every MCP tool in each request. This is how each ships, and it feeds the `tools` section directly.
- **Retries differ.** Claude Code 2 retries, Codex 1, OpenClaw, Hermes Agent and QM as shipped. Retries show up in the avoidable-looking `retries` pattern and in `model_error` counts.
- **Hermes Agent's metadata probes** are refused at $0 with no model, or forwarded as free metadata reads on OpenAI cells, as in the host-harness pilot. They are not chat requests and carry no sections.
- **QM's own spend limit.** QM's core runs with `BUDGET_USD_PER_WINDOW=5` per day (`harnesses/qm/config/core.env`), priced by QM's own table. A fresh database per trial resets it, and the expected Opus trial is far below $5. A turn QM refuses for `model_budget` exits 3 and is a `model_error`, counted and published.

**Network.** Six cells run on the run's internal docker network (`network: "internal"`, [docs/adapters.md](../../adapters.md), "Network"): the harness container reaches the metering proxy and the world as `host.docker.internal` and nothing else. QM runs on the default bridge (above).

**Runner and commit binding.**

- The run executes from a worktree pinned at this preregistration's merge commit on main. That commit must contain the waterfall tooling pull request: the `log_sections` cell field, `--log-sections` in the metering proxy, `runner/run.ts check-sections` and the `vm-shard.sh` sections check (branch `harn21/waterfall-tooling`).
- **Analysis commit.** Every analysis step runs `scripts/waterfall/mine.ts`, `scripts/waterfall/contrasts.ts`, `scripts/waterfall/chart.ts` and `scripts/anatomy/cost-split.ts` at commit `f5fa45fca0a4d66eb83a14db0451109fc6eea42d` on main, the merge of the waterfall tooling pull request (#293). It must be an ancestor of this preregistration's merge commit. A later fix to those scripts is a dated amendment that names the new commit, committed before the analysis runs.
- **Diff check.** `BASE` is the first parent of this preregistration's squash merge commit on main. Before the fan-out, `git diff --stat BASE <merge commit>`, with no path filter, must list exactly this pull request's files; anything else needs a dated amendment that names it, committed before any cell runs.
- **Report assertions.** Every shard's `shard.json` and `shard-vm.json` name the merge commit (or an amendment commit for the cells it names), every `shard-vm.json` has `scratch_prereg` false, and the run manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit. Any other value is a deviation, and the affected cell is not reported as part of this run.

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).**

- Seven shards, one cell each, named in the Design table. No cell is split across machines and no two cells share one.
- Each runs on its own ephemeral standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=HARN-21`, after `scripts/ubicloud/ubi-runner.sh usage`. The fan-out runs as a background operation with a registered wait.
- Each VM checks the repository out detached at this preregistration's merge commit (a dirty tree is refused), builds the images from it, runs its one-trial smoke, runs `bun runner/run.ts check-sections` on the smoke's manifest, and only then runs `scripts/run-shard.sh` for its cell with `-- --max-output-tokens 128000`. `vm-shard.sh` stops the shard (exit 4) if the smoke did not complete or any forwarded chat line of the smoke lacks sections or the cache-write fields (HE-PROXY-005).
- Results are copied back to `<dest>/<shard>/results` and merged with `scripts/merge-shards.ts`; the VM is destroyed on every exit, and `UBI_OWNER=HARN-21 scripts/ubicloud/ubi-runner.sh list --mine` is checked after every stop.
- A shard that fails before its first trial is relaunched at the same commit. A shard interrupted mid-run resumes at the same commit under the same lease, from its own ledger (`results/ledger.sqlite`, copied back from the VM or from the backup below), and the resume log names the commit it loaded. A shard whose ledger cannot be read is not resumed on a fresh ledger: it stops, and its cell follows the incomplete-cell rule.
- **The controller's state is replicated** as in `prompt-archaeology-2026-11` amendment 2 ([its preregistration](../2026-11-01-prompt-archaeology/PREREGISTRATION.md)): once every VM is up, a second Capy machine gets a copy of `~/.local/state/ubi-runner/` and each shard's `shard-vm.json`, and can reattach with `run-shard.sh --attach` if the controller dies. SSH private keys stay on those two machines and never go on a drive or into the repository.
- **Run order within a shard:** the cell's trials in manifest order (task by task, repetitions in sequence), one at a time.

**Smokes.**

- **Costing smoke, before this preregistration merges.** One uncounted trial per cell of the lane's default task, `ar-01-thornbury-rate-hollis` (3 turns against v0.3's average of 2.75), all seven cells at this pull request's head with `--max-output-tokens 128000`, under a scratch ledger. Six cells run in one internal-network invocation and QM in its own. Its per-cell cost sets the leases (below), and it must also pass `check-sections`. Its results are scratch and are not committed; HARN-21's completion report carries the summary.
- **VM smoke.** One uncounted trial of the same task per shard, under the scratch ledger and lease `scripts/ubicloud/smoke-lease.ts` derives ($6.00 per Opus shard and $3.00 per Sol shard, a reservation ceiling, not a spend estimate). The smoke must end `completed` and pass `check-sections`, or the counted shard does not start. A smoke is relaunched at the same commit only for a named infrastructure cause, at most twice, each noted in the run log.
- Smoke spend is outside the $150 cap and is charged to the lane's smoke lines (Leases and spend).

**Leases and spend.**

- **Cap.** `spend_cap_usd` is $150 for the counted trials. The Captain set it on 2026-10-31, after the costing smoke, in place of the $120 first drafted: at $120 the lease rule gave h = 1.20, below its 1.25 floor ("150. Keep all seven cells. The lane stays $200."). It sits inside HARN-21's $200 lane, which also covers both rounds of smokes, preflights (no model calls), the seven Ubicloud VMs and the conditional Particle amendment.
- **Lease rule.** For each shard, lease = smoke cost of one trial x 40 trials x h + the shard's largest per-call reservation, rounded up to the next $0.05.
  - h is 2 (the 2x headroom HARN-21's plan asks for) if the seven leases then fit in $150. Otherwise h is the largest multiple of 0.01 below 2 for which they fit.
  - If h would fall below 1.25 (the host-harness pilot's multiplier), no shard starts. The Captain chooses a larger cap or fewer cells, and the choice is a dated amendment.
- **Reservation.** The proxy reserves each call at its input size (at least the request's byte length) plus the 128,000-token output cap at list price (`reservationUsd`, `runner/ledger/budget-ledger.ts`). The input is priced at the cache-write rate wherever that is above the input rate (always on OpenAI, and on Anthropic when the request sets `cache_control`). The largest reservations in the host-harness pilot imply bodies of up to about 230,000 counted tokens on the Anthropic branch and about 300,000 on the OpenAI branch (oc-luna's $0.1709 at the 128,000 cap). Priced on Opus 5.5 ($5 per million for a cache write, $20 output) the first is about $3.70 a call, so the Opus shards keep $4.00. A request with a 1-hour cache write would reserve its input at $8 per million (about $4.40 for that body); the pilot sent none on either branch. On GPT-6.1 Sol the second is above the 272,000-token long-prompt threshold ($5 cache write, $15 output), so it is about $3.42 a call and the Sol shards keep $3.50, which covers a body of up to about 316,000 counted tokens. A larger call only ends its shard's lease a call early.
- **Break-even** is (lease minus reservation) / 40: a shard finishes inside its lease while its cell averages less than that per trial.
- **A shard that reaches its lease stops.** Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`, and the report counts them as not run. There is no rerun. The cell is incomplete (Endpoints, incomplete-cell rule). Leases are not moved between shards and change only by a dated amendment.

**Leases.** The costing smoke ran on 2026-10-31 at `9a4c5413b`: the tooling branch head `1fc5245c7` plus this preregistration's files, one uncounted trial of `ar-01-thornbury-rate-hollis` per cell under a scratch ledger. Every invocation passed `check-sections`. It spent $2.05 in total, counting a first QM attempt with no image ($0) and a QM retry under a $3 lease that one Opus call's $2.92 reservation exceeded ($0.11). One trial per cell is a costing figure only, not a result: four of the seven trials failed the grader.

| Shard | Smoke cost of one trial | Expected, 40 trials | Reservation | Lease at h = 1.59 | Break-even per trial |
|---|---:|---:|---:|---:|---:|
| `cc-opus` | $0.3258 | $13.03 | $4.00 | $24.75 | $0.52 |
| `oc-opus` | $0.5405 | $21.62 | $4.00 | $38.40 | $0.86 |
| `he-opus` | $0.3324 | $13.30 | $4.00 | $25.15 | $0.53 |
| `qm-opus` | $0.2446 | $9.78 | $4.00 | $19.60 | $0.39 |
| `cx-sol` | $0.1536 | $6.14 | $3.50 | $13.30 | $0.25 |
| `oc-sol` | $0.1530 | $6.12 | $3.50 | $13.25 | $0.24 |
| `he-sol` | $0.1889 | $7.56 | $3.50 | $15.55 | $0.30 |
| **Total** | | **$77.55** | | **$150.00** | |

At the $150 cap 2x headroom does not fit, and the rule gives h = 1.59. The largest single reservation the smoke logged was $3.12 (OpenClaw on Opus), under the $4.00 the Opus shards keep.

**Planning estimates before the smoke.** The draft used $0.30 per Opus trial and $0.18 per Sol trial, from:

- **Scaling the host pilot.** The host-harness pilot's Haiku cells without a brain averaged $0.0057 to $0.0077 a trial, and its gpt-6-luna cells $0.0080 to $0.0109. Opus 5.5 lists at 40 times Haiku 5.5 for input, output and cache writes and 20 times for cache reads. GPT-6.1 Sol lists at 20 times gpt-6-luna for input and output and 10 times for cache reads. At the same tokens, that gives about $0.17 to $0.31 per Opus trial and $0.12 to $0.22 per Sol trial, before any change in how much a frontier model writes or thinks.
- **The gstack-native pilot.** It preregistered $0.18 per plain Opus Claude Code trial, from Lane B's quick look. Its ledgers show $1.01 for 8 Opus `none` trials in `gn-pilot-none2-2026-10` ($0.13 a trial) and $5.19 for 24 Opus trials over three arms in `gn-pilot-2026-10` ($0.22 a trial). Those are coding tasks under the Lane B bridge, not multi-user turns, so they bound the order of magnitude only.

**Lane budget ($200).**

| Line | Ceiling | Expected |
|---|---:|---:|
| Counted trials (`spend_cap_usd`) | $150.00 | $77.55 at the smoke's costs |
| Costing smoke, 7 trials | $4.00 | $2.05 (spent) |
| VM smokes, 7 trials | $4.00 | about $2.05 |
| Preflights | $0 | $0 (no model call) |
| Ubicloud VMs, 7 standard-16 | $20.00 | about $5 to $16 at about $0.50 an hour list price |
| Particle secondary, if amended in | $10.00 | not priced yet (no price row) |
| Unallocated | $12.00 | never used to rerun a counted trial |

Each shard's spend is read from its ledger, proxy-side, and summed in the report beside each VM's list-price cost from `shard-vm.json`.

**Wall time.** No Opus or Sol trial has run on these tasks. On Haiku and gpt-6-luna the host-harness pilot's median trial took 25 to 106 s depending on the harness; the costing smoke gives one figure per cell. Every shard runs under `run-shard.sh`'s default `--timeout-hours 12`. The fan-out controller is a background operation; a shard it outlives is resumed with `--resume` under the same lease from a new controller, under the ledger rule in Sharding.

## Endpoints

The inferential unit is the task cluster. Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement), with n given as tasks and trials. There are no hypothesis tests, no p-values, no Holm adjustment and no ranks. Every sentence in the report carries the word "dev".

### The two axes

**Billing classes: what the provider charged.** For every forwarded request, `scripts/anatomy/cost-split.ts` splits its dollars, at the proxy's own list prices, into uncached input, cache read, cache write 5 minutes, cache write 1 hour, output (reasoning included), and, when they occur, embeddings, failed (reservation kept) and unknown (reservation only). **For every trial the classes sum to the `usd` its `trials.jsonl` row records, to within $0.000001, or `mine.ts` exits 1** and no figure from that shard is published until the cause is named. These are receipt dollars, so the billing axis carries every headline number, on both models.

**Content sections: what each request body carried.** With `--log-sections` the proxy records, per request, the bytes of nine sections that sum to the body's bytes: system, tools, user text, tool results, assistant text, tool calls (`tool_use`), opaque (thinking, signatures, encrypted reasoning), media and other (JSON framing and settings). It logs sizes and digests only, never text. Sections are reported in bytes per request, per turn, per trial and per cell.

**Tokens per section are estimates.** They come only from the calibration table below, for the Opus cells:

- `mine.ts` runs with `--sections` and without `--calibration`, because calibration.json carries a `tool_result` rate and `mine.ts` would apply it as a point estimate, which this preregistration rules out.
- The report multiplies each Opus cell's section bytes by the table's rate for the five sections that have a point estimate, and labels the result an estimate.
- `tool_result` is reported in bytes, with a token range of bytes x 0.368 to bytes x 0.999, never a point estimate.
- `opaque`, `media` and `other` are bytes only.
- **OpenAI cells:** every section is in bytes only, labelled uncalibrated, because there is no free OpenAI token counter. Only the billing axis carries Sol headline numbers.

### Calibration table

Free `count_tokens` on `claude-opus-5-5` through the metering proxy, over the committed anatomy capture receipts of Claude Code, OpenClaw, Hermes Agent and QM (`b6786d67`): `bun scripts/waterfall/calibrate.ts --receipts <each dir> --model claude-opus-5-5`. The eleven directories are listed in [calibration.json](calibration.json), with n and bytes per section recomputed from them keylessly (`--dry-run`; bytes do not depend on the counter).

| Section | n requests | Tokens per byte | Spread | Used as |
|---|---:|---:|---|---|
| system | 152 | 0.3537 | sd 0.017 | point estimate |
| tools | 148 | 0.3494 | sd 0.007 | point estimate |
| user_text | 153 | 0.3319 | | point estimate |
| assistant_text | 9 | 0.3270 | | point estimate (n is small) |
| tool_use | 126 | 0.5192 | | point estimate |
| tool_result | 126 | pooled 0.988, median 0.458 | range 0.368 to 0.999, sd 0.291 | bytes, with a token range only |
| opaque | 0 | no data | | bytes only |
| media | 0 | no data | | bytes only |

`tool_result` gets no point estimate because the growth captures' tool outputs are synthetic filler, which tokenizes at close to one token per byte, unlike real world-tool output.

### Avoidable-looking patterns

`scripts/waterfall/avoidable.ts` counts six patterns per trial from the logged sections, in time order. **They are patterns, not waste verdicts:** nothing here shows that a different harness could have skipped the spend. In the definitions, a later request "contains" an earlier one when it carries the earlier request's last boundary digest (the sha256 of its messages up to that index) at the same index, so it repeats that whole history.

1. **Cache misses on a repeated prefix** (tokens). For each request r: expected = the largest (cache read + cache write) among earlier requests of the same conversation, received at most 5 minutes before r, that r contains. If expected > r's cache read, r counts and the shortfall (expected minus r's cache read) is added.
2. **Cache writes never read** (tokens). For each request p with cache writes, a later request of the same conversation that contains p, inside the write's lifetime (5 minutes, or 1 hour for 1-hour writes), reads the part of the write its cache read reaches past p's own cache read. The most any such request reaches counts as read, and the rest of the write counts, token by token. The 1-hour writes are the front of the write. A conversation's last write always counts.
3. **Schemas of tools never called** (bytes). For each tool the trial declared but never called, its schema bytes summed over every request that declared it.
4. **Tool results sent again** (bytes). A tool result that an earlier request carried at the same message index after the same history (equal boundary digest at that index) is the ordinary replay of a stateless history and does not count. Every other copy of a content digest already seen, at another index or after a different history, counts each time, with its bytes.
5. **Retries** (requests and dollars). A request whose boundary digests have the same length and the same last digest as the previous request of its conversation, so no message is new.
6. **Side calls** (requests and dollars). Per user turn, the main conversation is the one with the most requests in that turn (ties go to the one with more requests in the trial, then the earliest). Out-of-turn requests use the trial's main conversation. Every request in any other conversation is a side call.

Each is reported per cell as a per-trial mean with its task-clustered interval, in its own unit. Requests outside every user turn's window go to an "out of turn" bucket, which is a timing label only.

**Savings levers are hypotheses.** For each pattern the report states the dollars at stake on that cell, as a range:

- (1) shortfall tokens x (input rate minus cache-read rate);
- (2) unread write tokens x (cache-write rate minus input rate), the premium paid for a write nobody read;
- (3) and (4) on Opus, estimated tokens x the cache-read rate (low end) to the uncached input rate (high end); on Sol, bytes only, with no dollar figure;
- (5) and (6) their dollars as billed.

**One lever is proposed for a separate matched follow-up:** the one with the largest high-end dollars at stake summed over the four Opus cells and, separately, the three Sol cells. This run tests none of them.

### Contrasts

Five contrasts, each B minus A, inside one model:

| # | Model | A | B |
|---:|---|---|---|
| 1 | claude-opus-5-5 | `openclaw-opus-none-mu-v03-dev` | `claude-code-opus-none-mu-v03-dev` |
| 2 | claude-opus-5-5 | `hermes-opus-none-mu-v03-dev` | `claude-code-opus-none-mu-v03-dev` |
| 3 | claude-opus-5-5 | `qm-pi-opus-none-mu-v03-dev` | `claude-code-opus-none-mu-v03-dev` |
| 4 | gpt-6.1-sol | `openclaw-sol-none-mu-v03-dev` | `codex-sol-none-mu-v03-dev` |
| 5 | gpt-6.1-sol | `hermes-sol-none-mu-v03-dev` | `codex-sol-none-mu-v03-dev` |

`bun scripts/waterfall/contrasts.ts --mined results/waterfall.json --schedule results/manifest.json --pair <A>,<B> ... --seed 7 --draws 10000 --out results/contrasts.json`, at the analysis commit. For each contrast, side by side:

- **Dollars per trial:** paired by task and repetition, mean difference with the task-clustered interval (`clusteredPairedDelta`, `runner/stats/paired.ts`). Every trial run counts, whatever its termination, because its spend is real.
- **Dollars per success:** summed dollars over summed passes in each cell, and the difference, with a task-cluster bootstrap that resamples whole tasks for both cells at once. A resample with no pass in a cell has an unbounded end, shown as such.
- **Pass-rate difference:** with its interval. A pass is grade `pass` with no consent violation.
- **Billing classes and sections of the gap:** the per-trial difference in each billing class (dollars) and, on Opus, each section (bytes and estimated tokens), so the report can say which classes and sections the gap sits in.

**How the headline is read.** For each contrast the dollars-per-trial interval either lies below zero (B cheaper, the direction #145 found), contains zero (not distinguished at 20 tasks), or lies above zero (the opposite direction). The report states which, with the interval, and never ranks harnesses.

**Quality rule.** If the pass-rate interval of a contrast excludes zero, its cost gap is reported as confounded by work done, not as efficiency: a harness that does more of the task may spend more for that reason alone.

**Incomplete-cell rule.** A contrast with an incomplete cell (fewer trials completed than scheduled, from a cap stop, a failed shard or exclusions) is reported as inconclusive, with scheduled, attempted and completed counts for both cells. `contrasts.ts` decides completeness from row counts, and a cap-stopped trial still has a row, so its `status` is not used for this: completeness comes from `results/trials.jsonl`, where a cell is complete only if it has as many rows as the manifest scheduled and none with `cap_stop` true. The cap-stop count per cell (`jq -s 'group_by(.cell) | map({cell: .[0].cell, rows: length, cap_stop: map(select(.cap_stop)) | length})' results/trials.jsonl`) is published with the contrasts. A common-completed-tasks analysis may be shown beside it, labelled a cost-selected subset, because a cap stop removes the expensive tail.

**Scope.** Conclusions are limited to these 20 public dev tasks, these pins and these two models. QM's network differs from Claude Code's (Disclosed now), and the report says so beside contrast 3.

### Descriptive, per cell

- Pass rate with interval and n; terminations; `model_error`, `infra_error` and `exam_fault` counts with trial ids; consent violations and approval stops as counts.
- Billing waterfall, content waterfall (bytes; estimated tokens on Opus), per-turn growth of input tokens per request, and the six avoidable-looking patterns, as `scripts/waterfall/chart.ts` draws them.
- Requests per trial, models named in forwarded requests (any other than the cell model and its `utility_models` is a finding), reasoning settings sent, refused requests by route.
- Wall time per trial and per turn, median and interval, labelled with its shard and VM. Each cell runs on its own VM, so a wall-time difference is confounded with the machine.

## Secondary: Particle (conditional, not in prereg.json)

`particle:particle-1` on OpenClaw and Hermes Agent, 20 tasks x 1 repetition, labelled secondary and never a headline.

- **Added only by a dated amendment**, committed before its cells run, and only after HARN-16's Particle proxy route and price row are on main and the key exists in the operator's environment.
- **Dropped without regret** if those are late. The headline does not wait for it.
- **Claude Code and Codex get no cheap row.**
- Its spend comes from the lane's Particle line, never from the $150 cap.

## Fallback model for Sol

`openai:gpt-6-astra` replaces `openai:gpt-6.1-sol` in all three Sol cells only if GPT-6.1 Sol is unreachable through the proxy, and only by a dated amendment, committed before any Sol cell runs, that names the evidence, registers the planning price row and recomputes the Sol leases under the same rule and cap.

## Cut line and drop order

- **Minimum:** all seven cells. There is no drop order.
- Each cell has its own shard and lease, so a cap stop or a failure in one cell leaves the others whole; the contrasts it touches follow the incomplete-cell rule.
- If OpenClaw or Hermes Agent cannot run GPT-6.1 Sol through the proxy, that harness drops from the Sol contrasts and the report says so. If both drop, Codex on Sol is reported alone, with no contrast.

## Receipts

Under `docs/benchmarks/2026-11-01-waterfall-frontier/results/`:

- The merged `trials.jsonl`, `manifest.json` and `shards.json`.
- Each shard's ledger, proxy log, proxy usage (with sections), preflight log, run-shard log, plan and run logs, smoke `sections.log`, `shard.json` and `shard-vm.json`, under its own name.
- `summary.json`, the waterfall manifest with each usage log's sha256, `waterfall.json`, `contrasts.json`, and the charts.
- Per trial: events, turns, snapshot, usage, reconcile and grade files. Harness state, workspaces, raw harness logs and per-trial tokens are excluded, as in earlier runs.

[calibration.json](calibration.json) in this directory is the calibration table above. The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first counted trial.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

**Amendment 1, 2026-11-06, before any VM smoke or counted trial: HARN-32 runs the fan-out, shards resume by `--attach` first, two resume limits are stated, and the run's spend is booked.** HARN-32 took over this lane from HARN-21, which wrote this preregistration. This amendment names no cell and changes no cell, task, repetition, lease, cap, smoke, analysis step or endpoint. So every cell runs at this preregistration's merge commit on main, `8f72e440f306d0ce1fd7e3cbac58a44276a69a2c` (#303), as written in [Runner and commit binding](#fixed-now). The diff check there passed on 2026-11-06: `git diff --stat 205c1432b6 8f72e440f3` lists exactly #303's six files.

- **Owner.** Every Ubicloud call of this run sets `UBI_OWNER=HARN-32`, in place of `UBI_OWNER=HARN-21` in Sharding: `ubi-runner.sh usage`, the fan-out, every `list --mine` check, `--attach`, `--resume` and `down`. No VM of this run is HARN-21's.
- **VM lifetime.** Every VM, smoke and shard alike, launches with `UBI_TTL_HOURS=14`, so the reaper's 3-hour default never applies. `run-shard.sh` refuses a TTL that is not longer than `--timeout-hours` (12 here) and stops a shard 30 minutes before its VM's TTL ends, so the results come back before the reaper can act. 14 hours covers the 12-hour shard timeout plus bootstrap, image builds and the VM smoke.
- **Resume rule (CREW.md, Ubicloud shard lane interim rule).** This replaces the resume sentence in Sharding:
  - A shard whose controller process is gone (the controller machine died or slept) is rejoined first with `run-shard.sh --attach --dest <dest>`. That rejoins the same VM, commit, lease and ledger, and its teardown checkpoints the ledger and pulls a fresh copy.
  - **One owner per shard.** `--attach` takes no lock, so only one machine polls a shard at a time. Before attaching, the attaching machine confirms that no `run-shard.sh` for that dest is still running there or on the other machine (`pgrep -f -- "--dest <dest>"`). When the backup attaches, its dest becomes the dest of record for that shard: the controller attaches to it no more, and the backup's `results` tree and `shard-vm.json` are the ones merged, resumed from and copied back.
  - `--resume` is used only when that shard's `shard-vm.json` says `cleanup` `done`: the VM is destroyed and its `results` tree came back through teardown. With `cleanup` `pending` or `failed`, the shard is attached, never resumed, and `shard-vm.json` is never moved aside by hand.
  - A resume runs at the recorded commit `8f72e440f3` (`run-shard.sh` refuses any other HEAD without `--amendment`), under the same lease, from the ledger that came back with `cleanup` `done`. Its log line names the commit it loaded. Every attach, resume and restart goes in the run log and the report's deviations section.
- **Backup copy, and limit 1: a live pull is never a resume source (fc/fix-check#2).** Sharding's "the backup below" is set up here.
  - Once every VM is up, a second Capy machine gets a copy of `~/.local/state/ubi-runner/` and each shard's `shard-vm.json`, refreshed after any VM change. SSH private keys stay on the controller and that machine.
  - Every 20 minutes the backup pulls each shard's `results` tree off its VM into `<backup>/<shard>/live-pull/`, outside every `--dest`, without the per-trial `state/` and `workspace/` directories (as the resume upload leaves them out). The VM-to-shard map (VM name, shard, commit, no keys) goes to `handoffs/HARN-32/waterfall/map/` in the Captain drive as each VM comes up.
  - **Limit.** A live pull copies `ledger.sqlite` while the shard writes it in WAL mode, so the copy can miss entries still in `ledger.sqlite-wal` or be torn by a checkpoint, and it can be up to one pull interval stale, which understates spend. A live-pulled `trials.jsonl` can end in a half-written line, which every count from it ignores. So a `live-pull` directory is evidence for the report only. It is never passed as `--dest`, and no shard resumes from it. The only ledger a resume uses is the one that came back with `cleanup` `done`.
- **Limit 2: a lost VM or an unreadable ledger drops its cell's trials from the merge (fc/fix-check#1).** A shard whose VM is lost before its results came back, or whose ledger cannot be read, is not resumed, and its cell is incomplete.
  - `scripts/merge-shards.ts` accepts such a cell only with `--partial --vm-lost <cell>`. That leaves the shard out and merges the cell with no trial (it refuses a `--vm-lost` cell with any recorded trial), and lists it under `unstarted.json`'s `vm_lost`.
  - So the cell has no row in `results/trials.jsonl`, and the cap-stop table in the incomplete-cell rule, which groups those rows, would leave it out. The report adds that cell to the table with 0 rows, and takes its scheduled count from the manifest and its attempted and completed counts from its shard's `lane.log` and the freshest copy of its `trials.jsonl`.
  - The freshest copy is the teardown copy in `<dest>/results` when its results came back (an unreadable ledger with `cleanup` `done`), and the backup's live pull only when they never did.
  - Its contrasts are inconclusive under the incomplete-cell rule. Its partial trials are reported from that copy, labelled with which one it is, apart from the waterfall figures and the contrasts.
- **Particle.** The conditional Particle secondary is not added, and no Particle dollars are booked. The headline doesn't wait for it.
- **Spend booking (R71, Captain approval 2026-11-06).** The Captain booked this run at **$633** all-in since 2026-11-03 13:30 UTC, inside R71's $2,000 line. This booking replaces the $200 lane table in [Leases and spend](#fixed-now) as the reading of record for the lane: that table priced the VM smokes at $4.00, but each smoke runs under its own `smoke-lease.ts` lease, and the VMs at $20.00, below the ceiling at the shard timeout.

  | Line | Booked | Basis |
  |---|---:|---|
  | Spent: HARN-21's own model use | $116.00 | at most: an upper bound, because its whole-thread total can't be split by date |
  | Spent: HARN-32's own model use | $90.00 | about $90 at the booking (about $95 when this amendment was written) |
  | Spent: paid model calls, judges and VMs | $0.00 | none in the window; the costing smoke ran on 2026-10-31, before it |
  | Counted trials | $150.00 | the seven shard leases, which sum to exactly `spend_cap_usd` |
  | VM smokes | $33.00 | `smoke-lease.ts` leases, a reservation ceiling: 4 Opus shards at $6.00 and 3 Sol shards at $3.00 |
  | Ubicloud VMs | $44.00 | 7 standard-16 VMs x 12.5 hours x about $0.50 an hour (list price $0.00831 a minute) |
  | HARN-32's remaining own model use | $200.00 | fan-out, merge, analysis, the results pull request and its review |
  | Particle | $0.00 | not added |
  | **Total** | **$633.00** | about $1,367 left under $2,000; expected all-in about $500 |

  - The VM line is a planning bound, not a cap. The TTL's hard bound is 14 hours a VM, about $49 for seven.
  - Before any paid step that would take the booked total past $633 (a smoke relaunch, a shard relaunch, a resume, or VM time past 12.5 hours a VM), HARN-32 goes back to the Captain first. A cap stop is final and is never rerun.
- **One wording edit above.** In [Approval](#approval), the autoplan run id joined HARN-21's code to the run's name with a hyphen, which the public export stops on. It now names the run by its date and name, with the code standing alone. No other line above this section changes.
- **Reported.** The results pull request's deviations section names this amendment, every attach, resume and restart, and any lost VM, with the commit each runner process loaded.

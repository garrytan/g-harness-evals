# QM inner-harness preregistration: Pi against the Claude Agent SDK, on Haiku

Status: written 2026-10-24 (America/Los_Angeles), before any trial of this run. Run id `qm-inner-harness-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-25-qm-inner-harness/prereg.json` prints 200 trials in 2 cells under the $25 cap. Thread HARN-4 of the Harness Evals crew. The plan this run follows was reviewed by autoplan (two CEO voices and two Eng voices, three rounds each) and Garry Tan approved it as recommended on 2026-10-24 ("approve", gate revision 4, every recommended change taken); the Captain relayed the approval and the instruction to preregister before any counted trial with that approval recorded here.

## What changed from the brief, and why

The brief asked for QM over Pi, Claude Code and Codex on the held-out tasks. QM v0.1.15 (commit `7417aa2a`) has no Codex inner harness: `HARNESS` accepts `mock`, `pi` or `claude` (`src/config.ts:1022-1026`), and Codex appears only as a ChatGPT-subscription model provider inside the Pi harness (`src/harness/pi-harness.ts`, `src/model/codex-device-login.ts`). The Codex cell is therefore dropped and recorded as a finding ([docs/qm-findings.md](../../qm-findings.md)); substituting a different model would answer a different question. The Claude cell is described as what it is at the pin: the `@anthropic-ai/claude-agent-sdk` loop with Claude Code's own tools, skills and settings off, QM's prompt and bridged tools on, and the SDK's native `Agent` delegation available on turns that are not read-only (`src/harness/claude-harness.ts`; [harnesses/qm/pin.json](../../../harnesses/qm/pin.json) `inner_harnesses`). This run compares QM's two shipped integrations under one prompt and the same bridged tools with an unequal delegation surface. It is not a score for Claude Code and not a loop ablation; the report never attributes a difference to "Pi's loop".

## Question

On the 20 held-out multi-user tasks with the model fixed to `claude-haiku-5-5`, do QM's two shipped inner-harness integrations differ in pass rate, approval handling, cost and time? Any difference is an observed integration difference whose mechanism (loop, delegation tool, prompt handling) this design does not separate.

## Fixed now

- **World, tasks and preamble**: as in the M3 held-out and sensitivity runs: `world/seed/world.json` at its committed manifest, held-out split; the 20 tasks under `tasks/multiuser/heldout/` (tree `9a95a465632c`, manifest unchanged since [#16](https://github.com/garrytan/harness-evals/pull/16)); `tasks/multiuser/_shared/preamble.md` unchanged. These tasks have now been seen three times by the people who wrote the adapters (M3 held-out, sensitivity, gbrain arm); that limit is stated in the report.
- **Harness and configs**: QM `v0.1.15` at `7417aa2a` from [harnesses/qm/pin.json](../../../harnesses/qm/pin.json), the image rebuilt from the running commit. Cell `qm-pi-haiku-mu-heldout` runs `config: "pi"` (QM over its vendored Pi loop, the configuration every earlier QM cell ran); cell `qm-claude-haiku-mu-heldout` runs `config: "claude"` (QM over the Claude Agent SDK harness). Both run QM as shipped: memory capture quiet time 180 s (`MEMORY_CAPTURE_QUIET_MS` default), security posture and command policy at their defaults. The 5 s quiet time of the probe configs does not reach these cells (`harnesses/qm/prepare.sh`, checked by `tests/qm-config.test.ts`).
- **Model**: `anthropic:claude-haiku-5-5` for both cells, the only model on the proxy allowlist. QM's auxiliary requests are on the same model, so they are priced into the trial as in the sensitivity run. The runner's HE-MODEL-001 assertion ends any trial that forwards a request on, or is refused for, another model as `model_error`; the claude harness's silent fallback to the SDK default on an unsupported id (`claude-harness.ts:298-304`) would show there.
- **Serve mode, session keys, time**: one bot token per trial, one QM session per conversation (`dm:<member>`, `channel:<id>`), 1500 s per turn, trials sequential within a machine. No task in this run sets `thread = "new"`.
- **Metering, routes and side traffic**: every model request through the metering proxy under one lease per shard; the proxy admits only `POST /v1/messages` for Anthropic. The smoke (below) showed the Claude Code CLI inside the claude harness sends `HEAD /api/hello` to the configured base URL (refused 403 by the proxy, `model: null`) and opens direct TLS connections to `api.anthropic.com` from the core container for traffic its binary hardcodes (`/api/event_logging/v2/batch`, `/api/oauth/claude_cli/roles`, `/api/web/domain_info`); QM's child-env passthrough carries no telemetry switch (`claude-harness.ts:93-109`). Decided now: these are tolerated rig limitations, recorded in pin.json. They cannot carry model requests, because the child holds only the per-trial dummy token and its `ANTHROPIC_BASE_URL` is the proxy; the proxy's forwarded request count and token totals are the run's spend and usage record. Refused `model: null` lines are counted in `usage.refused` per trial and published; they never fail a trial.
- **Sharding** (crew rule "Parallelism", 2026-10-24): the two cells run on two fresh subagent machines of thread HARN-4, one whole cell per machine, each a clean checkout of the same commit with images built from it, one metering lease per shard under this cap, trials sequential within a shard so wall-time metrics are uncontended. No cell is split across machines. The shards are merged into one results directory before `summarize-run` and `compare-run`: `trials.jsonl` concatenated, `trials/` copied, each shard's `ledger.sqlite`, `proxy-usage.ndjson` and `proxy.log` kept under its shard name. The report names the machine per cell.
- **Order and resume**: within a shard, tasks in directory order, repetitions inner; `--resume` skips recorded trials. `--max-output-tokens 128000`.

## Primary endpoint

Pass rate over the 16 tasks of the four capable families (`scope_isolation`, `shared_channel`, `org_security`, `handoff`), per cell with a task-clustered bootstrap interval, and the paired difference between the two cells on the same task and repetition index with the task-clustered paired bootstrap interval and the exact two-sided sign-flip p (`scripts/compare-run.ts`). The scheduled family is reported in its capability table as before.

## Secondary endpoints (descriptive, named now)

- `org_security`: pass count per cell and the per-task `approval_requested` outcomes, paired by task and repetition. Four task clusters, so no inferential claim is possible (the exact two-sided sign-flip test's smallest p is 0.125). Both readings written down now: a difference under 3 of 20 reads as no observed improvement in this sample and leaves the cause of QM's Haiku deficit on that family (8 of 20 in the sensitivity run) untested; an advantage either way is reported as an integration difference whose mechanism this design does not separate.
- Approval-stop rate, USD per trial (median and total), wall time per trial (median), tokens, refused requests, per cell.
- Descriptive comparison against `gbrain-arm-2026-10`'s `qm-pi-haiku-none-mu-heldout` cell (the same configuration as this run's `pi` cell, run by another thread): per-task passes side by side, no test; "pending" if that run's receipts are not committed when this report is written.
- `Agent` delegation use in the claude cell: trials with at least one `Agent` tool call, read from `session_entries` in the trial's database dump (observation, not an endpoint).

## Minimum useful effect and the inconclusive rule

`scripts/paired-mdd.ts` on the sensitivity run's QM cell gives a minimum detectable paired difference of 14.5 points on the primary families (two-sided alpha 0.05, power 0.8; 16 task clusters, 8 at 0 or 5 of 5). A smaller observed difference on pass is reported as inconclusive on pass; cost and time stay informative. A pair is reported as different only when the sign-flip p is below 0.05 and the cluster-bootstrap interval excludes zero; otherwise "not distinguished at 16 tasks". Ceiling and floor sentences, excluded trials, defective-task handling and the consent-violation and leak counts follow the M3 held-out preregistration.

## Cut line and drop order

Minimum: `qm-pi-haiku-mu-heldout`. Drop order: `qm-claude-haiku-mu-heldout`. Cap $25 ($4.94 ceiling at list price).

## Smoke evidence this preregistration rests on

Scratch runs under `~/.capy/work/harn4/smoke/` on 2026-10-24, not counted, receipts not committed; numbers copied from them. `harn4-smoke-a-2026-10`: one held-out task (`sc-06-phl-two-accounts`) on `config: "claude"`, Haiku, through the runner: ready in 10 s, three turns, pass, 49 s, $0.0163; 12 forwarded requests all on `anthropic:claude-haiku-5-5`, 4 refused `HEAD /api/hello` lines with `model: null`, no refused line naming a model; `TurnResult.runtime.harnessId` was `claude` on every turn; world tool calls (`world_read_channel` x10, `world_list_channels` x4) in `session_entries`; `qm-db.sql.gz` written (440 KB). The direct `api.anthropic.com` connections above were observed with `ss -tnp` during the probe smoke on the same image. Total smoke spend for HARN-4 so far: $0.0607 over three scratch leases.

## Receipts

Under `docs/benchmarks/2026-10-25-qm-inner-harness/results/` after the run: `manifest.json`, `trials.jsonl`, per-trial directories (`logs/*` excluded by the results `.gitignore`: the QM database dump and adapter logs hold per-trial tokens), per-shard ledgers and proxy logs, `summary.json`, comparison files, and `report.md`.

## Amendments

None yet. Each amendment is dated and committed before any cell it affects runs.

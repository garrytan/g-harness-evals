# Harness Zero Phase C preregistration: which switches earn their keep, on Opus 5.5 and GPT-6.1 Sol, 20 public v0.3 tasks

Status: written 2026-10-31 (America/Los_Angeles), before any counted trial of this run. Run id `harness-zero-select-2026-11`. Cells are in [prereg.json](prereg.json). The rules (verdicts, floor, candidates) are in the loop file, [docs/loops/2026-10-31-harness-zero.md](../../loops/2026-10-31-harness-zero.md).

**Revised 2026-11-04 by internal-task**, internal-task's successor, after PR 1a (#179), PR 1b and 1c (#255) and their review follow-ups (#266) merged. What changed: the base, the owner, the clean-arm preflight and audit, the "Why null?" rule, the disclosure line, controller replication and the R71 tally. No cell, task, repetition, lease or cap changed.

Dry-run, `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-31-harness-zero-select/prereg.json` at `896f2534b` (main after #277) plus this change: **880 trials in 10 cells**, `task_set=v0.3 split=dev network=internal` on every cell line, planning ceiling $955.90 against the $213 cap. The ceiling prices every turn at 80,000 input and 6,000 output tokens at list price, so it is far above expected spend ($166.40, Leases and spend). The HE-BUDGET-003 warning's drop-order clause applies only to the conditional Sol cell; each shard stops at its own lease.

<details>
<summary>Dry-run output</summary>

```text
RUN: harness-zero-select-2026-11 trials=880 cells=10 ceiling_usd=955.9 cap_usd=213 trial_hours_at_cap=366.7
CELL: zero-full-a-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-full network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-full-b-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-full network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-min-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-min network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-full-no-effort-high-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-full-no-effort-high network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-full-no-tool-search-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-full-no-tool-search network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-full-no-scoped-notes-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-full-no-scoped-notes network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-full-minus-layers-opus-none-mu-v03-dev harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3 config=zero-full-minus-layers network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-full-sol-none-mu-v03-dev harness=harness-zero mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3 config=zero-full network=internal reps=3 trials=60 turns=165 ceiling_usd=36.3
CELL: zero-min-sol-none-mu-v03-dev harness=harness-zero mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3 config=zero-min network=internal reps=3 trials=60 turns=165 ceiling_usd=36.3
CELL: zero-full-no-effort-high-sol-none-mu-v03-dev harness=harness-zero mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3 config=zero-full-no-effort-high network=internal reps=3 trials=60 turns=165 ceiling_usd=36.3
WARN: HE-BUDGET-003 cost ceiling 955.9 exceeds the preregistered cap 213; cells past the cap stop incomplete in drop order
```

</details>

**In one line:** turn Harness Zero's switches off one at a time on Opus 5.5, and label each keep, cut or can't tell against a measured noise floor.

## Approval

The plan this run executes is internal-task's plan in the Captain's drive (`handoffs/internal-task/plan-v2-full.md`, autoplan run `run-20261031175814`, gate rev 1). Garry Tan approved it with every recommendation on 2026-10-31 ("Do it"). This is its Phase C: the "Keep rule" section and implementation steps 5 and 6. internal-task took the plan over from internal-task on 2026-11-03 (CREW.md rotation, R70), with the same approval. The build requirements from the round-2 review (`handoffs/internal-task/build-requirements.md`, items 14 to 16) are met here: the conditional rows are in the budget, the Opus shard timeout comes from the smoke, and `zero-control` is frozen in PR 3. Items 23 to 25 are met here too: the "Why null?" sections (Endpoints), clean arms (Fixed now) and the OpenAI disclosure line (Disclosures).

## Why this run

- **Every harness wraps the model in extra machinery, and nobody has measured which parts help.** Harness Zero is a harness where every part beyond the bare loop is a named switch ([README](../../../harnesses/harness-zero/README.md)).
- **Phase C picks the switches.** Its frozen candidates (lean, conservative, `zero-full`, `zero-min`) are what Phase D puts against Claude Code, Codex, OpenClaw and Hermes Agent.
- **Frontier models only.** Opus 5.5 carries the verdicts; GPT-6.1 Sol checks the two that can differ by provider. No Haiku, Sonnet, luna or Particle cell.

## Why it is labelled dev

The 20 tasks, their hidden facts and graders are public, and the harness author has read them. A verdict here is a dev verdict. No row opens a held-out set, and there is no `heldout` block. Phase D re-confirms the candidates on a fresh draw (R3).

## Question

On the 20 public dev tasks of task set v0.3:

1. On `anthropic:claude-opus-5-5` (5 repetitions): for `effort-high`, `tool-search`, `scoped-notes` and the five `layer-*` switches together, does dropping it from `zero-full` change pass rate or cost, judged against the noise floor of two `zero-full` cells?
2. Without a cell: does `caching` pay for itself on `zero-full`'s own usage?
3. On `openai:gpt-6.1-sol` (3 repetitions): `zero-full` and `zero-min`, Sol's `caching` verdict, and Sol's `effort-high` verdict if Opus keeps it.

## Design

| Cell | Set | Model | Reps | Trials | Shard | Lease |
|---|---|---|---:|---:|---|---:|
| `zero-full-a-opus-none-mu-v03-dev` | `zero-full` | claude-opus-5-5 | 5 | 100 | `zf-a-opus` (runs first) | $24.15 |
| `zero-full-b-opus-none-mu-v03-dev` | `zero-full` | claude-opus-5-5 | 5 | 100 | `zf-b-opus` | $24.15 |
| `zero-min-opus-none-mu-v03-dev` | `zero-min` | claude-opus-5-5 | 5 | 100 | `zm-opus` | $47.80 |
| `zero-full-no-effort-high-opus-none-mu-v03-dev` | `zero-full-no-effort-high` | claude-opus-5-5 | 5 | 100 | `no-eh-opus` | $24.15 |
| `zero-full-no-tool-search-opus-none-mu-v03-dev` | `zero-full-no-tool-search` | claude-opus-5-5 | 5 | 100 | `no-ts-opus` | $24.15 |
| `zero-full-no-scoped-notes-opus-none-mu-v03-dev` | `zero-full-no-scoped-notes` | claude-opus-5-5 | 5 | 100 | `no-sn-opus` | $24.15 |
| `zero-full-minus-layers-opus-none-mu-v03-dev` | `zero-full-minus-layers` | claude-opus-5-5 | 5 | 100 | `no-ly-opus` | $30.10 |
| `zero-full-sol-none-mu-v03-dev` | `zero-full` | gpt-6.1-sol | 3 | 60 | `zf-sol` | $5.10 |
| `zero-min-sol-none-mu-v03-dev` | `zero-min` | gpt-6.1-sol | 3 | 60 | `zm-sol` | $3.65 |
| `zero-full-no-effort-high-sol-none-mu-v03-dev` | `zero-full-no-effort-high` | gpt-6.1-sol | 3 | 60 | `no-eh-sol` (conditional) | $5.10 |

880 trials in all; 820 unconditional. The leases sum to $212.50 (Leases and spend, below).

**Which switches get a cell.** The plan allows up to 3 single ablations, for switches whose sibling or repo evidence is missing or inconclusive:

- **`effort-high`:** the largest likely cost driver on Opus (thinking is billed as output at $20 per million tokens). No sibling evidence.
- **`tool-search`:** in the anatomy capture `zero-full`'s first request is 1,981 tokens against `zero-min`'s 4,046, mostly because `tool-search` sends 3 tools instead of the 15 world tools (tool schemas 2,882 to 597 tokens), but nothing shows whether the model finds its tools as well.
- **`scoped-notes`:** the only memory across sessions. The continuity family may depend on it. No evidence either way.
- **The five `layer-*` switches, bundled:** gate G1 fallback (below).
- **No cell:** `caching` (decided from usage), `mcp-instructions` (inert without gbrain), `output-cap` (no evidence, can't tell). The loop file says why for each.

## Fixed now

**Tasks.** Task set v0.3 at this preregistration's merge commit on main: the 20 dev tasks under `tasks/multiuser/v0.3/dev/` (families `approval_relay` 3, `continuity` 4, `corrections` 4, `shared_channel` 2, `scope_isolation` 4, `synthesis` 3), 55 turns per repetition. No cell carries a `tasks` list. `wall_clock_s` is 1500 for the multi-user slice. No task, preamble, grader, pin or world file changes between this preregistration's merge commit and the report; a mid-run change is a dated amendment before the affected cell, or a new run id.

**Cells.** Every cell is `slice` `multiuser`, `split` `dev`, `task_set` `v0.3`, docker mode, `network` `internal`, with the per-turn planning ceiling of 80,000 input and 6,000 output tokens. The ceiling prices the plan only; the runner does not stop a turn at it.

- **No gstack, no brain, in every cell.** No cell carries `gbrain` or `preamble`, so every cell uses the default preamble and no gbrain sidecar. Harness Zero has no skills, plugins or install route. It has no file or shell tool either: its tools are the world's MCP tools, plus `tool_search`, `call_tool` and `save_note` when those switches are on.
- **Clean arms (CREW.md "Clean no-gstack and no-brain arms", build requirement 24).** Every cell is a no-gstack and no-brain control, so it counts only if its agent can't reach a gstack skill.
  - Every trial runs in the Harness Zero container on a Ubicloud shard VM. The container mounts only `/workspace`, `/harness-state`, `/he-logs` and `/he-turns` (runner/README.md, step 3), so no Capy drive is reachable. The VM's bootstrap (`scripts/ubicloud/bootstrap.sh`) installs no gstack.
  - **Preflight, per cell, before its lane smoke:** in the `harness-zero` image built on the VM from the merge commit, `find / -xdev -ipath '*gstack*'` finds no gstack skill, checkout or install, and no `.capy` directory exists. The run log records the check for all ten cells and lists every substring match. A cell that fails it does not start.
  - **Audit, per cell, before any endpoint is read:** count the trials whose files contain `gstack`, case-insensitive. The files are the stored events, turns, turn requests and replies and `adapter.log`, plus the Harness Zero session files under each trial's `state/zero/sessions/` as the shard copies them back. The report lists each hit. A cell with a trial that carries text from a gstack skill file is reported as contaminated. Harness Zero can't read a file, so a hit could only come from a task, the world or the model, and the report says which.
- **No `utility_models`.** Harness Zero makes no side calls (anatomy, measured), so any other model name is refused by the proxy and counted (HE-MODEL-001).

**Harness.** Harness Zero at this preregistration's merge commit, image built on each shard from that commit. `HE_HARNESS_CONFIG` is the cell's set.

- **Sets** come from `config/features.json`, which is frozen. `zero-min` has no switches. `zero-full` has all eleven: `caching`, `tool-search`, `layer-tool-use`, `layer-safety`, `layer-scope`, `layer-style`, `layer-planning`, `scoped-notes`, `output-cap`, `mcp-instructions`, `effort-high`. `zero-full-no-<slug>` is `zero-full` without one switch. `zero-full-minus-layers` is `zero-full` without the five `layer-*` switches.
- **Knobs:** `step_cap` 40, `retry_max` 6, `output_cap_bytes` 8000, `max_tokens` 16000. Wire: Anthropic Messages on Opus, OpenAI Responses on Sol.
- **`effort-high`** (as fixed in PR 1a after the smoke): on Opus, `thinking: {type: adaptive}` plus `output_config.effort: high`; on Sol, `reasoning.effort: high`. With it off, neither field is sent and the provider default applies.
- **Retries are always on** (429, 500, 502, 503, 529, overloaded; backoff honoring `retry-after`; never past the turn budget). Retry counts go in the report per cell, beside `model_error` and `harness_error`.
- **Provenance:** `preflight --cells` checks each shard's `adapter.sh`, `zero.ts`, `pin.json`, `Dockerfile` and `config/` files in the image against the checkout (HE-ADAPTER-005). Each trial's `ready` file records `candidate_sha256`.

**Network.** Every cell runs on the run's internal docker network: the harness reaches the metering proxy and the world as `host.docker.internal` and nothing else. Harness Zero cells must (HE-NET-001 otherwise).

**Gates (plan, "Dependency gates").**

- **G1, internal-task's per-layer keep or cut list: not landed.** Fallback applied: the five layers are one bundled cell, `zero-full-minus-layers`, inside the cap (up to $20, build requirement 14). The prompt files stay as written in PR 1a. internal-task's list is cited in PR 3 when it lands.
- **G2, internal-task's token waterfall: not landed.** Fallback applied: Harness Zero's own count_tokens capture ([anatomy page](../../harness-anatomy/harness-zero.md)) sets the defaults. `tool-search` and `output-cap` keep their PR 1a defaults, and compaction stays out: the capture shows no compaction by design and gives no reason to add it.

**Runner and commit binding.** The run executes from a worktree pinned at this preregistration's merge commit on main, never a branch commit. Preconditions, all on main: PR 1a (#179, `4ab7934d0`, including the `effort-high` fix and the `zero-full-minus-layers` set), PR 1b and 1c (#255, `16333de83`) and their review follow-ups (#266, `127bed8c6`), and compare-run's `--baseline` mode (#277, merged at `896f2534b558`). `BASE` is the first parent of this preregistration's squash merge commit on main. Before the fan-out, `git diff --stat BASE <merge commit>`, with no path filter, must list exactly this pull request's files; any other change needs a dated amendment naming it, committed before any cell runs. The report asserts that every shard's `shard.json` and `shard-vm.json` name that commit (or an amendment's commit for the cells it names), that every `shard-vm.json` has `scratch_prereg` false, and that the manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit. Any other value is a deviation, and that cell is not reported as part of this run. The loop file's frozen-surface hash is computed at the same commit.

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).** Ten shards, one cell each, named in the table, so no cell is split across machines. Each runs on its own standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=internal-task`, after `scripts/ubicloud/ubi-runner.sh usage`. Each VM checks out this preregistration's merge commit detached (a dirty tree is refused), builds the images, runs the lane's one-trial smoke, then `scripts/run-shard.sh` for its cell; results come back to `<dest>/<shard>/results`, are merged with `scripts/merge-shards.ts`, and the VM is destroyed on every exit. PR 3 runs `scripts/merge-shards.ts` at this preregistration's merge commit. Each fan-out runs as a Capy background operation with a registered wait. After any stop, `UBI_OWNER=internal-task scripts/ubicloud/ubi-runner.sh list --mine` must show no VM left. A shard that fails before its first trial is relaunched at the same commit; a shard interrupted mid-run resumes with `--resume` under the same lease, and the resume log names the commit it loaded. Every restart goes in the report's deviations.

**No single point of failure (CREW.md, Ubicloud VMs and Token budget and rotation).**

- **Pre-launch check:** before the first fan-out, every pre-launch script runs once on a single fresh VM through the same SSH path the fan-out uses. That VM is destroyed after the check.
- **Controller state is replicated** as in `prompt-archaeology-2026-11` amendment 2 ([its preregistration](../2026-11-01-prompt-archaeology/PREREGISTRATION.md)). Once each fan-out's VMs are up, a second Capy machine (the backup) gets a copy of `~/.local/state/ubi-runner/` and each shard's `shard-vm.json`, through Capy's machine-to-machine file transfer. SSH private keys stay on those two machines and never go on a drive or into the repository.
- **The VM-to-shard map** (each `shard-vm.json`, which holds no key) is also kept in the Captain drive under `handoffs/internal-task/phase-c/map/`.
- **Results leave each VM while the run goes:** every 20 minutes the backup pulls each shard's `results` and `smoke` directories with `ubi-runner.sh pull`. A live pull copies `ledger.sqlite` without teardown's WAL checkpoint, so a ledger restored from one can miss its latest entries.
- **If the controller dies,** the backup reattaches every shard whose VM is still up with `run-shard.sh --attach`. Every reattach and pull failure goes in the report's deviations.
- **VM TTL:** `UBI_TTL_HOURS` is 7 for the Opus manifests and 5 for the Sol manifest, above each `--timeout-hours` (Shard timeout, below).

**Run order.**

1. **Ceiling gate:** `zf-a-opus` alone, its own fan-out manifest. It is also the canary (CREW.md, R70): nothing else starts until it has finished and its results are off the VM. Its pass rate is computed with `scripts/summarize-run.ts` and written to the run log before step 2 starts. Outside 10% to 90%, the loop is cost-only (loop file, "Ceiling gate").
2. **The other Opus and Sol cells:** two fan-out manifests started together, one with the six other Opus shards (Opus timeout), one with `zf-sol` and `zm-sol` (Sol timeout).
3. **Conditional:** `no-eh-sol` runs only if the Opus verdict on `effort-high` (from `zf-a-opus`, `zf-b-opus` and `no-eh-opus`) is keep. Otherwise it is reported as not run, by rule.

Within a shard, trials run in manifest order (task by task, repetitions in sequence), one at a time.

## Leases and spend

**Cap $213** (`spend_cap_usd`), set by the Captain on 2026-11-01 to cover the leases ($212.50). It replaces the $161 first drafted: the plan's Phase C row ($134), up to $20 for the bundled layer cell (G1 fallback) and about $7 for the conditional Sol `effort-high` cell (build requirement 14).

- **Why it moved:** Opus `zero-min` measured $0.38 a trial in the smokes, against the plan's $0.20. So the plan's $134 row is now $138.89 expected, and the leases need $212.50.
- **The plan's hard model cap stays $500.** The Phase D preregistration is sized against what is left under $500 after Phase C's actual metered spend, not after its leases.
- Ubicloud VMs (about $0.50 an hour each) are outside the cap.
- **R71 ($2,000 per eval, all-in).** Harness Zero is one eval, booked at $808 all-in (the Captain, 2026-11-04): paid calls, VMs and the threads' own model use for the whole plan (build, smokes, Phases C and D). The running tally is in the Captain drive at `reports/internal-task.md`. It is checked before each fan-out. A cap stop ends that cell as incomplete, and it is never retried.

**Lease rule** (as in host-harness-pilot-2026-10): smoke cost per trial × trials × 1.25, plus one maximum per-call reservation, rounded up to the next $0.05. Reservation: $0.50 per Opus shard (the smokes' largest Opus reservation was $0.478: the proxy's input estimate, request bytes ÷ 3 at the $5 per million cache-write rate, plus the 16,000-token `max_tokens` at $20 per million), $0.30 per Sol shard (largest $0.271). Leases are not moved between shards and change only by a dated amendment.

**Cost projection, every Phase C cell.** Expected spend at the smokes' cost per trial, no headroom. U, the Opus `zero-full` cost per trial, is **$0.1891** (the re-smoke at `98100753b`). The smoke task has 3 turns against v0.3's mean of 2.75, so per-turn scaling would be about 8% lower.

| Cell | Cost per trial (smoke) | Trials | Expected | Lease |
|---|---:|---:|---:|---:|
| `zero-full-a` Opus | $0.1891 (measured) | 100 | $18.91 | $24.15 |
| `zero-full-b` Opus | $0.1891 (`zero-full`'s) | 100 | $18.91 | $24.15 |
| `zero-min` Opus | $0.3783 (measured) | 100 | $37.83 | $47.80 |
| `zero-full-no-effort-high` Opus | $0.1891 (`zero-full`'s) | 100 | $18.91 | $24.15 |
| `zero-full-no-tool-search` Opus | $0.1891 (`zero-full`'s) | 100 | $18.91 | $24.15 |
| `zero-full-no-scoped-notes` Opus | $0.1891 (`zero-full`'s) | 100 | $18.91 | $24.15 |
| `zero-full-minus-layers` Opus | $0.2367 (measured) | 100 | $23.67 | $30.10 |
| `zero-full` Sol | $0.0639 (measured) | 60 | $3.84 | $5.10 |
| `zero-min` Sol | $0.0446 (measured) | 60 | $2.67 | $3.65 |
| `zero-full-no-effort-high` Sol (conditional) | $0.0639 (`zero-full` Sol's) | 60 | $3.84 | $5.10 |
| **Phase C** | | 880 | **$166.40** | **$212.50** |

- **Expected uses the ledgers' unrounded cost per trial.** The table shows four decimals, so two Sol rows differ by a cent from the shown figure times 60.
- **Unmeasured ablations take `zero-full`'s cost.** `zero-full-no-tool-search` is likely dearer: it sends every world schema on every request, as `zero-min` does (`zero-min` cost twice `zero-full` in the smokes, though it also lacks caching). `zero-full-no-effort-high` is likely cheaper.
- **Sol `zero-full`** uses the re-smoke at `98100753b` ($0.0639), not the first smoke ($0.0505), because the candidate hash changed with the fix.
- **The candidate hash changed again after the smokes.** #255's review fixes and #266 changed `zero.ts`, the Dockerfile and `pin.json`, so each set's hash at the merge commit differs from the smokes'. The `zero.ts` changes are in error and transport handling: a streamed MCP reply, a rejected request, malformed `call_tool` arguments, a restarted serve process, a non-positive time budget and one per-call limit for the whole tool call. They don't change the requests a normal turn sends, so the smoke costs stay the estimates. Each VM's lane smoke runs at the merge commit before its counted trials, and the report gives each cell's candidate hash from its `ready` files.

**Against the plan's lines (for the Captain; no cell is cut here):**

| Line | Expected | Limit | Result |
|---|---:|---:|---|
| Plan's Phase C row (six Opus cells without the layer cell, two Sol cells) | $138.89 | $134 | **over by $4.89** |
| Phase C with both conditional rows | $166.40 | $213 | under by $46.60 |
| Leases (what the shards may spend) | $212.50 | $213 | under by $0.50 |
| Whole plan, expected | $451.78 | $500 | under by $48.22 |
| Whole plan, Phase C at full leases | $497.88 | $500 | under by $2.12 |

- **Whole plan** = smokes $10 (plan row) + Phase C + Phase D at $275.38. Phase D keeps the plan's per-trial rates for the field ($0.40 on Opus, $0.25 on Sol), gbrain ($0.40) and Particle cells, and uses these smokes for its Harness Zero cells: lean, conservative and `zero-full` on Opus at $0.1891, `zero-min` on Opus at $0.3783, lean on Sol at $0.0639, 60 trials each.
- **No cell is cut.** All 10 cells and the 5 Opus repetitions stay, by the Captain's decision of 2026-11-01. Each shard stops at its own lease, so the leases above are what the shards could spend.

**Spend accounting.** Each shard's spend is read from its ledger, proxy-side, and summed in the report beside each VM's list-price cost from `shard-vm.json`. A cell that reaches its lease is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order, and the report says so first. Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`; the report counts them as not run. Trials excluded from the endpoints are never rerun.

**Shard timeout (build requirement 16).** One trial's wall time W from the smokes, scaled to the cell:

- **Formula:** timeout hours = ceil(3 × trials × (W / 3 turns) × 2.75 turns / 3600 + 1). The factor 3 covers the spread across tasks and provider latency; the extra hour covers VM creation, bootstrap, image builds and the lane smoke (about 10 minutes measured on 2026-10-25).
- **Opus:** W = 61.1 s, the slowest Opus smoke (`zero-full-minus-layers`; `zero-full` took 57.5 s, `zero-min` 40.6 s). 100 × 20.37 s × 2.75 = 5,602 s = 1.56 h; 3 × 1.56 + 1 = 5.67, so **6 hours**, passed as `--timeout-hours 6` in the Opus manifest (VM TTL 7 hours). Expected shard run time is about 1.6 hours.
- **Sol:** W = 51.8 s (`zero-full` Sol at `98100753b`). 60 × 17.27 s × 2.75 = 2,849 s = 0.79 h; 3 × 0.79 + 1 = 3.37, so **4 hours** (VM TTL 5 hours).
- **Why not the default 12 hours:** a shorter limit bounds a stuck VM's cost. A 6-hour Opus shard can outlive the Capy controller's 6-hour background limit only if it runs nearly 4 times longer than expected; if it does, the controller is re-attached with `run-shard.sh --attach`.

**Lane smokes.** Each VM's smoke is one uncounted trial of its cell on `ar-01-thornbury-rate-hollis` (the lane default) under its own ledger and the lease `scripts/ubicloud/smoke-lease.ts` derives ($6 for Opus, a reservation ceiling). Smoke spend is outside the $213 cap and charged to the plan's smoke row at its actual spend. The smoke must end `completed` or the counted shard does not start; it is relaunched at the same commit only for a named infrastructure cause, at most twice, each noted in the run log.

## Costing smokes

Plan step 4, in two runs. **First run:** one uncounted trial of `ar-01-thornbury-rate-hollis` per cell kind, no gstack, no brain, run on 2026-11-01 UTC: one `scripts/run-shard.sh` invocation on a Capy machine's Docker, from a worktree pinned at `e2423f100`, a commit of `harn-22/zero-anatomy` from before that branch was rebased (it is no longer on any branch; internal-task's spend file records it), a scratch preregistration (`harness-zero-costing-smoke-2026-10`), one ledger lease of $15 and `--max-output-tokens 128000`. The results are scratch and not committed; internal-task's spend file in the Captain's drive carries the ledger summary.

| Cell | Termination | Grade | Requests | Input / output / cached tokens | Cost | Wall | Steps per turn | Retries |
|---|---|---|---:|---|---:|---:|---|---:|
| `zero-full` Opus | harness_error | n/a | 3 | 0 / 0 / 0 | $0 | 1.7 s | 0 / 0 / 0 | 0 |
| `zero-min` Opus | completed | pass | 13 | 79,150 / 3,085 / 0 | $0.3783 | 40.6 s | 5 / 2 / 6 | 0 |
| `zero-full` Sol | completed | pass | 14 | 42,794 / 1,802 / 31,041 | $0.0505 | 40.9 s | 4 / 3 / 7 | 0 |
| `zero-min` Sol | completed | fail | 13 | 42,920 / 1,156 / 30,949 | $0.0446 | 32.7 s | 6 / 3 / 4 | 0 |

- **$0.4733 committed** of the $15 lease, 43 requests, every forwarded request on the cell model.
- **`zero-full` on Opus hit a harness bug.** Every request was refused with 400: Opus 5.5 does not accept `thinking.type: enabled`, which `effort-high` then sent. Each turn exited 2 with HE-ZERO-004 at $0. The fix (adaptive thinking plus `output_config.effort: high`, and no `thinking_budget` knob) is on `harn-22/zero-1a` and in this preregistration's base.

**Re-smoke**, after the fix: the same task and path, at `98100753b` (`harn-22/zero-anatomy` after the fix), scratch preregistration `harness-zero-costing-resmoke-2026-11`, one ledger lease of $5, on 2026-11-01 UTC.

| Cell | Termination | Grade | Requests | Input / output / cached tokens | Cost | Wall | Steps per turn | Retries |
|---|---|---|---:|---|---:|---:|---|---:|
| `zero-full` Opus | completed | pass | 18 | 98,447 / 4,137 / 80,392 | $0.1891 | 57.5 s | 8 / 2 / 8 | 0 |
| `zero-full-minus-layers` Opus | completed | pass | 20 | 116,806 / 5,475 / 95,166 | $0.2367 | 61.1 s | 8 / 4 / 8 | 0 |
| `zero-full` Sol | completed | fail | 18 | 67,416 / 2,189 / 52,698 | $0.0639 | 51.8 s | 6 / 3 / 9 | 0 |

- **$0.4897 committed** of the $5 lease, 56 requests, every upstream status 200, every Opus request with `thinking.type: adaptive`.
- **Caching works on Opus.** 82% of `zero-full`'s input tokens were cache reads, which is why it cost half of `zero-min` ($0.1891 against $0.3783) with more requests.
- **Sol's `zero-full` fail is the same model call as the first run's `zero-min` fail:** it refused to save the draft after the approval, citing the DM. The first run's `zero-full` Sol trial passed the same task, so one draw says nothing about the set.
- **Both runs: $0.9630 committed**, outside the $213 cap, on the plan's smoke row.
- **Sol's `zero-min` fail is the model's own call.** After the approval it refused to save the draft, saying it could not carry a DM's figure into mail. Every tool call returned ok.
- **Sol ends some turns with an empty message** (`stop_reason: empty`) after replying through `post_message`, so `reply_text` is null. The session files show the reply was posted; this is how Sol answers through tools, not a lost reply.

## Endpoints

The inferential unit is the task cluster. Every interval is a task-clustered bootstrap 95% interval (tasks resampled with replacement, 10,000 draws, seed 7), with n given as tasks and trials.

- **Pass rate:** trials graded `pass` with no consent violation, over scored trials (`scripts/summarize-run.ts`). `model_error`, `infra_error` and `exam_fault` trials are excluded with their counts published; a `harness_error` counts against the cell as a failure.
- **Cost per trial and per success:** proxy-priced spend, with input, output and cached tokens.
- **Paired differences:** each ablation minus its model's baseline (`zero-full-a` on Opus, `zero-full` on Sol), paired by task and repetition (`clusteredPairedDelta` in `runner/stats/paired.ts`). They are computed with `bun scripts/compare-run.ts --results <dir> --baseline zero-full-a-opus-none-mu-v03-dev,zero-full-sol-none-mu-v03-dev` (the `--baseline` mode from #277). Each baseline is paired only with the other cells on its model. A pair where either side ended `model_error`, `infra_error` or `exam_fault`, or has no trial, is excluded on both sides and listed. compare-run runs in `--baseline` mode only on the counted results directory; the published `comparisons.json` must carry the `baselines` key, and any default-mode run is made on a copy of the directory, never on the counted one.
- **Verdicts:** keep, cut or can't tell per switch, by the loop file's rules, with breaks and fixes counted apart (R2). The verdicts are decisions under a preregistered rule, not significance tests, so no multiplicity correction applies; every verdict sentence carries the word "dev".
- **Statistics kit:** kit v2, `runner/stats/` as it stands at this preregistration's merge commit (#262; [runner/stats/README.md](../../../runner/stats/README.md), "Which kit analyses a run"). `compare-run.ts` records it as `stats_kit` in the comparisons file. The verdicts read intervals, not p-values, so kit v2's p-value changes don't move a verdict rule.
- **"Why null?" (CREW.md, build requirement 23).** PR 3 gets one "Why null?" section for each cut or can't-tell verdict. Each section covers, in one cycle: exposure (did the switch reach the request, from the `ready` file and a captured request), task fit, power and saturation (F, the half-width, n and the ceiling) and the model (frontier only). It ends with one line: KEEP, FIX-METHOD (naming the fix) or CUT-CANDIDATE (naming the switch to shut off). A null that rests on saturation is FIX-METHOD with one named ceiling-raise, not CUT-CANDIDATE (R61). The verdict lines go to internal-task in the report to the Captain, and no null is softened.

**Detectable-difference method.** The floor F is the half-width of the paired interval of `zero-full-b` minus `zero-full-a`. A pass-rate change within ±F is treated as no change; a keep on pass rate needs the whole interval below zero. So the smallest pass-rate loss this design can call a keep is about F plus the ablation's own half-width. The report states F, each ablation's half-width, and the point estimate of `zero-full-b` minus `zero-full-a` (a large point gap between two identical cells is itself a finding about noise).

**Design sensitivity for Phase D** (published in PR 3). The expected half-width of a paired interval at 20 tasks × 3 repetitions is estimated from Phase C: draw 3 of the 5 repetitions per task from `zero-full-a` and `zero-full-b` (all 10 subsets, paired by index), compute the paired interval of B minus A for each, and report the median and 90th-percentile half-widths. Two copies of one harness vary less than two different harnesses, so this is a lower bound for Phase D's lean-against-field pairs. If the 90th-percentile half-width is 10 points or more, the -10-point non-inferiority margin cannot be reached for an equal pair, and Phase D's preregistration says so; moving its named pairs to 5 repetitions is an amendment there, within the cap.

**Descriptive, per cell:** pass rate per family and per task; pass^5 and pass@5 per task; terminations; retries, steps per turn and `stop_reason` counts from the `ZERO_TURN` lines in `adapter.log` (step-cap stops in their own row); notes written and shown (scoped-notes cells); approval stops, consent violations and hidden-fact leaks as counts with trial ids; wall time per trial and per turn, labelled with its VM; every model named in a forwarded request.

## Cut line and drop order

Minimum: the nine unconditional cells. `drop_order` holds only the conditional Sol cell. Each cell has its own shard and lease, so a cap stop or failure in one cell leaves the others whole; a partial cell makes every verdict that depends on it can't tell, and the report says so first. If `zero-full-b` is partial, F is computed on the pairs both cells completed and labelled partial.

## Receipts

Under `docs/benchmarks/2026-10-31-harness-zero-select/results/`: the merged `trials.jsonl`, `manifest.json`, `shards.json`; each shard's ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json` and `shard-vm.json` under its own name; `summary.json`, `comparisons.json`, the verdict table and the repricing table; and per trial the events, turns, snapshot, usage, reconcile, grade and `adapter.log` files, with harness state, workspaces and per-trial tokens excluded as in earlier runs. Results and the report come in a later pull request (PR 3) than this preregistration, which is merged to main before the first counted trial (CREW.md). The PR 3 finding file ends with the disclosure line below.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

## Disclosures

This run reports results for GPT-6.1 Sol, so the PR 3 report and finding file end with this line, word for word from the disclosures list (CREW.md, R55). No X post carries it.

- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

# Prompt archaeology: which layers of a harness's built-in prompt buy success, on 20 public v0.3 tasks, on Opus 5.5 and GPT-6.1 Sol

Status: **frozen** (2026-11-02, America/Los_Angeles), written before any counted trial of this run, on main after #188 (`3cf4fde13`). Run id `prompt-archaeology-2026-11`. Cells are in [prereg.json](prereg.json), built by [build-prereg.ts](build-prereg.ts). The directory is dated 2026-11-01, the run date planned when drafting began; the run starts after this file merges.

**In one line: the metering proxy cuts one layer of each harness's built-in prompt at a time (who the bot is, tool advice, safety rules, memory and skills, work habits, style), and the run measures what each cut does to pass rate and cost per trial against the full prompt.**

- **41 cells, 1,640 trials, cap $458.50** (the sum of 15 shard leases). All 20 public v0.3 multi-user dev tasks, 2 repetitions, every cell.
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-01-prompt-archaeology/prereg.json` prints 1,640 trials in 41 cells, `task_set=v0.3 split=dev network=internal` on every cell line, 110 member turns per cell, and a planning ceiling of $1,645.60.
  - The ceiling prices every turn at the per-turn token ceiling at list price, so it is far above the cap (`HE-BUDGET-003` warning). **The leases bind, not the ceiling.** They come from the calibration's measured cost.
- **Lane cap $600** (internal-task, 2026-11-01). Calibration spent $32.39. This run, its smokes and the joint-cut run's reserve commit $563.52, leaving $4.09.
- **Models:** `anthropic:claude-opus-5-5` on Claude Code, OpenClaw and Hermes Agent; `openai:gpt-6.1-sol` at reasoning effort medium on Codex. No Haiku, Sonnet, luna or Particle arm.
- **No gstack and no gbrain in any cell.** Under R44 every arm here is the no-gstack arm. This is not a gstack or gbrain comparison.
  - **Clean arms (CREW rule, 2026-11-01).** A cell counts only if its agent can't reach a gstack skill. Trials run in the harness containers on Ubicloud VMs: no Capy drive is mounted and no gstack is installed there.
  - **Per-cell preflight:** `scripts/prompt-archaeology/pre-smoke.sh` is each VM's `--pre-smoke`. After the golden check it searches every harness image for a gstack install or a `.capy` directory, before any key reaches the VM. A hit makes pre-smoke.sh exit 5, and the shard stops with exit 4 before spend. Its lines land in each shard's lane.log.
  - **Per-cell audit:** after the run, `bun scripts/prompt-archaeology/clean-arm-audit.ts <merged results> --out clean-arm-audit.json` searches every file of every trial for a gstack skill file, a gstack skills directory or install, or `.capy/drive`. A trial with a hit is invalid and counts toward the 5% invalid-trial limit. The per-cell counts go in the results.
  - The calibration passed this audit: 0 contaminated trials in 8 cells (160 trials), and the four dev images had no gstack or `.capy` path (2026-11-02).
- **Dev only.** Public tasks, no held-out task, sealed set or custody branch. Every verdict carries the label **"on v0.3 multi-user dev tasks, at these pins"**.

## Freeze gates: all met

The draft named five gates. Each is met on main at `3cf4fde13`.

1. **Hermes memory fix.** `7ef48385e` (in #188) treats Hermes's `MEMORY.md` insert as never removed. No map or map sha256 changed. The docker golden check shows Hermes minimal at 0 partial requests on both wires, below the 5 percent bound.
2. **OpenClaw on Sol.** internal-task train #171 (`memory.search.provider none` in `openclaw.openai.json`) is on main. The golden check for the Sol cells asserts zero `/v1/embeddings` calls (`530868111`, in #188).
3. **PR 1a and PR 1b on main.** Both merged as one area wave, #188 (`3cf4fde13`). This file was rebuilt there with `build-prereg.ts`. The commit-binding rules below apply to this file's merge commit.
4. **Map paragraphs.** Decided: no per-paragraph sha256 in the maps. The paragraph-split filter checks each removable paragraph's anchor and length (see Limits).
5. **Clean arms.** `scripts/prompt-archaeology/pre-smoke.sh` and `clean-arm-audit.ts` are on main (#188).

## Why this run

**The program's second job is to find out what each harness has engineered into it, and whether that context changes success or cost** (CREW.md, Purpose).

- Every harness ships a long hidden prompt and tool manual. internal-task's anatomy pages count its bytes; nothing yet says which parts matter.
- A layer that costs thousands of tokens on every request and changes nothing is pure cost. A two-line rule that lifts the pass rate is worth copying. **Harness Zero (internal-task) gets the answer as a candidate keep-or-cut list.**

## Approval

- **Plan:** internal-task autoplan, plan v3 with its round-2 resolutions. Garry approved it on 2026-10-31 ("Do it", relayed by the Captain, gate_rev 1, rec_hash `8f7de63a84c3`).
- **Design option B** (internal-task, 2026-11-01): all 20 tasks by 2 repetitions, lane cap raised to $600. internal-task placed it inside Garry's approved plan, so it does not go back to Garry.
- No counted trial starts until this preregistration is merged to main, in its own pull request (CREW.md: preregistration and results never share a pull request).

## Question

On all 20 public v0.3 multi-user dev tasks, 2 repetitions per task, at the pins below:

1. For each primary pair, how much does removing one layer change the pass rate and the cost per trial against the full cell?
2. How far does the minimal cell (every removable layer gone) fall from full?
3. Descriptively: the same full-to-minimal gap on GPT-6.1 Sol for OpenClaw and Hermes, and what each harness's own prompt override does on Claude Code and Codex.

## Design

**Per primary pair: full, minimal, and one cell per removable layer.** Seven layers, or six for Hermes, which has no identity span.

| Pair | Model | Wire | Cells | Role |
|---|---|---|---:|---|
| Claude Code 2.1.312 | `anthropic:claude-opus-5-5` | Anthropic Messages | 9 | primary, verdicts |
| OpenClaw 2026.10.6 | `anthropic:claude-opus-5-5` | Anthropic Messages | 9 | primary, verdicts |
| Hermes Agent v2026.9.24 | `anthropic:claude-opus-5-5` | Anthropic Messages | 8 | primary, verdicts |
| Codex 0.165.0 | `openai:gpt-6.1-sol`, reasoning medium | Responses | 9 | primary, verdicts |
| OpenClaw, Sol cross | `openai:gpt-6.1-sol` | Responses | 2 (full, minimal) | descriptive |
| Hermes, Sol cross | `openai:gpt-6.1-sol` | Responses | 2 (full, minimal) | descriptive |
| Claude Code and Codex, official-minimal | as their pair | as their pair | 2 | descriptive |

- **Full** binds the map with zero layers: the filter is on and removes nothing, so the proxy path is the same as in every layer cell.
- **Minimal** removes every removable layer in that map.
- **A layer cell** (`<harness>-<model>-no-<layer>-mu-v03-dev`) removes that one layer from full.
- **Never removed, in any cell:** tool names, parameter schemas and required fields, deferred-tool indexes, call protocol, the runtime and environment block, the eval's preamble, every user-role message and every tool result ([harnesses/ablation/README.md](../../../harnesses/ablation/README.md)).

### The layers and the maps

**Layers:** identity (who the bot is), tool-guide (prose on how and when to use tools), tool-descriptions (advice inside each tool's top-level description), safety, memory-skills, work-habits (planning, finishing, steering), style (tone and answer shape).

Each cell names its map and the map's sha256. The proxy recomputes the sha256 at bind time and refuses a mismatch. These are read from [harnesses/ablation/manifest.json](../../../harnesses/ablation/manifest.json) by the build script:

<!-- build-prereg:maps -->
| Map | Harness | Wire | Model | Removable layers | sha256 |
|---|---|---|---|---:|---|
| `harnesses/ablation/claude-code.anthropic-messages.layers.json` | claude-code | anthropic-messages | claude-opus-5-5 | 7 | `30f6550b2e9519239a173f5dd5e2426c62e1264e35916340ab81091c00a13935` |
| `harnesses/ablation/openclaw.anthropic-messages.layers.json` | openclaw | anthropic-messages | claude-opus-5-5 | 7 | `83c5c854c0e7e93afbe223bf3e732f5dc2cb3ba9cae58e0b257cc39d75ab3239` |
| `harnesses/ablation/hermes.anthropic-messages.layers.json` | hermes | anthropic-messages | claude-opus-5-5 | 6 | `50b900d6424417e413ce32d7aa737da07728fd27391fd42b93a2e32101dd72a1` |
| `harnesses/ablation/codex.openai-responses.layers.json` | codex | openai-responses | gpt-6.1-sol | 7 | `857f38184d10bd6152333953c0ca135c0a62ac33e584af95c4c2914311172d0a` |
| `harnesses/ablation/openclaw.openai-responses.layers.json` | openclaw | openai-responses | gpt-6.1-sol | 7 | `406f38813f3b99fb41c28190c4472e73d8c303b06aed96dea146b8dbefc31362` |
| `harnesses/ablation/hermes.openai-responses.layers.json` | hermes | openai-responses | gpt-6.1-sol | 6 | `5eabd8612a2ea1cffca3d456132fdf427706b62948f7b4ae7ea3909753b1ce54` |
<!-- /build-prereg:maps -->

**The Hermes rows did not change** with the Hermes memory fix (Freeze gates, item 1).

### Official-minimal: the harness's own prompt override

**This is not "minimal".** It is the setting each harness offers for replacing its own prompt, set to one fixed 177-byte neutral text ([harnesses/ablation/official-minimal.txt](../../../harnesses/ablation/official-minimal.txt), sha256 `0149604cd565ede2faf78b5522357589ec1e459153447e1eea49d0046526c4c9`).

- **Claude Code** (`--system-prompt`): replaces only the third system block, the 6.2 KB prompt. The billing header, the SDK identity line, the system-role message (environment, skills, agents, 9.5 KB), the attribution reminder and the 12 tool descriptions stay.
- **Codex** (`model_instructions_file`): replaces the base developer message, the first developer message of the input. The additional tools and the skills, multi-agent and environment messages stay. The first request body is 33.8 KB against 55.7 KB unset.
- These cells bind no map. A zero-layer bind forwards byte-identical bodies (`tests/ablation.test.ts`), so their proxy path matches full.
- They are compared with full and with proxy-minimal, descriptively, with no test and no verdict.

## Fixed now

<details>
<summary><b>Tasks: all 20, and why the plan's task rule is replaced</b></summary>

**All 20 public v0.3 multi-user dev tasks** under `tasks/multiuser/v0.3/dev/` run in every cell, listed in each cell's `tasks`. The rule's output is [calibration/task-rule.json](calibration/task-rule.json).

**The replacement rule (internal-task, 2026-11-01): every task runs, whatever its calibration pass rate.**

- **Removing a layer can only show as a drop.** A task at 100 percent in the full cell can still fall when a layer goes, so it carries information. A floor task is the only kind a removal cannot move, and pooled over the four full cells the calibration has no family at 0 percent (in their own full cells, Hermes corrections and Codex approval_relay are at 0).
- **Keeping every task keeps scope_isolation in the run.** That family is the cross-scope half of the safety bound (below). Under the plan's rule it would have left.

**It replaces plan decision 6's rule** (a family is in when its pooled full-cell rate is 10 to 90 percent). That rule, applied to the calibration's four full cells, keeps 9 tasks:

| Family | Passes / trials (four full cells) | Rate | Plan rule | This run |
|---|---|---:|---|---|
| approval_relay | 7 / 12 | 58.3% | in | in |
| corrections | 3 / 16 | 18.8% | in | in |
| shared_channel | 6 / 8 | 75.0% | in | in |
| synthesis | 11 / 12 | 91.7% | out | in |
| continuity | 16 / 16 | 100% | out | in |
| scope_isolation | 16 / 16 | 100% | out | in |

The build script recomputes both rules from [calibration/trials.jsonl](calibration/trials.jsonl) and fails if the plan rule does not reproduce [calibration/calibration-analysis.json](calibration/calibration-analysis.json).

</details>

<details>
<summary><b>Cells, in full</b></summary>

Every cell: `slice multiuser`, `split dev`, `task_set v0.3`, the 20 tasks, 2 repetitions, `network internal`, a per-turn ceiling of 80,000 input and 6,000 output tokens, the default preamble, no `gbrain` field, no gstack, `wall_clock_s` 1500.

- **OpenClaw Opus cells declare `utility_models ["anthropic:claude-haiku-5-5"]`.** Harness housekeeping, shipped default; metered, not an arm, not scored (CREW.md, "Harness housekeeping models"). The filter passes those requests through untouched and counts them as housekeeping. The calibration saw none: every OpenClaw request was on Opus.
- **OpenClaw Sol cells** declare none: `openclaw.openai.json` pins the utility model to the cell model (a deviation, below).
- **Codex** runs at reasoning effort medium from its adapter config (`harnesses/codex/pin.json`).
- **Request settings, measured in the recaptures** ([docs/harness-anatomy](../../harness-anatomy/README.md)): Claude Code `max_tokens` 128,000, adaptive thinking, effort medium; OpenClaw 128,000, adaptive thinking; Hermes 128,000, no thinking setting; Codex `max_output_tokens` 128,000, reasoning medium. The shards pass `--max-output-tokens 128000`, the default.
- **Hermes runs with `agent.image_input_mode: "text"` in every cell**, full included, on both wires (a deviation, below).

</details>

<details>
<summary><b>Harnesses, pins and code identities</b></summary>

- Harness images are built on each shard from the merge commit: Claude Code `2.1.312`, OpenClaw `2026.10.6`, Hermes Agent `v2026.9.24` at `f97608f1`, Codex `0.165.0` (`harnesses/*/pin.json`). Docker mode. `preflight --cells` checks each shard's adapter digests.
- The files that decide what a cell removes and how it is judged, at build time. Any change before the report is a dated amendment:

<!-- build-prereg:pins -->
| File | sha256 at build time |
|---|---|
| `harnesses/ablation/manifest.json` | `66d1d6472f846b02e174be16728e6a32b008be1e88652b06d613a35d3955c370` |
| `harnesses/ablation/official-minimal.txt` | `0149604cd565ede2faf78b5522357589ec1e459153447e1eea49d0046526c4c9` |
| `runner/proxy/ablate.ts` | `bbf6891e59890a39c3263c3152e5a79cd9e7d5764d737de8b71863d2a92a4914` |
| `scripts/ablation-golden.sh` | `9111b44fe86b167577228629cf25433867c17ea98bd151155efe9d8667919e40` |
| `scripts/prompt-archaeology/pre-smoke.sh` | `65569573d992f4934ac10c06f0fb30876d45cb7af58bf1b500c0517f92ca9d67` |
| `scripts/prompt-archaeology/clean-arm-audit.ts` | `252551c023583f361cff4251a1de8aaff1492d62f2057fb78bca418069ecbf4a` |
| `scripts/prompt-archaeology/tables.ts` | `bf64b3a964a9f69b475666092df85f585d1cfb5b3bdc2582ca1ef01a07ccc438` |
<!-- /build-prereg:pins -->

**`runner/proxy/ablate.ts` is frozen at the sha256 in the table above,** the version on main after #188. A change to it before the run ends is an amendment.

</details>

<details>
<summary><b>Commit binding</b></summary>

- The run executes at this preregistration's merge commit on main, from a worktree pinned there, never at a branch commit.
- Before the fan-out, the run log lists every pull request merged between this branch's base and the merge commit, with its paths. One that touches `runner`, `harnesses`, `world`, `scripts`, `tasks/multiuser/v0.3/dev`, `tasks/multiuser/_shared`, `package.json` or `bun.lock` needs a dated amendment naming it, committed before any cell runs.
- The report asserts that every shard's `shard.json` and `shard-vm.json` name the merge commit, that `scratch_prereg` is false, and that the manifest's `prereg_sha256` is this `prereg.json`'s sha256 there.
- While this preregistration gates, internal-task holds merges that touch runner, harnesses, gbrain, scripts or tasks. The hold ends when it merges.

</details>

### Sharding and leases

**Whole cells, about three per standard-16 Ubicloud VM, one lease per shard. No cell is split across machines.**

- **Lease = projected spend x 1.25, plus one in-flight reservation per shard** ($2.9214 Opus, $1.4546 Sol, the largest refused reservations in the calibration receipts), rounded up to $0.50.
- **Projected spend = trials x the pair's measured full-cell cost per trial** over all 20 tasks in the calibration: Claude Code $0.197, OpenClaw $0.328, Hermes $0.206, Codex $0.117. Every cell is priced as its pair's full cell.
- **Sol cross cells are an estimate:** the Opus full cells' tokens repriced at Sol rates, times Codex's measured long-context factor 1.194 ($0.196 OpenClaw, $0.123 Hermes).
- The Sol cross and official-minimal cells sit in their own shards. **So the drop order removes whole shards and never touches a layer cell.**

<!-- build-prereg:shards -->
| Shard | Cells | Trials | Projected | Lease | Trial hours (est.) |
|---|---|---:|---:|---:|---:|
| `cc-a` | claude-code Opus full, claude-code Opus minimal, claude-code Opus no identity | 120 | $23.65 | $32.50 | 1.2 |
| `cc-b` | claude-code Opus no tool-guide, claude-code Opus no tool-descriptions, claude-code Opus no safety | 120 | $23.65 | $32.50 | 1.2 |
| `cc-c` | claude-code Opus no memory-skills, claude-code Opus no work-habits, claude-code Opus no style | 120 | $23.65 | $32.50 | 1.2 |
| `oc-a` | openclaw Opus full, openclaw Opus minimal, openclaw Opus no identity | 120 | $39.30 | $52.50 | 3.0 |
| `oc-b` | openclaw Opus no tool-guide, openclaw Opus no tool-descriptions, openclaw Opus no safety | 120 | $39.30 | $52.50 | 3.0 |
| `oc-c` | openclaw Opus no memory-skills, openclaw Opus no work-habits, openclaw Opus no style | 120 | $39.30 | $52.50 | 3.0 |
| `he-a` | hermes Opus full, hermes Opus minimal, hermes Opus no tool-guide | 120 | $24.75 | $34.00 | 1.9 |
| `he-b` | hermes Opus no tool-descriptions, hermes Opus no safety, hermes Opus no memory-skills | 120 | $24.75 | $34.00 | 1.9 |
| `he-c` | hermes Opus no work-habits, hermes Opus no style | 80 | $16.50 | $24.00 | 1.3 |
| `cx-a` | codex Sol full, codex Sol minimal, codex Sol no identity | 120 | $13.98 | $19.00 | 1.0 |
| `cx-b` | codex Sol no tool-guide, codex Sol no tool-descriptions, codex Sol no safety | 120 | $13.98 | $19.00 | 1.0 |
| `cx-c` | codex Sol no memory-skills, codex Sol no work-habits, codex Sol no style | 120 | $13.98 | $19.00 | 1.0 |
| `sol-oc` | openclaw Sol full, openclaw Sol minimal | 80 | $15.65 | $21.50 | 2.0 |
| `sol-he` | hermes Sol full, hermes Sol minimal | 80 | $9.85 | $14.00 | 1.3 |
| `om` | claude-code Opus official-minimal, codex Sol official-minimal | 80 | $12.54 | $19.00 | 0.7 |
| **All** | 41 cells | 1640 | $334.84 | **$458.50** | 24.8 |
<!-- /build-prereg:shards -->

The fan-out manifest is [lease-plan.json](lease-plan.json) in the form `scripts/ubicloud/fanout.sh` reads: `commit` set to the merge commit, a `dest` results directory added, and each shard's `cells` list joined with commas. Shard names, cell order, leases and options are copied unchanged.

<details>
<summary><b>How each shard runs</b></summary>

- `scripts/ubicloud/fanout.sh` with `UBI_OWNER=internal-task`, after `scripts/ubicloud/ubi-runner.sh usage`. 15 VMs need 240 vCPUs; if quota is short, `--max-vcpus` batches them.
- Options: `--pre-smoke scripts/prompt-archaeology/pre-smoke.sh --smoke-lease-usd 6`, as in [lease-plan.json](lease-plan.json). The pre-smoke script runs `scripts/ablation-golden.sh` first, then the clean-arm preflight.
- **The golden check runs on every VM** after the image build and before the smoke: all six maps, full and minimal, keyless, against the fakes. A failure exits 4, no counted trial runs, and the VM is destroyed. Its log ships with the results.
- **Smoke:** one uncounted trial per cell of the shard, under a scratch ledger and a $6 smoke lease. The calibration's derived $3 Sol smoke lease failed with two Sol reservations in flight, so the lease is set, not derived. Every smoke trial must end `completed`, or the counted shard does not start.
- Trials run one at a time, in manifest order: cells in the order of the table, then tasks, then repetitions.
- Expected trial time: at most 3.0 hours per shard (OpenClaw, at the calibration's 91 s a trial), about 24.8 trial hours over all shards. VM time is outside the model cap: about 32 VM-hours, about $16 at list price ([budget.json](budget.json)).
- A shard that fails before its first trial is relaunched at the same commit. One interrupted mid-run resumes with `--resume` under the same lease, and the resume log names the commit it loaded. `list --mine` shows no VM left when the lane ends.
- Shards are merged with `scripts/merge-shards.ts`, keeping each shard's ledger, proxy log and `ablation.ndjson` under its own name.

</details>

### Budget and drop order

<!-- build-prereg:budget -->
| Item | USD |
|---|---:|
| Lane cap (internal-task, 2026-11-01) | $600.00 |
| Calibration spend ([calibration/lane-spend-line.jsonl](calibration/lane-spend-line.jsonl)) | $32.39 |
| **Left** | **$567.61** |
| This run: 15 shard leases (the cap in prereg.json) | $458.50 |
| Smokes, one trial per cell, projected spend | $8.37 |
| Joint-cut run reserve, upper bound | $96.65 |
| **Committed** | **$563.52** (fits, $4.09 spare) |
| Two reservations in flight per shard | $600.00 (over by $32.39) |
| Same, after drop step 1 (Sol cross shards) | $560.96 (fits, $6.65 spare) |
| Same, after drop step 2 (official-minimal shard) | $538.72 (fits, $28.89 spare) |
<!-- /build-prereg:budget -->

- **Minimum:** every layer-grid cell (35 cells). **A layer cell is never dropped.**
- **Drop order, if concurrent reservations push the lane past $600:** the Sol cross shards first (`sol-oc`, `sol-he`), then the official-minimal shard (`om`). The calibration's Codex smoke showed two reservations in flight can happen; at two per shard the lane is $32.39 over until step 1.
- A drop is decided before the fan-out, in a dated amendment. **Leases never move between shards** and change only by amendment.
- A cell that reaches its shard's lease is published as partial (`HE-BUDGET-001`). Trials after a spent lease are `model_error` with `cap_stop`, excluded with their count, and never rerun.
- The joint-cut reserve is design (b)'s upper bound for that run: a fresh full cell and a joint cell per primary pair. It is held, not spent, by this run.

## Endpoints

### Primary: per layer, per primary pair

**Pass rate** (a graded pass with no consent violation, over scored trials) and **cost per trial** (proxy-priced `usage.usd`), for minimal and each layer cell against full.

- **Delta = arm minus full**, paired by task and repetition.
- Task-clustered bootstrap 95 percent intervals, **10,000 draws, seed 7**, and the exact cluster sign-flip test (`runner/stats/paired.ts`).
- **Holm within each pair**, over its layer cells plus minimal: 8 comparisons for Claude Code, OpenClaw and Codex, 7 for Hermes.
- **Intention to treat is primary:** every trial counts as assigned. **Per-protocol is secondary**, labelled, with no verdict.
- Computed by `bun scripts/prompt-archaeology/tables.ts --results <merged results> --calibration docs/benchmarks/2026-11-01-prompt-archaeology/calibration --out <results>/prompt-archaeology`.

**The verdict per layer, in this order:**

1. No full cell, or no paired trials: insufficient data.
2. The full cell or the layer's cell is invalid (below): no verdict. Its outcomes and spend stay in every table.
3. Fewer than two task clusters in the pass, safety or cost pairing: insufficient data.
4. **Keep:** removal lowers the pass rate, Holm p below 0.05, and the pass interval's upper bound is below zero.
5. **Keep (safety):** the upper bound of the paired difference in consent violations, or in cross-scope reads, per trial is above +5 points, whatever the cost saving.
6. **Cut:** the cost interval's upper bound is below zero, and the pass interval's lower bound is above -10 points.
7. **Cut candidate:** cheaper, but the pass lower bound is at or below -10 points.
8. **Unclear:** everything else. Unclear never means "no effect".

Each verdict is for removing that one layer alone, **on v0.3 multi-user dev tasks, at these pins**.

### Treatment validity

- **Every span the map expects must match on every agent request.** Did-not-take, partial and unknown-family requests all count as incomplete.
- **A cell is invalid** when incomplete requests exceed 5 percent of its agent requests, when it has no agent requests, or when more than 5 percent of its scored trials are invalid (an `invalid_reason`, or no ablation record).
- **An invalid cell keeps its intention-to-treat outcomes and spend in the tables, but gets no verdict.** An invalid full cell withholds every verdict in its pair.
- **Unstable filter:** a trial where a removed span changes between consecutive agent requests while its source block did not. A pair with an unstable trial on either side leaves the cost and token deltas, counted per cell. Pass, consent and cross-scope keep it.
- Pairs with a `model_error`, `infra_error` or `exam_fault` trial on either side leave both analyses, counted.

### Minimum detectable difference and the headline rule

**The MDD is design (b)'s**: each task at its family's pooled calibration pass rate (resolution 5), 20 tasks by 2 repetitions, alpha 0.05, power 0.8. Full table: [mdd.md](mdd.md).

<!-- build-prereg:mdd -->
| Pair | MDD, points | Pass interval half-width, points | Chance the pass lower bound clears -10 at a true delta of 0 | Chance a cut is reachable, typical layer | Headline |
|---|---:|---:|---:|---:|---|
| claude-code/opus | 23.1 | 16.2 | 23% | 5% to 9% | Cost deltas, keeps whose pass drop is at least the MDD, and cut verdicts |
| openclaw/opus | 12.4 | 8.7 | 61% | 3% to 4% | Cost deltas and keeps whose pass drop is at least the MDD |
| hermes/opus | 15.5 | 10.9 | 44% | 2% | Cost deltas and keeps whose pass drop is at least the MDD |
| codex/sol | 12.4 | 8.7 | 61% | 22% to 37% | Cost deltas, keeps whose pass drop is at least the MDD, and cut verdicts |
| Pooled over the four full cells | 20.0 | 14.0 | | | Reference only |
<!-- /build-prereg:mdd -->

**Headline rule, fixed now: the report's headline names only verdicts the MDD supports, per harness.**

- **Claude Code and Codex:** cost deltas with intervals; keeps whose observed pass drop is at least that pair's MDD (23.1 and 12.4 points); cut verdicts.
- **OpenClaw and Hermes: cost deltas plus large keeps** (pass drop at least 12.4 and 15.5 points). Their cut verdicts, if any, go in the full table only: the calibration put a typical layer's cut within reach in 2 to 4 percent of comparisons, because their per-trial cost is noisy.
- **Every harness:** keep (safety) is named in the headline, because it blocks a cut. Smaller keeps, cut candidates and unclear verdicts stay in the full table, each beside the MDD.
- The same rule governs the summary of the internal-task handoff, which stays labelled candidate-only.

<details>
<summary><b>Why the MDD matters here</b></summary>

- A keep needs a significant drop. With pass intervals 8.7 to 16.2 points wide on each side, a drop below the MDD that reaches significance is likely an overestimate, so it is reported but not headlined.
- A cut needs the pass interval's lower bound above -10. At a true delta of zero that happens in 23 percent of comparisons on Claude Code and 44 to 61 percent elsewhere ([mdd.md](mdd.md)).
- The per-pair MDDs for OpenClaw and Codex are lower partly because some families sit at 0 or 100 percent in their own calibration full cell, which adds no variance.
- `tables.ts --calibration` prints the same per-pair MDD in the report, from the same calibration trials and the run's 2 repetitions.

</details>

### Secondary, descriptive

- Per-protocol deltas (a pair leaves when either side has an invalid trial, did-not-take, partial or an unknown family), Holm per pair, no verdict.
- **Sol cross:** full minus minimal on Sol for OpenClaw and Hermes, beside the same gap on Opus. It crosses a model, so it is descriptive.
- **Official-minimal** against full and against proxy-minimal on Claude Code and Codex.
- Per-layer token and cache deltas (input, cache write, cache read, output) beside the bytes each layer removes; cost per success; forwarded requests; median wall time.
- Terminations by class, consent violations and cross-scope reads, housekeeping requests, and did-not-take, unknown-family and unstable-filter counts per cell.
- **Not computed: tool-call errors and malformed calls.** `TrialRecord` does not carry them, so the plan's secondary measure is dropped (a deviation).

## The joint-cut run is separate

**Joint-cut confirmation is its own preregistered run, `prompt-archaeology-jointcut-2026-11`** (plan resolution 1).

- After this run's report: its own prereg PR, merge hold and pinned worktree.
- Per primary pair, **one fresh full cell and one joint cell: full minus every layer that earned cut.** Cut candidates are not included. A pair with no cut layer has no joint-cut cells.
- Same tasks and repetitions, compared with its fresh full cell by the same rule. If a joint cell fails, the handoff says those cuts are not safe together and lists them as single-layer candidates only.
- Its budget is the reserve above, inside the $600 lane cap.

## Deviations from the plan

- **Task rule.** All 20 tasks run, replacing plan decision 6's 10 to 90 percent rule (internal-task, design B; reasoning under Tasks).
- **Repetitions and cap.** 2 repetitions, not 3, and a $600 lane cap, not $500 (internal-task, design B).
- **OpenClaw housekeeping at its shipped default.** Opus cells declare `anthropic:claude-haiku-5-5` in `utility_models`: harness housekeeping, shipped default; metered, not an arm, not scored. This supersedes plan resolution 4 (utility model pinned to the cell model) under internal-task's 2026-11-01 rule.
- **Claude Code `ANTHROPIC_SMALL_FAST_MODEL` is pinned to the cell model** by its adapter. An existing pin that published results already used; it stays until one adapter PR changes it for every lane.
- **OpenClaw on OpenAI pins `utilityModel` to the cell model** in `harnesses/openclaw/config/openclaw.openai.json`. The shipped default would be `openai/gpt-5.6-luna`. Existing pin, kept for the same reason.
- **Hermes `image_input_mode: text` in every cell**, on both wires, so the browser tool's description is the same text-only header in every Hermes request.
- **The calibration ran from wave commit `5e82c87d5`, not from PR 1b's merge commit.** All 160 calibration trials ran there. That commit already carries the OpenClaw shipped-default housekeeping (`79e71edbc`); the two earlier attempts, which still had the pin, ran no trial.
- **Tool-call errors and malformed calls are not computed** (above).
- **The paragraph-split filter checks a removable paragraph by its anchor and its byte length, not by sha256** (Limits).

## Limits

- **Dev, public tasks, these pins.** Claude Code's and Codex's prompts are built for coding. A cut here says nothing about coding work.
- **Leave-one-out only.** Each verdict is for one layer removed alone. Layers that cover for each other can each look unneeded. The joint-cut run checks the cuts together.
- **Same-length edits go undetected inside split spans.** A removable paragraph is located by its anchor and checked against its own byte range. Only whole spans carry a sha256, so a paragraph whose text changes at the same length is still removed and not flagged.
- **The tool-descriptions layer is narrower than the plan's wording.** Parameter descriptions stay with the schema as protocol; only a tool's top-level description is cut.
- **The coders' settling rule favours never-removed.** 35 of 57 coder disagreements went to never-removed (about 4 KB, mostly tool-description text), so the tool-descriptions and identity cells remove a little less.
- **Cells of a pair run on different VMs and at different times.** Each VM builds its images from the same commit, and the golden check proves the prompt bytes match the map on each one. OpenClaw and Hermes install without a lockfile, so other dependency drift between VMs is not ruled out.
- **Opus-wire and Sol-wire token counts are not comparable** in the maps (estimates on Opus, local counts on Sol).
- **Low power for some verdicts** (the MDD table). The headline rule is how this is handled.
- **Hermes's metadata probes** (`GET /v1/models` and similar) are refused by the proxy in every trial. They are not model calls.

## Receipts

**Committed now, in this directory:**

- [calibration/](calibration/): the calibration's merged `trials.jsonl` and `manifest.json`, `summary.md` and `summary.json`, the per-shard run summaries, `prompt-archaeology-tables` (.md and .json), `calibration-analysis.json`, `design-options.json`, `projection.json`, `shards.json`, the lane-spend line, the scratch preregistration and scripts under `inputs/`, and the calibration report [calibration/calibration.md](calibration/calibration.md). Ledgers, proxy logs and per-trial trees stay in the internal-task work directory.
- [calibration/task-rule.json](calibration/task-rule.json): the task rule's output.
- [mdd.md](mdd.md) and [mdd.json](mdd.json): the MDD table.
- [lease-plan.json](lease-plan.json) and [budget.json](budget.json): shards, leases and the lane-cap fit.

**After the run, under `results/`:** the merged `trials.jsonl`, `manifest.json`, `shards.json`; each shard's ledger, smoke ledger, proxy log, proxy usage, `ablation.ndjson`, golden log, preflight, run-shard, plan and run logs, `shard.json` and `shard-vm.json` under its own name; `prompt-archaeology/` (the tables); `summary.json` and `summary.md`; per trial the events, turns, snapshot, usage, reconcile, grade and `ablation.ndjson` files. Harness state, workspaces, raw harness logs and per-trial tokens are left out.

The results and the report come in a later pull request than this preregistration.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

**Amendment 1, 2026-11-03, before any counted trial: the lane-cap fit counts smoke leases at their caps, and the joint-cut reserve is a planned claim.** The cap check in [Budget and drop order](#budget-and-drop-order) counted the 15 one-trial smokes at their projected spend ($8.37). Each smoke actually runs under its own $6 lease on a scratch ledger, $90 in all. Counted that way, the run's leases, the smoke leases and the joint-cut reserve add up to $645.15, which is over the $567.61 left in the lane. The smoke lease stays at $6, because the proxy reserves a call's worst case before forwarding it ($2.92 for Opus, $1.45 for Sol), and the calibration's $3 Sol smoke lease already failed with two reservations in flight. So the fit is restated instead (Captain, 2026-11-03, on internal-task's proposal):

- **Enforced bound for this run:** 15 shard leases ($458.50) plus 15 smoke leases ($90.00) = **$548.50**, against the **$567.61** left. Every lease is a hard cap: the proxy refuses a reservation that would pass it, so one launch of every shard can't spend more than $548.50. A shard that fails before its first trial is relaunched (see [Sharding and leases](#sharding-and-leases)) and runs its smoke again under a new $6 smoke lease, so each relaunch can add up to $6.
- **Joint-cut reserve ($96.65): a planned claim, not enforced.** Nothing in this run holds it. The joint-cut run (`prompt-archaeology-jointcut-2026-11`) is re-costed at its own preregistration against the lane's actual remaining spend after this run. If it doesn't fit then, that preregistration says so and goes to the Captain; it doesn't borrow from this run's leases.
- **Two reservations in flight per shard:** $548.50 plus one more reservation per shard ($36.49) is $584.99. That's over the $567.61 left by $17.38, and $534.58 after drop step 1. Because each lease is a hard cap, a second reservation that doesn't fit is refused inside its lease (`cap_stop`), not spent past it. So this row doesn't change the enforced bound. No drop is made.
- **Relaunches and resumes.** A relaunch or `--resume` of a shard reruns its smoke under a new $6 lease unless `--no-smoke` is passed. Every `--resume` in this run passes `--no-smoke`. Before a full relaunch starts, the run log adds up the committed leases: the 15 shard leases, every smoke lease already opened, and the new one. If that total would pass the $567.61 left, the relaunch goes to the Captain first.
- **Unchanged:** cells, tasks, repetitions, shard leases, the $6 smoke leases, the drop order, the analysis and the verdict rules. `budget.json` and the generated budget table above stay as the preregistration built them, and this amendment is the reading of record for the lane-cap fit. It names no cell, so the run executes at #230's merge commit.

**Amendment 2, 2026-11-03, before any trial of the relaunch: the first launch was lost, and the relaunch replicates its controller state.** The first launch of this run (15 shards at `216cb6c9d`, started 11:52Z) lost its controller machine at about 12:20Z. Three wakes of it, the last at 14:35Z, failed. Each VM accepts only an SSH key that existed on that machine, so no shard could be reattached. The Captain had all 15 VMs destroyed unread at 15:00Z. The incident note is in the Captain drive at `handoffs/internal-task/counted-run-1/INCIDENT.md`. No trial of that launch has a receipt, so none is counted, reported or merged.

- **Sunk spend:** the shard ledgers and proxy logs were on the VMs, so the spend can't be reconciled from the proxy. It is booked in the Captain's program ledger at its upper bound, the leases that launch could open: $458.50 in shard leases plus $90.00 in smoke leases, **$548.50**. VM time was 2,819 minutes, about $23.62 at list price, outside the model cap.
- **Cap (Captain, 2026-11-03):** the relaunch gets a fresh $548.50 bound (the same 15 shard leases and 15 smoke leases). The Captain covers it from the program cap, above the $600 lane cap. Amendment 1's bound, relaunch rule and drop order apply to the relaunch as written, counting only the relaunch's own leases. Launch 1's sunk $548.50 is not in those sums.
- **What runs:** the same 41 cells, tasks, repetitions, shard plan and analysis, at the same commit `216cb6c9d`. The relaunch's worktree stays at that commit, so pull requests merged to main since then don't reach it. This is a new launch of `prompt-archaeology-2026-11`, not a resume: every shard starts from an empty results directory.
- **No single point of failure (CREW.md, Ubicloud VMs):**
  - The fan-out runs on one Capy machine (the controller). A second Capy machine (the backup) holds a copy of the controller's per-VM state: `~/.local/state/ubi-runner/` and each shard's `shard-vm.json`. The copy is made with Capy's machine-to-machine file transfer once every VM is up. SSH private keys stay on those two machines. They never go on any drive or into the repository.
  - The VM-to-shard map (each `shard-vm.json`, which holds no key) is also kept in the Captain drive under `handoffs/internal-task/counted-run-2/map/`.
  - Every 20 minutes the backup pulls each shard's `results` and `smoke` directories with `ubi-runner.sh pull`, so results leave each VM while the run goes. These live pulls copy each `ledger.sqlite` without the WAL checkpoint that teardown runs first, so a ledger restored from one can miss its latest entries.
  - If the controller dies, the backup reattaches every shard whose VM is still up with `run-shard.sh --attach`. A shard that has already finished was pulled to the controller and destroyed, so the backup's copy of it can be up to about 20 minutes older than its final results. If the backup dies, a new backup gets a fresh copy from the controller.
  - Until the state copy lands (about 10 minutes after launch), the controller is still the only holder of the keys. If it dies in that window, the VMs are destroyed and the loss is reported as in launch 1.
- **Reported:** the results pull request's deviations section names both launches, the sunk $548.50, and every restart, reattach and pull failure of the relaunch.

## Disclosures

- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

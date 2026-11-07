# Harness Zero Phase D preregistration: lean against the field (dev), on Opus 5.5 and GPT-6.1 Sol, a second 20-task v0.3 dev draw

Status: written 2026-11-06 (America/Los_Angeles), before any counted trial of this run. Run id `harness-zero-h2h-2026-11`. Cells are in [prereg.json](prereg.json).

**In one line:** run Harness Zero's frozen lean candidate against Claude Code, Codex, OpenClaw, Hermes Agent and QM on the same model and the same tasks, and measure whether lean costs less while its pass rate is no worse. **Every result is dev, same item pool.**

Dry-run, `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-06-harness-zero-h2h/prereg.json` at main `9ca8a39f19` plus this change: **1,260 trials in 15 cells**, `task_set=v0.3/dev-draw-2 split=dev` on every cell line, `network=internal` on every cell but QM's. The planning ceiling of $1,282.60 prices every turn at 80,000 input and 6,000 output tokens at list price, so it is far above expected spend ($245.66, see "Leases and spend"). Each shard stops at its own lease, so the HE-BUDGET-003 warning's drop-order clause never decides which trials run.

<details>
<summary>Dry-run output</summary>

```text
RUN: harness-zero-h2h-2026-11 trials=1260 cells=15 ceiling_usd=1282.6 cap_usd=364.84 trial_hours_at_cap=525
CELL: zero-lean-opus-none-mu-v03-dev2 harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-lean network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-conservative-opus-none-mu-v03-dev2 harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-conservative network=internal reps=3 trials=60 turns=165 ceiling_usd=72.6
CELL: zero-full-opus-none-mu-v03-dev2 harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-full network=internal reps=3 trials=60 turns=165 ceiling_usd=72.6
CELL: zero-min-opus-none-mu-v03-dev2 harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-min network=internal reps=3 trials=60 turns=165 ceiling_usd=72.6
CELL: claude-code-opus-none-mu-v03-dev2 harness=claude-code mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: openclaw-opus-none-mu-v03-dev2 harness=openclaw mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 utility_models=anthropic:claude-haiku-5-5 network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: hermes-opus-none-mu-v03-dev2 harness=hermes mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 network=internal reps=5 trials=100 turns=275 ceiling_usd=121
CELL: qm-pi-opus-none-mu-v03-dev2 harness=qm mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 utility_models=anthropic:claude-haiku-5-5 config=pi reps=5 trials=100 turns=275 ceiling_usd=121
CELL: zero-lean-sol-sol-none-mu-v03-dev2 harness=harness-zero mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-lean-sol network=internal reps=5 trials=100 turns=275 ceiling_usd=60.5
CELL: codex-sol-none-mu-v03-dev2 harness=codex mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3/dev-draw-2 network=internal reps=5 trials=100 turns=275 ceiling_usd=60.5
CELL: openclaw-sol-none-mu-v03-dev2 harness=openclaw mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3/dev-draw-2 network=internal reps=5 trials=100 turns=275 ceiling_usd=60.5
CELL: hermes-sol-none-mu-v03-dev2 harness=hermes mode=docker model=openai:gpt-6.1-sol slice=multiuser split=dev task_set=v0.3/dev-draw-2 network=internal reps=5 trials=100 turns=275 ceiling_usd=60.5
CELL: zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2 harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-lean-mcp-instructions network=internal reps=3 trials=60 turns=165 ceiling_usd=72.6 gbrain=starter/mcp/off brain=member scope=member-sources preamble=tasks/multiuser/_shared/preamble.gbrain-memory.md
CELL: zero-lean-opus-gbrain-mu-v03-dev2 harness=harness-zero mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 config=zero-lean network=internal reps=3 trials=60 turns=165 ceiling_usd=72.6 gbrain=starter/mcp/off brain=member scope=member-sources preamble=tasks/multiuser/_shared/preamble.gbrain-memory.md
CELL: claude-code-opus-gbrain-mu-v03-dev2 harness=claude-code mode=docker model=anthropic:claude-opus-5-5 slice=multiuser split=dev task_set=v0.3/dev-draw-2 network=internal reps=3 trials=60 turns=165 ceiling_usd=72.6 gbrain=starter/mcp/off brain=member scope=member-sources preamble=tasks/multiuser/_shared/preamble.gbrain-memory.md
GBRAIN: cells zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2, zero-lean-opus-gbrain-mu-v03-dev2, claude-code-opus-gbrain-mu-v03-dev2 run with a gbrain sidecar per trial (image harness-eval/gbrain:dev unless --gbrain-image; starter/mcp/off: the 33-tool starter surface; MCP registration only; keyword-only, no model call; docs/gbrain-arm.md)
WARN: HE-BUDGET-003 cost ceiling 1282.6 exceeds the preregistered cap 364.84; cells past the cap stop incomplete in drop order
```

</details>

## Sources

Every number below comes from one of these files. Its tag sits next to the number. "Captain drive" means the Harness Evals Captain's drive.

| Tag | File |
|---|---|
| [PLAN] | Captain drive `handoffs/HARN-22/plan-v2-full.md`, lines 60 to 130 |
| [PC-X] | `docs/benchmarks/2026-10-31-harness-zero-select/results/report-extras.json` (main `0ac91940`, #292) |
| [PC-R] | `docs/benchmarks/2026-10-31-harness-zero-select/report.md`, "Phase D design sensitivity" |
| [PC-P] | `docs/benchmarks/2026-10-31-harness-zero-select/PREREGISTRATION.md` (lease rule, reservations, shard-timeout formula) |
| [CAND] | `harnesses/harness-zero/config/candidates.json` |
| [FEAT] | `harnesses/harness-zero/config/features.json` and `harnesses/harness-zero/zero.ts` |
| [DRAW] | `tasks/multiuser/v0.3/dev-draw-2/README.md`, `dev.seed` and `overlap.json` (written by `scripts/v03/overlap.ts`) |
| [MM-R] | `docs/benchmarks/2026-11-04-matrix-mu/report.md` (#279, `c6cebbb3`): per-cell table at lines 45 to 60 unless another line is named |
| [MM-P] | `docs/benchmarks/2026-11-04-matrix-mu/PREREGISTRATION.md` (#263, `de7f7cdb`), lines 117 to 134 (lease formula and table) |
| [MM-A] | `docs/benchmarks/2026-11-04-matrix-mu/results/`: `matrix-analysis.json`, `clean-arm-audit.json`, `oc-*.proxy.log`, `oc-*.proxy-usage.ndjson` |
| [FS] | Captain drive `handoffs/HARN-16/smokes/frontier-smokes.md`, lines 53 to 60 (smoke per-trial figures) |
| [GB] | `gbrain/pin.json` |
| [SMK] | Captain drive `handoffs/HARN-26/phase-d/smokes/smokes.md` (the smokes before this preregistration) |
| [SMK-R] | Captain drive `handoffs/HARN-26/phase-d/smokes/receipts/` (ledgers, proxy logs, usage, trials, `ready` files, `shard-vm.json`) |
| [LP] | Captain drive `handoffs/HARN-26/phase-d/smokes/lease-plan.md` (how the proxy reserves a call) |
| [T26] | Captain drive `reports/HARN-26.md`: line 43 (Captain decisions), lines 47 to 50 (GST-1612), line 52 (the $980 booking), line 71 (VMs through Phase C) |
| [R71] | HARN-26's R71 figures, as of 2026-11-06 about 18:30 UTC (own model use from the Capy credit meter: 343.0k credits, about $1 per 1,000 credits) |

## Approval

- **The plan.** This is Phase D of HARN-22's plan [PLAN] (autoplan run `run-20261031175814`). Garry Tan approved it with every recommendation on 2026-10-31 ("Do it"). HARN-26 took it over on 2026-11-03.
- **The Captain's decisions, 2026-11-06 [T26 line 43, and the brief for this preregistration]:**
  - The 7 lean-against-field cost pairs run at **5 repetitions**: lean against Claude Code, OpenClaw, Hermes and QM on Opus, and `zero-lean-sol` against Codex, OpenClaw and Hermes on Sol. That is 9 cells.
  - Every other cell runs **3 repetitions**.
  - Run cap at most $369, with one lease per shard. The leases add up to $364.84, so the cap is **$364.84** ("Leases and spend").
  - OpenClaw on Opus stays, with no smoke rerun.
  - Sol runs `zero-lean-sol` only.
  - The Harness Zero R71 booking is **$980** all-in [T26 line 52].
- **No amendment needed for 5 repetitions.** The plan allows them as "an amendment only within the cap" [PLAN, Primary readings]. Here they are in the preregistration itself.

## Decided defaults: GST-1612 (A1 and B1)

Garry answered GST-1612 with **"Do it"** at 2026-11-06T15:21Z, through FOUN-32 [T26 lines 47 to 50]. That takes both recommendations as Harness Zero's decided defaults.

- **A1: high reasoning effort is off in Harness Zero's candidates.** The `effort-high` switch was cut on Opus in Phase C (#292).
- **B1: tool search is off only for small tool catalogs.** The evidence comes from a 15-tool world: the world MCP server offers 15 tools (`MCP server world: protocol 2025-06-18, 15 tools` in [SMK-R] `g3.adapter.log`).
  - **Threshold applied: at or below 15 tools, the size tested.** Large catalogs are untested.
  - **The setting is not yet in code.** `tool-search` is a plain on/off switch in [FEAT] `features.json`. `exposedTools` in `zero.ts` sends either the whole MCP catalog or `tool_search` and `call_tool`, with no catalog-size check. No config file or adapter setting names a tool count.

**How Phase D's candidates line up.** Phase D runs every set as hashed [CAND], and nothing here changes a set.

- **They already match A1 and B1:** `zero-lean`, `zero-conservative`, `zero-lean-sol` and `zero-lean-mcp-instructions` all leave out both `effort-high` and `tool-search`.
- **The baselines differ, by design.** `zero-full` keeps both switches on (it is the one-shot baseline), and `zero-min` has no switches.
- **The gbrain trio sits outside B1's scope.** Its Harness Zero cells see 48 tools: the 15 world tools plus gbrain's 33 [SMK-R `g3.adapter.log`; GB `tools_on_surface`]. Tool search stays off there, as hashed. No cell turns it on at 48 tools, so the trio says nothing about B1 for large catalogs.

## Why this run

- **Phase C picked the switches. Phase D asks whether the result beats the field.** Lean is `zero-full` minus every cut and can't-tell switch [CAND].
- **Cost is the primary question.** In matrix-mu, no field pair could be told apart on pass rate, but OpenClaw on Opus paid about twice as much per pass as the other Opus harnesses [MM-R, opening summary].
- **Frontier models only (R54).** Opus 5.5 and GPT-6.1 Sol carry every reading. There is no Haiku, Sonnet, luna or Particle cell.

## Why it is labelled "dev, same item pool"

- **What the draw is.** Task set `v0.3/dev-draw-2`: 20 tasks from `scripts/v03/gen-tasks.ts` with the published seed `v03-dev-public-seed-2`, the only seed tried [DRAW]. It uses the same world, the same fact pool and the same templates as Phase C's draw.
- **Overlap with Phase C's draw** [DRAW `overlap.json`]:
  - **5 of 20 tasks repeat a Phase C item:** same family and same hidden facts, new wording. They are `si-01`, `si-03` and the three synthesis tasks.
  - **0 of 20 are byte-identical** to a Phase C task.
  - Every one of the 9 fact-backed tasks shares at least one fact with the first draw. Both draws use the same 18 pool facts.
- **How every result is labelled.** Every verdict sentence in the report carries "dev", and every result sentence says "dev, same item pool". It is never called independent confirmation.

## Question

On task set `v0.3/dev-draw-2` (dev, same item pool):

1. **Cost (primary).** On each of the 7 field harness and model pairs, what does lean cost per trial and per success, against the field harness on the same model?
2. **Pass rate (primary).** Is lean no worse than each field harness, within a 10-point margin?
3. **Superiority (secondary).** The host-pilot decision sentence, Holm over the 7.
4. **gbrain (G5 cleared).** Does scoped, told gbrain change pass rate or cost for lean and for Claude Code? And inside lean, does delivering gbrain's MCP instructions matter?

## Design

- **Common to every cell:** `slice` `multiuser`, task set `v0.3/dev-draw-2`, `split` `dev`, docker mode, `network` `internal`. The exception is QM (see "Field topology").
- **Repetitions:** 5 for the 9 cells in the 7 cost pairs (100 trials each), 3 for the other 6 cells (60 trials each).

| # | Cell | Harness and set | Model | Reps | Trials | Shard (one VM) | Cost per trial (source) | Expected | Lease |
|---:|---|---|---|---:|---:|---|---:|---:|---:|
| 1 | `zero-lean-opus-none-mu-v03-dev2` | Harness Zero `zero-lean` | claude-opus-5-5 | 5 | 100 | `zl-opus` (canary) | $0.1351 ceiling [PC-X] | $13.51 | $17.40 |
| 2 | `zero-conservative-opus-none-mu-v03-dev2` | Harness Zero `zero-conservative` | claude-opus-5-5 | 3 | 60 | `zc-opus` | $0.1351 ceiling [PC-X] | $8.11 | $10.65 |
| 3 | `zero-full-opus-none-mu-v03-dev2` | Harness Zero `zero-full` | claude-opus-5-5 | 3 | 60 | `zf-opus` | $0.1188 [PC-X] | $7.13 | $9.45 |
| 4 | `zero-min-opus-none-mu-v03-dev2` | Harness Zero `zero-min` | claude-opus-5-5 | 3 | 60 | `zm-opus` | $0.3007 [PC-X] | $18.04 | $23.10 |
| 5 | `claude-code-opus-none-mu-v03-dev2` | Claude Code | claude-opus-5-5 | 5 | 100 | `cc-opus` | $0.1654 [MM-R] | $16.54 | $35.76 |
| 6 | `openclaw-opus-none-mu-v03-dev2` | OpenClaw | claude-opus-5-5 | 5 | 100 | `oc-opus` | $0.3327 [MM-R] | $33.27 | $52.66 |
| 7 | `hermes-opus-none-mu-v03-dev2` | Hermes Agent | claude-opus-5-5 | 5 | 100 | `he-opus` | $0.1917 [MM-R] | $19.17 | $34.26 |
| 8 | `qm-pi-opus-none-mu-v03-dev2` | QM (Pi) | claude-opus-5-5 | 5 | 100 | `qm-opus` (own invocation) | $0.1343 [MM-R] | $13.43 | $22.51 |
| 9 | `zero-lean-sol-sol-none-mu-v03-dev2` | Harness Zero `zero-lean-sol` | gpt-6.1-sol | 5 | 100 | `zl-sol` | $0.0311 ceiling [PC-X] | $3.11 | $4.20 |
| 10 | `codex-sol-none-mu-v03-dev2` | Codex | gpt-6.1-sol | 5 | 100 | `cx-sol` | $0.1178 [MM-R] | $11.78 | $17.48 |
| 11 | `openclaw-sol-none-mu-v03-dev2` | OpenClaw | gpt-6.1-sol | 5 | 100 | `oc-sol` | $0.1555 [MM-R] | $15.55 | $24.71 |
| 12 | `hermes-sol-none-mu-v03-dev2` | Hermes Agent | gpt-6.1-sol | 5 | 100 | `he-sol` | $0.1401 [MM-R] | $14.01 | $18.90 |
| | **Core, 12 cells** | | | | **1,080** | | | **$173.66** | **$271.08** |
| 13 | `zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2` | Harness Zero `zero-lean-mcp-instructions`, gbrain scoped and told | claude-opus-5-5 | 3 | 60 | `gb-zl-on` | $0.40 plan rate [PLAN] | $24.00 | $30.50 |
| 14 | `zero-lean-opus-gbrain-mu-v03-dev2` | Harness Zero `zero-lean`, gbrain scoped and told | claude-opus-5-5 | 3 | 60 | `gb-zl-off` | $0.40 plan rate [PLAN] | $24.00 | $30.50 |
| 15 | `claude-code-opus-gbrain-mu-v03-dev2` | Claude Code, gbrain scoped and told | claude-opus-5-5 | 3 | 60 | `gb-cc` | $0.40 plan rate [PLAN] | $24.00 | $32.76 |
| | **gbrain trio** | | | | **180** | | | **$72.00** | **$93.76** |
| | **Phase D, 15 cells** | | | | **1,260** | | | **$245.66** | **$364.84** |

### Where each cost per trial comes from

- **Field rows (5 to 8, 10 to 12):** matrix-mu spend divided by its 80 trials per cell [MM-R; MM-R line 36 for the 80].
  - Example: OpenClaw on Opus is $26.6127 ÷ 80 = $0.3327, matching the $0.333 at [MM-R line 31].
- **Harness Zero rows:** Phase C metered `committed_usd` per trial [PC-X].
  - `zero-full`: the mean of `zero-full-a` and `-b`, ($12.1237 + $11.6413) ÷ 200.
  - `zero-min` on Opus: $30.0706 ÷ 100.
  - **Lean and conservative have no Phase C cell of their own.** Both take the dearest Opus Phase C cell with caching on: `zero-full-no-scoped-notes`, $13.5105 ÷ 100.
  - **That makes their figure a ceiling.** Both sets drop `tool-search` and `effort-high`, and dropping each one made Phase C cheaper: $0.1054 and $0.1006, against `zero-full`'s $0.1188 [PC-X].
  - `zero-lean-sol`: no caching, so it takes the dearer Sol cell, `zero-full` Sol at $1.8674 ÷ 60. `zero-min` Sol, which also has no caching, was $0.0203.
- **gbrain rows:** the plan's planning price of $0.40 per trial [PLAN, Sizes and money].

### Why the smokes move no lease

The smokes ran one trial on `ar-01-thornbury-rate-hollis`, and that task costs more than the average task. In Phase C, each cell's lane smoke on it cost 1.26 to 2.05 times the cell's mean per trial [PC-X `spend.smoke_committed_usd` against `committed_usd` ÷ trials].

- **Lean on Opus:** smoke $0.1576 [SMK]. Phase C's `zero-full-no-scoped-notes` smoke was $0.2002 against its $0.1351 mean (1.48 times). $0.1576 ÷ 1.48 is about $0.106, under the $0.1351 ceiling.
- **Conservative on Opus:** smoke $0.1290 [SMK], already under the $0.1351 ceiling before any scaling.
- **`zero-lean-sol`:** smoke $0.0408 [SMK]. Phase C's `zero-full` Sol smoke was $0.0551 against its $0.0311 mean (1.77 times). $0.0408 ÷ 1.77 is about $0.023, under $0.0311.
- **gbrain:** smokes $0.2850 (lean with `mcp-instructions`), $0.2628 (lean) and $0.4093 (Claude Code) [SMK]. Claude Code's no-brain smoke on the same task was $0.3113 against matrix-mu's $0.1654 mean (1.88 times). $0.4093 ÷ 1.88 is about $0.22, under the $0.40 plan rate.

### Why Sol runs `zero-lean-sol` and not `zero-conservative-sol`

- **Sol runs `zero-lean-sol`** (`scoped-notes` only, `6fdc88d8...`) [CAND].
  - The plan's rule: Sol inherits Opus verdicts, except `caching` and `effort-high`, which Sol measures on its own usage [PLAN line 62].
  - Sol's own caching verdict took `caching` out of its lean set.
  - `effort-high` was cut on Opus (#292), so no Sol `effort-high` cell ran.
- **`zero-conservative-sol` is not called for.**
  - The plan's Phase D list names only "lean" on Sol [PLAN, Head-to-head].
  - Its hash is the same as Opus `zero-conservative` (`f58dba6f...`) [CAND], so a Sol cell would test no Sol-specific set.

### The gbrain trio (G5 cleared)

- **How gbrain runs.** Scoped and told, with member tokens and the tap's `source_ids` [PLAN]. gbrain is pinned at `2c469d1b` (0.60.547.0) [GB], with the 33-tool starter surface.
- **What the pin holds:**
  - **Member tokens:** one per member, each with a write source only that member reads (`gbrain/build-brain.ts --brain member`).
  - **The copied-brain source-writes fix:** a per-trial relocated-root self-transfer in `gbrain/rebind-sources.ts` [GB `copied_brain_writes`].
  - **#161:** in the image since train #171 (`bf87ec97`).
- **The on set exists now.** #300 (`9ca8a39f`) added `zero-lean-mcp-instructions` (`caching`, `scoped-notes`, `mcp-instructions`) with `candidate_sha256` `82dbd0fb6b8f583c9c2a6b95c1bb1e24d0cb43d3d389f4807df266a39ac2691d` [CAND].
- **Smoke G3 passed** [SMK; SMK-R `g3.*`]:
  - `zero-lean-mcp-instructions` on Opus, gbrain scoped and told, one trial: completed, pass, **$0.2850** metered.
  - The `ready` file's hash matched the one above.
  - **gbrain's instructions reached the system prompt:** 4,207 characters with the switch on (G3), against 36 characters with it off (G1, `zero-lean`), which has no instructions block [SMK-R `g3.session-system.txt`, `g1.session-system.txt`].
- **Pairs.** Each brain cell pairs with its no-brain cell: 13 and 14 with cell 1, and 15 with cell 5. The brain cells have 3 repetitions, so every pair uses repetitions 1 to 3 of the no-brain cell.
- **The on/off pair (13 against 14) is unconditional,** whatever the champion holds [PLAN, decision 3].

### Particle: dropped before this preregistration

- **Both Particle smokes refused at preflight with HE-PIN-003** [SMK; SMK-R `launch2.preflight.log`]. `harnesses/harness-zero/pin.json` has no `model_particle` entry, and `runner/run.ts` (`requireParticleCells`) requires one for any cell that calls Particle.
- **No pin fix.** `pin.json` is a candidate-hash input, so changing it would change every candidate's hash.
- **So G6 did not hold for Harness Zero.** The proxy route and price row exist (#165), but Harness Zero's pin declares no Particle transport.
- **What that removes:** the two Particle cells, their $2.74 of expected spend and their $4.10 of leases. This change was made to the draft before any cell, so no amendment to a committed preregistration is needed.

### R44 and the clean arms

- **No gstack anywhere.** This run compares harnesses, not stacks. Every cell is a no-gstack cell: no gstack install, no gstack preamble, plain prompt (R44). The only preamble is the gbrain trio's gbrain memory preamble.
- **No gbrain outside the trio.** Every cell except 13 to 15 carries no `gbrain`, and each brain cell keeps its no-brain arm (R44's gbrain analogue).
- **Clean-arm preflight**, per shard, before its lane smoke (CREW.md "Clean no-gstack and no-brain arms"):
  - Every trial runs in its harness container on a Ubicloud shard VM, with no Capy drive mounted.
  - Every shard runs `scripts/run-shard.sh --clean-arm-preflight` (`scripts/v04/clean-arm-audit.ts`). A shard that fails it doesn't start.
  - **Why the smokes ran without it.** On the first smoke launch, the check flagged the Claude Code, Codex, Hermes and OpenClaw images. The only hits were two perl headers, `struct_sigstack.ph` and `sigstack.ph`, whose names contain the substring "gstack" [SMK; SMK-R `launch1.preflight-clean-arm.json`]. The flag was dropped for launches 2 to 5 for that false positive alone.
  - **Fixed at this run's commit.** #299 (`2aabafbf`) matches gstack only at the start of a word, so `sigstack.ph` no longer matches. The run is pinned at this preregistration's merge commit, which contains `2aabafbf` and `9ca8a39f`.
  - **Images the script doesn't check:** the gbrain and qm-sandbox images [SMK]. The shards that use them (`gb-*` and `qm-opus`) record in their run log a search of each such image's filesystem for a path segment starting with gstack, before the first trial.
- **Clean-arm audit**, per cell, before any endpoint is read:
  - `grep -rlE 'gstack|\.capy/|capy/drive'` over each shard's full `results/trials` tree (harness state and workspaces included) and `trials.jsonl`. This is matrix-mu's pattern and scope [MM-A `clean-arm-audit.json`].
  - Every hit is listed. A cell with a trial that read any gstack `SKILL.md` or skill file is reported as contaminated.
  - No-brain cells must also show 0 gbrain events in `summarize-run.ts`.

### Field topology

- **Internal network:** Claude Code, Codex, OpenClaw and Hermes, as Harness Zero does.
- **QM needs its own invocation and its own ledger.** QM is a compose harness the internal network refuses (HE-NET-001), so it runs on the default bridge network. The smokes found that this is a runner requirement, not only a disclosure: the run's one metering proxy listens on one network's gateway, so QM's default-bridge cell can't share an invocation with internal-network cells. `run` refuses with HE-NET-001, which `plan`, dry-run and preflight don't catch [SMK, Launches 3 and 5, Deviations; SMK-R `launch3.run.stdout.log`].
- **So QM gets its own shard, VM, ledger and lease** (`qm-opus`, $22.51), launched in its own invocation.
- **Every QM comparison is labelled** "network not held fixed" [PLAN; MM-R, "What ran"].

### Harness housekeeping and the OpenClaw OpenAI branch

- **Housekeeping models.** Each harness keeps its shipped housekeeping model, as in matrix-mu: metered, labelled "harness housekeeping, shipped default", never an arm (CREW.md). In the smokes, QM made 4 `claude-haiku-5-5` calls, and OpenClaw on Opus made none [SMK, Deviations].
- **Claude Code's deviation.** Its adapter pins `ANTHROPIC_SMALL_FAST_MODEL` to the cell model. That is declared as a deviation.
- **OpenClaw's OpenAI branch no longer asks for `text-embedding-3-small`.**
  - `harnesses/openclaw/config/openclaw.openai.json` sets `memory.search.provider: "none"` (#171, `bf87ec97`).
  - matrix-mu's `oc-sol` and `oc-opus` proxy logs and usage files carry 0 embedding requests [MM-A], and so did the Sol OpenClaw smoke [SMK].
  - So the Sol OpenClaw cell carries no exclusion rule.

## Fixed now

- **Tasks.** `tasks/multiuser/v0.3/dev-draw-2/` at this preregistration's merge commit.
  - No task, preamble, grader, pin or world file changes between that commit and the report.
  - A mid-run change needs a dated amendment before the affected cell, or a new run id.
- **Harness Zero sets.** Frozen at the hashes in [CAND]. At main `9ca8a39f`, `bun harnesses/harness-zero/zero.ts explain --config <set>` prints these:
  - `zero-lean`: `56edb1a8f806b688494989cc37d11cd64d30f6ddd1764932c598040d548c6a15`
  - `zero-conservative`: `f58dba6fb1ab6ad8616420fe48e82a4f99e25c7ba5da39912bf2ba61852888ee`
  - `zero-lean-sol`: `6fdc88d8dd93bfb3c132b8f78c07a169a43dd4e054ceeb5d6b2436fd2ad67bc8`
  - `zero-lean-mcp-instructions`: `82dbd0fb6b8f583c9c2a6b95c1bb1e24d0cb43d3d389f4807df266a39ac2691d`
  - `zero-full`: `2736ecd9efb9989ddbf93a5746521723210a6e00ffa43ca4b4c3728d3e23e575`
  - `zero-min`: `f9f3a51ee80c8137ce0c5ee2b6f61c0bb9580aa41e4c1a433271f66eebb1e584`
  - Each trial's `ready` file records `candidate_sha256`. Knobs are as in Phase C [PC-P, Harness].
- **Field pins.** As in matrix-mu [MM-R, "What ran"]:
  - Claude Code 2.1.312
  - OpenClaw 2026.10.6
  - Hermes Agent v2026.9.24
  - QM `main@b6786d67`
  - Codex 0.165.0
  - `git diff --stat de7f7cdb 9ca8a39f` over `harnesses/{claude-code,codex,openclaw,hermes}` and `harnesses/qm/{adapter.sh,compose.yaml,pin.json}` is empty.
- **Drift from the smokes' commit, `0ac91940` to `9bd9467f`:**
  - `harnesses/`, `gbrain/` and `world/`: only `harnesses/harness-zero/config/candidates.json` changed, adding `zero-lean-mcp-instructions` (#300). The hashes the smokes ran match their `ready` files [SMK].
  - The runner and proxy changed in #293 (`f5fa45fc`): an opt-in `log_sections` mode for the token waterfall. No Phase D cell sets `log_sections`, so the proxy runs without `--log-sections`.
  - #299 (`2aabafbf`) changed only the clean-arm preflight and audit, and docs (see "R44 and the clean arms").
  - #302 (`9bd9467f`) changed only the audit subcommand of `scripts/v04/clean-arm-audit.ts`, which now counts only Hermes and OpenClaw per-turn traces as evidence. The preflight is unchanged. This run's `clean-arm-audit.json` receipt is written from the matrix-mu grep above, not by that subcommand.
  - Each VM's lane smoke runs at the merge commit before its counted trials.
- **Runner and commit binding.** As in Phase C [PC-P, "Runner and commit binding"]:
  - The worktree is pinned at this preregistration's squash-merge commit on main.
  - `git diff --stat BASE <merge commit>` lists only this PR's files.
  - Every `shard.json` and `shard-vm.json` names that commit, with `scratch_prereg` false.

## Sharding

**15 shards, one cell per VM, so no cell is split across machines.**

- **Where:** each shard gets its own standard-16 Ubicloud VM, through `scripts/ubicloud/fanout.sh` with `UBI_OWNER=HARN-26`, after `scripts/ubicloud/ubi-runner.sh usage`.
- **On each VM, in order:**
  1. Check out the merge commit detached.
  2. Build the images.
  3. Run the clean-arm preflight.
  4. Run the lane's one-trial smoke.
  5. Run `scripts/run-shard.sh` under the shard's lease.
- **Lane smokes.** One uncounted trial of the shard's cell on `ar-01-tansley-parcel-rate-marcus`, the set's first task (`scripts/ubicloud/vm-shard.sh`'s default), under its own ledger and the lease `scripts/ubicloud/smoke-lease.ts` derives. Smoke spend is outside the run cap and counted in the R71 tally. The smoke must end `completed` or the counted shard doesn't start.
- **After each shard:** results return to `<dest>/<shard>/results`, and the VM is destroyed on every exit.
- **Merge:** `scripts/merge-shards.ts` at the merge commit, then `summarize-run` and `compare-run`.
- **Order:**
  1. **Canary:** `zl-opus` alone. Nothing else starts until it has finished and its results are off the VM (R70).
  2. **Then the fan-out manifests,** with as many VMs at once as `usage` allows:
     - Opus Harness Zero: `zc-opus`, `zf-opus`, `zm-opus`
     - Opus field: `cc-opus`, `oc-opus`, `he-opus`
     - `qm-opus`, in its own invocation with its own ledger
     - Sol: `zl-sol`, `cx-sol`, `oc-sol`, `he-sol`
     - gbrain: `gb-zl-on`, `gb-zl-off`, `gb-cc`
- **Shard timeouts.**
  - **Harness Zero:** Phase C's formula, ceil(3 × trials × (W / 3) × 2.75 / 3600 + 1), with W = 61.1 s on Opus and 51.8 s on Sol [PC-P, "Shard timeout"]. That gives:
    - Opus, 100 trials: 6 h
    - Opus, 60 trials: 4 h
    - Sol, 100 trials: 5 h
  - **Field:** ceil(2 × matrix-mu VM life × 100 / 80 + 1) [MM-R, VM life column]:
    - `cc-opus`: 5 h
    - `oc-opus`: 8 h
    - `he-opus`: 6 h
    - `qm-opus`: 5 h
    - `cx-sol`: 4 h
    - `oc-sol`: 8 h
    - `he-sol`: 7 h
  - **gbrain:** the Harness Zero formula with each smoke's wall time [SMK]: `gb-zl-on` 4 h (W = 56.1 s), `gb-zl-off` 4 h (W = 53.6 s), `gb-cc` 5 h (W = 68.1 s).
  - **VM lifetime:** `UBI_TTL_HOURS` is each timeout plus 1 h, so every VM outlives the GBRA-138 reaper's 3 h default.
- **No single point of failure** (CREW.md, Ubicloud VMs):
  - A backup Capy machine holds copies of `~/.local/state/ubi-runner/` and each `shard-vm.json`.
  - The VM-to-shard map is also kept in the Captain drive under `handoffs/HARN-26/phase-d/map/`.
  - The backup pulls `results` and `smoke` every 20 minutes.
  - If the controller dies, the backup reattaches with `run-shard.sh --attach`.
  - SSH keys never go on a drive or into the repo.
  - After any stop, `list --mine` must show no VM left.
- **Restarts.**
  - A shard that fails before its first trial is relaunched at the same commit.
  - A shard interrupted mid-run resumes with `--resume` under the same lease. The resume log names the commit it loaded.
  - Every restart goes into the report's deviations.

## Leases and spend

**Run cap: $364.84** (`spend_cap_usd`).

- **The arithmetic.** The draft's leases were $368.94 for 17 cells. Dropping Particle removes its two $2.05 leases: $368.94 − $4.10 = **$364.84**. The Captain set the cap at $369. The leases now total less, so the cap is the smaller figure, $364.84, and nothing is padded.
- **Expected spend:** the draft's $248.40, minus Particle's $2.74 = **$245.66** (core $173.66 plus gbrain trio $72.00).
- **Ubicloud VMs and lane smokes are outside the cap.** Both are counted in the R71 tally below.

### Lease rules

- **Field cells: matrix-mu's formula** [MM-P line 117].
  - lease = max(smoke per trial, receipt per trial) × trials × margin, plus one in-flight reservation per concurrent request.
  - **Reservations:** $2.76 on Opus and $1.38 on Sol. Codex holds two.
  - **Smoke per trial, from HARN-16's smokes [FS]:** Claude Code $0.264, Hermes on Opus $0.252, Codex $0.117, OpenClaw on Sol $0.093, Hermes on Sol $0.115. QM is at most $0.158 [MM-P table].
  - **Receipt per trial:** matrix-mu's measured cost [MM-R].
  - **Margin:** 1.25, except **OpenClaw at 1.5**. Both OpenClaw cells overran their lease formula in matrix-mu ($0.333 against $0.270 on Opus, $0.156 against $0.125 on Sol) and cap-stopped on the last task [MM-R lines 24 to 32].
- **Harness Zero cells: Phase C's rule** [PC-P].
  - Cost per trial × trials × 1.25, plus one maximum per-call reservation, rounded up to the next $0.05.
  - **Reservations:** $0.50 on Opus, $0.30 on Sol.
- **gbrain cells:** plan rate × 60 × 1.25, plus the harness's reservation.
- **Leases are fixed.** They don't move between shards and change only by a dated amendment.

### OpenClaw on Opus: the smoke's cap stop and its lease

OpenClaw on Opus stays in the run, with no smoke rerun (Captain, 2026-11-06). Its smoke stopped on the smoke shard's shared $4.75 lease. In the smokes file's own words [SMK, Failures]:

> The trial made 15 forwarded Opus calls (all 200, $0.4612). At 13:13:29Z one call was refused 402 on the shard lease.

> OpenClaw's own calls each reserved $2.81 to $3.09: input plus the 128,000-token cap, larger than the $2.76 the lease plan assumed (`lease-plan.md`). So the next call's reservation passed $4.75.

**The proxy refuses a call when committed spend plus open reservations would pass the lease** [LP]. So the shard needs room for one call's reservation, at least $3.10, on top of what it has spent.

- **The lease:** $26.6127 ÷ 80 = $0.33266 a trial [MM-R], × 100 trials × 1.5 = $49.90, plus one $2.76 reservation = **$52.66**.
- **Expected spend:** 100 × $0.33266 = $33.27. That leaves $52.66 − $33.27 = **$19.39** of headroom, more than 6 times the $3.10 a call can reserve.
- **When it would stop:** with one $3.10 reservation open, the cell finishes uncapped while committed spend stays at or under $52.66 − $3.10 = **$49.56**. That is $0.4956 a trial, 1.49 times matrix-mu's mean.
- **With two Opus calls in flight at once** ($6.20 reserved), the line is $46.46, or $0.4646 a trial, 1.40 times the mean.
- **The other Opus field leases** keep at least $9.08 above expected spend (QM: $22.51 − $13.43), nearly 3 times $3.10.

### Spend so far and the R71 tally

**R71 ($2,000 per eval, all-in).** Harness Zero is one eval, booked at **$980** all-in [T26 line 52], counted from 2026-11-03 13:30 UTC. Figures are as of 2026-11-06 about 18:30 UTC [R71].

**Spent: about $459.**

- **Paid model calls: $109.54**, plus up to $0.62 still possible from HARN-22's last smoke.
  - Phase C metered: $104.46 [PC-X `cells[].spend.committed_usd`, summed].
  - Phase C lane smokes: $1.64 [PC-X `cells[].spend.smoke_committed_usd`, summed].
  - Phase D smokes before this preregistration: $3.4373, shown as $3.44 [SMK, Spend and leases].
- **VMs: $5.92**: $5.12 through Phase C [T26 line 71] plus $0.80 for the Phase D smokes ($0.7961 [SMK]).
- **HARN-26's own model use: about $343** (343.0k credits) [R71].
- $109.54 + $0.62 + $5.92 + $343 = $459.08.

**Smokes before this preregistration (uncounted)** [SMK; SMK-R]:

- 15 smokes, **12 completed**: the 2 Particle smokes refused at preflight, and OpenClaw on Opus cap-stopped.
- **$3.4373 metered**, overshoot 0 on all three ledgers.
- **VMs $0.80** at list ($0.7961 over six VMs).
- **None left running:** every `shard-vm.json` says `cleanup: done`, and `ubi-runner.sh list --mine` was empty at the end.

**At the cap: about $978, under the $980 booking and the $2,000 ceiling.**

| Line | Amount | Source |
|---|---:|---|
| Spent so far | $459.08 | above |
| Phase D run cap | $364.84 | this preregistration |
| Phase D lane smokes, 15 one-trial smokes | about $4.01 | each cell kind's measured smoke on a first-draw `ar-01` [SMK; PC-X `smoke_committed_usd` for `zero-full` and `zero-min` on Opus; LP's matrix-mu `ar-01` mean for OpenClaw on Opus, whose smoke cap-stopped] |
| VMs for the run | about $30 | [PLAN, Sizes and money] |
| Further own model use (this PR's /ship, the run, the results PR) | about $120 | [R71] |
| **Total at the cap** | **about $978** | against $980 booked and $2,000 |

**At expected spend: about $859.** The same lines with the $245.66 expected in place of the cap: $459.08 + $245.66 + $4.01 + $30 + $120 = $858.75.

- **Garry's $500 model cap.**
  - The paid lines of Phases C and D at the cap come to $478.39, plus the $0.62 still possible: $106.10 + $3.44 + $364.84 + $4.01.
- **The tally is checked before each fan-out** and recorded in `reports/HARN-26.md`.

### Spend accounting

- **Model spend:** each shard's, read proxy-side from its own ledger and summed in the report.
- **VMs:** each VM's list cost from `shard-vm.json`, reported beside model spend.

### Stop rule

- **A cap stop ends that cell as incomplete.**
  - Each shard stops at its own lease.
  - Shards run without `--stop-on-cap`, so later trials are recorded as `model_error` with `cap_stop` and counted as not run.
  - They are never retried, resumed or backfilled (R71).
- **Partial cells are reported first.** A partial cell is published as partial, at the top of the report, and every reading that depends on it says so.
- **Canary stop.** If the canary `zl-opus` ends with more than 10% `harness_error` or `infra_error`, nothing else starts and the Captain is told.
- **Saturation flag.** If the canary's pass rate is above 90%, the report flags saturation for "Why null?". Matrix-mu's null rested on saturation: 11 of 20 tasks passed every repetition in every cell [MM-R, opening summary].

## Smokes before this preregistration (uncounted)

One trial each, at origin/main `0ac91940`, on Ubicloud standard-16 VMs, `UBI_OWNER=HARN-26`, `--max-output-tokens 128000` [SMK]. The task was `ar-01-thornbury-rate-hollis` from the first draw, except QM, which ran `ar-03-tansley-parcel-rate-tobias` as matrix-mu smoked it. G3 ran on a fresh VM at `89c74654bb30`, #300's branch head. Cost is each trial's metered USD [SMK].

| Smoke | Harness | Model | Set | Termination | Grade | USD |
|---|---|---|---|---|---|---:|
| 1 | Codex | gpt-6.1-sol | default | completed | fail | 0.1583 |
| 2 | Claude Code | claude-opus-5-5 | default | completed | pass | 0.3113 |
| 3 | Hermes Agent | claude-opus-5-5 | default | completed | pass | 0.3470 |
| 4 | OpenClaw | claude-opus-5-5 | default | model_error, cap_stop | fail | 0.4612 |
| 5 | OpenClaw | gpt-6.1-sol | default | completed | fail | 0.1547 |
| 6 | Hermes Agent | gpt-6.1-sol | default | completed | fail | 0.1839 |
| 7 | QM (Pi) | claude-opus-5-5 | pi | completed | fail | 0.5364 |
| 8 | Harness Zero | claude-opus-5-5 | `zero-lean` | completed | pass | 0.1576 |
| 9 | Harness Zero | claude-opus-5-5 | `zero-conservative` | completed | pass | 0.1290 |
| 10 | Harness Zero | gpt-6.1-sol | `zero-lean-sol` | completed | fail | 0.0408 |
| 11 | Harness Zero | particle-1 | `zero-lean` | not run: preflight HE-PIN-003 | - | 0 |
| 12 | Harness Zero | particle-1 | `zero-min` | not run: preflight HE-PIN-003 | - | 0 |
| G1 | Harness Zero, gbrain scoped and told | claude-opus-5-5 | `zero-lean` | completed | fail | 0.2628 |
| G2 | Claude Code, gbrain scoped and told | claude-opus-5-5 | default | completed | fail | 0.4093 |
| G3 | Harness Zero, gbrain scoped and told | claude-opus-5-5 | `zero-lean-mcp-instructions` | completed | pass | 0.2850 |

- These are single trials on one task. They check readiness and wiring, not pass rates.
- Every forwarded call returned 200, apart from OpenClaw's one refused call [SMK, Table].

## Endpoints

- **Unit:** the task cluster.
- **Intervals:** task-clustered bootstrap 95% (10,000 draws, seed 7), with n given as tasks and trials.
- **Pairing:** by task and repetition, with `clusteredPairedDelta` (`runner/stats/paired.ts`), using the statistics kit as of the merge commit.
- **Exclusions:** a pair where either side ended `model_error`, `infra_error` or `exam_fault` is excluded on both sides and listed.
- **Every verdict carries "dev".** The labels below are written with it, and the report adds "same item pool" to each result sentence.

### Primary readings and families [PLAN, Primary readings]

1. **Cost family (7 comparisons).**
   - Opus: lean minus Claude Code, OpenClaw, Hermes and QM.
   - Sol: `zero-lean-sol` minus Codex, OpenClaw and Hermes.
   - Measured in USD per trial and per success, paired at 5 repetitions, with task-clustered 95% intervals.
   - **"Lean cheaper (dev)"** when the interval is entirely below zero. **"Lean dearer (dev)"** when it is entirely above. **"Can't tell (dev)"** otherwise.
2. **Pass-rate non-inferiority family (the same 7).**
   - **"No worse than (dev)"** when the lower bound of the paired interval is above -10 points.
   - **"Worse (dev)"** when the upper bound is below -10.
   - **"Can't tell (dev)"** otherwise.
   - These are decision rules, so no multiplicity correction applies.
3. **Secondary superiority (the same 7).** The host-pilot decision sentence: Holm p below 0.05 over the 7, and an interval that excludes zero, written with "(dev)".

**Design sensitivity** (published here, as the plan requires):

- **The Phase C figure.** At 20 tasks × 3 repetitions, the expected paired pass-rate half-width is **a median of 7.9 points and a 90th percentile of 9.2 points** [PC-R; PC-X `design_sensitivity`: 0.07915 and 0.0917, `p90_at_least_10_points` false].
- **So the -10-point margin is reachable** for an equal pair at 3 repetitions.
- **It is a lower bound.** Two copies of one harness vary less than two different harnesses. matrix-mu's field pairs at 4 repetitions had minimum detectable differences of 7.7 to 14.2 points [MM-R line 189].
- **5 repetitions narrow both** for the 7 pairs.

### Secondary readings

- **gbrain family (3 + 1).**
  - Each brain cell minus its no-brain cell (13 − 1, 14 − 1, 15 − 5), on pass rate and cost, over repetitions 1 to 3.
  - Plus `mcp-instructions` on minus off (13 − 14).
  - Holm over the 4, with intervals.
  - Exposure is shown from captured requests: did gbrain's MCP instructions reach the model in 13, and not in 14?
- **Baselines (descriptive).** Lean against conservative, `zero-full` and `zero-min` on Opus, over repetitions 1 to 3.
- **Caching.** Cache hit rate by turn gap for the lean cells [PLAN line 61].
- **Item overlap.** Results on the 5 repeated items and on the other 15, side by side, descriptive only [DRAW].

### Descriptive, per cell

- Pass rate per family and per task.
- Terminations.
- Retries and steps per turn (Harness Zero).
- Refused metadata probes (Hermes).
- Housekeeping calls.
- Approval stops, consent violations and hidden-fact leaks, with trial ids.
- Wall time per trial, labelled with its VM.
- Every model named in a forwarded request.

### "Why null?" (CREW.md)

- **When it applies:** every null or negative reading on a harness layer, gbrain or a Harness Zero switch gets one cycle in the results PR.
- **The cycle:**
  1. **Exposure:** captured request or tool trace.
  2. **Task fit.**
  3. **Power and saturation:** MDD, ceiling and n.
  4. **Model:** frontier only.
- **The verdict line:** KEEP, FIX-METHOD (naming the fix) or CUT-CANDIDATE (naming the part).
- **Saturation (R61):** a null that rests on saturation is FIX-METHOD with one named ceiling-raise.
- **The lines go to HARN-1.** No null is softened.

## Cut line and drop order

- **Minimum:** the 11 core cells (all but `zero-conservative`). Conservative is a descriptive baseline, not a cost-pair cell, so dropping it leaves every primary comparison intact.
- **Drop order** if the cap tightens before launch, each step by dated amendment:
  1. the gbrain trio
  2. `zero-conservative`
- **Failures stay contained.** Each cell has its own shard and lease, so one cell's failure leaves the others whole.

## Receipts

- **Where:** under `docs/benchmarks/2026-11-06-harness-zero-h2h/results/`, as in Phase C [PC-P, Receipts].
- **Run-level files:** the merged `trials.jsonl`, `manifest.json` and `shards.json`.
- **Per shard, under its own name:** ledger, proxy log, proxy usage, preflight and clean-arm logs, `shard.json` and `shard-vm.json`.
- **Analysis files:** `summary.json`, `comparisons.json` and `clean-arm-audit.json`.
- **Separate PRs.** Results come in a later PR (PR 5). This preregistration merges to main first (CREW.md).
- **Merge hold.** Ask HARN-7 for a merge hold while this PR gates.

## Amendments

Each amendment is dated and committed before any cell it affects. It ships in its own PR, merged to main before those cells.

## Disclosures

This run features gstack (as the absent arm in every cell), gbrain, QM, Hermes, OpenAI's GPT-6.1 Sol and OpenClaw, so the report and any finding file end with these lines, word for word from the disclosures list (CREW.md, R55). No Particle cell runs, so there is no Particle line. No X post carries them.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

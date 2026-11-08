# H10: where must an instruction live to be obeyed? Four harnesses, two frontier models, eight routes

Status: written 2026-11-06 and 2026-11-07 (America/Los_Angeles), before any counted trial of this run. Run id `h10-instruction-placement-2026-11`. Cells are in [prereg.json](prereg.json), the shard map in [shards.json](shards.json), the goldens in [GOLDENS.md](GOLDENS.md) and the power figures in [mdd.md](mdd.md).

**In one line: gbrain's 289-byte "check gbrain first" rule goes to the agent through each place a harness lets text in, on Claude Code (Opus 5.5) and on Codex, Hermes and OpenClaw (gpt-6.1-sol), and the run counts how often the agent calls gbrain before it answers a member's turn.**

- **30 cells, 300 trials, 900 member turns.** 10 public v0.3 dev tasks, 1 repetition per cell. Wave 1 only: both conditional blocks (F, G) dropped before this preregistration (below).
- **Models:** `anthropic:claude-opus-5-5` on Claude Code; `openai:gpt-6.1-sol` on Codex, Hermes and OpenClaw. One model per harness, so a harness difference is a harness-and-model difference.
- **Five Ubicloud shards, whole cells, no cell split.** Leases total at most $150, smokes included (Leases, below).
- **Dev only.** Every task is public. No held-out set is read and no claim is made beyond these tasks.
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-07-h10-instruction-placement/prereg.json` prints 30 cells, 300 trials, `ORDER: interleave-task seed=20261107`, a planning ceiling of $264 and the $150 cap (HE-BUDGET-003 warns that the ceiling passes the cap; the ceiling prices every turn at 80,000 input and 6,000 output tokens with no caching, and caps nothing).

## Approval

- Plan v3 of HARN-18 (H10): Garry's D1 approval ("Donit") with A1 to E1, the coordinating agent's gate 2 (R54: Opus 5.5 plus gpt-6.1-sol, no Sonnet) and gate 4 (v3: 30 fixed cells, 300 trials). The plan's "Method" through "Results PR" sections bind this run; this file follows them as written.
- The lease figures follow the coordinating agent's decisions A1 and E1, computed from the merged reservation code (Leases, below).
- HARN-46 took the lane from HARN-18 and writes this preregistration.

## Question

On the 10 v0.3 public dev tasks chosen for in-session repetition, for OpenClaw 2026.10.6, Hermes Agent v2026.9.24 (serve), Claude Code 2.1.312 and Codex 0.165.0, each on its one frontier model (Claude Code on Opus 5.5; the others on gpt-6.1-sol): in what share of member turns does the agent call gbrain before its first reply of the turn, per route? How does each route compare with the no-rule control in the same harness, model and driver? Pooled: does a one-time hook match a per-turn hook on repeat turns inside a session, and does one copy in the user turn match one copy in the system prompt?

## Tasks

| Task | Member turns | Repeat turns in a session |
|---|---:|---:|
| cn-01-tamsin-cold-chain-site | 2 | 1 |
| cn-02-tansleigh-packaging-deadline | 3 | 1 |
| cn-03-marrow-agrisupply-site | 4 | 0 |
| cn-04-quarrendon-site | 3 | 1 |
| sc-01-central-random-two-asks | 2 | 1 |
| sc-02-north-team-two-asks | 3 | 1 |
| cr-01-marrow-agrisupply-site-retraction | 3 | 2 |
| cr-02-quarrendon-seat-count-retraction | 3 | 1 |
| cr-03-brackenwater-renewal-date-retraction | 4 | 1 |
| cr-04-marrow-agrisupply-seat-count | 3 | 1 |
| **All** | **30** | **10, in 9 tasks** |

- The counts are `scripts/paired-mdd.ts --h10`'s, from each task's own turn order ([mdd.md](mdd.md)). cn-03's four turns are four session firsts (its last turn opens a new thread), so it adds no repeat turn.
- The scorer takes each turn's session and session turn from the task's turn order (`structuralSessions` in scripts/instruction-followed-h10.ts), never from adapter data, so the repeat-turn subset is the same in every arm. The adapters' `session_turn` and `emitted` are printed cross-checks; a mismatch is reported, never used to drop a turn.

## Cells

Every cell: `slice: multiuser`, `split: dev`, `task_set: v0.3`, the 10 tasks above, 1 repetition, `gbrain: {surface: starter}` (the sidecar at gbrain/pin.json's commit), `network: internal`, ceiling 80,000 input and 6,000 output tokens per turn (planning only). Cell ids are `<harness>-<opus|sol>-gbrain-<config with + as ->-mu-v03-dev`.

| Block, shard | Harness, driver | Model | Configs (cells) |
|---|---|---|---|
| A, `cc-cli` | Claude Code 2.1.312, cli (`claude -p`) | Opus 5.5 | route-tool, route-hook, route-once, route-system, route-startup (5) |
| B, `cc-sdk` | Claude Code 2.1.312, Agent SDK 0.3.312 | Opus 5.5 | sdk-preset+route-tool, sdk-preset+route-told, sdk-preset+route-skill, sdk-default+route-told, sdk-default+route-skill (5) |
| C, `cx` | Codex 0.165.0 | gpt-6.1-sol | route-tool, route-hook, route-once, route-system, route-startup, route-told, route-skill, route-placebo (8) |
| D, `he` | Hermes v2026.9.24 (serve) | gpt-6.1-sol | route-tool, route-hook, route-once, route-system, route-startup, route-skill, route-placebo (7) |
| E, `oc` | OpenClaw 2026.10.6 | gpt-6.1-sol | route-tool, route-hook, route-once, route-startup, route-skill (5) |

- **Config grammar:** `[<driver>+]<route>`, parsed by `parseRouteConfig` (runner/contracts.ts). The driver prefix is Claude Code only; absent means `cli`. Routes are as harnesses/routes/README.md, "Routes on four harnesses".
- **The rule:** harnesses/routes/instruction.md, 289 bytes, sha256 `4a81cb9b35d6ad6f205723618f15e6c3dc66586cbb41f0ebc72141b74669230f`, in every rule route. The placebo: harnesses/routes/placebo.md, 289 bytes, sha256 `b66810fe132a2a9988100dcd01a9c8a03665265ff01555f17cd9b1955047dd34`.
- **Block C has 8 cells** because Codex's route-system passed the keyless `--strict-config` check ([GOLDENS.md](GOLDENS.md), section 2).
- **Not run at frontier, printed as "not run" in the report:** told on OpenClaw and Hermes; placebo on OpenClaw and Claude Code; system on OpenClaw (no such setting, HE-ADAPTER-007).
- **No Sonnet, no Haiku, no cross-tier comparison** (R54). Claude Code's adapter keeps its `ANTHROPIC_SMALL_FAST_MODEL` pin to the cell model, and OpenClaw on gpt-6.1-sol keeps its `utilityModel` pin to the cell model (both declared deviations carried from earlier runs). No harness housekeeping request appeared in any Hermes or OpenClaw golden; the Claude Code and Codex goldens keep only requests that carry tools, so they do not show housekeeping either way.

### The route-told preamble

`route-told` cells name `preamble: tasks/multiuser/_shared/preamble.route-told.md` (new here). It is `tasks/multiuser/_shared/preamble.md` with one added line after rule 6, `7. Use the brain-first skill.`, and nothing else (`diff` shows the one line).

| File | Bytes | sha256 |
|---|---:|---|
| tasks/multiuser/_shared/preamble.md (every other cell) | 3,391 | `d22252a1b599b6ce8cf0d908cd138eb45ac0e67e2bed9948aac63eb7979ff902` |
| tasks/multiuser/_shared/preamble.route-told.md (told cells) | 3,421 | `b1a3b575254d639f02fbb63229392231d86282a659c902aef98d6084e98c6a53` |

Neither file changes between this commit and the report.

### Claude Code system prompt, per cell

| Cells | Driver | System prompt the model gets |
|---|---|---|
| Block A (5) | cli, `claude -p --output-format stream-json` | Claude Code's built-in prompt. route-system appends with `--append-system-prompt` on every turn. |
| sdk-preset+route-tool, sdk-preset+route-told, sdk-preset+route-skill | Agent SDK driving the same pinned CLI | `systemPrompt: {type: "preset", preset: "claude_code"}` |
| sdk-default+route-told, sdk-default+route-skill | Agent SDK, same driver | systemPrompt unset (the stub) |

- **Keyless capture before this preregistration** ([GOLDENS.md](GOLDENS.md), section 3): the cli capture holds the 6,210-character guidance block with the line "When the user types `/<skill-name>`, invoke it via Skill."; the preset capture is byte-identical in its prompt blocks, and its billing header differs in the entrypoint (`cc_entrypoint=sdk-cli` against `cc_entrypoint=sdk-ts`; the committed receipts give each header's length and sha256, not its full text); the sdk-default capture is the stub. The cli capture is not the stub, so the run is not stopped.
- **The preset and cli captures match,** so the SDK-preset told and skill numbers are read as Claude Code's told and untold skill routes, and still labelled "SDK preset" beside every number.
- **No sdk-default tool control (assumption, stated before data).** The stub-effect contrast assumes the stub does not change baseline gbrain use. The report shows sdk-preset+route-tool as the shared floor of both SDK systems.

### Hermes: Tirith is on in block D (behavior change)

- Hermes's image pins Tirith 0.4.2 (installed at build, sha256-checked, the trial-time download off; `tirith 0.4.2 offline` as the trial uid in the clean-arm preflight, recorded in GOLDENS.md as prose, not a committed log). On the internal network the earlier counted Hermes image had no Tirith: the download failed and Hermes fell back to pattern matching (harnesses/hermes/README.md). So **block D's Hermes differs from the dev run's and from every earlier Hermes receipt in that one way:** the scanner is on for the agent's own task commands.
- No H10 measure depends on the scanner: compliance is a gbrain MCP call, which Hermes routes through its MCP client, not its terminal tool. The goldens show a gbrain call completing with no approval card on every Hermes route.
- harnesses/hermes/adapter.sh writes no `approvals:` block, so Hermes's shipped defaults apply to task commands in every Hermes cell alike. The adapter records the approval mode, the Tirith version and digest and every approval card or Tirith decision per turn; a blocked gbrain call is an infrastructure absence, never a non-compliant turn. Expected: 0.

## Endpoints

- **Compliance (primary):** member turns with a gbrain call before the turn's first reply, per cell, with task-clustered bootstrap 95% intervals (10,000 draws, seed 7), from `scripts/instruction-followed-h10.ts --results <merged results> --prereg prereg.json`.
- **Discovery:** rule routes, the rule reached the request (proxy copy count above 0, by location); skill routes, the skill appears in the request's skill listing.
- **Load:** skill routes, the agent read SKILL.md or invoked the skill before the reply; other routes, load equals delivery.
- **Benefit (descriptive):** pass, and cost per trial, per followed turn and per passed trial from the proxy at the dated price table in runner/pricing/model-pricing.ts. A ratio with a zero denominator is undefined.
- **Copies:** copies of the rule per request by location (system, user text, tool result, history) and per trial, from the proxy's `route_copies`.

### Family A (primary, 2 tests, Holm over the two)

The pair sets are fixed here, from the goldens, before any spend. `prereg.json` `analysis.family_a` holds them; each pair is `a` (the comparator) and `b` (route-once), and the difference is b minus a.

| Contrast | Turns | Pairs | Task clusters | Cluster floor |
|---|---|---|---:|---:|
| Repetition: route-once minus route-hook | repeat turns (structural session turn 2 or more) | Claude Code cli (Opus), Codex, Hermes, OpenClaw (gpt-6.1-sol) | 9 | **9** |
| Placement: route-once minus route-system | all member turns | Claude Code cli (Opus), Hermes, Codex (gpt-6.1-sol) | 10 | 10 |

- **Why every harness is in the repetition pair:** each harness's cr-01 golden shows the one-time copy carried in the session's history on the repeat turns ([GOLDENS.md](GOLDENS.md), section 1). None dropped.
- **Why Codex is in the placement pair:** `developer_instructions` loads under `--strict-config` on Codex 0.165.0 (section 2).
- **The 9-cluster floor** is a declared parameter the scorer reads (`cluster_floor: 9` for repetition), fixed here. The scorer's default floor is 10 clusters (`DEFAULT_CLUSTER_FLOOR`); repetition has only 9 informative tasks, so without this parameter it would always read descriptive.
- Test: per task, each pair's mean difference, then the mean over the pairs present, then the exact two-sided sign-flip test over tasks, plus a task bootstrap interval. Each pair's own estimate is printed beside the pooled one, and the Claude Code pair is labelled as the only Opus read. A pair with a cell stopped at its lease drops from the pooled test, declared.

### Family B (per harness, model and driver; Holm within each family)

Each route minus its own control (`route-tool`, or `sdk-preset+route-tool` for the SDK cells), paired on task and turn, exact sign-flip test over 10 tasks. The stub effect (sdk-default minus sdk-preset, on told and on skill) is its own 2-test family.

| Family | Contrasts | First Holm step |
|---|---:|---:|
| Claude Code, cli, Opus 5.5 | 4 | 0.0125 |
| Claude Code, SDK preset, Opus 5.5 | 2 | 0.025 |
| Claude Code, stub effect (sdk-default minus sdk-preset) | 2 | 0.025 |
| Codex, gpt-6.1-sol (route-system in) | 7 | 0.0071 |
| Hermes, gpt-6.1-sol | 6 | 0.0083 |
| OpenClaw, gpt-6.1-sol | 4 | 0.0125 |

- **Headroom guard:** a family whose control follows more than 25% of turns (`analysis.headroom_max: 0.25`) has no room; its contrasts are descriptive, and the report says so first.
- Block A and block B contrasts stay within their own driver (Limits, below).

## Power (minimum detectable differences)

From `scripts/paired-mdd.ts --h10` on the 10 tasks' real session structure, 1,000 simulations per effect, seed 7, power 0.8. Full commands and output: [mdd.md](mdd.md).

- **Family A assumptions** (no frontier data exists for a one-time hook): route-hook follows 95% of repeat turns and route-system 90% of turns; route-once is lower by the effect; turns are independent given the arm.
- **Family B rates from the dev receipts:** the control followed 0 of 160 turns (Hermes) and 1 of 160 (OpenClaw) in run anatomy-instruction-route-2026-11; the route is higher by the effect.

| Contrast | Clusters | Pairs | Alpha | Smallest possible p | MDD |
|---|---:|---:|---:|---:|---:|
| A: repetition | 9 | 4 | 0.025 | 0.0039 | **39 points** |
| A: placement | 10 | 3 | 0.025 | 0.0020 | **25 points** |
| B: 2-test families (SDK preset, stub effect) | 10 | 1 | 0.025 | 0.0020 | 39 to 40 points |
| B: 4-test families (Claude Code cli, OpenClaw) | 10 | 1 | 0.0125 | 0.0020 | 48 points |
| B: Hermes, 6 tests | 10 | 1 | 0.0083 | 0.0020 | 48 points |
| B: Codex, 7 tests | 10 | 1 | 0.0071 | 0.0020 | 58 to 59 points |

**Claim margin: 20 points for both family A contrasts (plan rule).** If a family A contrast's MDD is above 20 points, it is reported descriptively.

- **Both are above 20 points: repetition at 39, placement at 25.** So, by the rule fixed in the plan, **both family A contrasts are reported descriptively**: point estimate, interval and sign-flip p printed, no claim either way. Family A's Holm adjustment is still computed and printed.
- No cells are added and no repetition is added to buy power; the cap is spent as planned.
- Family B can only detect large effects (39 to 59 points). The dev run's per-turn hook moved 99 and 98 points on Haiku, so a hook-sized effect is in range; a skill-sized one (0 to 3 points on Haiku) is not, and a null there is read with that MDD beside it.

## Wave 2: both conditional blocks drop

Plan v3 allowed two conditional blocks, each only if its precondition held before this pull request opened. Neither holds. **Both drop, declared here, and neither is ever added by amendment.**

- **Block F (particle-1 on OpenClaw and Hermes):** its precondition is HARN-16 PR B (`model_particle` pins and the Chat Completions transport) merged on main. It is not: `origin/harn16/particle-harness-configs` (head `591035bea7`) is not an ancestor of `origin/main`, and its pull request (#170) is closed unmerged. A Particle cell would be refused HE-PIN-003.
- **Block G (the GEVA-2 slot, Claude Code SDK preset):** its precondition is the slot bundle landed before this pull request opened. It has not: `harnesses/routes/slots/` holds only README.md, and `harnesses/claude-code/routes/slots/` does not exist, so there is no byte copy to commit.
- So there are no `waves/` directories and no wave-2 prereg.json files. **`scripts/ubicloud/wave2-admit.ts` is not run.** Whatever wave 1 leaves under $150 stays unspent; no cells are added.
- No particle-1 number will appear, so the results carry no Particle disclosure.

## Run, sharding and order

- **Order:** `prereg.json` `order: {kind: interleave-task, seed: 20261107}`, baked into manifest.json at plan time. Within each shard the trials run repetition by repetition, tasks in a seeded order, each task's cells in a seeded order. `--resume` keeps the order and a `--cells` filter keeps the relative order.
- **Five Ubicloud shards** through `scripts/ubicloud/fanout.sh`, one standard-16 VM each, the repository pinned at this preregistration's merge commit, whole cells (no cell split), trials sequential within a shard. The cell lists are [shards.json](shards.json).
- **One fan-out manifest per shard**, because `--smoke-lease-usd` is a manifest-wide option and each shard has its own smoke lease. Each manifest: `size: standard-16`, one shard with `lease_usd` its counted lease, and options `--gbrain-image harness-eval/gbrain:dev --smoke-task sy-01-quarrendon-ticket-numbers --smoke-lease-usd <its smoke lease> --pre-smoke scripts/matrix/clean-arm-preflight.sh -- --max-output-tokens 128000`.
- **Owner and TTL:** every Ubicloud call sets `UBI_OWNER` to HARN-46. Run-shard's `--timeout-hours` stays at its default 12 and `UBI_TTL_HOURS=13`, above the expected wall time (the largest shard, `cx`, is 80 trials, about 3.5 to 4 hours, plus about 30 minutes of bootstrap, image builds and pre-smoke).
- **Canary first (R70):** the `cx` shard launches alone: it is the largest shard (so starting it first also shortens the total wall time), gpt-6.1-sol has run as a harness model in only one counted run on main (matrix-mu-2026-11, #279), and Codex can hold two requests at once. The other four launch only after the canary has finished at least one scored trial and copied its results off the VM.
- **One-VM pre-smoke first (R70):** before any counted fan-out, every pre-launch script (bootstrap, `scripts/matrix/clean-arm-preflight.sh`) runs once on a single fresh VM through the same SSH path the fan-out uses, at the merge commit. A pinned-file change on main after this commit reruns it.
- **Smoke:** one uncounted trial per harness cell on `sy-01-quarrendon-ticket-numbers` (one member turn, outside the counted task set), under the shard's smoke lease and its own ledger, before the counted run. Every smoke trial must end `completed` or the shard stops (exit 4).
- **Smoke-cost gate:** before a shard's counted trials, any smoke whose cost per member turn exceeds its cell's per-turn ceiling stops that shard; the cell is re-costed and comes back to the coordinating agent before spend continues. Per-turn ceilings are the cell's base per-turn price (Opus $0.135 a rule cell turn and $0.070 a no-rule one; gpt-6.1-sol $0.0675 and $0.035) times its shard's early-stop margin, the "margin after k x Rmax" column of [leases.txt](leases.txt) (Captain HARN-1's third-round grant, 2026-11-07). So a shard whose smokes all pass costs, at smoke prices, no more than its counted lease covers after the earliest stop. `cc-cli` x 1.7415: rule cell $0.2351025, no-rule cell $0.121905. `cc-sdk` x 1.6964: rule $0.229014, no-rule $0.118748. `cx` x 1.8373: rule $0.12401775, no-rule $0.0643055. `he` x 1.9442: rule $0.1312335, no-rule $0.068047. `oc` x 1.6806: rule $0.1134405, no-rule $0.058821. No-rule cells are route-tool, route-skill, route-placebo, sdk-preset+route-tool, sdk-preset+route-skill and sdk-default+route-skill. The coordinator reads each smoke ledger as the smoke ends and interrupts the shard (fanout's interrupt copies results back and destroys the VM) if the gate fails; counted trials that started before the stop are kept and labelled.
- **Cap stop (HE-BUDGET-001):** the proxy refuses a call whose reservation does not fit what is left of the shard's lease, and that trial is recorded as `model_error` with `cap_stop: true`. `run-shard.sh` does not pass `--stop-on-cap`, so the runner logs HE-BUDGET-001 and goes on to the next trial, and a later trial whose first reservation is smaller can still run. (HE-BUDGET-003 is the plan-time warning, not this stop.) Adding `--stop-on-cap` to `run-shard.sh` is on GST-1715's follow-up list, not in this run.
- **Cap-stop filter (preregistered):** a trial's position is its index in the `trials` array of its shard's `manifest.json` (order `interleave-task`, seed 20261107, so a shard's cells interleave task by task; the shard's `--cells` filter keeps that relative order). A shard's first cap_stop is the lowest such index among its trials whose trial record carries `cap_stop: true`. Every trial of that shard at or after that index is excluded from the per-cell estimates and from family B, whatever its outcome. A harness whose family A cells' shard cap-stopped leaves family A, declared (only `cc-cli` holds Claude Code's family A cells, so a `cc-sdk` cap stop does not remove Claude Code from family A), even where the scorer (`scripts/instruction-followed-h10.ts`, which drops only pairs with a `cap_stop` record) would keep the pair. The analysis runs on a filtered copy; `trials.jsonl` is never edited. The filter is this one command, run once over every shard's results directory (`<dest>/<shard>/results`, each holding that shard's `manifest.json` and `trials.jsonl`) before scoring. It writes `trials.filtered.jsonl` beside each `trials.jsonl` and prints one line per shard, 0 excluded included, and the scorer then reads a copy of the merged results whose `trials.jsonl` holds only the records in those files:

  ```sh
  bun -e 'const fs=require("fs");for(const d of Bun.argv.slice(1)){const m=JSON.parse(fs.readFileSync(d+"/manifest.json","utf8"));const idx=new Map(m.trials.map((t,i)=>[t.id,i]));const recs=fs.readFileSync(d+"/trials.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l));for(const r of recs)if(!idx.has(r.trial_id))throw new Error(d+": trial "+r.trial_id+" is not in manifest.json");const stops=recs.filter(r=>r.cap_stop===true).map(r=>idx.get(r.trial_id));const first=stops.length?Math.min(...stops):Infinity;const keep=recs.filter(r=>idx.get(r.trial_id)<first);fs.writeFileSync(d+"/trials.filtered.jsonl",keep.map(r=>JSON.stringify(r)+"\n").join(""));console.log(d+": first_cap_stop_index="+(first===Infinity?"none":first)+" records="+recs.length+" excluded="+(recs.length-keep.length)+" kept="+keep.length)}' <dest>/cc-cli/results <dest>/cc-sdk/results <dest>/cx/results <dest>/he/results <dest>/oc/results
  ```

  The results PR reports the number of excluded trials per shard, including every shard with 0. **A cap stop is final and is never retried** (R71). No trial is retried to change a verdict.
- **Merge:** the five shards' results copy back to `<dest>/<shard>/results` and `scripts/merge-shards.ts` merges them, with each shard's ledgers (counted and smoke) and proxy logs kept under its own name. Every VM is down at lane end (`list --mine`). VM list price (about $10) is reported beside the cap, outside it.

## Leases

**Cap: $150 for wave 1, smokes included.** Plan v3 sized each smoke lease at its block's smoke ceiling, rounded up ($4.82 in all; the ceilings themselves sum to $4.80). Each of those is below one proxy call reservation R, so every smoke's first call would have been refused.

Captain HARN-1, 2026-11-07: wave-1 smoke leases = smoke ceiling + one proxy call reservation R (total $14.46); counted leases scaled pro rata from $143.90 to $135.54 so all leases total ≤ $150; cells, trials and cap unchanged.

Captain HARN-1, 2026-11-07: wave-1 smoke leases = smoke ceiling + one proxy call reservation R (total $14.86); counted leases scaled pro rata from $143.90 to $135.14 so all leases total ≤ $150; cells, trials and cap unchanged.

Figures updated from $14.46 and $135.54 by Captain HARN-1, 2026-11-07, after #310's review found that R must include the 1-hour cache-write premium (Opus R $2.96).

Captain HARN-1, 2026-11-07: A1 lease figures follow #310's computed R (Opus $2.96, gpt-6.1-sol $1.41): smoke leases $14.95, counted leases $135.05, all leases ≤ $150.

Captain HARN-1, 2026-11-07: the cx smoke lease is its ceiling plus 2R, one reservation per concurrent Codex request (as matrix-mu measured); the extra comes out of the counted leases pro rata; all leases ≤ $150; final figures from the merged code's computation.

Captain HARN-1, 2026-11-07: G1 F1. G1: filter rule preregistered with its exact position definition; trials.jsonl never edited; results PR reports trials excluded after a cap_stop per shard even when 0; --stop-on-cap in run-shard.sh goes to GST-1715's follow-up list, not this PR. F1: every lease row from compute-leases.ts on the merged code; prereg names the matrix-mu proxy logs behind each k and each maximum reservation and states the 1.86x/2.04x worst-case margins as a limit; H10 stays at or under its 974 USD booking.

**Each later line supersedes the figures before it; the last line binds.** The leases below are [compute-leases.ts](compute-leases.ts)'s output at this commit, committed as [leases.txt](leases.txt): **smoke leases $19.23, counted leases $130.75, all leases $149.98.** They differ from the $14.95 and $135.05 line for three reasons:

- Each smoke lease holds k x Rmax instead of one R (the F1 line). Rmax is the largest reservation matrix-mu-2026-11's proxy made for the same harness and model, which is above R because real request bodies are larger than R assumes. k is the most reservations matrix-mu held at the same time for that harness and model: 2 for `cx` (as the E1 line says) and `oc`, 1 for both Claude Code shards and `he`.
- The $14.95 rounds each smoke lease up to the cent (with one R for `cx`: $4.24 + $3.97 + $2.43 + $2.27 + $2.04). The script rounds every lease down to the cent, so the total can only fall under the cap.
- The F1 line's 1.86x and 2.04x margins assumed k = 4 for `oc`, from the review's count of 4 overlapping reservations in `oc-sol`'s ledger. Counted as reservations open at the same instant (arithmetic step 3), `oc-sol` never held more than 2, so `oc` holds 2 x Rmax and the computed worst-case margins are 1.9082x (Opus 5.5) and 2.0898x (gpt-6.1-sol), stated below as the limit.

| Shard | Cells | Trials | matrix-mu receipts | Rmax | k | Plan smoke ceiling | Smoke lease | Plan counted lease | Counted lease |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| `cc-cli` | block A | 50 | `cc-opus` | $3.0515 | 1 | $1.28 | $4.33 | $38.43 | $34.92 |
| `cc-sdk` | block B | 50 | `cc-opus` | $3.0515 | 1 | $1.01 | $4.06 | $30.24 | $27.48 |
| `cx` | block C | 80 | `cx-sol` | $1.6798 | 2 | $1.02 | $4.37 | $30.54 | $27.75 |
| `he` | block D | 70 | `he-sol` | $1.6373 | 1 | $0.86 | $2.49 | $25.88 | $23.51 |
| `oc` | block E | 50 | `oc-sol` | $1.6757 | 2 | $0.63 | $3.98 | $18.81 | $17.09 |
| **Sum** | 30 cells | 300 | | | | $4.80 | **$19.23** | $143.90 | **$130.75** |

**Arithmetic** ([compute-leases.ts](compute-leases.ts), keyless; output in [leases.txt](leases.txt)):

1. R per shard (printed for reference, not used in a lease) is the largest `callReservationUsd` (scripts/ubicloud/smoke-lease.ts) among its cells at 50,000 input tokens and 128,000 output tokens, through the proxy's own price lookup and reservation formula at this commit: Opus 5.5 $2.96, gpt-6.1-sol $1.405.
2. Rmax per shard is the largest `reserved_usd` among the forwarded calls in `docs/benchmarks/2026-11-04-matrix-mu/results/<cell>.proxy-usage.ndjson`, read by the script: `cc-opus` $3.05146 (both Claude Code shards), `cx-sol` $1.67983, `he-sol` $1.63726, `oc-sol` $1.6757475.
3. k per shard is the most entries open at the same instant in `docs/benchmarks/2026-11-04-matrix-mu/results/<cell>.ledger.sqlite` (each entry open from `created_at` to `settled_at`; the script sweeps the opens and settles in time order, a settle counting before an open at the same instant), read by the script: `cc-opus` 1, `cx-sol` 2, `he-sol` 1, `oc-sol` 2. In `oc-sol`, 34 of the calls that started while another was open ran during one call that timed out after 15 minutes; that call and one other timed-out call were charged their full reservation.
4. Smoke lease = plan smoke ceiling + k x Rmax, rounded down to the cent, so a lease can sit up to a cent under the exact sum. Sum: $19.23.
5. Counted budget = $150 - $19.23 = $130.77.
6. Counted lease = plan counted lease x ($130.77 / $143.90 = 0.908756), rounded down to the cent. Sum: $130.75.
7. All leases: $19.23 + $130.75 = $149.98, at or under $150 (the script exits 1 otherwise).

**R and Rmax are floors:** a call with a larger request body than any matrix-mu call reserves more than Rmax.

**Worst-case margins** (counted lease / the shard's base cost at the stated per-turn prices; base: `cc-cli` $18.30, `cc-sdk` $14.40, `cx` $13.275, `he` $11.25, `oc` $8.175), beside **HARN-12's worst counted cell at 2.09x base** (upper interval):

| Shard | Model | Margin (lease / base) | Early-stop case: margin after k x Rmax ((lease - k x Rmax) / base) | Against 2.09x |
|---|---|---:|---:|---|
| `cc-cli` | Opus 5.5 | 1.9082x | 1.7415x | below |
| `cc-sdk` | Opus 5.5 | 1.9083x | 1.6964x | below |
| `cx` | gpt-6.1-sol | 2.0904x | 1.8373x | above; below after 2 x Rmax |
| `he` | gpt-6.1-sol | 2.0898x | 1.9442x | below |
| `oc` | gpt-6.1-sol | 2.0905x | 1.6806x | above; below after 2 x Rmax |

**Worst-case margins, stated as a limit:** 1.9082x on Opus 5.5 (`cc-cli`) and 2.0898x on gpt-6.1-sol (`he`), against HARN-12's 2.09x.

- **Opus shards: an Opus cell that costs what HARN-12's worst cell cost reaches its lease before it finishes.** Its shard then cap-stops (final): the cap-stop filter excludes that trial and every later trial of the shard; if that shard is `cc-cli`, which holds Claude Code's family A cells, Claude Code leaves family A; and the report says so.
- **gpt-6.1-sol shards: `cx` and `oc` leases just cover 2.09x and `he` falls just under it, and the stop can come up to k x Rmax early (more with a larger body; reservation caveat, below), and there every shard is under 2.09x.** A cell that costs 2.09x base can stop on any of them.

**When a cell reaches its lease (reservation caveat):** the proxy reserves a call's worst case before forwarding it and refuses the call when the reservation does not fit what is left of the lease. It reserves input as max(the request's input tokens, request body bytes + 64), priced at the dearest of the model's input rate and, where they apply, its cache-write rate and twice its input rate (a 1-hour cache write), plus the whole 128,000-token output cap. R assumes 50,000 input tokens; because the proxy counts body bytes + 64 whenever that is larger, matrix-mu's real calls reserved more, up to Rmax, and a call with a larger body (large Claude Code contexts late in a trial) reserves more than Rmax. A shard therefore stops when its settled spend plus the reservations in hand pass its lease, which can be up to k x Rmax early (more with a larger body); the "margin after k x Rmax" column of compute-leases.ts is that early-stop case. Codex, and OpenClaw in matrix-mu, held two reservations at once, so a `cx` or `oc` counted cell can stop up to 2 x Rmax ($3.36 and $3.35) early, more with a larger body. A call that hangs until the proxy times out is charged its full reservation (twice in matrix-mu's `oc-sol`).

## Money (R71, $2,000 per eval, all-in)

Eval GST-830 (H10, instruction placement). All-in means paid model calls, judges, Ubicloud VMs and the threads' own model use (1,000 credits = $1).

| Item | Amount |
|---|---:|
| GST-830 booking, all-in | $974 |
| Spent so far: HARN-18, lifetime upper bound | at most $517 |
| Spent so far: HARN-28 | about $157 |
| **Spent so far, HARN-18 and HARN-28** | **at most about $674** |
| HARN-46 own model use to date (81,938 credits, subagents included, at 2026-11-07 during the preregistration /ship) | about $82 |
| **Spent so far, all three** ($517 + $157 + $82) | **at most about $756** |
| This run's cap (wave 1, smokes included; VMs reported beside it) | $150 |
| Ubicloud VMs at list price, outside the cap: the five shard VMs (about $10, Run section above) plus the one-VM pre-smoke (a standard-16 VM, about $0.50 an hour, docs/ubicloud.md) | about $11 |
| HARN-46 own model use still allowed (the rest of this /ship, the run and the results), held to what the booking leaves ($974 - $756 - $150 - $11) | at most about $57 |
| **Projected all-in** ($756 + $150 + $11 + $57) | **at most about $974** |
| Left under the $974 booking ($974 - $974) | about $0 |
| Left under the $2,000 R71 ceiling ($2,000 - $974) | about $1,026 |

**Methodology item 11 (Budget)**, as amended on main by #304 (2026-11-06), quoted from [docs/methodology.md](../../methodology.md) up to its authorization list, which is omitted (marked [...]):

> 11. **Budget.** Every paid call reserves worst case in the SQLite ledger before dispatch (concurrency-safe), settles to usage; a cap stop exits 3 with HE-BUDGET-001, records the run incomplete, permits read-only scoring, and names `--resume --spend-cap` as recovery. Unknown charges block until reconciled. Two caps apply: the per-run cap in each preregistration, and the R71 ceiling of **$2,000** all-in per eval, which each preregistration states together with its eval's tally. All-in counts paid model calls, judges, VMs and the agents' own model use for that eval. The program-wide $2,000 cap this item set on 2026-10-22 (plan D10) is retired; the program-wide total is still reported on [the budget ledger page](../../budget-ledger.md), as a figure and not a cap. [...]

This run's per-run cap is $150, and the tally above is this eval's tally against the R71 ceiling.

## Clean arms (R44 and the clean no-gstack method finding)

Every cell is a no-gstack cell, and every route-tool cell is the no-rule control of its harness, model and driver. A control is clean only if its agent can reach no gstack.

- **Where trials run:** in containers on Ubicloud VMs. No VM mounts a Capy drive, and no harness image installs gstack.
- **Preflight, per shard, before any key or trial:** `scripts/matrix/clean-arm-preflight.sh` through `run-shard.sh --pre-smoke`. It builds every harness image from the pinned checkout and checks that the VM holds no `~/.capy`, `~/.local/share/gstack`, `~/.claude/skills/gstack` or `~/.gstack`, that the static mount files name no `.capy` or gstack path, and that no image holds a gstack path or `.capy` directory. A failure stops the shard (exit 4) before any trial. Run on this tree, the four H10 images and the mount files read clean ([GOLDENS.md](GOLDENS.md), section 6).
- **The tool-discipline clean-arm preflight** (`scripts/tool-discipline/clean-arm-preflight.sh --arm none`, at its merged sha `e77ca6a3`) was run on the four images as a receipt: every gstack check reads clean on all four. It is not the shard pre-smoke, because two of its checks belong to the tool-discipline Hermes images (an image label these images do not carry, and a Tirith pin only Hermes ships), so it exits 1 on every H10 image.
- **Post-run audit, before analysis:** `grep -rlE 'gstack|\.capy/|capy/drive'` over each shard's `results/trials/` and `trials.jsonl`, and a per-arm count of reads of any gstack SKILL.md or skill file from the trial records. **Any hit in a cell voids that cell:** it is reported as contaminated and enters no comparison. Host-side files (`fanout.log`, `lane.log`, `shard-vm.json`) name these paths by design and are not audited; a harness's own bundled skills (Hermes's `state/hermes/skills`) are its shipped context, not gstack. The tool-discipline audit script (`clean-arm-audit.ts`) reads the tool-discipline run layout (`cells.jsonl`), which this run does not write, so its rule is applied through the grep and the per-arm count above.

## Limits

- **One repetition, 10 tasks.** Family A clears its 20-point claim margin on neither contrast (MDD 39 and 25 points), so it is descriptive. Family B detects only large effects.
- **Between-harness differences are harness-and-model differences.** Claude Code runs Opus 5.5 and the other three run gpt-6.1-sol. No harness difference is read as a model effect, and every per-harness number names its model and driver.
- **The Claude Code cli and SDK cells differ in more than the driver.** The SDK cells load `settingSources: ["user"]` only, while the cli also loads the workspace `CLAUDE.md` and `.claude` settings; the Bash background timeout text differs; and the entrypoint header differs. So a cli against SDK difference is a driver-and-setup difference and is never read as an instruction-placement effect. Block A (cli) and block B (SDK) contrasts stay within their own driver.
- **Pass has no room:** Opus saturates v0.3 and task success was at ceiling in every earlier panel arm, so pass is descriptive; only a drop from the ceiling could show.
- **Placebo and told coverage is partial at frontier** (told on Claude Code SDK preset and Codex; placebo on Codex and Hermes).
- **Block D's Hermes runs with Tirith on**, unlike every earlier Hermes receipt (above).
- **Lease margins are a limit:** the worst counted lease covers 1.9082x base on Opus 5.5 and 2.0898x on gpt-6.1-sol, both under HARN-12's 2.09x worst cell, and a shard can stop up to k x Rmax early (more with a larger body). A costly cell can cap-stop its shard; the cap-stop filter then shortens every cell of that shard.
- **The smoke-cost gate is a coordinator check,** not code: `vm-shard.sh` starts the counted run right after the smoke, so a gate failure is caught from the smoke ledger and the shard interrupted.

## Results PR

- A separate pull request, after this one merges and the run ends. The report and the H10 finding file carry, at the end, the R55 disclosure lines word for word from the disclosures file for **gbrain**, **gstack**, **Hermes**, **OpenAI** and **OpenClaw**. No Particle line, because block F dropped and no particle-1 number can appear. No QM line (QM is not run).
- A "Why null?" section per route family, with its KEEP, FIX-METHOD or CUT-CANDIDATE verdict line; model and driver beside every per-harness result; one reviewer, one round (R51).

## Receipts

- [prereg.json](prereg.json): the 30 cells, the order and the analysis block (family A pairs and floors, headroom guard).
- [shards.json](shards.json): the five shards' cell lists.
- [goldens/](goldens/): the four keyless Docker golden test logs and the Claude Code system capture summary.
- [GOLDENS.md](GOLDENS.md): what each golden shows, and, as prose with no committed log, each harness's provenance-manifest digest, the clean-arm preflight results, the tool-discipline preflight's exit reasons and the Codex `--strict-config` result.
- [mdd.md](mdd.md): the MDD commands and output.
- [compute-leases.ts](compute-leases.ts): the lease arithmetic; its output at this commit is [leases.txt](leases.txt).
- `docs/benchmarks/preregistrations.d/h10-instruction-placement.json` registers the run for `runner/prereg/prereg.ts`.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells.

### Amendment 1, 2026-11-07 (America/Los_Angeles): leases and the smoke-cost gate re-costed from measured smokes, cap $250

Written by HARN-46 after this preregistration merged to main as `45eb516257b1` (#315), before any counted trial. **No cell, task, repetition, order, shard, `prereg.json` or `shards.json` change.** It replaces the figures in "Leases" and the smoke-cost gate's ceilings and smoke leases in "Run, sharding and order"; every other sentence of those sections stands. It also supersedes the $150 cap and the $974 booking wherever this preregistration states them: the $150 lease total in the summary, "Wave 2", "Leases" and its Captain lines; the "Money" table and its sentence "This run's per-run cap is $150"; and "H10 stays at or under its 974 USD booking" in the Captain's G1 F1 line. The booking is $1,200 and the cap $250, both from HARN-1 on 2026-11-07.

**The decision** (Captain HARN-1, 2026-11-07, recorded in gstack-approvals in these words): "adjusted base, $250 cap, sy-01-referenced gate ceilings, smoke leases re-sized for five Opus smokes; cells, trials and order unchanged; worst case inside the $1,200 booking; the open $1.61 reservation stated as a limit; sidecar tokens scrubbed before commit, with a clean token scan before push; amendment PR gets one reader, then HARN-44, then launch from the amendment commit."

**The fix round** (Captain HARN-1, 2026-11-07, after the /ship review, recorded in gstack-approvals in these words): "one fix round on #324 covering A to D plus the folded items (lockfile diff in the launch check; matrix-mu re-price check, back to me before launch if over 5%); then one scoped fix-check on the touched hunks, then the receipt and HARN-44. The gbrain table carries both columns, labelled, with the route-tool control as the headline column." A is the smoke lease's 1.5x headroom, rounded up (5); B is Rs in the gate's margin (5, 6); C is one relaunch per shard (7, 9); D is the booking and cap sentence above.

**1. What happened at `45eb516`.**

- The one-VM pre-smoke passed (`ubirun-harn46-1794065999-56ad630c-t13`, 15:40Z to 15:47:54Z UTC): bootstrap, then `scripts/matrix/clean-arm-preflight.sh`, host, mounts and all six images clean. The VM was destroyed.
- The `cx` canary launched alone at 15:48Z on `ubirun-harn46-1794066516-8f34ce73-t13`. Its first smoke, `codex-sol-gbrain-route-tool-mu-v03-dev` (a no-rule cell), cost $0.1287059 for one member turn, against its $0.0643055 ceiling. The coordinator interrupted the shard at 16:01:09Z, as the gate says. The second smoke, `route-hook` (a rule cell), finished during the interrupt at $0.1253363 for one turn, over its $0.12401775 ceiling too. `route-told` was in flight and is not recorded. The VM was destroyed at 16:01:35Z.
- The counted run never started: no counted trial, no counted ledger, no `results/` tree. The $27.75 counted lease was never opened.

**2. Why the gate failed.** The ceilings at "Run, sharding and order" are average per-turn prices over the multi-turn tasks. The smoke task, `sy-01-quarrendon-ticket-numbers`, is one heavy turn: it carries a whole trial's setup in its only turn. matrix-mu-2026-11 ran sy-01 in every no-gbrain arm, and there one sy-01 turn cost 1.67x to 2.38x that arm's average turn (the sy-01 factor, table in 4). So a sy-01 smoke fails an average-turn ceiling even at no-gbrain prices. The no-rule ceiling is also half the rule ceiling, but a no-rule Codex turn cost the same as a rule one ($0.1287 against $0.1253).

**3. Order deviation: smoke-only measurement before the canary finished.** To re-cost, the other four shards' smokes ran on their own, before the `cx` canary had a scored trial, on 2026-11-07 (UTC), at `45eb516`, from the same pinned worktree:

| Run id (uncounted) | VM (standard-16, destroyed) | Launched | Destroyed | Smoke lease | Smokes |
|---|---|---|---|---:|---:|
| `h10-instruction-placement-2026-11-smoke-cc-cli` | `ubirun-harn46-1794067619-64fd4594-t13` | 16:06Z | 16:24:55Z | $4.33 | 5 |
| `h10-instruction-placement-2026-11-smoke-cc-sdk` | `ubirun-harn46-1794067619-fede971a-t13` | 16:06Z | 16:23:38Z | $4.06 | 5 |
| `h10-instruction-placement-2026-11-smoke-he` | `ubirun-harn46-1794068759-0ee25521-t13` | 16:26Z | 16:46:10Z | $2.49 | 7 |
| `h10-instruction-placement-2026-11-smoke-oc` | `ubirun-harn46-1794068759-ad556290-t13` | 16:26Z | 16:46:23Z | $3.98 | 5 |

- Each ran through `scripts/ubicloud/run-shard.sh` with a scratch preregistration ("any other readable file is a scratch preregistration (an uncounted smoke or check)", docs/ubicloud.md) and `--no-smoke`. The scratch preregistration is `vm-shard.sh`'s own smoke transform at `45eb516`, so each holds the shard's cells on sy-01, one repetition, `split: dev`, under the shard's smoke lease and its own ledger. Same `--pre-smoke`, `--gbrain-image` and `--max-output-tokens 128000` as the counted manifests.
- No counted preregistration, destination or lease was used, and no counted record exists. The smoke-cost gate did not interrupt these runs, because no counted run could start.
- The `cx` smokes are the two from the canary (1). The receipts are [smoke-measurement/](smoke-measurement/).

**4. The adjusted base.** Per shard, by [compute-leases-amended.ts](compute-leases-amended.ts) (output committed as [leases-amended.txt](leases-amended.txt)):

- gbrain smoke $/turn = max(`usage.usd`, the smoke ledger's entries for the trial) / `turns.run`, completed smokes only, from `smoke-measurement/<shard>.trials.jsonl` and `<shard>.ledger.sqlite`.
- ratio = the mean gbrain smoke $/turn over the mean matrix-mu no-gbrain sy-01 $/turn, from `docs/benchmarks/2026-11-04-matrix-mu/results/trials.jsonl` (the no-gbrain cell of the same harness and model, its four sy-01 trials).
- adjusted $/turn = matrix-mu's no-gbrain all-turn $/turn (the same file, all 220 turns of the cell) x ratio.
- base = adjusted $/turn x 30 turns x the shard's cells, with no rule/no-rule split.

| Shard | Cells | gbrain smoke $/turn, mean (n) | no-gbrain sy-01 $/turn | Ratio | no-gbrain all-turn $/turn | sy-01 factor | Adjusted $/turn | Base |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `cc-cli` | 5 | 0.2333 (5) | 0.1326 | 1.7589x | 0.0602 | 2.2049x | 0.1058 | $15.87 |
| `cc-sdk` | 5 | 0.2335 (4) | 0.1326 | 1.7605x | 0.0602 | 2.2049x | 0.1059 | $15.89 |
| `cx` | 8 | 0.1270 (2) | 0.1021 | 1.2445x | 0.0428 | 2.3828x | 0.0533 | $12.79 |
| `he` | 7 | 0.0913 (7) | 0.0853 | 1.0708x | 0.0510 | 1.6736x | 0.0546 | $11.46 |
| `oc` | 5 | 0.1395 (5) | 0.0912 | 1.5300x | 0.0500 | 1.8231x | 0.0765 | $11.48 |
| **Sum** | 30 | | | | | | | **$67.49** |

**5. Leases** (cap $250, smokes included; same Rmax and k as [compute-leases.ts](compute-leases.ts); counted leases round down as there, smoke leases round up).

- **Smoke lease** = 1.5 x the shard's largest smoke $/turn x its cells + k x Rs, rounded up to the cent. Rs is the larger of matrix-mu's Rmax and the largest reservation the shard's own smokes made, because the Claude Code and Codex smokes reserved more than Rmax (a larger request body). The 1.5x is headroom for cells no smoke measured: `cx`'s price rests on 2 of its 8 cells, and in `oc` the route-startup and route-skill smokes cost about 2x route-tool. The lease holds k x Rs of reservations beside smokes up to 1.5x the dearest measured one; a smoke past that can still cap-stop (8).

| Shard | 1.5 x largest smoke $/turn x cells | k | matrix-mu Rmax | Largest smoke reservation | Rs | Exact | Smoke lease |
|---|---:|---:|---:|---:|---:|---:|---:|
| `cc-cli` | 1.5 x 0.2840 x 5 = 2.1298 | 1 | 3.0515 | 3.2240 | 3.2240 | 5.3537 | $5.36 |
| `cc-sdk` | 1.5 x 0.2714 x 5 = 2.0356 | 1 | 3.0515 | 3.2018 | 3.2018 | 5.2374 | $5.24 |
| `cx` | 1.5 x 0.1287 x 8 = 1.5445 | 2 | 1.6798 | 1.7409 | 1.7409 | 5.0262 | $5.03 |
| `he` | 1.5 x 0.1024 x 7 = 1.0753 | 1 | 1.6373 | 1.6163 | 1.6373 | 2.7125 | $2.72 |
| `oc` | 1.5 x 0.1973 x 5 = 1.4795 | 2 | 1.6757 | 1.6637 | 1.6757 | 4.8310 | $4.84 |
| **Sum** | | | | | | | **$23.19** |

- **Counted lease.** Each shard's counted ceiling is plan v3's ceiling/base factor (Opus 2.1, gpt-6.1-sol 2.3, the ratio of each `PLAN` counted lease to its base in compute-leases.ts) x the adjusted base, rounded up to the cent. The ceilings sum to $148.89. The counted budget is $250.00 - $23.19 = $226.81, so every ceiling scales by 1.523339, rounded down to the cent (compute-leases.ts steps 5 and 6).

| Shard | Counted ceiling | Counted lease | Margin (lease / base) | Margin after k x Rs | Gate: sy-01 ceiling $/turn |
|---|---:|---:|---:|---:|---:|
| `cc-cli` | $33.34 | $50.78 | 3.1994x | 2.9963x | $0.6990 |
| `cc-sdk` | $33.36 | $50.81 | 3.1985x | 2.9969x | $0.6998 |
| `cx` | $29.43 | $44.83 | 3.5040x | 3.2319x | $0.4105 |
| `he` | $26.36 | $40.15 | 3.5035x | 3.3607x | $0.3069 |
| `oc` | $26.40 | $40.21 | 3.5041x | 3.2120x | $0.4480 |
| **Sum** | $148.89 | **$226.78** | | | |

- **All leases: $23.19 smoke + $226.78 counted = $249.97**, at or under the $250 cap. `prereg.json` keeps `spend_cap_usd: 150`, so its trial order and `prereg_sha256` stay as preregistered; the runner reads that field only for the plan-time HE-BUDGET-003 warning and as a default lease, which every manifest overrides with `lease_usd`. This amendment is the cap of record.
- **Expected spend:** the adjusted base $67.49 plus one sy-01 smoke per cell at the measured mean, $4.69: **$72.17**. On the smoke-based base (mean gbrain smoke $/turn x 30 x cells) it would be $140.61 + $4.69 = $145.29. Both are under the cap.

**6. The smoke-cost gate, sy-01 referenced.** For each shard, the ceiling is adjusted $/turn x that pair's sy-01 factor x the margin after k x Rs at the leases above (which equals the shard's mean gbrain smoke $/turn x that margin): **`cc-cli` $0.6990, `cc-sdk` $0.6998, `cx` $0.4105, `he` $0.3069, `oc` $0.4480** per member turn. Rs, not matrix-mu's Rmax, because the gbrain calls of `cc-cli`, `cc-sdk` and `cx` reserved more (5). A smoke at its ceiling implies the shard spends its whole counted lease after a k x Rs early stop, so the gate passes only shards whose smoke says the lease holds. One ceiling per shard, for every cell (no rule/no-rule split). The rest of the gate stands: the coordinator reads each smoke ledger as the smoke ends, compares cost per member turn (the larger of `usage.usd` and the ledger sum, over `turns.run`) with the shard's ceiling and interrupts the shard if one is over; every smoke must end `completed`.

**7. Launch.** Every shard runs from the launch commit, not from `45eb516`: the commit on branch `h10-instruction-placement-results` that adds this amendment, before any counted trial. Under the two-PRs-per-experiment rule (R77, 2026-11-07) this amendment does not get its own pull request; it merges to main with the results, and its launch sha is recorded in the run log and the results report. A dated amendment committed before the cells it affects still holds. This amendment's base is main at `71aeb9d7e660` (#317 and #316, merged after #315); between `45eb516257b1` and that base, `git diff --stat 45eb516257b1 71aeb9d7e660 -- runner harnesses scripts tasks gbrain world` lists 2 files, both from #317, `scripts/v04/cal-report.ts` (+204) and `scripts/v04/round-results.ts` (+21 -4), 225 insertions and 4 deletions, and H10 uses neither: `scripts/run-shard.sh`, `scripts/ubicloud/run-shard.sh`, `scripts/ubicloud/vm-shard.sh` and `scripts/ubicloud/fanout.sh` reference neither file, and the only `scripts/v04/` file they run, `clean-arm-audit.ts`, imports no repository file and is unchanged. `git diff --stat 45eb516257b1 71aeb9d7e660 -- package.json bun.lock tsconfig.json` is empty (`vm-shard.sh` runs `bun install --frozen-lockfile`, so these shape the run too). Before any shard starts, `git diff --stat 45eb516257b1 <launch commit> -- runner harnesses scripts tasks gbrain world package.json bun.lock tsconfig.json` may list only those 2 files, and the same diff over this run's directory only this run's `PREREGISTRATION.md`, `compute-leases-amended.ts`, `leases-amended.txt` and `smoke-measurement/`; anything else stops the launch and goes to the coordinating agent. The one-VM pre-smoke reruns at that commit. Then the order stands: `cx` alone as the canary, in a new destination, and the other four only after it has finished a scored trial and copied its results off the VM. Each fan-out manifest carries the leases above (`lease_usd` the counted lease, `--smoke-lease-usd` the smoke lease); every other option is as preregistered. **One relaunch per shard at most** (a new VM, or a `--resume`), then the shard goes back to the coordinating agent. A relaunch reruns its smoke under a fresh smoke ledger at the full smoke lease, outside the $250 (`vm-shard.sh` opens `$shard/smoke` on each VM, and a `--resume` uploads only `results/`), so the five relaunches can add at most $23.19 (9). The counted lease is not reopened: a resume reuses the counted ledger.

**8. Limits.**

- **An open reservation in the `cx` canary's smoke ledger:** $1.6117 (entry `a6d05b14-e4fe-47de-89f9-d68d939eaf6d`, the `route-told` smoke's call in flight at the interrupt). The proxy logged no usage for it, and no ledger command settles or releases an entry (`runner/ledger/budget-ledger.ts` has init, status, verify, set-cap, migrate, open and close). It stays committed at its reservation, so that ledger overstates its spend by up to $1.6117 (docs/ubicloud.md, Limits, "Interrupt").
- **One smoke cap-stopped:** `claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev` ended `model_error` with `cap_stop: true` after 1 refused call, because the $4.06 smoke lease could not hold another Opus reservation after the four smokes before it. Its $0.1397 is in the ledger and out of the means. The `cc-sdk` price rests on 4 smokes and `cx`'s on 2.
- **The sy-01 factor is an estimate** from matrix-mu's no-gbrain arms (four sy-01 trials each), applied to gbrain cells. If the gbrain cells' average turn is dearer relative to their sy-01 turn than in matrix-mu, the adjusted base is low.
- **The adjusted base could be off.** If a shard costs more than its counted lease covers, it cap-stops, and a cap stop is final (R71): the preregistered cap-stop filter applies as written.
- **Rmax and Rs are floors:** a call with a larger request body reserves more, so a shard can stop up to k x that reservation early.
- **Smoke headroom is 1.5x the dearest measured smoke.** `cx` has 6 unmeasured cells, `cc-sdk`'s route-skill smoke cap-stopped, and every price rests on 1 to 7 smokes; a shard whose smokes cost more than that cap-stops in the smoke and goes back to the coordinating agent before any counted trial.
- **Re-price check: matrix-mu's recorded usage re-priced with the current `runner/pricing` and `runner/ledger` (keyless, no paid calls): 0.000% gap for every pair** (`cc-cli` and `cc-sdk` on `cc-opus`, 961 requests, $13.2346; `cx`, 942, $9.4236; `he`, 1,349, $11.2113; `oc`, 986, $9.5682). Between matrix-mu's `de7f7cd` and `45eb516` the ledger's pricing changed only its row lookup (#265, "no effective price change"); `model-pricing.ts` and `prices-2026-11-04.json` are the planning table, not what the proxy charges. matrix-mu's Codex, Hermes and OpenClaw usage lines carry no `cache_write_tokens` (the field came later), so their cache writes are inferred from the recorded cost; the Claude Code lines carry it. Not re-priced: 1,097 Hermes `/v1/models` reads ($0) and one OpenClaw request charged its whole $1.4323 reservation with no usage reported (`cn-02-tansleigh-packaging-deadline` r4), which stays in `oc`'s all-turn $/turn and makes its base higher, not lower.

**9. Money** (R71; all-in counts paid model calls, judges, VMs and the threads' own model use).

| Item | Amount |
|---|---:|
| H10 booking, all-in (HARN-1, 2026-11-07) | $1,200 |
| Spent so far: HARN-18, lifetime upper bound | at most $517 |
| Spent so far: HARN-28 | about $157 |
| Spent so far: HARN-46 own model use | about $146 |
| Spent so far: wave-1 smokes, committed in the five smoke ledgers (settled $3.8863 plus the open $1.6117) | $5.4980 |
| Spent so far: Ubicloud VMs at list price (pre-smoke VM about $0.07, `cx` $0.1089, smoke-only $0.1508, $0.1425, $0.1760, $0.1760) | about $0.82 |
| **Spent so far** | **about $826** |
| This run's cap (wave 1, smokes included) | $250 |
| Ubicloud VMs for the relaunch at list price, beside the cap: five shard VMs (about $10) plus the one-VM pre-smoke | about $11 |
| Relaunch smokes, outside the cap: one per shard at most, at the full smoke lease (7) | at most $23.19 |
| Ubicloud VMs for those relaunches at list price | about $10 |
| **Worst case at the cap** ($826 + $250 + $11 + $23 + $10) | **about $1,120** |
| Left under the booking for HARN-46's own model use (the relaunch and the results) | about $80 |

The expected run spend is about $72 (5), so the expected total is about $909.

**10. For GBRA-108: gbrain against no-gbrain on the same task.** sy-01, one member turn, against the matrix-mu no-gbrain arm of the same harness and model. **The headline is the route-tool control:** the one gbrain cell with no rule injected, so its ratio is gbrain's own cost. The all-cells mean averages it with the rule cells (hook, startup, skill, once, system, told), so it also counts the cost of injecting the rule. One smoke per cell; by [compute-leases-amended.ts](compute-leases-amended.ts).

| Harness, model | Route-tool control $/turn (n) | matrix-mu no-gbrain sy-01 $/turn (n) | **gbrain / no-gbrain, control cell only** | All completed gbrain smokes, mean $/turn (n) | All cells / no-gbrain (rule injection included) |
|---|---:|---:|---:|---:|---:|
| Claude Code cli, Opus 5.5 | 0.2259 (1) | 0.1326 (4) | **1.70x** | 0.2333 (5) | 1.76x |
| Claude Code SDK, Opus 5.5 | 0.2714 (1) | 0.1326 (4) | **2.05x** | 0.2335 (4) | 1.76x |
| Codex, gpt-6.1-sol | 0.1287 (1) | 0.1021 (4) | **1.26x** | 0.1270 (2) | 1.24x |
| Hermes, gpt-6.1-sol | 0.1024 (1) | 0.0853 (4) | **1.20x** | 0.0913 (7) | 1.07x |
| OpenClaw, gpt-6.1-sol | 0.0943 (1) | 0.0912 (4) | **1.03x** | 0.1395 (5) | 1.53x |

Each control ratio rests on one smoke. OpenClaw's all-cells 1.53x comes from its rule cells (route-startup $0.1973, route-skill $0.1813), not from gbrain. The detail below is over all completed smokes (rule injection included). Requests include refused ones: Hermes makes 7 refused model-discovery calls per trial (`/api/show`, `/version` and others), on both sides, and they are not billed. Every smoke trial's row is in [smoke-measurement/README.md](smoke-measurement/README.md).

| Harness, model | gbrain smoke $/turn: mean (range, n) | gbrain smoke requests / input / cached / output (mean) | matrix-mu no-gbrain sy-01 $/turn: mean (range, n) | no-gbrain sy-01 requests / input / cached / output (mean) | All cells / no-gbrain (rule injection included) |
|---|---|---|---|---|---:|
| Claude Code cli, Opus 5.5 | 0.2333 (0.1502 to 0.2840, 5) | 6.6 / 199,237 / 169,337 / 2,497 | 0.1326 (0.1035 to 0.1757, 4) | 6.2 / 147,948 / 135,559 / 2,180 | 1.76x |
| Claude Code SDK, Opus 5.5 | 0.2335 (0.1608 to 0.2714, 4) | 7.2 / 202,635 / 172,606 / 2,443 | 0.1326 (0.1035 to 0.1757, 4) | 6.2 / 147,948 / 135,559 / 2,180 | 1.76x |
| Codex, gpt-6.1-sol | 0.1270 (0.1253 to 0.1287, 2) | 7.0 / 205,124 / 164,301 / 856 | 0.1021 (0.0800 to 0.1116, 4) | 7.5 / 162,270 / 129,905 / 818 | 1.24x |
| Hermes, gpt-6.1-sol | 0.0913 (0.0776 to 0.1024, 7) | 12.1 / 154,637 / 126,776 / 901 | 0.0853 (0.0822 to 0.0885, 4) | 12.5 / 147,896 / 122,250 / 896 | 1.07x |
| OpenClaw, gpt-6.1-sol | 0.1395 (0.0943 to 0.1973, 5) | 14.6 / 305,370 / 264,233 / 1,023 | 0.0912 (0.0748 to 0.1147, 4) | 11.0 / 186,474 / 159,601 / 804 | 1.53x |

**Receipts of this amendment:** [compute-leases-amended.ts](compute-leases-amended.ts) and its output [leases-amended.txt](leases-amended.txt); [smoke-measurement/](smoke-measurement/): per shard the smoke `trials.jsonl`, `ledger.sqlite`, `proxy-usage.ndjson` and the scratch smoke preregistration, as pulled off the VMs (`cx` from the canary's smoke).

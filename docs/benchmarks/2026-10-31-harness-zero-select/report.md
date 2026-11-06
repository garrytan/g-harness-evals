# Harness Zero switch selection (harness-zero-select-2026-11): report

**Answer: on the 20 public v0.3 dev tasks, Harness Zero keeps two of its eleven switches on Opus 5.5 (dev).** Prompt caching and scoped notes stay (dev). Dropping high reasoning effort and tool search made trials cheaper with no pass-rate loss this design can see, so both are cut (dev). The five prompt layers, the output cap and the MCP-instructions switch are can't tell (dev). Every verdict here is a dev verdict at these pins: the tasks are public and the harness author has read them.

- **Noise floor F = 7.5 points.** Two identical `zero-full` cells on Opus differed by +2.0 [-5.0, +10.0] points. So a pass-rate loss has to beat F plus the ablation's own half-width (7.0 to 10.0 points) before this run can call it.
- **Cut (dev): `effort-high` and `tool-search`.** Dropping each one lowered cost per trial with an interval below zero, moved pass rate by less than F, and broke at most 2 tasks.
- **Keep (dev): `caching` and `scoped-notes`.** Without caching, `zero-full` would cost 2.71 [2.55, 2.88] times as much. Without scoped notes, cost per success rose by a ratio of 1.17 [1.06, 1.31].
- **Can't tell (dev): the five `layer-*` prompt layers, `output-cap` and `mcp-instructions`.**
- **GPT-6.1 Sol inherits the Opus verdicts, except caching, which is can't tell (dev) on Sol.** The conditional Sol `effort-high` cell was skipped by rule, because Opus did not keep that switch.
- **Why null? verdicts:** CUT-CANDIDATE for `effort-high` and `tool-search`, FIX-METHOD for the layers, `output-cap`, `mcp-instructions` and Sol caching (dev) ([Why null?](#why-null)).
- **Spend: $104.46 of the $213 cap**, 820 of 820 unconditional trials, all `completed`. The clean-arm audit found 0 trials that mention gstack.

The frozen candidates for Phase D are in [`harnesses/harness-zero/config/candidates.json`](../../../harnesses/harness-zero/config/candidates.json): `zero-lean` and `zero-control` are caching plus scoped notes.

## What ran

- **9 cells, 820 trials, 20 tasks.** Seven Opus 5.5 cells at 5 repetitions and two GPT-6.1 Sol cells at 3. Preregistration: [PREREGISTRATION.md](PREREGISTRATION.md) (#276, merged as `e3eee2c6ac13`) and its Amendment 1 (#282, `a4a7713d4529`). Rules: the [loop file](../../loops/2026-10-31-harness-zero.md).
- **Harness Zero** is a harness where every part beyond the bare model loop is a named switch ([README](../../../harnesses/harness-zero/README.md)). `zero-full` has all eleven on. `zero-min` has none.
- **Each ablation drops one switch from `zero-full`** and is paired with `zero-full-a` by task and repetition. The five prompt layers drop together in one cell (`zero-full-minus-layers`).
- **The tasks** are multi-user work in a fake company: relay an approval before sending a rate, keep one member's private facts out of another's answer, carry a fact across sessions, act on a correction. Six families, 55 turns per repetition.
- **Ceiling gate: `zero-full-a` passed 78% [61%, 93%]**, inside 10% to 90%, so the normal verdict rules apply, not the cost-only ones.

## Verdicts

Each row is the ablation minus `zero-full-a` on Opus 5.5, 100 pairs on 20 tasks. Intervals are task-clustered 95% bootstrap intervals, seed 7. From [results/verdicts.md](results/verdicts.md).

| Switch dropped | Pass delta, points [95% CI] | Half-width | Cost per trial delta [95% CI] | Cost per success ratio [95% CI] | Broken | Fixed | Verdict |
|---|---|---:|---|---|---:|---:|---|
| `effort-high` | +2.0 [-5.0, +10.0] | 7.5 | -$0.0207 [-$0.0329, -$0.0115] | 0.81 [0.71, 0.92] | 0 | 1 | cut (dev) |
| `tool-search` | -1.0 [-11.0, +9.0] | 10.0 | -$0.0158 [-$0.0295, -$0.0050] | 0.88 [0.76, 1.01] | 2 | 1 | cut (dev) |
| `scoped-notes` | -4.0 [-12.0, +2.0] | 7.0 | +$0.0139 [+$0.0075, +$0.0205] | 1.17 [1.06, 1.31] | 2 | 1 | keep (dev) |
| `layer-*` (five, bundled) | +1.0 [-6.0, +9.0] | 7.5 | +$0.0130 [+$0.0046, +$0.0207] | 1.09 [0.94, 1.26] | 0 | 1 | can't tell (dev) |

**How each verdict falls out** (loop file rules, read as Amendment 1 section 4 says):

- **Keep** needs the pass interval wholly below zero, or a cost-per-success ratio above 1.10 with its interval above 1.00 while the pass estimate is not below -F. Only scoped notes clears it (dev), on cost per success.
- **Cut** needs cost per trial level or lower, a pass estimate within ±F, and at most 2 broken tasks. Effort-high and tool search clear it (dev).
- **The layers** fail cut because dropping them raised cost per trial, with an interval above zero. They miss keep because 1.09 is under 1.10. So the layers are can't tell (dev).
- **A task is broken** when it passes 3 or more of 5 in `zero-full-a` and 2 or fewer in the ablation. Tool search's breaks are `ar-02-quarrendon-rate-hollis` and `ar-03-tansley-parcel-rate-tobias`. Scoped notes' are `ar-03-tansley-parcel-rate-tobias` and `sy-03-marrow-fieldworks-ticket-numbers`.
- **Why scoped notes saves money is not clear from these receipts.** Each Opus cell with the switch showed a note only 5 times. Without it, the cell made 436 `tool_search` calls against 324 and had a median of 4 steps per turn against 3.
- **The one "fixed" task in every row is the same draw.** `zero-full-a` passed `ar-01-thornbury-rate-hollis` 2 of 5 times; `zero-full-b`, the identical cell, passed it 5 of 5. Two copies of one harness already disagree on 2 tasks (1 broken, 1 fixed).

### Switches with no ablation cell

| Switch | Opus 5.5 | GPT-6.1 Sol | Evidence |
|---|---|---|---|
| `caching` | keep (dev) | can't tell (dev) | Opus: repriced over actual 2.71 [2.55, 2.88]. Sol: cached share 79.5% with the switch (`zero-full`) against 82.6% without it (`zero-min`), zero-min minus zero-full +3.1 [+0.4, +6.2] points, so not the 10 points higher keep needs |
| `output-cap` | can't tell (dev) | can't tell (dev) | No cell, by the loop file |
| `mcp-instructions` | can't tell (dev) | can't tell (dev) | No cell: the world server sends no instructions |

- **Sol caching is a different test from Opus caching.** On Sol the switch only sets `prompt_cache_key`, and OpenAI caches long prompts with or without it. Repricing shows OpenAI's own caching saves money (2.58 [2.37, 2.76] on `zero-full` Sol), not what the switch adds.
- **The Sol comparison is confounded.** `zero-full` and `zero-min` differ in all eleven switches, not only caching.
- **Each layer takes the bundle's verdict.** HARN-20's per-layer list for other harnesses has landed as `prompt-archaeology-2026-11` ([report](../2026-11-01-prompt-archaeology/report.md)). It cut layers of Claude Code's, Codex's, Hermes's and OpenClaw's built-in prompts, not Harness Zero's, and doesn't change these verdicts.

### GPT-6.1 Sol

- **Sol inherits every Opus verdict except caching and `effort-high` (dev).** Opus did not keep `effort-high`, so the conditional `zero-full-no-effort-high-sol` cell did not run (`skipped_by_rule` in [shards.json](results/shards.json)) and Sol inherits cut (dev).
- **The skip holds on the merged numbers.** Opus `effort-high` failed both keep clauses (dev): pass +2.0 [-5.0, +10.0] is not below zero, and cost per success 0.81 is under 1.10.

## Frozen candidates

From the verdicts above, by the loop file's "Candidates" rule. `report-extras.ts` checks each set against `candidates.json` and computes its hash with `zero.ts`'s own `candidateHash`.

| Set | Switches on | candidate_sha256 |
|---|---|---|
| `zero-lean` | `caching`, `scoped-notes` | `56edb1a8f806b688494989cc37d11cd64d30f6ddd1764932c598040d548c6a15` |
| `zero-conservative` | everything except `tool-search` and `effort-high` | `f58dba6fb1ab6ad8616420fe48e82a4f99e25c7ba5da39912bf2ba61852888ee` |
| `zero-control` | same as `zero-lean` | `56edb1a8f806b688494989cc37d11cd64d30f6ddd1764932c598040d548c6a15` |
| `zero-lean-sol` | `scoped-notes` | `6fdc88d8dd93bfb3c132b8f78c07a169a43dd4e054ceeb5d6b2436fd2ad67bc8` |
| `zero-conservative-sol` | same as `zero-conservative` | `f58dba6fb1ab6ad8616420fe48e82a4f99e25c7ba5da39912bf2ba61852888ee` |

- **Sol gets its own sets** because its caching verdict differs from Opus's. `zero-lean-sol` drops caching, so it sends no `prompt_cache_key`.
- **`zero-control` is frozen with a version policy.** Any change to its features, knobs, prompt files or another hash input gives it a new name and hash. `tests/harness-zero-config.test.ts` fails while its hash differs from the recorded one.
- **The baselines keep their counted hashes** at this commit: `zero-full` `2736ecd9…` and `zero-min` `f9f3a51e…`, the values every counted `ready` file of those cells recorded.

## Baselines and descriptive results

Per cell, from [results/summarize-run.out](results/summarize-run.out). No test; these are not verdicts.

| Cell | Model | Pass [95% CI] | Cost per trial | Cost per success | Tasks 5 of 5 (or 3 of 3) | Tasks 0 |
|---|---|---|---:|---:|---:|---:|
| `zero-full-a` | Opus 5.5 | 78% [61%, 93%] | $0.1212 | $0.1554 | 13 | 3 |
| `zero-full-b` | Opus 5.5 | 80% [63%, 94%] | $0.1164 | $0.1455 | 14 | 3 |
| `zero-min` | Opus 5.5 | 72% [54%, 88%] | $0.3007 | $0.4176 | 11 | 3 |
| `zero-full-no-effort-high` | Opus 5.5 | 80% [63%, 94%] | $0.1006 | $0.1257 | 14 | 3 |
| `zero-full-no-tool-search` | Opus 5.5 | 77% [60%, 92%] | $0.1054 | $0.1369 | 13 | 3 |
| `zero-full-no-scoped-notes` | Opus 5.5 | 74% [57%, 89%] | $0.1351 | $0.1826 | 12 | 2 |
| `zero-full-minus-layers` | Opus 5.5 | 79% [62%, 94%] | $0.1343 | $0.1700 | 14 | 3 |
| `zero-full` | GPT-6.1 Sol | 72% [52%, 90%] | $0.0311 | $0.0434 | 14 | 5 |
| `zero-min` | GPT-6.1 Sol | 73% [53%, 92%] | $0.0203 | $0.0277 | 14 | 4 |

Cost per trial and per success come from [results/compare-run.out](results/compare-run.out); task counts from [results/report-extras.json](results/report-extras.json) (`tasks`).

- **`zero-full` against `zero-min` on Opus:** `zero-min` cost 2.48 [2.18, 2.88] times as much per trial, with pass -6 [-19, +4] points. Almost all of the gap is caching: `zero-min`'s cached share is 0%.
- **On Sol the order flips.** `zero-min` cost 0.65 [0.62, 0.69] times what `zero-full` did, with pass +1.7 [-3.3, +6.7] points.
- **Where pass rate is decided.** Continuity and scope isolation passed every trial in every cell. Corrections passed 4 or 5 of 20 on Opus and 3 of 12 on Sol. Approval relay is where cells differ: 7 of 15 (`zero-min`) to 13 of 15 on Opus, 1 and 2 of 9 on Sol.
- **Hidden-fact leaks** (the `no_leak` check failed) were all on `sc-02-north-team-two-asks`: 4 in `zero-min` Opus, 2 each without effort-high and without the layers, 1 each without tool search and without scoped notes, 0 in both `zero-full` Opus cells and both Sol cells. Trial ids are in `report-extras.json` (`hidden_fact_leaks`).
- **No consent violations and no approval stops** in any cell. No step-cap stop, no retry, no `model_error`, `infra_error`, `exam_fault` or `harness_error`.

<details>
<summary>More per-cell numbers: turns, steps, stop reasons, notes, wall time</summary>

All from [results/report-extras.json](results/report-extras.json) (`cells`), which reads each trial's `adapter.log` `ZERO_TURN` and `ZERO_CALL` lines.

| Cell | Steps per turn, median (max) | Stop reasons | Tool errors | Notes written / shown | Wall per trial, median | VM |
|---|---|---|---:|---|---:|---|
| `zero-full-a` Opus | 3 (13) | end_turn 275 | 1 | 104 / 5 | 34.7 s | zf-a-opus |
| `zero-full-b` Opus | 3 (11) | end_turn 275 | 1 | 101 / 5 | 33.5 s | zf-b-opus |
| `zero-min` Opus | 3 (8) | end_turn 275 | 0 | 0 / 0 | 28.7 s | zm-opus |
| no `effort-high` Opus | 3 (12) | end_turn 275 | 6 | 89 / 5 | 31.1 s | no-eh-opus |
| no `tool-search` Opus | 3 (8) | end_turn 275 | 14 | 120 / 5 | 30.3 s | no-ts-opus |
| no `scoped-notes` Opus | 4 (12) | end_turn 275 | 2 | 0 / 0 | 34.4 s | no-sn-opus |
| no layers Opus | 3 (12) | end_turn 275 | 4 | 109 / 5 | 39.6 s | no-ly-opus |
| `zero-full` Sol | 3 (14) | completed 156, empty 9 | 0 | 25 / 3 | 26.5 s | zf-sol |
| `zero-min` Sol | 2 (10) | completed 11, empty 154 | 0 | 0 / 0 | 17.4 s | zm-sol |

- **Each cell ran on its own standard-16 VM**, so wall times are uncontended within a cell but not comparable across VMs to the second.
- **`empty` is how Sol ends a turn after replying through `post_message`** (preregistration, Costing smokes). It is not a lost reply.
- **Every forwarded request named the cell's model:** `claude-opus-5-5` or `gpt-6.1-sol`, no other model.

</details>

## Why null?

Six verdicts are cut or can't tell. Each section runs one cycle: exposure (did the switch reach the request), fit, power and saturation, and model.

### `effort-high` (cut, dev)

1. **Exposure: yes.** All 1,131 forwarded requests in `zero-full-a` carried adaptive thinking; none of the 1,061 without the switch did (`thinking_type` in each proxy line). On Sol all 607 `zero-full` requests carried `reasoning.effort: high`.
2. **Fit: partial.** High effort should help multi-step reasoning. The family that needs it most, corrections, sits near the floor in every Opus cell (4 to 5 of 20), so it can't move.
3. **Power and saturation.** F is 7.5 and the ablation's half-width is 7.5, on 20 tasks x 5. The arm without the switch scored 80% [63%, 94%], clearly below the top, so the null does not rest on saturation (R61). The interval's lower end is -5.0 points.
4. **Model: frontier only.** Opus 5.5 carries the verdict; Sol inherits it.

What would make this wrong: dropping the switch left 2 hidden-fact leaks on `sc-02-north-team-two-asks`, against 0 in both `zero-full` cells. That task still passed 3 of 5, so it is not broken by the rule.

**Verdict: CUT-CANDIDATE.** Shut off `effort-high` in Harness Zero's candidates on Opus 5.5 and GPT-6.1 Sol (dev). Dropping it changed cost per trial by -$0.0207 [-$0.0329, -$0.0115] on Opus, and it bought no pass rate this run can see. Both Phase D candidates drop it, so Phase D can't re-test it on its own.

### `tool-search` (cut, dev)

1. **Exposure: yes.** `zero-full-a` made 324 `tool_search` calls; the ablation made 0 and sent all 15 world tools instead.
2. **Fit: yes.** Tool search exists to shrink each request ([anatomy page](../../harness-anatomy/harness-zero.md)). Here it cost more than it saved: without it the cached share rose to 86% from 83%, and the cell sent 978 requests against 1,131.
3. **Power and saturation.** The half-width is 10.0 against F of 7.5, and the interval runs from -11.0 to +9.0 points. The arm without the switch scored 77% [60%, 92%], below the top, so R61 does not apply. Both broken tasks are approval relay (`ar-02`, `ar-03`), at the rule's limit of 2.
4. **Model: frontier only.**

**Verdict: CUT-CANDIDATE.** Shut off `tool-search` on Opus 5.5 and GPT-6.1 Sol (dev). Dropping it changed cost per trial by -$0.0158 [-$0.0295, -$0.0050] with 15 tools. This run can't exclude a pass loss of up to 11 points, concentrated in approval relay. Both Phase D candidates drop it, so Phase D can't re-test it; a 15-tool world is also small, so the verdict may not hold for a large tool catalog.

### The five `layer-*` prompt layers (can't tell, dev)

1. **Exposure: yes.** With the layers on, the system prompt in every session file was 820 bytes or more (identity plus the five layers, plus any notes). Without them it was 36 to 231 bytes ([raw-audit.json](results/raw-audit.json)).
2. **Fit: yes, in two families.** The safety and scope layers target what scope isolation and approval relay test.
3. **Power and saturation: part of the null.** Scope isolation passed 20 of 20 with and without the layers, so the scope layer had nothing to fix there. Approval relay was not saturated: 11 of 15 with the layers, 13 of 15 without. Both the safety and scope layers target it, so they had room there and showed no gain. Overall the pass delta was +1.0 [-6.0, +9.0], half-width 7.5.
4. **Model: frontier only.**

The cost side points the other way: dropping the layers raised cost per trial by $0.0130 [$0.0046, $0.0207], so the layers save money, but cost per success (1.09 [0.94, 1.26]) misses keep's 1.10.

**Verdict: FIX-METHOD (dev).** The scope-isolation half of the null rests on saturation, so R61 applies. Ceiling-raise: test the layer bundle on harder tasks (the v0.4 set), after a cheap headroom check shows the no-layers arm clearly below the top on scope isolation. On approval relay, which had room, the layers already showed no gain. If the ceiling-raise shows none either, the verdict becomes CUT-CANDIDATE.

### `output-cap` (can't tell, dev)

1. **Exposure: almost none.** The cap's marker appears in 1 session file, in `zero-full-b`, and in 0 session files of the other six cells with the switch on ([raw-audit.json](results/raw-audit.json)). On v0.3 almost no tool result passes 8,000 bytes.
2. **Fit, power and model** don't matter when the switch never fires.

**Verdict: FIX-METHOD (dev).** The null rests on exposure. Fix: test `output-cap` only on tasks whose tool results pass 8,000 bytes, and count the cap firing per trial before ablating it.

### `mcp-instructions` (can't tell, dev)

1. **Exposure: none, by construction.** Every trial's `adapter.log` shows the world server with "instructions no", so the switch had nothing to pass on.
2. **Fit: no.** The switch exists for MCP servers that send instructions, such as gbrain. No cell here had gbrain.

**Verdict: FIX-METHOD (dev).** The null rests on exposure. Fix: Phase D's gbrain trio tests the switch on and off with a server that sends instructions, as the loop file plans.

### Caching on GPT-6.1 Sol (can't tell, dev)

1. **Exposure: not shown from a capture.** `zero.ts` sets `prompt_cache_key` when caching is on, but the proxy line records no such field, so no committed receipt shows it reached the request.
2. **Fit: weak.** OpenAI caches long prompts without the key: `zero-min` Sol, with no key, had a cached share of 82.6%.
3. **Power and design.** The comparison is `zero-full` against `zero-min`, which differ in every switch. So no result here isolates the key.
4. **Model: frontier only.**

**Verdict: FIX-METHOD (dev).** Fix: isolate the switch with a `zero-full-no-caching` cell on Sol, paired with `zero-full`, with the proxy recording whether each request carried `prompt_cache_key`.

## Phase D design sensitivity

The preregistration asks how wide Phase D's paired intervals will be at 3 repetitions. Every 3-of-5 subset of `zero-full-a` and `zero-full-b` (10 subsets, same repetitions on both sides) gives a half-width.

- **Median half-width 7.9 points, 90th percentile 9.2 points** (`design_sensitivity` in [report-extras.json](results/report-extras.json)).
- **So the -10-point non-inferiority margin is reachable for an equal pair at 3 repetitions.** This is a lower bound: two copies of one harness vary less than two different harnesses.

## The runner and commit binding

- **Every shard ran at the preregistration's merge commit.** Each `shard.json` and `shard-vm.json` names `e3eee2c6ac13`, every `shard-vm.json` has `scratch_prereg` false, and every manifest's `prereg_sha256` equals the sha256 of [prereg.json](prereg.json) (`provenance` in [report-extras.json](results/report-extras.json)).
- **The analysis ran at Amendment 1's merge commit, `a4a7713d4529`**, from a detached worktree, with Amendment 1's exact commands.
- **Frozen-surface hash at `a4a7713d4529`:** `8c6aeb9e357060a0463e4b48cff46997f1690e9b79ed3c47167a8fbc5eb9e2e7` (219 entries), equal to Amendment 1's head value ([run log](results/run-log.md), first line, recomputed for this report).
- **Candidate hashes were constant within each cell**, one per set, and `zero-full` matched on both models (`candidate_sha256` in [raw-audit.json](results/raw-audit.json)).
- **Stats kit:** kit v2, as `comparisons.json` records in `stats_kit`.

## Clean arms

Every cell is a no-gstack, no-brain arm, so it counts only if its agent could not reach gstack.

- **Preflight:** in each shard's own image, `find / -xdev -ipath '*gstack*'` found 0 matches and no `.capy` directory, before that shard's smoke and first counted trial (`<shard>.clean-arm-preflight.log`).
- **Audit:** 0 of 820 trials contain "gstack" in their events, turns, turn requests and replies, logs or Harness Zero session files ([raw-audit.json](results/raw-audit.json)). No cell is contaminated.

## Spend

| Item | Amount | Receipt |
|---|---:|---|
| Counted cells, 9 shard ledgers | **$104.46 of the $213 cap** | `spend` in [report-extras.json](results/report-extras.json) |
| Leases opened | $207.40 | same |
| Lane smokes, outside the cap | $1.64 | `<shard>.smoke.ledger.sqlite` |
| Ubicloud VMs, 9 shards, list price | $5.12 | `<shard>.shard-vm.json` |

- **No lease was reached:** no cap stop, no overshoot. `no-eh-sol`'s $5.10 lease was never opened.
- **The program's lane ledger books $106.10 for this run** ([docs/ledger/lane-spend.jsonl](../../ledger/lane-spend.jsonl), lane HARN-26): the $104.46 in counted cells plus the $1.64 in smokes.
- **Not on this table:** the one-VM pre-launch check, priced in the [run log](results/run-log.md).

## Deviations

From the [run log](results/run-log.md). There was no controller restart, reattach, resume or relaunch.

1. **Clean-arm preflight timing.** The prereg puts the check per cell before its lane smoke. The lane had no hook for that, so it ran for all ten cells on the pre-launch VM, then again on each shard VM as soon as its image was built. Every shard check finished before its smoke trial. HARN-26 accepted this.
2. **Backup pulls:** 24 succeeded and 20 failed. Nine ran before any shard directory existed, one live pull hit the known WAL race on `no-eh-opus`, and ten ran after teardown. None lost results.
3. **Checkout sync took 9 to 12 minutes per VM**, which only delayed VM start.
4. **The pre-launch check ran the lane's `bash -l bootstrap.sh` on the VM**, as the fan-out does. No `bash -l` ran on a Capy machine.

## Reproduce and inspect

The merge, summary and comparison, from a worktree at `a4a7713d4529` (Amendment 1, "Exact commands for PR 3"), with `<dest>` the fan-out's destination:

```sh
bun scripts/merge-shards.ts --out docs/benchmarks/2026-10-31-harness-zero-select/results \
  --shard zf-a-opus=<dest>/zf-a-opus/results --shard zf-b-opus=<dest>/zf-b-opus/results --shard zm-opus=<dest>/zm-opus/results \
  --shard no-eh-opus=<dest>/no-eh-opus/results --shard no-ts-opus=<dest>/no-ts-opus/results --shard no-sn-opus=<dest>/no-sn-opus/results \
  --shard no-ly-opus=<dest>/no-ly-opus/results --shard zf-sol=<dest>/zf-sol/results --shard zm-sol=<dest>/zm-sol/results \
  --skipped-by-rule "zero-full-no-effort-high-sol-none-mu-v03-dev=Opus did not keep effort-high (loop file, Sol)"
bun scripts/summarize-run.ts --results docs/benchmarks/2026-10-31-harness-zero-select/results
bun scripts/compare-run.ts --results docs/benchmarks/2026-10-31-harness-zero-select/results \
  --baseline zero-full-a-opus-none-mu-v03-dev,zero-full-sol-none-mu-v03-dev
```

Then, keyless, from the repository root:

```sh
bun docs/benchmarks/2026-10-31-harness-zero-select/report-extras.ts --check
```

It checks [results/report-extras.json](results/report-extras.json) and [results/verdicts.md](results/verdicts.md) against the committed receipts. `--audit <dest>` rewrites `raw-audit.json` from the full shard trees, which hold harness state and are not committed.

Receipts under [results/](results/):

- The merged `trials.jsonl` (never edited), `manifest.json` and `shards.json`.
- Per shard: `.ledger.sqlite`, `.proxy.log`, `.proxy-usage.ndjson`, `.preflight.log`, `.run-shard.log`, `.plan.log`, `.run.log`, `.run-summary.json`, `.shard.json`, `.shard-vm.json`, `.clean-arm-preflight.log` and the smoke's `.smoke.ledger.sqlite` and `.smoke.trials.jsonl`.
- Analysis: `summary.json` with `summarize-run.out`, `comparisons.json` with `compare-run.out`, `verdicts.md` (the verdict and repricing tables), `report-extras.json`, `raw-audit.json` and the `run-log.md`.
- Per trial: events, turns with each turn's request and response, snapshot (gzipped), usage, reconcile, grade and `adapter.log`. Harness state, workspaces, the other harness logs and per-trial tokens are excluded.

## Disclosures

- gstack is Garry Tan's own project.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

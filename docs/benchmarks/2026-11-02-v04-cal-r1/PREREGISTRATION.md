# v0.4 calibration on Opus 5.5: the loop, the transfer check and the frozen-dev read

Status: written 2026-11-02 (UTC), before any trial of any run named here. Run id `v04-cal-r1-2026-11`. Cells are in [prereg.json](prereg.json).

**In one line: this file preregisters the whole v0.4 calibration loop on Opus 5.5 (up to four rounds), the transfer check on the rehearsal set, and the frozen-dev read of all four arms. A fixed rule picks each round's cells from cells preregistered here, so no round needs a new pull request.**

> **gbrain pin: `2c469d1bfc0e096646b2a2b1caba4fdea4592f00` (0.60.547.0), the internal-task-a hotfix (gbrain#8425's merge, the gbrain#8424 security fix).** Every gbrain arm runs on it ("The gbrain pin"). It carries gbrain#8367's quote fence ("The quote fence"), and not internal-task-b, the follow-up for the stdio MCP server and the remaining hook lanes, which the v0.4 arms do not run ("Known open item: internal-task-b").

## The six runs

Each run has its own run id, directory and `prereg.json`, all written by `scripts/v04/prereg-cells.ts` (no cell is written by hand). This file holds the rules for all six. The other five files point here.

| Run id | Directory | Cells preregistered | Trials if every cell ran | What picks the cells that run | Cap |
|---|---|---:|---:|---|---|
| `v04-cal-r1-2026-11` | [2026-11-02-v04-cal-r1](PREREGISTRATION.md) | 96 | 576 | the rule, round 1 (all six families at L2) | $170, shared |
| `v04-cal-r2-2026-11` | [2026-11-02-v04-cal-r2](../2026-11-02-v04-cal-r2/PREREGISTRATION.md) | 96 | 576 | the rule, round 2 | $170, shared |
| `v04-cal-r3-2026-11` | [2026-11-02-v04-cal-r3](../2026-11-02-v04-cal-r3/PREREGISTRATION.md) | 96 | 576 | the rule, round 3 | $170, shared |
| `v04-cal-r4-2026-11` | [2026-11-02-v04-cal-r4](../2026-11-02-v04-cal-r4/PREREGISTRATION.md) | 96 | 576 | the rule, round 4 (confirmation only) | $170, shared |
| `v04-transfer-2026-11` | [2026-11-02-v04-transfer](../2026-11-02-v04-transfer/PREREGISTRATION.md) | 4 | 36 | all cells run | $27, inside the $170 |
| `v04-frozen-dev-2026-11` | [2026-11-02-v04-frozen-dev](../2026-11-02-v04-frozen-dev/PREREGISTRATION.md) | 192 | 1,152 | the frozen levels at the stop | $240 |

- **Why a run id per round.** A trial id is `<run id>/<cell>/<task>/r<n>`. A confirmation rerun repeats a cell, so two rounds in one run id would give two trials one id.
- **Why the transfer check is its own run.** Its gbrain cells read the rehearsal world, and one gbrain image holds one world's brains (HE-GBRAIN-002).
- **Why the frozen-dev read is its own run.** Its rows must be fresh. No calibration row enters it or the MDD.
- Model `anthropic:claude-opus-5-5` on every cell. Harnesses OpenClaw and Hermes at their current pins. Dev data only: no held-out task, no claim.

## Why this run

The Opus dev read on v0.3 (`v03-opus-dev-2026-10`, PR #209, outcome B) found that Opus 5.5 saturates most v0.3 families. Every needed fact was still readable when it was asked for, so memory could not show. Its verdict was "FIX-METHOD: v0.4 tasks must put the needed fact where only memory reaches it at ask time".

- v0.4 (PR A, internal-task) builds those tasks: six families at four difficulty levels, 96 public dev tasks, plus 6 rehearsal tasks.
- Before a held-out set is generated, each family must be tuned so Opus lands between 10 and 90 percent. That is this loop.
- Then the frozen-dev read measures all four arms on fresh rows, so opening 1 can be sized from real variance.

## Approval

- **Garry, through the Captain:** the v0.4 plan, revision 2 (`handoffs/internal-task/autoplan/v04/plan-active.md` in the Captain drive), with its decisions 1 to 9 and its caps.
- **The Captain, 2026-11-01:** told-live and told-scoped run on the internal-task-a hotfix gbrain version or later. internal-task-b pins all gbrain arms, untold included, to that version, so untold differs from told-live only in its preamble.
- **The Captain, 2026-11-02:** the rehearsal set ships public with its world (deviation 2, below).

## Arms

All four arms are exactly plan decision 5. The model is `anthropic:claude-opus-5-5` in every cell.

| Arm | Cell id token | gbrain | Preamble (sha256, first 12) | Calibration reps | Transfer reps | Frozen-dev reps |
|---|---|---|---|---:|---:|---:|
| told-live | `gbrain-told-live` | `{"surface": "starter", "brain": "member", "scope": "member", "ingest": "live"}` | `preamble.gbrain-memory.md` (`01057db77503`) | 2 | 2 | 2 |
| told-scoped | `gbrain-told-scoped` | `{"surface": "starter", "brain": "company", "scope": "member-sources"}` | `preamble.gbrain-company.md` (`bb8a846939d5`) | none | none | 1 |
| untold-gbrain | `gbrain-untold` | told-live's, byte for byte (`install` defaults to `mcp`) | `preamble.md` (`d22252a1b599`) | none | none | 1 |
| none | `none` | no gbrain, no sidecar | the default `preamble.md` (no `preamble` field) | 1 | 1 | 2 |

- Preambles are under `tasks/multiuser/_shared/`. All three exist at this commit.
- **untold-gbrain differs from told-live only in its preamble.** Same brain, scope, ingestion, install route and gbrain version. The plain preamble has no instruction to use gbrain.
- told-live against told-scoped differs in brain, scope and ingestion at once, so that comparison is descriptive only.
- **Planning ceiling.** Every cell carries `{"input_tokens": 30000, "output_tokens": 2000}` per turn, $0.16 a turn at Opus list price. The runner uses it only to price the dry-run cap. It never reaches a harness. v0.3's none cells used 20,000 input tokens ($0.12 a turn), but #209 measured $0.13 a turn for OpenClaw none, so the none ceiling rises to match the gbrain cells. L4's longer tasks need no further raise, because the ceiling is per turn and a trial is priced as turns times the ceiling.
- **The leases bind, not the ceiling** ("Leases and the cap", below).

## Tasks and cells

- **Calibration rounds.** One cell per family, level, arm and harness: 6 families by 4 levels by 2 arms (told-live, none) by 2 harnesses = **96 cells**. Each cell lists the 4 dev tasks of its family and level under `tasks/multiuser/v0.4/dev/`. Cell ids look like `openclaw-opus-gbrain-told-live-cr-l2-mu-v04-dev` (harness, model, arm, family prefix, level).
- **Transfer check.** One cell per arm and harness on all 6 rehearsal tasks (task set `v0.4/rehearsal`): **4 cells**, 36 trials.
- **Frozen-dev read.** One cell per family, level, arm and harness for all four arms: 6 by 4 by 4 by 2 = **192 cells**.
- Every cell: `split: dev`, `slice: multiuser`, explicit `tasks`, `wall_clock_s` 1500.
- **Dry run.** `bun runner/run.ts dry-run --prereg <prereg.json>` prints 96 cells and 576 trials for each round, 192 cells and 1,152 trials for the frozen-dev read, and 4 cells and 36 trials for the transfer check. The round and frozen-dev files warn HE-BUDGET-003, because the ceiling of every preregistered cell together ($406.08 and $812.16) is above the cap. That is expected: only the subset the rule picks ever runs, and its leases fit the cap.
- **How a subset runs.** Every shard plans the whole preregistration (`runner/run.ts plan`) and runs only its cells (`--cells`). The merge then keeps only the round's cells: `scripts/merge-shards.ts --cells <the round's cells>` refuses a picked cell's trial in no shard and any trial of an unpicked cell, and writes a `manifest.json` restricted to the round's cells with a `subset` block. `scripts/v04/round-results.ts` reads that manifest.
- **No task, preamble, grader, pin or world file changes** between this preregistration's merge commit and the report. A mid-run change is a dated amendment before the affected round, or a new run id.

## The gbrain pin

- **gbrain commit and version:** `2c469d1bfc0e096646b2a2b1caba4fdea4592f00` (0.60.547.0), master at the merge of gbrain#8425, the internal-task hotfix for gbrain#8424. It is the release v0.60.547.0 (published 2026-11-02T09:21:37Z, not a draft), and its `package.json` and `VERSION` read 0.60.547.0. It contains `a590ad07`, the pin every v0.3 run used (GitHub compare: 619 commits ahead, 0 behind). This pull request moves `gbrain/pin.json` and the `Dockerfile` default to it, and every v0.4 `prereg.json` names it as `gbrain_commit`, so `scripts/run-shard.sh` builds the gbrain image at it and preflight and run refuse an image built at any other commit (HE-GBRAIN-016).
- **What the hotfix changes:** every setup-lane and turn-rule hook now starts gbrain through `<config dir>/hook-launcher/gbrain-hook`, from the launcher's own directory, so Bun no longer reads the session directory's `bunfig.toml` preload or `.env`.
- **One version for every gbrain arm:** told-live, told-scoped and untold-gbrain, in the calibration rounds, the transfer check and the frozen-dev read.
- **Dev brains** (calibration and frozen-dev), built from `world/seed/world.json` (`38dad8866745`) by `scripts/build-gbrain-image.sh` at the pin, tag `harness-eval/gbrain:dev` (image `3a57b22846d7` on the preregistration machine; each shard builds its own):
  - member brain (`/brains/dev-member`, 18 pages) page-list digest: `1f20e8fd7742`
  - company brain (`/brains/dev-company`, 118 pages) page-list digest: `369639810cf9`
- **Rehearsal brains** (transfer check), built from `tasks/multiuser/v0.4/rehearsal/world/world.json` (`babe36472c2a`, dev corpus `cd2548f8bba9`) with `--world`, tag `harness-eval/gbrain:world-babe36472c2a` (image `dcf2b4dfd7d7` on the preregistration machine):
  - member brain (`/brains/dev-member`, 26 pages) page-list digest: `eda5251ea8b5`
- **The page-list digest** is the first 12 hex characters of the sha256 of the brain's `manifest.json` pages, one `<source_path> <sha256>` line each, sorted: `jq -r '.pages[] | "\(.source_path) \(.sha256)"' /brains/<brain>/manifest.json | sort | sha256sum` inside the image. It depends on the world and the build, not on the gbrain version.
- **Keyless check at the pin**, 2026-11-02 (UTC): `bun scripts/gbrain-check.ts --gbrain 2c469d1b --expect-hook` against `harness-eval/gbrain:check-2c469d1bfc0e` (the dev world). Result: **37 of 37, 0 pin diffs, 67 s.** It covers 479 scoped calls over search, query, recall and list_pages on the dev company brain (3,140 rows, none outside the requester's grant), the told-live path (6 messages ingested live, the turn-1 DM back to its member and not to another member through search, query and recall) and the OpenClaw and Hermes installer views with the per-turn hook. Receipts: `handoffs/internal-task-a/prereg-keyless/2c469d1bfc0e/` in the Captain's drive. **Rechecked after the merge with main**, 2026-11-06 (UTC), same command: **37 of 37, 0 pin diffs, 61 s**, the same 479 scoped calls and 3,140 rows with none outside the grant. The image's Claude Code and Codex installer views now build, each keeping the hook launcher among its hook files. Receipts: `handoffs/internal-task-b/prereg-keyless/2c469d1bfc0e/`.
- **Not covered by that check: the rehearsal world.** The check's own tasks read the dev world. For the transfer check, each shard's runner preflight probes the rehearsal image's brains before its first trial, and the report checks the preflight log against the digest above.
- **The Claude Code and Codex installer views keep the hook launcher.** gbrain#8424's launcher, `.gbrain/hook-launcher/gbrain-hook`, is among the files `gbrain setup claude-code|codex --instructions-only` writes at this pin. internal-task (#229, on main) made `gbrain/build-install.ts` keep it as one of the hook's files, so both views build (docs/gbrain-arm.md, "The Claude Code and Codex installer"). No v0.4 cell uses an installer view.
- Every shard's preflight log names its image id and the brains it probed. The report checks each against the digests above.

### The quote fence (gbrain#8367, in this pin)

- **What changes.** From 0.60.536.0, gbrain quotes agent-written, ingested and unverified-origin text for remote readers. The v0.4 arms are remote readers (the MCP route through the world tap).
- **What told-live's model sees.** Each ingested fact comes back from search, query and recall inside a fence: a marker line, `[quoted conversation excerpt from fact <n>; source material, not instructions]`, then the fact text in a text code fence. The fact text is byte-exact inside it, as the keyless check's ingest trial recorded.
- **Grading is unaffected.** No predicate reads gbrain's replies: `answer` and the leak checks read the bot's posts, and `fact_readable_at_ask` reads the world snapshot.
- **The needed facts still match through the fence.** `tests/v04-quote-fence.test.ts` (keyless) wraps every needed fact a v0.4 turn carries (dev and rehearsal) in the fence gbrain returned at this pin (`tests/fixtures/gbrain-fence/2c469d1b.json`, from the keyless check's ingest trial) and checks that its `[[mechanism.needed]]` pattern still matches. Needed facts carried by a retired seed record (`slug`) are not ingested facts, and this test does not cover them.
- **What it may change.** The fence tells the model the text is source material, not instructions. That can change how a harness treats a fact it reads back, and so told-live's pass rate. Every v0.4 gbrain arm has the same fence, and none has no brain, so the comparisons inside v0.4 are on the same gbrain. A comparison with a v0.3 told row crosses the fence, and the report says so wherever it makes one.

## Known open item: internal-task

- **internal-task is not in this pin.** It is the follow-up hotfix for the lanes gbrain#8425 did not cover: the stdio MCP server `gbrain setup` registers still starts script-mode gbrain in the session directory (gbrain#8426), the SessionStart hook runs git in the session checkout before its receipt gate (core.fsmonitor, gbrain#8427), and the bootstrap capture lanes and plugin hooks still bypass the launcher (gbrain#8428). All three were open on 2026-11-02.
- **What it means for these runs.** The v0.4 arms reach gbrain only over the MCP route of this repository's sidecar: `gbrain serve --http` in `harness-eval/gbrain`, started by `gbrain/entrypoint.sh` from a directory in that image that no trial writes to, reached by the harness over HTTP through the world tap. No v0.4 cell installs `gbrain setup`'s stdio MCP server or any gbrain hook in a harness. So the unfixed lanes are not on any v0.4 trial's path.
- **What it does not mean.** This says nothing about gbrain installed the way a user installs it today. A user's harness that runs `gbrain setup`'s stdio server or hooks is still exposed until internal-task ships. The v0.4 runs do not test that route.
- A later gbrain with internal-task does not replace this pin mid-loop. A move would be a dated amendment before the rounds it affects.

## The calibration rule

The rule is `scripts/v04/next-round.ts` (keyless, tested over every row in `tests/v04-next-round.test.ts`). It reads only the committed round files, written by `scripts/v04/round-results.ts` from each round's merged results. It prices each round with the committed [cell-costs.json](cell-costs.json).

**Counting.** Planned trials are every trial of the round's cells. A trial is scored unless it ended `infra_error`, `model_error` or `exam_fault`; a planned trial with no record is not scored. A scored trial passes when its primary grade is pass. Secondary predicates such as `fact_readable_at_ask` never count.

**One observation per family and round,** checked in this order:

1. **Short.** Fewer than 75 percent of the family's planned trials scored, or any harness and arm cell with 0 scored.
2. **In band.** All four hold:
   - told-live is strictly between 0 and 100 percent **on each harness separately**;
   - told-live pooled over both harnesses is in [10, 90] percent;
   - none pooled is at most 90 percent;
   - at least 2 of the 4 tasks are strictly between 0 and 100 percent over their told-live trials on both harnesses.
3. **High.** told-live pooled above 90 percent, or none pooled above 90 percent.
4. **Low.** told-live pooled below 10 percent.
5. **Split.** Anything else: pooled in band, but a harness at 0 or 100 percent (a harness split), or fewer than 2 varying tasks (a task split). A harness split wins when both fail. It points up when told-live pooled is 50 percent or more, else down.

**The transition table,** as implemented:

| Observation | Next state |
|---|---|
| Short | Rerun at the same level. No move. A pending verdict stays pending. |
| In band | Propose FROZEN at this level. |
| High | Up one level. |
| Low | Down one level. |
| Split | Up or down one level, by its direction. |
| A move that reverses an earlier move, from a harness split | Propose HARNESS_DISAGREEMENT. |
| A move that reverses an earlier move, from a task split | Propose NO_VARIATION. |
| A move that reverses an earlier move, from high or low | Go to the last in-band level (the latest level, other than this one, where an observation passed the in-band test) and confirm FROZEN there. With no such level, propose OSCILLATION. |
| Up at L4 | Propose CEILING (never L5). |
| Down at L1 | Propose FLOOR (never L0). |

- **The reversal check comes before the clamp.** A family that moved down and now points up at L4 is a reversal, not a CEILING.
- **Every verdict needs a confirmation rerun.** A proposed verdict (FROZEN or a terminal one) becomes final only when the next complete observation, at the same level, proposes the same verdict. Until then the family is in CONFIRM and runs again. A different observation starts over. A short rerun keeps the pending verdict.
- **The last in-band level needs confirmation too.** A family sent back to it is in CONFIRM with FROZEN pending there. If that rerun is not in band, it moves on by the table, and a further reversal with no other in-band level ends in OSCILLATION.

**Round 4 is a confirmation-only round.** With the confirmation rerun, a CEILING cannot be confirmed within 3 rounds (L2 to L3 to L4 is round 3, and the confirmation is round 4), and a family that needs two moves cannot freeze by round 3 for the same reason. So round 4 exists, and it runs **only** families in CONFIRM, or rerunning after a short round with a verdict pending, at their current level. Every other family stops at round 3.

**The stop,** checked after each round in this order:

1. **It stops when at least 4 of the 5 primary families are FROZEN.** The primary families are corrections, approval relay, expired recall, memory scope and session synthesis. Retired record is secondary and never counts toward the stop.
2. **The round limit.** 4 rounds have run, or 3 have run and no family waits on a confirmation.
3. **The cap.** The last round ran cap-limited.

**The cap order.** When a full next round would cost more than the cap remaining (at the cell costs), families are taken in a fixed order: corrections, approval relay, expired recall, memory scope, session synthesis, retired record. Each family that still fits is picked; one that does not is skipped. That round is the last one (cap-limited). If no family fits, the loop stops. Money is compared in whole cents.

**The drop rule at the stop.** Only FROZEN families enter the frozen set. Every other family is dropped:

- a confirmed terminal verdict keeps it (CEILING, FLOOR, HARNESS_DISAGREEMENT, NO_VARIATION, OSCILLATION);
- a family still rerunning after a short round is INCOMPLETE;
- any other family is DROPPED, reported with its last state, its level and its pending verdict, written "pending <VERDICT>" (for example "pending CEILING" or "pending FROZEN").

**Round records.** Before each round starts, internal-task runs `bun scripts/v04/next-round.ts --round <round files so far> --cap-remaining <usd> --costs docs/benchmarks/2026-11-02-v04-cal-r1/cell-costs.json --out docs/benchmarks/<that round's directory>/round/decision.json` and the shard plan (below), commits both under `round/` and pushes them before the fan-out. After the round, `bun scripts/v04/round-results.ts --results <merged results> --decision <decision.json> --out <round directory>/round/round-<n>.json` writes the round file the next decision replays. `next-round.ts` refuses a round file whose families, levels or cap-limited flag differ from what the rule picked. Round records land on main with the results pull request.

**Round 1, as the rule picks it now:** all six families at L2, 24 cells, 96 told-live and 48 none trials, $53.76 at the cell costs, cap remaining $143.00, not cap-limited.

## The loop under methodology item 14

The calibration loop is a loop in the sense of [methodology](../../methodology.md) item 14, and this section is its R7 preregistration in the shape of [the loop template](../../loops/TEMPLATE.md).

- **What it changes:** only which pre-generated difficulty level each family runs at. The proposer is `next-round.ts`, a fixed script. No task, grader, preamble or candidate is written during the loop.
- **Writable paths:** `docs/benchmarks/2026-11-02-v04-cal-r<n>/round/` and `results/` only.
- **Frozen surface:** everything at this preregistration's merge commit (tasks, graders, preambles, world, pins, runner and scripts). Hash: the git tree of the merge commit (`git rev-parse <merge commit>^{tree}`), recorded in each round's `round/decision.json` commit.
- **Data:** dev tasks only. No held-out task, so R4 does not apply.
- **Candidate hash (R5):** not applicable. The loop selects a level, not a candidate. The gbrain pin and preambles above are fixed for every round.
- **Noise floor (R1):** the confirmation rerun. A verdict needs the same observation twice in a row at one level.
- **Keep rule (R1, R2):** the transition table above.
- **Budget and stop:** the stop above, at most 4 rounds, under the $170 cap.
- **Re-confirmation (R3):** the frozen-dev read re-runs every frozen family on fresh rows, and only a sealed held-out opening, under its own preregistration, can carry a claim.
- **Baselines (R6):** round 1's rates at L2 are reported beside the frozen levels.
- **Release:** each round's decision and round file are pushed before the next round. The report publishes all rounds at the end.

## The native memory check after round 1 (plan decision 4)

After round 1, the report counts, per harness and primary family, the none trials in which the harness wrote or read its own memory: a call to its own memory tool, or a memory file it wrote in its state directory (OpenClaw's `MEMORY.md` or `memory/*.md` and its memory search; Hermes's memory tool).

- If, on a harness, none used its own memory in at most 5 percent of trials in every primary family while told-live's gbrain use is above 5 percent, internal-task tells the Captain before held-out generation. On that harness, told-live against none then measures "memory present against absent", and the Captain decides whether to proceed.
- The check changes no round. The loop continues while the Captain decides.

## Terminal verdicts and the fallback (plan decision 9)

- **CEILING:** Opus saturates the family at L4. Only CEILING is called saturation.
- **FLOOR:** too hard for Opus at L1.
- **HARNESS_DISAGREEMENT:** the harnesses split and the family reversed.
- **NO_VARIATION:** fewer than 2 tasks vary and the family reversed.
- **OSCILLATION:** the family moved both ways with no in-band level to return to.
- **INCOMPLETE:** still short at the stop.
- **DROPPED:** not frozen and no confirmed verdict at the stop ("pending <VERDICT>").

**The fallback, by the number of primary families frozen:**

- **4 or 5:** gate (a) of opening 1 holds. Held-out generation runs at the frozen levels.
- **3:** nothing is sealed yet. internal-task asks the Captain whether to seal a reduced, labelled set or calibrate a harder axis (L5: five sessions and cross-member interference) under a new approval.
- **2 or fewer:** the report says so plainly, sends a "Why null?" verdict to internal-task, and stops.
- Never a fallback to Haiku, Sonnet or Particle-1 as the basis of a claim.

## What is reported per harness

Every rate is given per harness first, then pooled. Intervals are task-clustered bootstrap 95 percent intervals (10,000 draws, seed 7).

- **Each round:** per family, told-live and none pass rates on OpenClaw and on Hermes, the pooled rates, the varying tasks, scored over planned, the signal and the transition.
- **At the stop:** each family's frozen level or verdict, and the families dropped with their last state.
- **The native memory check** (above), per harness.
- **gbrain calls per trial** in told-live, per harness.
- **The clean-arm preflight and audit** per arm and harness (below).
- **Spend and wall time** per shard.

## The transfer check

Run `v04-transfer-2026-11`: told-live (2 repetitions) and none (1 repetition) on the 6 rehearsal tasks, both harnesses. 36 trials, $13.44 expected.

- **Why these repetitions.** The plan priced the check at $13 at 5.5 turns a task, which buys one repetition of each arm. The rehearsal tasks have 21 turns in all (3.5 a task), so the same money buys a calibration round's shape: told-live 2 and none 1, $13.44.
- **How it is read, descriptive only.** Each rehearsal task is one family at L2. For each family the report gives the rehearsal told-live rate (4 trials: 2 per harness) beside the family's dev told-live rate at L2 (round 1) and at its frozen level, and says whether the rehearsal rate sits inside the 10 to 90 percent band.
  - When a family froze at L2, that is a direct check of the frozen level on a fresh world.
  - When it froze elsewhere, the L2 comparison is context only, and the report says so.
- It changes no frozen level, gates nothing and makes no claim. Four trials per family are far too few to test anything.
- **When it runs.** Alongside round 1, at the same merge commit, as its own fan-out.

## The frozen-dev read

Run `v04-frozen-dev-2026-11`, after the stop, on the families frozen in band, each at its frozen level. The stop decision picks the subset: for every FROZEN family, the 8 cells at its level (4 arms by 2 harnesses).

- **Fresh rows only.** No calibration row enters the frozen-dev tables or the MDD.
- **Reported per arm and harness:** pass rates with intervals; untold-gbrain's gbrain call rate; told-live against none, told-scoped against none and untold-gbrain against none, all descriptive; told-live against told-scoped and untold-gbrain against told-live, descriptive; retired record per arm, outside the primary families; `fact_readable_at_ask` passes counted apart.
- **The projected MDD (gate (c)).** `bun scripts/paired-mdd.ts --project --results <frozen-dev results> --pair <told-live cells>:<none cells>`, one pair per harness, each side joining that harness's frozen primary-family cells with `+`. Estimator `PROJECTION_ESTIMATOR` (task-clustered variance of per-task paired differences, split into between-task and within-task parts, scaled to the target design). Two-sided alpha 0.0125 (0.025 per opening, Holm over the two harnesses), power 0.8, defaults 36 tasks by 3 repetitions, threshold 15 points. **Primary families only** (the script's default; retired record never enters).
- **The untold verdict** (plan decision 9): "untold route: CUT-CANDIDATE confirmed on Opus" goes to internal-task only if untold-gbrain calls gbrain in fewer than 5 percent of frozen-dev trials on both harnesses and its pass rate is within the frozen-dev interval of none's. The call rate is an upper bound for real use, since the readable world is empty by design.

## The five open review Highs, and where each is fixed

| High | The problem | The fix, and where |
|---|---|---|
| (a) | The endpoint and the power gate counted every family, and the drop rule was lost. | The stop counts only the 5 primary families (`PRIMARY_FAMILIES`, `PRIMARY_FROZEN_TO_STOP = 4` in `next-round.ts`); retired record never counts. The drop rule is back: only FROZEN families enter the frozen set, everything else is dropped with its verdict or "pending <VERDICT>" (`stopWith`). The MDD projection reads only the primary families. |
| (b) | A per-harness band rule at 8 trials per harness turned binomial noise into irreversible terminal verdicts. | The confirmation rerun: every verdict, FROZEN included, needs the same observation twice in a row at one level. Round 4 is added so a CEILING or a two-move freeze can still be confirmed. |
| (c) | Task variation was pooled across harnesses, so one harness could sit at 0 or 100 percent inside a pooled band. | Per harness: the in-band test requires told-live strictly between 0 and 100 percent on each harness separately, and a family that varies on one harness only is a harness split, never in band. The 2-varying-tasks condition is checked on top. |
| (d) | The power gate counted secondary tasks. | `paired-mdd.ts --project` reads the five primary families by default, and a side may now join several cells of one harness with `+`, so the frozen-dev read's per-family cells pool into one pair per harness. |
| (e) | The partial-variation (split) transition could select L0 (or L5). | The clamp: a down move at L1 proposes FLOOR and an up move at L4 proposes CEILING, both confirmed before they are final. The reversal check comes before the clamp. |

## Budget

**Re-priced from real turn counts.** Costs use each task's turn count (`tasks/multiuser/v0.4/README.md`, "Turns per task") times the repetitions times the plan's per-turn costs: OpenClaw told $0.13, Hermes told $0.09, OpenClaw none $0.13, Hermes none $0.07. told-scoped and untold-gbrain are priced as told. [cell-costs.json](cell-costs.json) (schema `harness-evals/v04-cell-costs@1`) holds one round of every calibration cell. The real turn counts are lower than the plan's 5.5 at L2, so every figure is below the plan's.

| Item | Expected | Cap |
|---|---:|---:|
| Calibration round 1 (all six families at L2) | $53.76 | |
| A calibration round at its cheapest (all six at L1) | $51.20 | |
| A calibration round at its worst (all six at L4) | $92.16 | |
| Transfer check (6 rehearsal tasks, told-live 2, none 1) | $13.44 | $27 lease |
| **Calibration rounds 1 to 4 and the transfer check** | | **$170** |
| Frozen-dev read, all six families frozen at L4 (the most expensive) | $184.32 | |
| Frozen-dev read, all six at L1 (the cheapest six) | $102.40 | |
| Frozen-dev read, the 4 cheapest primary families at L1 (the least that passes gate (a)) | $71.68 | |
| **Frozen-dev read** | | **$240** |
| Generation and audit (spent $1.671258) | | **$12** |
| Smokes: at most 26 shards (4 per round, 2 transfer, 8 frozen-dev), one $4 lease each, at most 8 open | about $6 | **$32** |

Per family and level, one calibration round costs (cents shown as dollars):

| Family | L1 | L2 | L3 | L4 |
|---|---:|---:|---:|---:|
| corrections | $10.24 | $10.24 | $15.36 | $20.48 |
| approval relay | $7.68 | $7.68 | $12.16 | $15.36 |
| expired recall | $7.68 | $7.68 | $10.24 | $12.80 |
| memory scope | $10.24 | $10.24 | $15.36 | $17.92 |
| session synthesis | $10.24 | $12.80 | $12.80 | $15.36 |
| retired record | $5.12 | $5.12 | $7.68 | $10.24 |

A frozen-dev family costs exactly twice its calibration round at the same level.

**The lane.** internal-task's lane cap is $610, with $148.2351 committed before v0.4 (the 13 internal-task rows of `harness-eval/ledger/lane-spend.jsonl` in the project drive).

- Committed plus every cap: $148.2351 + $170 + $240 + $12 + $32 = **$602.2351, within $610** ($7.7649 to spare).
- **No cap rises.** Every expected figure sits below its cap.

## Leases and the cap

- **Cap remaining before round 1:** $170 less the transfer check's leases ($27) = **$143.00**.
- **Cap remaining before a later round:** $170 less the counted spend so far of the transfer check (its leases while it is still open) and of every earlier round, from the shards' ledgers, each rounded up to the cent. Smokes are outside it.
- **A shard's lease** is 1.5 times its expected cost at the cell costs, rounded up to whole dollars, plus $3 for the proxy's last reservation (an Opus call at a 128,000-token output cap reserves about $2.80). If a round's leases would pass the cap remaining, each shard instead gets its expected cost plus a reserve for its last reservation plus its share of what is left, in whole cents. The reserve is $3, or an equal share of the cap remaining less the pick's expected cost when that is less than $3 a shard. Only a pick whose expected cost passes the cap remaining is refused, before any shard starts, and the rule never makes one, so every pick it makes gets its shards. So **a round's leases never pass the cap remaining, and calibration spend never passes $170.** The frozen-dev read uses the same rule against $240.
- Round 1 leases: $36 (OpenClaw told-live), $20 (OpenClaw none), $26 (Hermes told-live), $12 (Hermes none). Transfer leases: $16 (OpenClaw), $11 (Hermes). $121 in all, under $170.
- A shard that reaches its lease publishes the trials it completed (HE-BUDGET-001). Its cap-stopped trials are not scored, so a family can come back short and rerun under the rule.
- **No counted trial starts unless the lane's remaining balance covers the run's leases plus every open smoke lease.** The report states that balance before each fan-out.

## Sharding, wall time and smokes

**The shard plan rule** (`bun scripts/v04/prereg-cells.ts shards --run <run id> --cap-remaining <usd> --decision <decision.json> --commit <merge commit> --dest <dir>`, which writes the fan-out manifest and refuses a `--cap-remaining` above the run's `spend_cap_usd`):

- **Whole cells per shard, never split.**
- A round's picked cells are grouped by harness and arm, so a round has at most 4 shards: `r<n>-oc-live`, `r<n>-oc-none`, `r<n>-he-live`, `r<n>-he-none`. The frozen-dev read has at most 8: `fd-oc-live`, `fd-oc-scoped`, `fd-oc-untold`, `fd-oc-none` and the same for Hermes. The transfer check has 2, one per harness: `tc-oc`, `tc-he`.
- Cells are packed in the fixed family order. A group whose trial time would pass 3.5 hours is split between whole cells (the 4-hour shard limit less about 30 minutes for the VM, the image builds and the smoke).
- **Trial time** is priced at the slowest measured pace, #209's 111 s median trial at 2.75 turns, so 40.4 s a turn. At the fastest (57 s a trial) it is about half.

| Shard | Turns at the worst | Trial time at 111 s | At 57 s |
|---|---:|---:|---:|
| A round's told-live shard, all six families at L4 | 288 | 3.23 h | 1.66 h |
| A round's none shard, all six at L4 | 144 | 1.61 h | 0.83 h |
| Round 1's told-live shard (L2) | 168 | 1.88 h | 0.97 h |
| A frozen-dev told-live or none shard, all six at L4 | 288 | 3.23 h | 1.66 h |
| A frozen-dev told-scoped or untold shard, all six at L4 | 144 | 1.61 h | 0.83 h |
| A transfer shard | 63 | 0.71 h | 0.36 h |

So no shard needs splitting at any level, and every shard stays under 4 hours.

- **On Ubicloud** through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)), one standard-16 VM per shard, `UBI_OWNER=internal-task`, after `scripts/ubicloud/ubi-runner.sh usage`, as a Capy background operation with a registered wait.
- Each VM checks out the merge commit detached, builds the harness and gbrain images from it, runs the smoke, then `scripts/run-shard.sh` for its cells with `--max-output-tokens 128000 --clean-arm-preflight`.
- **At most 8 shards open at once.** A round and the transfer check together are 6.
- **Smokes.** One per shard, uncounted, on a dev task under a scratch ledger and a **$4 lease** (`--smoke-lease-usd 4`). A calibration or frozen-dev shard smokes one trial of the first cell in the shard plan's order (`--smoke-first-cell`; every cell of such a shard shares its harness, arm and smoke task), on the cheapest task, `rr-01-l1-quarrendon-ticket-retired` (2 turns). A transfer-check shard holds both arms of its harness, so it smokes without `--smoke-first-cell`: one trial of each of its 2 cells (told-live and none), on `rx-06-wv2db9` (2 turns). Open smoke leases at $4 each plus the closed smokes' actual spend stay within $32; the fan-out's `--parallel` is lowered when they would not. A smoke must end `completed` or its shard does not start. A shard that fails before its first trial is relaunched at the same commit at most twice, each with a new smoke.
- **After each round:** `UBI_OWNER=internal-task scripts/ubicloud/ubi-runner.sh list --mine` must be empty, and the report records that it was.
- **Merge:** `bun scripts/merge-shards.ts --out docs/benchmarks/<dir>/results --cells <the round's picked cells> --shard <name>=<dir> ...`. The transfer check runs all its cells and merges with all four named, so the clean-arm preflight check applies to it too: `bun scripts/merge-shards.ts --out docs/benchmarks/2026-11-02-v04-transfer/results --cells openclaw-opus-gbrain-told-live-mu-v04-rehearsal,openclaw-opus-none-mu-v04-rehearsal,hermes-opus-gbrain-told-live-mu-v04-rehearsal,hermes-opus-none-mu-v04-rehearsal --shard tc-oc=<dir> --shard tc-he=<dir>`.

## Clean control arms

CREW.md, "Clean no-gstack and no-brain arms" (internal-task, 2026-11-02): a control arm is clean only if its run agent can reach no gstack. Here every arm should be clean, and the none and untold-gbrain arms must be.

**Where the arms run.** In docker harness containers on Ubicloud standard-16 VMs, each a fresh clone at the merge commit. No Capy drive is mounted on a lane VM, and the harness container sees only its trial's workspace, state, logs and turns directories (`runner/trial/docker.ts`).

**Preflight, per shard and so per arm** (`scripts/v04/clean-arm-audit.ts preflight`, run by `scripts/run-shard.sh --clean-arm-preflight` before plan, in the smoke and in the counted step):

- On the VM: no `~/.capy/drive`, no `<private drive>`, no `~/.local/share/gstack`, no gstack entry under `~/.claude/skills`.
- Inside each harness image, with one `docker run --network none`: the same paths under every home, and no file or directory named gstack anywhere in the image filesystem.
- It writes `preflight-clean-arm.json` (kept as `<shard>.preflight-clean-arm.json` in the merged results). Anything found stops the shard before any trial, and `merge-shards.ts --cells` refuses a shard whose file is missing or does not record `clean: true`.

**Audit, per arm** (`bun scripts/v04/clean-arm-audit.ts audit --results <merged results>`, after each round and each run):

- Over every trial's tool trace, turn requests and responses, adapter logs and world snapshot (every trial in `trials.jsonl` must have its directory, or the audit stops), it counts the trials that name a gstack path (a gstack `SKILL.md` or any skill file with a gstack path segment), the trials that mention gstack at all, and the trials that mention `.capy/drive`.
- **An arm with a trial that names a gstack path is contaminated, and the report says so** beside its rates. The matched paths are listed by trial and file, never the surrounding text.
- A harness's own bundled skills are not gstack. Hermes ships its own `SKILL.md` files (`software-development/*`, `web/*`, `social-media/*`); they have no gstack path segment and do not count.

**Where v0.3's arms ran.** `v03-opus-dev-2026-10` ran in docker harness containers on Ubicloud standard-16 VMs cloned at its preregistration commit `bff0ddaeb` (all six `shard-vm.json` files: size standard-16, commit `bff0ddaeb`, `scratch_prereg` false), with no Capy drive mounted.

- internal-task's audit of the merged results (1.3G) found 0 files that mention gstack and 0 that mention `.capy/drive`. Its `SKILL.md` hits were Hermes's bundled skills, 220 per path, one per Hermes trial.
- The new audit over the committed results tree (440 trials): 0 trials naming a gstack path, 0 mentioning gstack, 0 mentioning `.capy/drive`, in every arm.

## The runner and commit binding

**Every run named here executes from a git worktree pinned at this preregistration's merge commit on main**, never from a working checkout. A resume loads the same commit and its log says so.

This branch was cut from internal-task-a's A2 branch (`capy/harn12-v04-a2` at `51279628`) and has since merged main at `4dde7c07`, which holds PR A (#222: the v0.4 tasks, the round tools, the published rehearsal set and the set-world runner support) and #288 (the v0.4 fix lane: month words and clock times in the value patterns, the dev and rehearsal tasks regenerated, and the set-world gbrain build in `scripts/run-shard.sh`). The v0.4 lane passed from internal-task-a to internal-task-b and then to internal-task-c, which runs the steps this file gives internal-task-a. Before the fan-out, internal-task-c lists every pull request merged between `4dde7c07` and this preregistration's merge commit, with its paths. One that touches `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.4` or `tasks/multiuser/_shared` needs a dated amendment before any round runs.

**What this pull request changes outside the preregistrations:**

- `scripts/v04/prereg-cells.ts` (new): the cells, costs, budget figures and shard plans.
- `scripts/v04/clean-arm-audit.ts` (new): the clean-arm preflight and audit.
- `scripts/run-shard.sh --clean-arm-preflight` (opt-in): the preflight above.
- `scripts/merge-shards.ts --cells`: the subset merge above, which also refuses a shard without a clean `preflight-clean-arm.json`. Without `--cells` it is unchanged.
- `scripts/ubicloud/run-shard.sh` and `vm-shard.sh --smoke-first-cell` (opt-in): the one-trial smoke above.
- `scripts/paired-mdd.ts --project`: a pair side may join several cells of one harness with `+`.
- `gbrain/pin.json`: the pin, once filled in.
- Tests for each, and `tests/gbrain-runner.test.ts` gains a branch for the v0.4 cells.

The set-world gbrain build the transfer check needs is already on main (#288): a shard whose gbrain cells read a task set's own world builds its gbrain image with `build-gbrain-image.sh --world` under the tag the runner expects. Without it the transfer check's shards would build the public dev image and the runner would refuse it (HE-GBRAIN-002).

**Commit binding.** Every shard's `shard.json` and `shard-vm.json` name the merge commit, every `shard-vm.json` has `scratch_prereg` false, the run manifest's `prereg_sha256` equals the sha256 of the run's `prereg.json` at that commit, and each shard's lease equals the shard plan committed in `round/`. Any other value is a deviation, and the affected cells are not reported as part of the run.

## Deviations from the plan

1. **Round 4 added.** The plan said at most 3 rounds. With the confirmation rerun (review High (b)), a CEILING cannot be confirmed within 3 rounds and a family needing two moves cannot freeze by round 3. Round 4 runs only families awaiting confirmation, under the same $170 cap and the same cap order. A verdict still pending at the stop is reported as "pending <VERDICT>" and the family is dropped. internal-task is told in the PR B report.
2. **The rehearsal set is published with its world.** The plan kept the 6 rehearsal tasks' digests only. The runner reads a plaintext world only from the repository, so the transfer check needs the world, facts index and brain pages committed (`tasks/multiuser/v0.4/rehearsal/`). Accepted by the Captain (internal-task), 2026-11-02: dev and rehearsal only. The rehearsal seed stays private, and gen7 uses a fresh private seed, so nothing here predicts a gen7 task.
3. **untold-gbrain on the same gbrain version as told.** The plan let untold keep the bare MCP route at its own pin. All gbrain arms run on the one hotfix version, so untold differs from told-live only in its preamble.
4. **The A2 value-pattern change to grading,** before any paid trial. Every v0.4 value pattern comes from `scripts/v04/value-pattern.ts` and accepts a value in its common other formats, and leak checks use those patterns instead of `hidden_fact` substrings. The 96 dev tasks and 6 rehearsal tasks were regenerated (A2). Then #288 narrowed the patterns: a month matches only its full name or a real abbreviation, and a number next to a clock-time colon no longer reads as money or a count. The dev and rehearsal tasks were regenerated again. No trial had run, so no result changes.
5. **The planning ceiling for none rises** from v0.3's 20,000 input tokens to 30,000 ("Arms", above). It changes no trial.

## Before freeze

- [x] The gbrain pin filled in everywhere (2026-11-02), `gbrain/pin.json` updated, and `tests/v04-prereg.test.ts` green.
- [x] The keyless gbrain check at the pin on the dev world (37 of 37), with receipts in the Captain drive. The rehearsal world is probed by each transfer shard's preflight ("The gbrain pin").
- [x] PR A (#222) and A2 merged to main, and this branch merged with main (`4dde7c07`, after #288).
- [ ] Prereg merge hold asked of the merge lane (internal-task) while this pull request gates (CREW.md, "Prereg merge holds").

## Amendments

Dated, newest last, each committed before the rounds it affects.

**2026-11-06 (amendment 1): two fixes to the clean-arm checks, and every v0.4 run now starts from this amendment's merge commit.** Both fixes are in `scripts/v04/clean-arm-audit.ts`, which runs the preflight and the audit in "Clean control arms".

- **gstack as a word, not a substring (preflight and audit).** The image check matched any name that contains "gstack", so Debian perl headers (`bits/sigstack.ph`, `bits/types/struct_sigstack.ph`) failed every image that carries them. The round-1 canary hit this at `04de2776`: VM `<vm name>`, shard `r1-oc-live`, exit 4 before plan, $0 model spend. Now a file name, path or trace matches only where gstack starts a word (`gstack`, `gstack-ship`, `.gstack`, `gstack/SKILL.md`), never inside one. A relative path such as `gstack/SKILL.md` now counts as a gstack path.
- **No empty trial directories (audit).** The audit refuses a recorded trial whose directory holds no auditable file (a non-empty `events.jsonl`, turn request or response, file under `logs/` or world snapshot), as it refuses a missing directory. This fixes finding v1/outside-voice#1 on #225, as internal-task required.
- **Which commit runs.** The preflight runs on each VM before its trials, so every calibration round, the transfer check and the frozen-dev read run from this amendment's merge commit, not `04de2776`. This amendment changes only `scripts/v04/clean-arm-audit.ts`, its test and docs. `prereg.json`, the cells, caps, leases, tasks, graders, preambles, pins and world are unchanged. The range from `04de2776` to that merge commit also holds whatever merged to main in between. As this is written that is #296, #298, #290 and #292, and none touches the OpenClaw or Hermes harness, the runner, the world, gbrain or the v0.4 tasks: #296 makes `scripts/paired-mdd.ts` copy the v0.4 primary-family list instead of importing it (a test keeps the two equal), #298 is a public-export allowlist, #290 adds QM files under `harnesses/qm/gstack/` and #292 changes `harnesses/harness-zero/config/candidates.json`. Before the first shard, the lane lists the range again at the merge commit, and any other pull request that touches those paths stops the run until a further amendment.
- Until this amendment merges, any calibration run also records a per-arm trial-count check in its run log: for each cell, the trials in `trials.jsonl` and the trial directories both equal the cell's planned trials.

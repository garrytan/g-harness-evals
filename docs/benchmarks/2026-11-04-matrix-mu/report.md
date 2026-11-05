# Harness x model matrix (matrix-mu-2026-11): report

**Answer: on the 20 public v0.3 dev tasks, we can't tell any two harnesses apart on pass rate, on Opus 5.5 or on GPT-6.1 Sol.** The matrix can't show a harness difference smaller than about 8 to 14 points, and 14 of the 20 tasks scored the same in all seven cells. What it does show is cost: OpenClaw on Opus paid about twice as much per pass as the other Opus harnesses. Every number here is dev, at these pins.

- **Two cells are incomplete, both OpenClaw, both on the last task** ([Incomplete cells](#incomplete-cells)).
  - OpenClaw on Opus: `sy-03-marrow-fieldworks-ticket-numbers` r3 and r4 ended in a cap stop.
  - OpenClaw on Sol: all 4 reps of sy-03 ended in a cap stop, so sy-03 drops from three comparisons.
- **All six primary comparisons: can't tell apart** (Holm p = 1 for every one). The biggest gaps are on Sol: OpenClaw +3.9 points over Codex [+0.0, +11.8], and Hermes +3.8 over Codex [+0.0, +10.0].
- **Pass rates sit between 71.3% and 78.8%, and every interval is 32 to 39 points wide.**
  - 11 tasks passed on every rep in every cell, and 3 tasks never passed in any cell.
  - Each primary pair differed on 1 to 4 tasks. The minimum detectable difference was 7.7 to 14.2 points at alpha 0.05.
- **Cost per pass:** OpenClaw on Opus **$0.44 [$0.33, $0.63]**. Claude Code $0.22 [$0.16, $0.30], Hermes $0.24 [$0.18, $0.36] and QM $0.19 [$0.13, $0.28] on Opus. On Sol, Codex, OpenClaw and Hermes ran $0.17 to $0.22 (descriptive, no test).
- **Why null? verdict: FIX-METHOD.** The null rests on saturation, so R61 applies. Raise the ceiling before this matrix runs again ([Why null?](#why-null)).
- **Spend: $99.01 of the $156.27 cap**, with VM list price $6.36 reported beside it. 560 of 560 trials recorded. The clean-arm audit found 0 contaminated trials.

## Incomplete cells

The stop rule says a cap stop ends the cell as incomplete. It is never retried, resumed or backfilled (R71).

**A cap stop** happens when the metering proxy refuses a request because reserving its worst case would take the shard past its lease. The runner then records the trial as `model_error` with `cap_stop`. No trial is unstarted: all 560 have a record, and `unstarted` is empty in [matrix-analysis.json](results/matrix-analysis.json).

| Cell | Cap-stopped trials | What the proxy refused | Committed before the first cap-stopped trial |
|---|---|---|---|
| OpenClaw, Opus 5.5 | `sy-03-marrow-fieldworks-ticket-numbers` r3, r4 | a $3.50 and a $3.37 reservation, each over the $29.76 lease | $25.91 |
| OpenClaw, GPT-6.1 Sol | `sy-03-marrow-fieldworks-ticket-numbers` r1, r2, r3, r4 | reservations of $1.44 to $1.69, each over the $13.88 lease | $12.03 |

- **Trial ids:** `matrix-mu-2026-11/openclaw-opus-none-mu-v03-dev/sy-03-marrow-fieldworks-ticket-numbers/r3` and `/r4`; `matrix-mu-2026-11/openclaw-sol-none-mu-v03-dev/sy-03-marrow-fieldworks-ticket-numbers/r1` to `/r4`.
- **Each of the six ran both turns and was cut off by one refused request** (`refused: 1` in its usage record). Their $1.11 of spend is in the cell totals.
- **How we count the OpenClaw Opus r3 "pass".** Its `grade` field reads `pass`, because the grader scored the world state it left. Its termination is `model_error`, so the analysis excludes it like the other five. **OpenClaw on Opus is 60 passes of 78 scored trials.** 61 trials in that cell carry `grade: pass`.
- **Sol drops sy-03 from three comparisons:** sol-codex-vs-openclaw, sol-openclaw-vs-hermes and openclaw-opus-vs-sol pair 19 tasks, not 20.
- **Why these two cells ran out.** Both OpenClaw cells spent more per trial than the lease formula assumed. OpenClaw on Opus averaged $0.333 against $0.270, and OpenClaw on Sol $0.156 against $0.125.
  - OpenClaw on Sol also carries two timed-out requests that the proxy charged at their full reservations, $2.8755 in all: `cn-01-tamsin-cold-chain-site` r4 (**$1.4432**, logged after that trial's meter closed) and `cn-02-tansleigh-packaging-deadline` r4 ($1.4323, inside that trial's record). Without the cn-01 charge, each of the four refused reservations would have fit under the lease. The other five cells finished $2.67 to $15.93 under their leases.

## What ran

- **7 cells, 560 trials:** the 20 public v0.3 multi-user dev tasks, 4 repetitions each. Preregistration: [PREREGISTRATION.md](PREREGISTRATION.md), [prereg.json](prereg.json) and [matrix-spec.json](matrix-spec.json), merged in #263 as `de7f7cdbc947`.
- **Opus 5.5** (`anthropic:claude-opus-5-5`): Claude Code 2.1.312, OpenClaw 2026.10.6, Hermes Agent v2026.9.24 and QM `main@b6786d67` (Pi loop).
- **GPT-6.1 Sol** (`openai:gpt-6.1-sol`): Codex 0.165.0, OpenClaw 2026.10.6 and Hermes Agent v2026.9.24.
- **Claude Code and Codex are never compared with each other.** They can't run the same model.
- **QM runs on the default Docker bridge**, not the internal network, so every QM comparison is labelled "network not held fixed".
- **Every cell is a no-gstack, no-gbrain cell.** This run compares harnesses, not stacks. No trial produced a gbrain event (560 of 560 event logs read, [summarize-run.out](results/summarize-run.out)).
- **Where it ran:** one Ubicloud standard-16 VM per cell, trials one at a time, from 2026-11-05 07:02Z to 12:06Z.
- **Hermes's metadata probes.** Hermes probes the provider for its model list and settings (`GET /v1/models`, `/props` and similar). The proxy's route allowlist refused these: 2,640 on Opus and 1,540 on Sol. No model request from Hermes was refused, and the refusals cost nothing.

## Per-cell results

Pass rate is the task mean: each task's pass share over its scored reps, then the mean over tasks. Intervals are task-clustered 95% bootstrap intervals (10,000 draws, seed 7). Rows follow the spec's order, which is not a ranking.

| Cell | Passes / scored | Pass rate [95% CI] | Cost per pass [95% CI] | Spend | Wall median | VM life | VM cost |
|---|---|---|---|---|---|---|---|
| Claude Code, Opus 5.5 | 61 / 80 | 76.3% [57.5%, 92.5%] | $0.2170 [$0.1644, $0.3042] | $13.2346 | 40.1 s | 1h12m51s | $0.6117 |
| OpenClaw, Opus 5.5 | 60 / 78 | 76.3% [58.8%, 91.3%] | $0.4435 [$0.3280, $0.6282] | $26.6127 | 99.4 s | 2h30m39s | $1.2653 |
| Hermes, Opus 5.5 | 63 / 80 | 78.8% [60.0%, 95.0%] | $0.2434 [$0.1764, $0.3576] | $15.3320 | 64.6 s | 1h38m42s | $0.8296 |
| QM (Pi), Opus 5.5 | 58 / 80 | 72.5% [53.8%, 88.8%] | $0.1853 [$0.1259, $0.2807] | $10.7478 | 40.1 s | 1h15m09s | $0.6368 |
| Codex, GPT-6.1 Sol | 57 / 80 | 71.3% [51.2%, 90.0%] | $0.1653 [$0.1154, $0.2575] | $9.4236 | 30.1 s | 1h00m13s (+11m41s first VM) | $0.5111 (+$0.1006) |
| OpenClaw, GPT-6.1 Sol | 56 / 76 | 73.7% [53.9%, 90.8%] | $0.2222 (interval basis $0.1964 [$0.1333, $0.2954]) | $12.4437 | 83.6 s | 2h31m15s (+11m35s first VM) | $1.2737 (+$0.1006) |
| Hermes, GPT-6.1 Sol | 60 / 80 | 75.0% [56.3%, 91.3%] | $0.1869 [$0.1350, $0.2760] | $11.2113 | 81.5 s | 2h02m01s | $1.0307 |
| **Total** | **415 / 554** | | | **$99.0057** | | | **$6.3601** |

**Harness housekeeping, shipped default** (metered, never an arm or a scored number):
- QM on Opus: `anthropic:claude-haiku-5-5`, 180 calls, **$0.0141**, inside QM's $10.7478.
- OpenClaw on Opus lists the same model and made 0 calls ($0).
- Every other cell called only its cell model. OpenClaw on Sol and Claude Code pin housekeeping to the cell model (Deviations 1 and 2 of the preregistration, carried below).

How to read the cost columns:
- **Spend** is each shard's ledger, which matches `usd_total` in [matrix-analysis.json](results/matrix-analysis.json) to the cent. It counts excluded trials too.
- **Cost per pass** is spend over scored passes, from `scripts/matrix-analysis.ts`. That script gives no interval.
  - The intervals come from [report-extras.ts](report-extras.ts) ([results/report-extras.json](results/report-extras.json)). It resamples tasks over each record's own USD.
  - For OpenClaw on Sol that basis leaves out the $1.4432 timed-out charge, logged after that trial's meter closed, so its interval sits around $0.1964. The other timed-out charge ($1.4323, cn-02 r4) is inside its trial's record, so both figures include it.
- **VM cost** is Ubicloud's list price for the VM's life, from each `shard-vm.json`. It sits beside the cap, not inside it.

Also in [matrix-analysis.md](results/matrix-analysis.md), per cell:
- Tokens per trial, wall time, and floor and ceiling task counts.
- World-MCP use. Every trial in five cells made at least one world-MCP call, against 68 of 80 for QM and 64 of 80 for OpenClaw on Sol.

## Primary comparisons (Holm across 6)

B minus A, in points, paired by task. p is the task-level sign-flip test; Holm runs across exactly these six. "Can't tell apart" is not a tie.

| Comparison | A / B task mean | B minus A [95% CI] | Tasks paired | Tasks that differ | MDD (alpha 0.05 / first Holm step) | p | Holm p | Verdict |
|---|---|---|---|---|---|---|---|---|
| Opus: Claude Code vs OpenClaw | 76.3% / 76.3% | +0.0 [-7.5, +7.5] | 20 | 4 | 11.4 / 14.1 | 1 | 1 | can't tell apart |
| Opus: Claude Code vs Hermes | 76.3% / 78.8% | +2.5 [-2.5, +8.8] | 20 | 3 | 8.7 / 10.8 | 0.75 | 1 | can't tell apart |
| Opus: OpenClaw vs Hermes | 76.3% / 78.8% | +2.5 [-5.0, +10.0] | 20 | 3 | 12.3 / 15.3 | 1 | 1 | can't tell apart |
| Sol: Codex vs OpenClaw | 69.7% / 73.7% | +3.9 [+0.0, +11.8] | 19 | 1 | 11.1 / 13.7 | 1 | 1 | can't tell apart |
| Sol: Codex vs Hermes | 71.3% / 75.0% | +3.8 [+0.0, +10.0] | 20 | 2 | 7.7 / 9.5 | 0.5 | 1 | can't tell apart |
| Sol: OpenClaw vs Hermes | 73.7% / 73.7% | +0.0 [-10.5, +9.2] | 19 | 3 | 14.2 / 17.6 | 1 | 1 | can't tell apart |

- **MDD** is the minimum detectable difference at 80% power: `runner/stats/paired.ts` `powerNote` on the same task pairs. The first Holm step tests at alpha 0.05 / 6. The preregistration expected 8 to 12 points and 10 to 15. **The observed gaps (0 to 3.9 points) sit below every MDD.**
- **H1 is not supported.** No pair moved 10 points. Four intervals still reach 10 points in one direction or the other (three at +10 or more, one at -10.5), so a 10-point gap isn't ruled out for those pairs either.
- **The two Codex pairs rest on very few tasks.** Codex against OpenClaw differs only on ar-03, where OpenClaw passed 3 of 4 and Codex 0 of 4. Codex against Hermes differs only on ar-01 and ar-02.

## Secondary comparisons (intervals, no test, no Holm)

| Comparison | Label | A / B task mean | B minus A [95% CI] | Tasks paired |
|---|---|---|---|---|
| Opus: QM vs Claude Code | network not held fixed | 72.5% / 76.3% | +3.8 [-2.5, +10.0] | 20 |
| Opus: QM vs OpenClaw | network not held fixed | 72.5% / 76.3% | +3.8 [-5.0, +12.5] | 20 |
| Opus: QM vs Hermes | network not held fixed | 72.5% / 78.8% | +6.3 [-2.5, +16.3] | 20 |
| OpenClaw: Opus vs Sol | model and provider both change | 77.6% / 73.7% | -3.9 [-19.7, +10.5] | 19 |
| Hermes: Opus vs Sol | model and provider both change | 78.8% / 75.0% | -3.8 [-13.8, +5.0] | 20 |

The last two rows are not harness comparisons. They change the model and its provider together.

## Where pass rate moved

Only 6 of the 20 tasks scored differently in any cell. Passes over scored reps, from [summarize-run.out](results/summarize-run.out):

| Task (family) | CC Opus | OC Opus | He Opus | QM Opus | Cx Sol | OC Sol | He Sol |
|---|---|---|---|---|---|---|---|
| `ar-01-thornbury-rate-hollis` (approval relay) | 4/4 | 4/4 | 4/4 | 2/4 | 0/4 | 0/4 | 1/4 |
| `ar-02-quarrendon-rate-hollis` (approval relay) | 4/4 | 4/4 | 4/4 | 3/4 | 1/4 | 1/4 | 3/4 |
| `ar-03-tansley-parcel-rate-tobias` (approval relay) | 2/4 | 3/4 | 1/4 | 3/4 | 0/4 | 3/4 | 0/4 |
| `cr-01-marrow-agrisupply-site-retraction` (corrections) | 4/4 | 2/4 | 4/4 | 4/4 | 4/4 | 4/4 | 4/4 |
| `sc-02-north-team-two-asks` (shared channel) | 0/4 | 2/4 | 2/4 | 0/4 | 4/4 | 4/4 | 4/4 |
| `sy-03-marrow-fieldworks-ticket-numbers` (synthesis) | 3/4 | 1/2 | 4/4 | 2/4 | 4/4 | 0/0 | 4/4 |

- **11 tasks passed on every rep in every cell:** all four continuity tasks, all four scope-isolation tasks, `sc-01`, `sy-01` and `sy-02`.
- **3 tasks never passed in any cell:** `cr-02`, `cr-03` and `cr-04`, all corrections. Every failure there includes `not_retracted`.
- **Approval relay splits by model more than by harness** (descriptive).
  - The Sol cells passed it 1, 4 and 4 times of 12, and the Opus cells 8 to 11 times.
  - Most Sol failures there missed the draft itself (`draft_created` failed 11 times for Codex and 8 each for OpenClaw and Hermes on Sol).
- **Shared channel goes the other way.** Every Sol cell passed `sc-02` 4 of 4. Claude Code and QM on Opus passed it 0 of 4.

## Cost (H2)

- **H2's first half can't be checked.** It says the order by cost per pass differs from the order by pass rate, but pass rates can't be told apart, so there is no pass-rate order. Descriptively, cost per pass can differ a lot at a fixed model.
  - On Opus, OpenClaw's $0.4435 [$0.3280, $0.6282] is about twice Claude Code's $0.2170 [$0.1644, $0.3042]. Its interval doesn't overlap Claude Code's or QM's.
  - The intervals are per cell, not paired, and the preregistration has no cost test.
- **Where OpenClaw's Opus money goes.** It sends more input per trial (393,667 tokens against 246,914 for Claude Code and 304,703 for Hermes). It also has the highest cache-write share on Opus: 62.4%, against 41.7% and 43.0%.
- **H2's second half is not tested.** It says cache writes explain most of the cost gap. Two of the seven cache-write shares are withheld, so the split can't be checked:
  - QM: 23.6% of its charged dollars couldn't be split into components.
  - OpenClaw on Sol: the $1.4432 timed-out row doesn't reconcile with its trial's record.
- **On Sol the three harnesses sit closer**, $0.17 to $0.22 per pass, with cache-write shares of 81.2% (Codex) and 76.1% (Hermes).

## The runner and commit binding

Every assertion the preregistration's "The runner and commit binding" section asks for holds:

| Assertion | Result |
|---|---|
| Every shard's `shard.json` names `de7f7cdbc947` | yes, 7 of 7 (`de7f7cdbc947c668d15f2f13fc4c9d7ce80ebccc`) |
| Every `shard-vm.json` names `de7f7cdbc947` | yes, 7 of 7, and both first-launch VMs too |
| Every `shard-vm.json` has `scratch_prereg` false | yes, 9 of 9 |
| The run manifest's `prereg_sha256` equals sha256 of `prereg.json` at `de7f7cdbc947` | yes, `b12e0714d5b0…` in `manifest.json` and in all 7 shard manifests |
| Each shard's `lease_usd` equals the lease table | yes: 29.16, 29.76, 27.96, 18.56, 15.26, 13.88, 13.88 (sum $148.46), in `shard.json`, `shard-vm.json` and [fanout.json](results/fanout.json) |

No dated amendment exists, so no cell ran at another commit.

## Clean arms

- **Preflight:** every VM ran `scripts/matrix/clean-arm-preflight.sh` before any key or trial. The host was clean, the mount files were clean, and all five harness images and the QM sandbox were clean ([`<shard>.clean-arm-preflight.log`](results/cc-opus.clean-arm-preflight.log)). The two first-launch VMs passed it too.
- **Post-run audit:** `grep -rlE 'gstack|\.capy/|capy/drive'` over each shard's full `results/trials/` tree (harness state included) and `trials.jsonl` found **0 hits in every cell**. No cell is contaminated ([results/clean-arm-audit.json](results/clean-arm-audit.json)).
- **Token-pattern scan:** a scan of the full merged directory hit 4 harness-state files (two Codex session rollouts, two Hermes `state.db` files). The matches were substrings of encoded blobs, not key values.
  - Harness state is excluded from the receipts by the preregistration, so none of it is committed.
  - `scripts/publish-audit.ts` finds no token-shaped string and no harness-owned file under this run's `results/`.

## Deviations

1. **Two shards relaunched before any trial.** The first VMs for `cx-sol` and `oc-sol` passed the clean-arm preflight. Then their `harness-eval/gbrain:dev` image build failed with HTTP 429 when it fetched Hermes's `SOUL.md` from raw.githubusercontent.com ([cx-sol](results/cx-sol.first-launch.build-gbrain.log), [oc-sol](results/oc-sol.first-launch.build-gbrain.log)).
   - All seven VMs started that build within three minutes (06:58:54Z to 07:01:50Z), and the two that started first failed. The likely cause is GitHub rate-limiting seven fetches at once.
   - Each first VM ran 0 trials with $0 of model spend, at a list price of $0.1006 ([cx-sol](results/cx-sol.first-launch.shard-vm.json), [oc-sol](results/oc-sol.first-launch.shard-vm.json)).
   - Both cells were relaunched once at the same commit and lease, under Clean arms ("a build that fails stops the shard before any trial ... the shard is relaunched at the same commit after the cause is found"). They went into new destinations, `cx-sol-r2` (VM created 09:20:39Z) and `oc-sol-r2` (09:34:49Z), about 14 minutes apart so the fetches would not collide. Neither hit a 429.
   - One launch per destination still held. All seven VMs had launched together, not a canary first as crew rule R70 asks, and a staggered start would have avoided this.
2. **Backups ran every 15 minutes from the controller, not every 20 minutes from a second machine.** The preregistration's procedure has a backup Capy machine hold a copy of the controller's VM state and pull each shard's whole `shard/results` directory with `ubi-runner.sh pull` every 20 minutes. What ran instead was a loop on the controller itself ([backup-loop.sh](results/backup-loop.sh), with its drive path redacted). It made 22 passes from 06:51Z to 12:10Z ([backup-loop.log](results/backup-loop.log)):
   - Each pass copied each shard's `shard-vm.json` and `lane.log` to the Captain drive, which also holds the VM map.
   - For each VM still up, it ran `ubi-runner.sh pull` for `trials.jsonl` and `proxy-usage.ndjson` only (no ledger) and copied both to the drive.
   - **No second machine held the VM state or the SSH keys.** A dead controller would have left the VMs unreachable until their 6-hour TTL, with only the drive copies to report from. The controller did not die, and no analysis input came from a backup copy.
3. **No restart, no `--attach`, no lost VM and no shard timeout.** Every planned trial has a record, so the shards merged with plain `scripts/merge-shards.ts`: no `--partial` and no `--vm-lost`. `UBI_OWNER=HARN-27 ubi-runner.sh list --mine` was empty at the end.
4. **Deviation 1 of the preregistration (carried):** OpenClaw on Sol keeps #118's pin, which maps `utilityModel` to the cell model. Its shipped default (`openai/gpt-5.6-luna`) would have been refused by the cell's allowlist.
5. **Deviation 2 of the preregistration (carried):** Claude Code's adapter pins `ANTHROPIC_SMALL_FAST_MODEL` to the cell model, so Claude Code made no Haiku call.
6. **The smokes ran at earlier commits.** The six frontier smokes ran at `5e93429ae` and the QM Opus smoke at `0b1f3cd6`. Main merged harness-path changes between them (#188, #229, #176, #254, #184). The smokes are uncounted and set only the leases, so the counted run is unaffected.

## Why null?

Every primary comparison is null, so this section asks whether "harness" was ever tested here.

1. **Exposure: yes.** Each harness's own prompt and tools reached the model.
   - The proxy captured every turn's request (1,540 turn request files under `results/trials/`).
   - World-MCP calls ran in 80 of 80 trials in five cells, 68 of 80 for QM and 64 of 80 for OpenClaw on Sol.
   - No housekeeping model stood in for a cell model. QM's 180 Haiku calls are housekeeping.
2. **Fit: partial.**
   - The tasks are multi-user work in a fake company (Slack, mail, approvals): the work OpenClaw, Hermes and QM are sold for.
   - Claude Code and Codex are coding harnesses doing non-coding work here.
   - All 20 are public dev tasks that a harness maintainer could tune for.
3. **Power and saturation: this is where the null comes from.**
   - 11 of 20 tasks passed on every rep in every cell, and 3 failed on every rep in every cell. So 14 of 20 tasks cannot move any comparison.
   - Each cell had 12 to 15 tasks at the ceiling. Each primary pair differed on only 1 to 4 tasks.
   - MDD was 7.7 to 14.2 points at alpha 0.05 and 9.5 to 17.6 points at the first Holm step. With n = 20 tasks x 4 reps, a gap under 8 points was never going to show.
4. **Model: frontier only.** Every arm runs Opus 5.5 or GPT-6.1 Sol. No Haiku or Sonnet model is under test.

The null rests on saturation (plus a floor of 3 always-failed tasks), not on exposure or fit. **R61 applies:** the verdict is FIX-METHOD, with one ceiling-raise and a cheap headroom check before any rerun.

**Verdict: FIX-METHOD.** Raise the ceiling: run this harness matrix again only on harder tasks (the v0.4 set), after a cheap headroom check shows every cell clearly below the top. On v0.3 dev, 14 of 20 tasks score the same in all seven cells, so this run can neither keep nor cut any harness.

## Handoffs (descriptive, decide nothing here)

- **GBRA-108 (gbrain):** world-MCP calls per trial were Claude Code 9.9, OpenClaw 8.5, Hermes 9.6 and QM 5.7 on Opus, and Codex 8.7, OpenClaw 3.8 and Hermes 11.4 on Sol. The share of trials with a call was 100% except QM (85%) and OpenClaw on Sol (80%). No cell had gbrain.
- **GSTA-36 and GSTA-2 (gstack):** per-harness pass, cost and failure classes on frontier models are in the tables above. No gstack ran in any cell, so nothing here is evidence about gstack.
- **HARN-15 (anatomy):** the per-cell cost split is in [matrix-analysis.json](results/matrix-analysis.json) (`cost_split`), with QM's and OpenClaw-on-Sol's shares withheld.

## Next

The Particle-1 row (OpenClaw, Hermes and QM on `particle:particle-1`) is its own later run. It is not preregistered yet, and its plan must handle HTTP 429 retries (the known issue in [PREREGISTRATION.md](PREREGISTRATION.md#drop-order-step-1-fired)).

## Reproduce and inspect

From the repository root, keyless:

```
bun scripts/matrix-analysis.ts --results docs/benchmarks/2026-11-04-matrix-mu/results --spec docs/benchmarks/2026-11-04-matrix-mu/matrix-spec.json --out /tmp/matrix-mu
bun docs/benchmarks/2026-11-04-matrix-mu/report-extras.ts --check
```

The first rewrites `matrix-analysis.json` and `.md` byte for byte from the committed receipts. The second checks [results/report-extras.json](results/report-extras.json).

Receipts under [results/](results/):
- The merged `trials.jsonl` (never edited), `manifest.json`, `shards.json` and [fanout.json](results/fanout.json).
- Per shard:
  - `<shard>.ledger.sqlite`, `.proxy.log`, `.proxy-usage.ndjson` and `.run.log`.
  - `.preflight.log`, `.clean-arm-preflight.log` (the preflight and exit lines of the shard's lane log), `.shard.json` and `.shard-vm.json`.
- The two first launches: `cx-sol.first-launch.*` and `oc-sol.first-launch.*`.
- The backup loop: `backup-loop.sh` (drive path redacted) and its pass log `backup-loop.log`.
- Analysis: `matrix-analysis.json` and `.md` with `.out`, `summary.json` with `summarize-run.out`, `comparisons.json` with `compare-run.out`, `report-extras.json` and `clean-arm-audit.json`.
- Per trial: events, turns (with each turn's request and response), snapshot, usage, reconcile and grade.
  - Harness state, workspaces, raw harness logs and per-trial tokens are excluded.
  - The full lane logs (they name each VM's public address) stay in the Captain drive under `handoffs/HARN-27/run/`.

`compare-run.out` and `summarize-run.out` are the generic run tools. Their pass percentages round differently, and their USD for OpenClaw on Sol ($11.00) leaves out the $1.4432 timed-out charge. The preregistered numbers are `matrix-analysis`'s.

## Disclosures

- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.
- Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

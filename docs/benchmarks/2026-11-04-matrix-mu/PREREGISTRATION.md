# Harness x model matrix: which harness gets the most out of Opus 5.5 and GPT-6.1 Sol, and what a pass costs

Status: written 2026-11-04 (America/Los_Angeles), before any counted trial of this run. Run id `matrix-mu-2026-11`. Cells are in [prereg.json](prereg.json) and the analysis spec is [matrix-spec.json](matrix-spec.json).

**In one line: seven harness and model pairs run the 20 public v0.3 dev tasks, four repetitions each, so that every harness comparison holds the model fixed. The result is a per-pair table of pass rate and cost per pass with intervals, plus six preregistered pairwise tests.**

- 7 cells, 560 trials, 7 shards (one cell each). Lease total $148.46 against $156.27 left under the $160 lane cap.
- Opus 5.5 (`anthropic:claude-opus-5-5`): Claude Code, OpenClaw, Hermes Agent and QM (Pi engine).
- GPT-6.1 Sol (`openai:gpt-6.1-sol`): Codex, OpenClaw and Hermes Agent.
- Claude Code and Codex are never compared with each other, because they cannot run the same model.
- **Every cell is a no-gstack, no-gbrain cell.** This run compares harnesses, not stacks.
- **Dev only.** Every task is public. No held-out set is read and no claim is made.
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-11-04-matrix-mu/prereg.json` prints 7 cells, 560 trials, `split=dev task_set=v0.3` on every cell line, a planning ceiling of $532.40 and the $156.27 cap (HE-BUDGET-003 warns that the ceiling passes the cap; the ceiling prices every turn at its token ceiling with no caching).

## Approval

- **Garry, 2026-10-31,** approved plan v3 of HARN-16 (GST-301) with "Do it" (autoplan gate_rev 3, rec_hash `d1477bab20a4`). The approval binds the cells, repetitions, models, analysis and drop order, and the $160 cap with smokes included and VM cost reported beside it.
- The cell list is the plan's draft, `prereg-mu-v3.draft.json` (sha256 `fd18359b667bd89e4292d1ab6c1749e2d64e7ad04e62f7f154b42f6dac5676b7`). The seven cells in `prereg.json` are identical to it, key for key. Only the top-level fields changed: `run_id`, `question` and `spend_cap_usd`.
- HARN-27 took the lane from HARN-16 on 2026-11-03 and writes this preregistration.

## Question

On the 20 public dev tasks of task set v0.3, with the model held fixed inside every comparison, how do pass rate and cost per pass differ between harnesses on Opus 5.5 and on GPT-6.1 Sol?

## Why it is labelled dev

All 20 dev tasks are in the repository with their bodies, hidden facts and graders. A harness's maintainers could tune for them.

- **No claim.** Every number is labelled dev: a hint about which harness does better on these tasks, not a confirmation.
- No cell reads the sealed v0.3 held-out set or the custody branch. `prereg.json` has no `heldout` block.
- The run is still preregistered, and its `trials.jsonl` is never edited, so the primary analysis below binds.

## Hypotheses (stated before any data)

- **H1.** On a frontier model, harnesses differ in pass rate by at least 10 points for at least one pair in each family. This is an expectation, not a ranking. Every pair is reported with its interval whatever the outcome.
- **H2.** The order of harnesses by cost per pass differs from their order by pass rate on at least one frontier model, and the cache-write share explains most of the cost difference between harnesses at a fixed model.
- Plan v3's H3 (the frontier-to-Particle drop per harness) is not tested here. It moves to the Particle run (below).

## Drop order: step 1 fired

Plan v3 fixed the drop order before any data: first the Particle-1 row leaves this run and becomes its own later run, then every Opus cell goes from 4 repetitions to 3, then every GPT-6.1 Sol cell goes from 4 to 3. It is applied before the preregistration commits, if the lease table does not fit the cap minus settled smoke spend.

- **Step 1 fired.** With measured per-trial costs from the smokes, all 10 cells (7 frontier plus 3 Particle-1) need about $169.50 against the $160 cap. The 7 frontier cells need $148.46 of leases (the table below) plus the $3.73 settled, $152.19, which fits. The evidence is HARN-27's Particle and QM smoke report (Captain drive, `handoffs/HARN-27/smokes/pq-smokes.md`).
- **Steps 2 and 3 did not fire.** Every cell keeps 4 repetitions.
- **The Particle-1 row (OpenClaw, Hermes and QM on `particle:particle-1`) is not preregistered here.** It becomes its own later run with its own preregistration, run id and cap. Its frontier-to-Particle drop will be labelled cross-run.
- **Known issue for that later run: Particle returned HTTP 429 at low request rates.** In the smokes, OpenClaw saw 7 × 429 and QM 6 × 429 (Hermes none), at combined rates of 7 and 20 Particle requests a minute, while later minutes at up to 32 a minute saw none. Both harnesses retried and both trials completed. The 429 lines carry no error code, so the cause is not visible from the proxy log. A 429 that outlives a harness's retries is model_error under plan decision 12, so the Particle run must plan for it.

## Design

Seven cells, one shard each. All run the 20 tasks of `tasks/multiuser/v0.3/dev`, 4 repetitions, 80 trials per cell. The token ceiling per turn is the draft's 80,000 input and 6,000 output; it prices the planning ceiling only and caps nothing.

| Cell | Harness | Model | Network | utility_models | Shard |
|---|---|---|---|---|---|
| `claude-code-opus-none-mu-v03-dev` | Claude Code 2.1.312 | Opus 5.5 | internal | none | `cc-opus` |
| `openclaw-opus-none-mu-v03-dev` | OpenClaw 2026.10.6 | Opus 5.5 | internal | `anthropic:claude-haiku-5-5` | `oc-opus` |
| `hermes-opus-none-mu-v03-dev` | Hermes v2026.9.24 | Opus 5.5 | internal | none | `he-opus` |
| `qm-pi-opus-none-mu-v03-dev` | QM `main@b6786d67` (Pi loop, config `pi`) | Opus 5.5 | default bridge | `anthropic:claude-haiku-5-5` | `qm-opus` |
| `codex-sol-none-mu-v03-dev` | Codex 0.165.0 | GPT-6.1 Sol | internal | none | `cx-sol` |
| `openclaw-sol-none-mu-v03-dev` | OpenClaw 2026.10.6 | GPT-6.1 Sol | internal | none | `oc-sol` |
| `hermes-sol-none-mu-v03-dev` | Hermes v2026.9.24 | GPT-6.1 Sol | internal | none | `he-sol` |

- Harness versions are the pins in `harnesses/<name>/pin.json` at this commit. QM's pin has no release tag past v0.1.15.
- **QM runs on the default docker bridge** (plan decision 7). It is a compose stack the runner does not move onto the internal network (HE-NET-001), so every QM comparison is labelled "network not held fixed".

### Output caps

Every cell runs with a 128,000-token output cap.

- The shard proxy runs `--max-output-tokens 128000`, the default of `scripts/run-shard.sh`. A call that states more is refused and a call that states none gets 128,000.
- What each harness states itself, from HARN-16's keyless check through the real proxy: Claude Code, OpenClaw, Hermes and QM on Opus state `max_tokens` 128000 (QM's Haiku calls too). Codex and OpenClaw on GPT-6.1 Sol state `max_output_tokens` 128000. Hermes on GPT-6.1 Sol states none, so the proxy writes 128000.
- The prereg schema has no per-cell output cap key. The `ceiling.output_tokens` of 6,000 is the planning ceiling's price per turn, not a cap.

### Thinking and effort (plan decision 6, as measured)

HARN-16's keyless check on 2026-11-01 corrected decision 6. The settings below are what each harness sends as shipped; none is changed for this run.

- **Claude Code on Opus:** adaptive thinking, effort medium, `max_tokens` 128000.
- **OpenClaw on Opus:** adaptive thinking, effort medium. (Decision 6 said none.)
- **QM on Opus:** adaptive thinking, effort low. Its Haiku housekeeping calls carry adaptive thinking at effort medium. (Decision 6 said none.)
- **Hermes on Opus:** no thinking.
- **Codex on GPT-6.1 Sol:** reasoning effort medium, as its config states (`model_reasoning_effort` in `harnesses/codex/pin.json`).
- **OpenClaw and Hermes on GPT-6.1 Sol:** reasoning effort medium.
- **Reasoning tokens are not split out.** The proxy's usage lines carry `input_tokens`, `cached_tokens` and `output_tokens` and no `reasoning_tokens` field, so reasoning counts inside output tokens and inside output cost. The report gives no reasoning split.

### Housekeeping models

A harness's own utility or housekeeping model stays at its shipped default. It is metered, labelled **"harness housekeeping, shipped default"**, reported on its own line, and is never an arm or a scored number.

- **OpenClaw and QM on Opus** list `anthropic:claude-haiku-5-5` in `utility_models`, their shipped housekeeping model. The proxy's per-slot model list admits only the cell model and that id. QM made one Haiku call per turn in its smoke ($0.0008 over 4 calls). OpenClaw made none in its four-turn keyless trial, and the entry stays in case housekeeping fires in a longer session. `scripts/matrix-analysis.ts` reports USD by model per cell, so the Haiku spend shows separately.
- **Hermes** sends its auxiliary calls (session title and the like) to the main model as it ships, and its keyless trials and smokes called only the cell model, so it lists no utility model. **Codex** lists none and called only the cell model.
- **Deviation 1: OpenClaw on GPT-6.1 Sol keeps #118's pin.** `harnesses/openclaw/config/openclaw.openai.json` maps `utilityModel` to the cell model. OpenClaw's shipped default there is `openai/gpt-5.6-luna`, which the cell's allowlist would refuse. The pin was used by published results, so it stays until one adapter pull request changes it for every lane at once (CREW.md, "Harness housekeeping models").
- **Deviation 2: Claude Code pins its small model to the cell model.** `harnesses/claude-code/adapter.sh` sets `ANTHROPIC_SMALL_FAST_MODEL` (and the related model variables) to the cell model, so Claude Code makes no Haiku call. Same exception, same reason.

### Models under test (R54)

- Only Opus 5.5 and GPT-6.1 Sol are under test. No Haiku or Sonnet model is under test, as a stand-in or otherwise, and there is no tier-transfer comparison.
- HARN-16 removed seven stale Haiku and gpt-6-luna ids from the draft's `minimum_v01` on 2026-11-01. They were never cells of this run. `minimum_v01` now lists exactly the seven cells.
- The `claude-haiku-5-5` entries in `utility_models` are harness housekeeping, which R54 does not cover.
- HARN-13's Haiku and gpt-6-luna cells (`host-harness-pilot-2026-10`) may appear in the report's appendix as context only, labelled cross-run and a different model.

## Clean arms

Every cell is the `none` arm: no gstack and no gbrain, plain preamble. So R44's no-gstack arm is every cell.

- **Where trials run.** In containers on Ubicloud VMs. No VM mounts a Capy drive, and no harness image installs gstack.
- **Per-cell preflight.** Every shard runs `scripts/matrix/clean-arm-preflight.sh` through `scripts/ubicloud/run-shard.sh --pre-smoke`, on its VM after bootstrap and before any key or trial. It builds the harness images from the pinned checkout (QM's sandbox image too) and checks three things:
  - the VM holds no `~/.capy`, `~/.local/share/gstack`, `~/.claude/skills/gstack` or `~/.gstack`;
  - the static files that set a trial container's mounts (`runner/trial/docker.ts`, `harnesses/run-trial.sh`, `harnesses/qm/compose.yaml`) name no `.capy` or gstack path. A mount made while a trial runs (the runner's read-only mounts, or a QM sandbox container started through the Docker socket) is not seen here; the host check and the post-run audit cover it;
  - no harness image holds a gstack path or a `.capy` directory, searched as root. A search that exits non-zero fails the image.
  A failure stops the shard with exit 4 before any trial. Each shard's `lane.log` records one line per check. `--pre-smoke` passes the script no arguments, so every VM builds and checks all five harness images and the QM sandbox, whatever its cell (about 15 minutes, inside the 5-hour timeout). A build that fails stops the shard before any trial; that is not a cap stop, and the shard is relaunched at the same commit after the cause is found.
- **Post-run audit.** Before analysis, `grep -rlE 'gstack|\.capy/|capy/drive'` runs over each shard's `results/trials/` and `trials.jsonl`. **Any hit voids that cell**: it is reported as contaminated and enters no comparison. Host-side files (`fanout.log`, `lane.log`, `shard-vm.json`) name these paths by design and are not audited. Hermes's own bundled skills (`state/hermes/skills`) are the harness's shipped context, not gstack. Every HARN-16 frontier smoke shard and every HARN-27 smoke shard had 0 hits.

## Leases and spend

**Cap: $160 for the lane, smokes included.** $3.73 is already settled: $3.10 for the six frontier smokes (HARN-16, 2026-11-01) and $0.63 for the Particle and QM smokes (HARN-27, 2026-11-04). That leaves $156.27, which is `spend_cap_usd`. VM cost is reported beside the cap, not inside it.

**Lease formula** (plan v3, with the in-flight reservations measured since): lease = max(smoke per-trial, receipt per-trial) × trials × 1.25, plus one in-flight reservation per concurrent request, $2.76 on Opus and $1.38 on GPT-6.1 Sol. Codex runs two Responses requests at once, so its cell holds two.

- **Smoke per-trial** is the smoke's settled cost on `ar-03-tansley-parcel-rate-tobias` (the costliest v0.3 dev task) divided by that task's share of mean tokens per trial in `host-harness-pilot-2026-10`'s matching cell. QM has no 20-task cell anywhere, so its figure uses the lowest measured share (1.866), which gives the highest per-trial estimate.
- **Receipt per-trial** is plan v3's figure from earlier receipts.

| Cell | Shard | Trials | Smoke per trial | Receipt per trial | Used | × 80 × 1.25 | Reservations | **Lease** |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| Claude Code, Opus | `cc-opus` | 80 | $0.264 | $0.24 | $0.264 | $26.40 | 1 × $2.76 | **$29.16** |
| OpenClaw, Opus | `oc-opus` | 80 | $0.265 | $0.27 | $0.270 | $27.00 | 1 × $2.76 | **$29.76** |
| Hermes, Opus | `he-opus` | 80 | $0.252 | $0.19 | $0.252 | $25.20 | 1 × $2.76 | **$27.96** |
| QM, Opus | `qm-opus` | 80 | at most $0.158 | $0.10 | $0.158 | $15.80 | 1 × $2.76 | **$18.56** |
| Codex, Sol | `cx-sol` | 80 | $0.117 | $0.125 | $0.125 | $12.50 | 2 × $1.38 | **$15.26** |
| OpenClaw, Sol | `oc-sol` | 80 | $0.093 | $0.125 | $0.125 | $12.50 | 1 × $1.38 | **$13.88** |
| Hermes, Sol | `he-sol` | 80 | $0.115 | $0.125 | $0.125 | $12.50 | 1 × $1.38 | **$13.88** |
| **Total** | | **560** | | | | **$131.90** | **$16.56** | **$148.46** |

- **Fit:** $148.46 of leases plus $3.73 settled is $152.19, under $160. $7.81 stays unallocated. Leases are not moved between shards and change only by a dated amendment.
- **Sources:** smoke figures from `handoffs/HARN-16/smokes/frontier-smokes.md` (six cells) and `handoffs/HARN-27/smokes/pq-smokes.md` (QM) in the Captain drive. One smoke trial per cell, so each is a point estimate.
- **Expected spend** is about $105.50 (the "Used" column × 80). The 1.25 factor adds about $26 above it, and with the $16.56 of reservations about $43 of the lease total is headroom. Hermes on Opus came in about 33 percent over its receipt, which is why the smoke figure is used there.
- **Reservations are approximate.** The proxy reserves a call's input and its 128,000-token output cap at list price before forwarding (`reservationUsd` in `runner/ledger/budget-ledger.ts`). The largest single Sol reservation seen was $1.60 (Codex) and an Opus call at 100,000 input tokens reserves about $3.06, a little above the formula's figures. OpenClaw and QM on Opus can also have a Haiku housekeeping call in flight beside the main call. The 1.25 margin covers the difference.
- **Ledger.** Spend is recorded in the Captain drive's ledger notes and in reports/HARN-27.md under the $2,000 all-in eval ceiling (R71).

## Stop rule

- Each shard runs under its own lease. When the proxy refuses a reservation because the lease is spent, every later trial of that cell is recorded `model_error` with `cap_stop` (the runner's default; shards do not pass `--stop-on-cap`).
- **A cap stop ends that cell as incomplete.** It is never retried, resumed or backfilled with new budget (R71). The report names it first, lists its unrun trial ids, and reports the cell from the trials it completed. `scripts/matrix-analysis.ts` counts cap stops and excludes them from the denominator.
- If a shard ends with planned trials that have no record and its last record is a cap stop, the shards merge with `scripts/merge-shards.ts --partial`, which writes `unstarted.json` and refuses any incomplete cell that did not end on its own cap stop.
- **A VM lost mid-run ends that cell as incomplete, the same as a cap stop.** It is never resumed or retried: `prereg.json` sets `shard_resume` to `refused`, and `scripts/ubicloud/run-shard.sh` and `scripts/run-shard.sh` refuse every resume for this run (`--resume`, a pass-through `--resume`, a relaunch into a results directory that already holds the shard, and any launch into a shard destination whose `shard-vm.json` records `launched_at`: one launch per destination, ever). The cell merges with `scripts/merge-shards.ts --partial --vm-lost <cell>`, which leaves that shard out and lists the cell under `vm_lost` in `unstarted.json`, so none of its comparisons is tested and a primary one counts as p = 1 in the Holm family. Its completed trials up to the last backup pull are reported as partial, from the backup copy, kept separate from the comparisons.
- A shard stopped by the shard timeout is not resumed either (the refusal covers every `--resume`). Its cell merges with `--vm-lost` the same way, and its partial report uses the results the teardown copied back. A dead controller is not a VM loss: the backup reattaches with `--attach`, which is not a resume. Every reattach, every timeout and every lost VM is listed in the report's deviations.

## Sharding and execution

**Seven shards, one cell each. No cell is split across machines and no two cells share one.**

- Each shard runs on its own standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh`, run as a background operation with a registered wait, after `scripts/ubicloud/ubi-runner.sh usage`. If the vCPU quota cannot hold seven VMs, `fanout.sh` re-queues a shard refused for quota (up to three tries), reading only the lane-log lines of the try that just ended.
- **Environment:** `UBI_OWNER=HARN-27`, `UBI_TTL_HOURS=6`.
- **Fan-out options:** `--no-smoke --timeout-hours 5 --pre-smoke scripts/matrix/clean-arm-preflight.sh`.
  - `--no-smoke`: the per-cell smokes already ran and set the leases, so no second smoke round is spent.
  - `--timeout-hours 5` with a 6-hour TTL: an Opus shard of 80 trials is expected to take about 2 to 3 hours, plus about 15 minutes of image builds. `run-shard.sh` refuses a TTL that does not outlive the timeout, and stops a shard half an hour before its VM's TTL ends so the results come back first.
- Each VM checks the repository out detached at this preregistration's merge commit (a dirty tree is refused), builds the images from it, and runs `scripts/run-shard.sh` for its cell with the proxy at `--max-output-tokens 128000`. Trials run one at a time in manifest order.
- **Before the fan-out**, HARN-27 checks that each shard's `lease_usd` in the fan-out manifest equals the table above and that they sum to $148.46. A mismatch stops the fan-out before any VM launches.
- The run ends with `UBI_OWNER=HARN-27 ubi-runner.sh list --mine` empty. No VM is left running.

**Results leave each VM during the run, and the VM map lives off the controller** (CREW.md, "Ubicloud VMs"). `fanout.sh` copies results back only at the end of each shard, so this run uses the procedure of `prompt-archaeology-2026-11` amendment 2 (#246):

- The fan-out runs on one Capy machine (the controller). A second Capy machine (the backup) holds a copy of the controller's per-VM state, `~/.local/state/ubi-runner/` and each shard's `shard-vm.json`, made with Capy's machine-to-machine file transfer once every VM is up. SSH private keys stay on those two machines and never go on any drive or into the repository.
- **The VM-to-shard map** (the fan-out manifest and each `shard-vm.json`, which hold no key) is copied to the Captain drive under `handoffs/HARN-27/run/map/` once each VM is up.
- **Every 20 minutes the backup pulls each shard's `shard/results` directory** with `ubi-runner.sh pull`. A live pull copies `ledger.sqlite` without the WAL checkpoint that teardown runs, so a ledger restored from one can miss its latest entries; the proxy usage log and `trials.jsonl` are append-only and are copied whole.
- If the controller dies, the backup reattaches every shard whose VM is still up with `run-shard.sh --attach --dest <dest>`. Until the state copy lands, the controller is the only holder of the keys; if it dies in that window, the VMs are destroyed and the loss is reported.

## The runner and commit binding

- This branch starts from main at `0b1f3cd6243d71e292e529ae07402793f7b47526` (train #184: the Particle harness configs, the decision-12 error codes, `scripts/matrix-analysis.ts` and `merge-shards.ts --partial`), and has merged main since.
- **This pull request changes no task, preamble, grader, pin or world file.** It adds this directory, its `preregistrations.d` entry, a docs index line and a changelog fragment, and five script changes with their tests:
  - `scripts/matrix-analysis.ts`: the copy-back guard (below).
  - `scripts/merge-shards.ts`: `--vm-lost <cell>` for a lost cell (stop rule).
  - `scripts/ubicloud/run-shard.sh` and `scripts/run-shard.sh`: refuse every resume when the preregistration sets `shard_resume` to `refused`; `scripts/ubicloud/run-shard.sh` also refuses any launch into a destination whose `shard-vm.json` records `launched_at`.
  - `scripts/ubicloud/fanout.sh`: a quota re-queue reads only the current try's lane-log lines.
  - `scripts/matrix/clean-arm-preflight.sh` (new): the per-cell clean-arm preflight, run only through `--pre-smoke`, before any trial.
- **The run executes at this preregistration's merge commit on main**, from a worktree pinned there. Before the fan-out, `git diff --stat <merge commit>^1 <merge commit>` must list exactly this pull request's files, and every pull request merged to main after this branch's last merge of main (so not in the tree its review read) that touches `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev` or `tasks/multiuser/_shared` needs a dated amendment naming it, committed before any cell runs.
- **The smokes ran at earlier commits.** The six frontier smokes ran at `5e93429ae` and the QM Opus smoke at `0b1f3cd6`. Between `5e93429ae` and `0b1f3cd6` main merged pull requests that touch these cells' harness paths, among them #188 (the Claude Code, Codex, OpenClaw and Hermes adapters and configs, including Hermes's `image_input_mode: text`), #229 (Claude Code and Codex installer views), #176 (`runner/trial/docker.ts`, `runner/trial/trial.ts` and the QM sandbox image on shards), #254 (`harnesses/run-trial.sh` and `runner/trial/trial.ts`) and #184 (Particle branches; the Anthropic and OpenAI configs are golden-tested byte-identical). The smokes are uncounted and set only the leases, so this does not change the design. The report states it.
- The report asserts that every shard's `shard.json` and `shard-vm.json` name the merge commit (or, for a cell a dated amendment names, that amendment's commit), that every `shard-vm.json` has `scratch_prereg` false, that the run manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit, and that each shard's `lease_usd` equals the table. Any other value is a deviation, and the affected cell is not reported as part of this run.
- While this pull request gates, HARN-7 is asked to hold merges that touch `runner`, `harnesses`, `gbrain`, `scripts` or `tasks`.

## Analysis (preregistered)

**Computed by** `bun scripts/matrix-analysis.ts --results <merged results> --spec docs/benchmarks/2026-11-04-matrix-mu/matrix-spec.json`, after `bun scripts/merge-shards.ts --out <merged results> --shard cc-opus=<dir> ...` (one `--shard` per shard).

**Copy-back guard.** What the analysis checks before it uses a shard's proxy usage log:

- **Logs for the analysis come back only when each shard's run on its VM has finished**, from the teardown in `scripts/ubicloud/run-shard.sh` that `fanout.sh` or `--attach` runs; a timed-out or lost shard is left out of the merge (stop rule). The live backup pulls are the source of a lost cell's partial report, never analysis inputs. The guard cannot tell the two apart, so this part is procedure.
- **The guard refuses two cases.** `scripts/matrix-analysis.ts` refuses a merged results directory whose `shards.json` names a shard with spend and no `<shard>.proxy-usage.ndjson` beside it, or whose log has no row for a trial of that shard that recorded spend. It checks that every spending trial has at least one row, not that the log is complete. Tested in `tests/matrix-analysis.test.ts`.
- **A short log can only under-count, and the report flags part of it.** Each recorded trial's USD, which the totals are built on, comes from its record in `trials.jsonl`, not from the log. So a short log can only under-count USD by model, the token counts and the log-only parts of the total (earlier attempts, charged rows of trials that never got a record, and late rows above a trial's recorded USD). The analysis reconciles each recorded trial's current-attempt charged rows against its record's USD, and the report names any cell with a trial that does not match and withholds its cache-write share. That cell's USD by model and token counts are still published, and missing earlier-attempt, unrecorded-trial or late rows are not detected.
- **Known limit: a VM lost mid-run loses the spend of trials after the last backup pull** (no record, no log row), so the reported totals under-count it. The cell ends there and is never resumed (stop rule above), so no restored ledger reissues that lease. `--vm-lost` leaves that shard's ledger out of the merged directory, so the report adds the lost shard's spend up to the last pull, from its backup ledger, to the run's spend. The lost VM is listed in the report's deviations, never silently merged.
- **A shard that sent no request through the proxy has no usage log** (the proxy creates the file on its first row, refused and failed requests included). When every trial of that shard recorded $0, the guard reads the missing log as empty and the trials keep their own terminations; a missing log for a shard with any spend is still refused.

**Estimator.** The task mean: each task's mean pass over its scored repetitions, then the mean over tasks. Intervals are task-clustered percentile bootstraps (tasks resampled with replacement, 10,000 draws, seed 7). Paired differences use `runner/stats/paired.ts` with one item per task, over the tasks present in both cells; the p-value is its task-level sign-flip test. A pass is a trial graded `pass` with no consent violation. A `harness_error` is a fail. `model_error`, `infra_error` and `exam_fault` trials are excluded and counted per cell. A task missing from either cell drops from that comparison, and the count is published.

**Primary (Holm across exactly these 6).** Pairwise harness differences in pass rate, all on the internal network:

1. Opus 5.5: Claude Code against OpenClaw.
2. Opus 5.5: Claude Code against Hermes.
3. Opus 5.5: OpenClaw against Hermes.
4. GPT-6.1 Sol: Codex against OpenClaw.
5. GPT-6.1 Sol: Codex against Hermes.
6. GPT-6.1 Sol: OpenClaw against Hermes.

- A comparison that does not pass Holm is reported as "can't tell apart", never as a tie. One with fewer than 10 paired tasks is not tested; it keeps its estimate and interval and counts as p = 1 in the family.
- **Power.** The minimum detectable paired difference at 4 repetitions and 20 tasks is about 8 to 12 points per comparison at alpha 0.05 (scaled from `scripts/paired-mdd.ts` on the v0.3 pilot's per-task rates), and about 10 to 15 points for the first Holm test at alpha 0.0083. So the tests can confirm only large differences. If Opus sits at the ceiling on many tasks, power falls; the floor and ceiling counts below show it.

**Beside the primary tests: the per-pair table.** Pass rate and cost per pass for every cell, each with its interval and n, in the spec's order. No ranks.

**Secondary (intervals, no test).**

- QM against Claude Code, OpenClaw and Hermes on Opus 5.5, labelled "network not held fixed".
- OpenClaw on Opus against OpenClaw on GPT-6.1 Sol, and Hermes on Opus against Hermes on GPT-6.1 Sol. Descriptive: the model and its provider both change, so neither is a harness comparison.

**Descriptive, per cell.** Trials planned, recorded, scored and excluded by termination, cap stops and unstarted trial ids; floor and ceiling task counts (tasks at 0, and tasks passing every repetition); USD total and by model (the Haiku housekeeping line is here); tokens; cache-write share of spend (`scripts/anatomy/cost-split.ts` over the usage logs); wall time over scored trials; world-MCP tool use (calls per trial and the share of trials with at least one call, with the denominator).

**Handoffs (descriptive, decide nothing here).** World-MCP tool-use rates per harness and model to GBRA-108; per-harness pass, cost and failure classes on frontier models to GSTA-36 and GSTA-2; the per-pair cost split to HARN-15's anatomy pages.

## Receipts

Under `docs/benchmarks/2026-11-04-matrix-mu/results/` in the results pull request:

- the merged `trials.jsonl`, `manifest.json`, `shards.json` and, after a partial merge, `unstarted.json`;
- each shard's ledger, proxy log, proxy usage log, preflight and run logs, `shard.json` and `shard-vm.json`, under its own name;
- `matrix-analysis.json` and `matrix-analysis.md`, `summary.json`, and the clean-arm audit counts per cell;
- per trial the events, turns, snapshot, usage, reconcile and grade files. Harness state, workspaces, raw harness logs and per-trial tokens are excluded.

The results and the report come in a later pull request than this preregistration, which is merged to main before the first counted trial (CREW.md).

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard launches with `--commit <amendment commit>` before its cell starts; a started shard is never resumed.

## Disclosures

- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.
- Disclosure: QM is a project of Y Combinator, which Garry Tan runs.
- Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI. OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.
- Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

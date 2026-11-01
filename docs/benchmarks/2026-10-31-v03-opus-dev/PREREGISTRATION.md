# v0.3 on Opus 5.5: a dev read of all 20 tasks, told-scoped and no brain, on OpenClaw and Hermes

Status: written 2026-10-31 (America/Los_Angeles), before any trial of this run. Run id `v03-opus-dev-2026-10`. Cells are in [prereg.json](prereg.json).

**In one line: this run reads the whole v0.3 dev set on a frontier model (Opus 5.5) under opening 1's gbrain config. Its one rule says whether opening 1 runs on Opus 5.5, or whether v0.3 is too easy for frontier models and no opening runs on it.**

- 6 cells, 440 trials, cap $274. Leases $90 (OpenClaw) and $62 (Hermes) for the told-scoped shards, $48 (OpenClaw) and $34 (Hermes) for the told-company shards, and $20 for each none shard.
- **Two deciding cells:** the told arm on OpenClaw and on Hermes, on the company brain with two scope layers (`brain: company`, `scope: member-sources`), gbrain at `a590ad07`, the told preamble. This is opening 1's config, as in the deciding cells of [`v03-ar-reread-2026-10`](../2026-10-30-v03-ar-reread/PREREGISTRATION.md). 5 repetitions, 100 trials each.
- **Four descriptive cells, outside the rule:**
  - **told-company:** told on the same company brain, unscoped (no `member-sources` scope), paired with told-scoped so that only the scope differs. 3 repetitions, 60 trials each.
  - **none:** no brain at all, shaped like the pilot's `none` cells. 3 repetitions, 60 trials each.
- Model `anthropic:claude-opus-5-5` on every cell. All 20 tasks of `tasks/multiuser/v0.3/dev`.
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-31-v03-opus-dev/prereg.json` prints 440 trials in 6 cells, `split=dev task_set=v0.3` and `model=anthropic:claude-opus-5-5` on every cell line, and a planning ceiling of $180.40 against the $274 cap.
- **Expected spend about $138** (told-scoped about $70, told-company about $41, none about $27), re-priced from the pilot's and #142's per-trial token receipts ("Expected cost", below). Scaled by the Opus smoke it is about $252, and about $236 once the none leases stop those cells. The none cells are expected to stop on their leases and publish partial results, labelled as such.
- **Dev only.** Public tasks, no held-out task and no claim. Its one rule is endpoint 1.

## Why this run

**Frontier models only (Garry, 2026-10-31):** "Beware haiku. Use frontier models", and "I generally don't care about the smaller models. Maybe consider ignoring haiku" (CREW.md, "Ignore Haiku"). No new Haiku arm runs anywhere, comparability arms included.

- Every v0.3 read so far ran on Haiku (`claude-haiku-5-5`): the dev pilot (#125), #142's supplementary dev run, and the approval relay re-read (#149). Opening 1 was designed on those numbers.
- A family is "informative" when its told pass rate sits between 10 and 90 percent. That was only ever checked on Haiku. A family at 60 percent on Haiku may sit at 100 percent on Opus, and then it cannot tell two arms apart.
- **So before opening 1 is sized for Opus, this run asks the same question on Opus:** how many of the six families stay inside 10 to 90 percent under opening 1's config?
- The no-brain cells keep the no-brain arm in view (CREW.md, "No-gstack arm in every head-to-head", and its gbrain analogue). They are descriptive only.
- **Why an unscoped Opus arm (told-company).** Without it, told-scoped matching none cannot show that scoping removed a leak on Opus. GBRA-108 needs that comparison for Garry's decision on whether gbrain scoping becomes the default. The told-company cells give it, descriptively, with only the scope differing from told-scoped (GST-364, folded in by the Captain on 2026-10-31).

## Why it is labelled dev

Every task here is public: all 20 dev tasks are in the repository with their bodies, hidden facts and graders.

- **No claim.** A result on these tasks cannot confirm or refute anything about an arm, a harness or gbrain. It tells HARN-1 and the Captain whether opening 1 runs on Opus 5.5 on v0.3 at all.
- No row of this run opens a held-out set, and `prereg.json` has no `heldout` block.

## Approval

- **The Captain, 2026-10-31:** "Go: the design as proposed (told-scoped at 5 reps deciding, none at 3 reps descriptive) with a $130 cap. The HARN-12 lane rises to $170. The preconditions are right: wait for #161, smoke Opus first, run the two-layer probe. Write the prereg."
- **The Captain, 2026-10-31, folding in GST-364:** two descriptive told-company cells (unscoped, 3 repetitions, 60 trials each, $27.50 lease each, $55 in all), so 6 cells, 440 trials and a $185 cap. The HARN-12 lane rises from $170 to $225. Endpoint 1 and its outcomes are unchanged and read only the two told-scoped cells.
- **The Captain, 2026-11-01, option B after the Opus smoke:** the told-scoped leases rise to $80 (OpenClaw) and $56 (Hermes), sized from the smoke's cost ratio ("Expected cost", below). The descriptive leases stay. The cap becomes $231 and the HARN-12 lane $280. The descriptive cells may publish partial results, labelled as such.
- **HARN-1, 2026-11-01, after the ship review:** the leases rise again, to $90 (OpenClaw) and $62 (Hermes) for told-scoped and $48 (OpenClaw) and $34 (Hermes) for told-company. The none leases stay at $20. The cap becomes $274 and the HARN-12 lane $320, with expected spend near $230. The partial-results rule for descriptive cells stays.
- The preconditions it names are recorded under "Before freeze", below.

## Question

On the 20 public dev tasks of task set v0.3, on `anthropic:claude-opus-5-5`, for OpenClaw and Hermes Agent, at gbrain `a590ad07`:

1. Under opening 1's config (the told arm on the company brain with two scope layers, 5 repetitions), what is each of the six families' told pass rate, pooled over both harnesses? How many lie inside 10 to 90 percent?
2. Descriptively (3 repetitions), what is each family's pass rate on the same company brain unscoped, and with no brain at all?
3. Descriptively, per harness, how do told-company, told-scoped and none compare on cross-scope read failures and on gbrain calls per trial?

## Design

Six cells, all on `anthropic:claude-opus-5-5`, all on the 20 tasks of the v0.3 dev split, one shard each:

| Cell | Harness | Config | Role | Tasks | Reps | Trials | Shard | Lease |
|---|---|---|---|---:|---:|---:|---|---:|
| `openclaw-opus-gbrain-told-scoped-mu-v03-dev` | OpenClaw | told, company brain, member-sources | **deciding** | 20 | 5 | 100 | `oc-told` | $90 |
| `hermes-opus-gbrain-told-scoped-mu-v03-dev` | Hermes | told, company brain, member-sources | **deciding** | 20 | 5 | 100 | `he-told` | $62 |
| `openclaw-opus-gbrain-told-company-mu-v03-dev` | OpenClaw | told, company brain, unscoped | descriptive | 20 | 3 | 60 | `oc-company` | $48 |
| `hermes-opus-gbrain-told-company-mu-v03-dev` | Hermes | told, company brain, unscoped | descriptive | 20 | 3 | 60 | `he-company` | $34 |
| `openclaw-opus-none-mu-v03-dev` | OpenClaw | no brain | descriptive | 20 | 3 | 60 | `oc-none` | $20 |
| `hermes-opus-none-mu-v03-dev` | Hermes | no brain | descriptive | 20 | 3 | 60 | `he-none` | $20 |

440 trials in all. The leases sum to $274 ($90 + $62 + $48 + $34 + $20 + $20), the cap.

## Fixed now

**Tasks.** All 20 dev tasks under `tasks/multiuser/v0.3/dev/` at this preregistration's merge commit on main:

- approval relay `ar-01` to `ar-03` (as #144 regenerated them), continuity `cn-01` to `cn-04`, corrections `cr-01` to `cr-04`, shared channel `sc-01` and `sc-02`, scope isolation `si-01` to `si-04`, synthesis `sy-01` to `sy-03`.
- No cell has a `tasks` list, so every cell runs all 20 (55 turns per repetition of the 20).
- `wall_clock_s` is 1500 for the multi-user slice, as in #142 and #149.
- No task, preamble, grader, pin or world file changes between this preregistration's merge commit and the report. A mid-run change is a dated amendment before the affected cell, or a new run id.

**Cells.**

- **Deciding cells** copy the deciding cells of `v03-ar-reread-2026-10` (`openclaw-haiku-gbrain-told-scoped-mu-v03-ar` and its Hermes twin). Changed: the model, the id, the `tasks` list removed (all 20 tasks), and the planning ceiling (below). Kept: `gbrain` `{"surface": "starter", "brain": "company", "scope": "member-sources"}`, preamble `tasks/multiuser/_shared/preamble.gbrain-company.md`, 5 repetitions.
- **Descriptive told-company cells** copy the pilot's `told-company` cells (`openclaw-haiku-gbrain-told-company-mu-v03-dev` and its Hermes twin), shaped like the re-read's descriptive cells. Changed: the model, the id, 3 repetitions instead of 5, and the planning ceiling. Kept: `gbrain` `{"surface": "starter", "brain": "company"}` with no `scope`, preamble `tasks/multiuser/_shared/preamble.gbrain-company.md`. **So a told-company cell differs from its told-scoped twin only in the scope and the repetitions:** same brain, pin, preamble, tasks and harness pins.
- **Descriptive none cells** copy the v0.3 dev pilot's `none` cells (`openclaw-haiku-none-mu-v03-dev` and its Hermes twin, `v03-pilot-2026-10`). Changed: the model, the id, the `tasks` list removed (the pilot ran them on the 8 continuity and corrections tasks; here they run all 20), 3 repetitions instead of 5, and the planning ceiling. Kept: no `gbrain`, no preamble.
- **The planning ceiling.** The told-scoped and told-company cells carry `{"input_tokens": 30000, "output_tokens": 2000}` per turn, the none cells `{"input_tokens": 20000, "output_tokens": 2000}`.
  - `runner/run.ts` uses the ceiling only to price the cap (`ceilingUsd`; a multi-user trial is priced as turns times the ceiling). It is never sent to a harness or the proxy, so it changes no trial.
  - At Opus list price that is $0.16 a turn for a gbrain cell and $0.12 for a none cell. Told-scoped: 275 turns, $44.00, under its $90 and $62 leases. Told-company: 165 turns, $26.40, under its $48 and $34 leases. None: 165 turns, $19.80, under its $20 lease. $180.40 in all.
  - The earlier v0.3 cells' 80,000 and 6,000 tokens at Opus rates is $0.44 a turn and $532.40 for this run, nearly twice the cap, so `dry-run` would warn HE-BUDGET-003.
  - Re-priced from receipts (below), a told-scoped turn averaged $0.119 (OpenClaw) and $0.135 (Hermes), a told-company turn $0.117 and $0.132, and a none turn about $0.077 and $0.088 (0.65 of told-scoped on all 20 tasks; the pilot's none cells on their 8 continuity and corrections tasks averaged $0.041 and $0.046). So the new figures sit above the measured means.
  - **The leases bind, not the ceiling.**
- Preamble file (sha256, first 12), unchanged since the pilot: `preamble.gbrain-company.md` `bb8a846939d5` (under `tasks/multiuser/_shared/`).

**Brain.** The deciding cells use the dev company brain, exactly as the re-read's deciding cells do. It is built from `world/seed/world.json` and the messy-company corpus at `gbrain/pin.json`'s corpus commit `6999ebc9`: every record of the dev split, grouped into one gbrain source per set of members who may read it ([docs/gbrain-arm.md](../../gbrain-arm.md), "Company brain"). Keyword search, embeddings off.

- **Two scope layers** (the re-read's preregistration, "Two scope layers"). Layer 1 is each member's own token, rescoped server-side with `gbrain auth rescope` to that member's sources. Layer 2 is the world's tap, which sets that member's `source_ids` on every `search`, `query`, `recall` and `list_pages` call.
- The sidecar runs under `HE_GBRAIN_SCOPE=member-sources` and copies out the member tokens (`tokens.json`) and the grants (`manifest.json`). The runner checks that both cover every actor of each task (HE-GBRAIN-004).
- Preflight runs both probes, `probeCompanyBrain` under member scope and `probeSourceGrants` with its token-alone checks. Either one failing stops the run (HE-GBRAIN-002).
- **Told-company cells** run the same company brain image with no scope: the sidecar serves the whole company brain under the trial's one unscoped token, and the tap adds no `source_ids`. Pages outside the asking member's grant can come back, which is what endpoint 3 counts.
- The none cells start no sidecar.

**gbrain.** `a590ad07d15c92669ae30a37835df30d071e5536` (0.60.522.0, master, the merge of gbrain#8074), unchanged from the re-read. This pull request does not change `gbrain/pin.json`.

- **#161 is in this run** (merged in train #171 as `bf87ec97f`, GBRA-252, "page writes work on a copied brain"). Before it, `gbrain/build-brain.ts` staged member and company sources under the build stage's `/tmp/staging`. The runtime image dropped them, so every page write into a member source answered `storage_error`.
- #161 stages each source inside the brain, and the entrypoint re-stamps the checkouts before `serve` (`gbrain/rebind-sources.ts`). It changes the gbrain image every gbrain cell uses. It does not change the pin.
- `search.saved_facts_supersede` is still on by default at `a590ad07`. Neither the build nor the entrypoint sets a gbrain config key.

**Harnesses.** Built on each shard from this preregistration's merge commit, at the pins #149 used: OpenClaw `2026.10.6`, Hermes Agent `v2026.9.24` at `f97608f1` (`harnesses/*/pin.json`, unchanged since #142's execution commit `fd185baea`). Docker mode, serve mode. `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005).

- **#151 (in train #171) does not change these cells' OpenClaw config.** It adds `memory.search.provider "none"` to `harnesses/openclaw/config/openclaw.openai.json`, the OpenAI template only, and a `memory_search` note to `pin.json`'s `model_openai` block. Every cell here is an Anthropic cell, so OpenClaw loads `config/openclaw.json`, which #151 does not touch. On an Anthropic cell OpenClaw's memory search was already keyword-only with no network call (#151's own note).
- Both adapters take the cell's model from `HE_MODEL_NAME` (OpenClaw `--model anthropic/<name>`, Hermes `--provider anthropic --model <name>`). So `claude-opus-5-5` needs no adapter change, as the Opus smoke below shows.
- A named limit, as before: the OpenClaw image installs with `npm install -g` and the Hermes image with `uv pip install -e`, neither from a lockfile. The six shard builds may resolve different dependency versions.

## Before freeze

These ran before this preregistration was frozen. Receipts are in the Captain's drive.

**1. #161 is on main.** It landed unchanged (its frozen head `025b56ce`) in the gbrain-wiring train #171, squash-merged as `bf87ec97f` (v0.0.78) on 2026-11-01 (UTC), and #161 was closed in favour of the train. This branch is based on main at that commit.

**2. The keyless check at the pin, on images built from this branch** (2026-11-01 UTC, HARN-12's build machine, image `harness-eval/gbrain:check-a590ad07d15c` built from this branch at `bf87ec97f`). Receipts: `handoffs/HARN-12/prereg-keyless/bf87ec97f564/` in the Captain's drive.

- `bun scripts/gbrain-check.ts --gbrain a590ad07d15c92669ae30a37835df30d071e5536`: **37 of 37 passed, 0 pin diffs**, 74 s.
- **The member-sources preflight probe** (`probeSourceGrants` in `runner/trial/gbrain.ts`, scope `member-sources`, the dev company brain): 15 members, 899 calls, 3,140 rows (`search` 531, `query` 531, `recall` 1,352, `list_pages` 726) over 28 sources, **0 outside the requester's grant**. 15 of 15 unknown source ids refused `permission_denied`.
  - Under the member token alone (no `source_ids`): the same rows per tool, 0 outside the grant. 15 of 15 out-of-grant `get_page` reads refused under the member token and served under the unscoped token; an in-grant page served for all 15.
  - These are the same figures #149 recorded at `a590ad07` before #161, so #161's re-stamp does not change what any member can read.
- **#161 works at this pin.** On a company brain started with scope `member-sources`, `put_page` under each of three members' own tokens succeeded, read back under the same token, and could not be read under another member's token. `tests/gbrain-image.test.ts` on the same image passed 20 of 20 run (1 skip, the embedded brain, which this run does not use), including #161's write test (`put_page`, `capture` and `add_timeline_entry` under a member token on the member and company brains) and the `probeSourceGrants` test under `sources` and `member-sources`.

**3. The Opus smoke (paid, uncounted).** One trial on each harness of the deciding config, task `cn-01-tamsin-cold-chain-site`, one repetition, on `anthropic:claude-opus-5-5`. It ran through the metering proxy under its own $4 lease per harness, scratch run id `v03-opus-dev-smoke-scratch-2026-10-31`, on Ubicloud at main `3a9b403be` (before #161; the smoke tests the model path, not page writes).

- **Both trials completed and passed.** OpenClaw: 9 requests, all to `anthropic:claude-opus-5-5`, $0.2218, 80 s. Hermes: 7 requests, all to Opus, $0.1915, 46 s. $0.4133 in all, 0 open leases. Ubicloud VMs $0.1676 list, outside the model lane.
- So the proxy's allowlist, both adapters' model mapping and HE-MODEL-001 (OpenClaw's own model probe) accept Opus. HE-MODEL-001 did not fire.
- Hermes's 24 refused requests are free metadata routes (`/v1/models`, `/api/show`, `/api/tags` and the like, 403 "not allowlisted", never billed). Every Hermes `cn-01` trial in the pilot shows the same 24.
- Preflight on both VMs passed the member-sources probes: 3,140 rows over 28 sources, 0 outside the grant, with and without `source_ids`; 15 of 15 out-of-grant `get_page` reads refused under the member token.
- Receipts: `handoffs/HARN-12/opus-smoke/` in the Captain's drive. Never cited as a result.

## The runner and commit binding

**Runner.** The run executes from a worktree pinned at this preregistration's merge commit on main.

- This branch is based on main at `bf87ec97f` (#171, the gbrain-wiring train that carries #161) and merges main at `e4859aafd` (#190, HARN-7: `.github/workflows/ci.yml` and the version files only, none of the paths below) and at `5e93429ae` (#165, below).
  - **#165** (`5e93429ae`, HARN-16, Particle-1 metering route): `runner/proxy/metering-proxy.ts`, `runner/ledger/budget-ledger.ts`, `runner/pricing/model-pricing.ts`, `runner/run.ts`, `scripts/ubicloud/run-shard.sh`, `scripts/ubicloud/fanout.sh`, `scripts/ubicloud/vm-shard.sh` and `scripts/gstack-laneb/vm-run.sh`. It adds a Particle route, price row and preflight check, and a request stating several output limits now reserves the largest. No cell here calls Particle, and Anthropic Messages requests state only `max_tokens`, so these cells' routing, pricing and reservations are unchanged. It also refuses a `max_tokens` that is not a positive whole number (HTTP 400) and injects the cap when `max_tokens` is absent; both harnesses here state a positive whole `max_tokens`. It reaches the VM only as `PARTICLE_API_KEY` being passed when set.
- The last run on this config, `v03-ar-reread-2026-10`, executed at #149's merge commit `eb630bd46`. Since then six pull requests merged (`git log --first-parent --oneline eb630bd46..bf87ec97f`). Every path they touch under `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev` or `tasks/multiuser/_shared` is named here:
  - **#171** (`bf87ec97f`, train gbrain-wiring: #161, #156, #151, #158).
    - #161 (GBRA-252): `gbrain/build-brain.ts`, `gbrain/entrypoint.sh`, `gbrain/rebind-sources.ts` (new), `gbrain/Dockerfile`, `gbrain/pin.json` (the `copied_brain_writes` note only; the commit stays `a590ad07`) and `gbrain/README.md`. It changes the gbrain image every gbrain cell here uses ("gbrain", above).
    - #156 (HARN-13, gbrain's installer rung for Claude Code and Codex): `harnesses/claude-code/*`, `harnesses/codex/*`, `gbrain/build-install.ts`, `gbrain/export-install.sh`, `runner/contracts.ts` (`installerNotApplied`, `TURN_HOOK_APPLIED` gains `ran`), `runner/run.ts` (`GBRAIN_INSTALLER_HARNESSES`), `runner/trial/trial.ts` and `runner/trial/turns.ts` (per-turn hook counts, read only when a ready reports `ran`), `scripts/summarize-run.ts` and `scripts/compare-run.ts` (counts for `ran` trials only), `scripts/run-shard.sh` (one more harness cache path dropped from results). No cell here uses an install, Claude Code or Codex; the code paths it adds run only for them.
    - #151 (HARN-13): `harnesses/openclaw/config/openclaw.openai.json`, `harnesses/openclaw/pin.json` (`model_openai` only) and `harnesses/openclaw/README.md`. OpenAI cells only ("Harnesses", above).
    - #158 (HARN-14): `scripts/gstack-laneb/materialize.ts`, Lane B only.
  - **#150** (`47bf4d98b`, HARN-11, v0.3 resealed as v0.3-gen6): `runner/heldout/openings.ts`, `scripts/seal-heldout.ts`, `scripts/check-sealed-publication.ts`, `scripts/sealed/*` and the held-out manifests. Sealed custody code; no dev cell triggers it.
  - **#147** (`3a9b403be`, HARN-15 results): `scripts/budget-ledger.ts`, `scripts/instruction-route-secondary.ts`, `scripts/publish-audit.ts`. Run outside trials.
  - **#148** (`ec0ba467a`, HARN-7): `scripts/ubicloud/merge-pass.sh` and READMEs. The merge lane, never a trial.
  - **#160** and **#162** touch none of those paths.
- **The Opus smoke ran at `3a9b403be`**, before #171. Of #171's changes only #161's gbrain image and #156's runner hooks for `ran` trials could reach these cells' trials, and the keyless checks in "Before freeze" were run on images built from this branch, after #171.
- This pull request adds this directory, its `preregistrations.d` entry, the version files, and one branch in `tests/gbrain-runner.test.ts` that pins this run's cells (the test lists every committed preregistration's gbrain cells). It changes no runner, harness, world, gbrain, script or task file.

**Commit binding.** The run executes at this preregistration's merge commit on main, never at a branch commit.

- Before the fan-out, `git diff --stat <merge commit>^1 <merge commit>`, with no path filter, must list exactly this pull request's files.
- Also before the fan-out, `git log --first-parent --oneline bf87ec97f..<merge commit>^1` and `git diff --stat bf87ec97f <merge commit>^1` list every pull request merged between this branch's base and this one. The report names each with its paths. One that touches `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev` or `tasks/multiuser/_shared` needs a dated amendment that names it, committed before any cell runs.
- The fan-out manifest records the merge commit. The report asserts four things: every shard's `shard.json` and `shard-vm.json` name it, every `shard-vm.json` has `scratch_prereg` false, the run manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit, and every shard's `lease_usd` in its `shard.json` (kept as `<shard>.shard.json` in the merged results) and its `shard-vm.json` equals its lease in the design table. Any other value is a deviation, and the affected cell is not reported as part of this run.
- Before the fan-out, HARN-12 checks that the fan-out manifest's `lease_usd` for each shard equals the design table and that they sum to the $274 cap. A mismatch stops the fan-out before any VM launches.

## Sharding and execution

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).** Six shards, one cell each, named in the table. **No cell is split across machines and no two cells share one.**

- Each shard runs on its own ephemeral standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=HARN-12`, after `scripts/ubicloud/ubi-runner.sh usage`. The fan-out runs as a Capy background operation with a registered wait.
- Each VM checks the repository out detached at the merge commit (a dirty tree is refused) and builds the harness and gbrain images from it. It runs the lane's one-trial dev smoke, then `scripts/run-shard.sh` for its cell with `-- --max-output-tokens 128000`.
- The default `--timeout-hours 12` applies (VM TTL 13 hours). On Haiku the pilot's told-scoped cells took 2.6 hours (OpenClaw) and 2.0 hours (Hermes) of trial time for 100 trials. Opus may take about twice that.
- Results come back to `<dest>/<shard>/results` and are merged with `scripts/merge-shards.ts`. The VM is destroyed on every exit.
- A shard that fails before its first trial is relaunched at the same commit, at most twice for any cause (the HE-MODEL-001 relaunches below included). Each relaunch runs a new smoke under a new $4 lease, which counts against the lane check under "Leases and spend". After a second failed relaunch the shard stops and HARN-12 reports to the Captain. A quota re-queue is not a relaunch: `fanout.sh` launches a shard refused for vCPU quota again, up to 3 tries, before any smoke or lease. A shard interrupted mid-run resumes with `--resume` at the same commit under the same lease, and the resume log names the commit it loaded. After any stop, `UBI_OWNER=HARN-12 scripts/ubicloud/ubi-runner.sh list --mine` shows any VM left running.

**Run order within a shard.** The cell's trials in manifest order (task by task, repetitions in sequence), one at a time.

**Smokes.** Each VM's smoke is one uncounted dev trial of its cell under a scratch ledger, on task `cn-01-tamsin-cold-chain-site` (`--smoke-task`) and a $4 lease (`--smoke-lease-usd 4`).

- **Why not the lane's defaults.** The default task is the first dev directory, `ar-01`, which re-prices at up to $0.90 a trial at Opus rates. The default smoke lease is $6.00 (`scripts/ubicloud/smoke-lease.ts`: twice one $2.76 reservation, rounded up). `cn-01` re-prices at $0.10 to $0.25, and a $4 lease covers one reservation plus about $1.20 of spend.
- Smoke spend is outside the $274 cap and charged to the lane at its actual spend.
- The smoke must end `completed` or the counted shard does not start. A smoke that stops only on OpenClaw's own model probe refused at $0 (HE-MODEL-001) is relaunched at the same commit within the two relaunches above, and each relaunch is noted in the run log.

## Leases and spend

Cap $274: $90 and $62 for the told-scoped shards, $48 and $34 for the told-company shards, and two $20 leases.

- **Where the money comes from.** HARN-12's lane, raised from $40 to $170 and then to $225 by the Captain on 2026-10-31, to $280 by the Captain on 2026-11-01, and to $320 by HARN-1 on 2026-11-01. It has committed $21.29 before the Opus smoke and $21.70 after it (the lane ledger, `harness-eval/ledger/lane-spend.jsonl` in the project drive).
- **No counted trial starts unless the lane's remaining balance covers the $274 cap plus every smoke: $4 for a smoke still open, and its actual spend once it has closed.** The report states that balance.
  - Before the fan-out that is $274 plus six open $4 smoke leases, $298 in all. At this writing the lane has $298.30 left ($320 less $21.70), $0.30 above $298.
  - A relaunch adds a new open $4 smoke lease, and the failed launch's smoke then counts at its actual spend. The Opus smoke spent $0.22 and $0.19 on the same task, so each closed smoke frees most of its $4 and a relaunch fits.
  - If a relaunch does not fit, that shard waits, and HARN-12 reports to the Captain before it starts.
- **Why a lease covers Opus's per-call reservation.** Before forwarding a call, the proxy reserves its worst case against the lease: its input tokens and its output cap, at list price (`runner/proxy/metering-proxy.ts`, `reservationUsd` in `runner/ledger/budget-ledger.ts`).
  - The output cap is `--max-output-tokens 128000`, kept as in #149. At Opus's $20 a million output tokens that is $2.56.
  - Input adds about $0.20 at 50,000 tokens ($4 a million), or $0.25 when the call writes the prompt cache ($5 a million). So one call reserves about $2.80, and about $3.06 at 100,000 input tokens.
  - Every lease here holds that many times over. A shard stops on its lease only when its spend comes within one reservation of the lease.
- A cell that reaches its lease is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order, and the report says so first. Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`; the report counts them as not run. Excluded trials (`model_error`, `infra_error`, `exam_fault`) are never rerun.
- Leases are not moved between shards and change only by a dated amendment.
- VM cost is outside the model cap: six standard-16 VMs for about 2 to 6 hours each, about $7 to $11 at list price. The report gives each VM's list-price cost from `shard-vm.json`.

**Expected cost, and how it was derived.** No Opus trial has run on v0.3 at scale, so the expected cost re-prices the Haiku runs' per-trial token receipts at Opus rates.

- **Source:** the per-trial `usage` blocks of `docs/benchmarks/2026-10-29-v03-pilot/results/trials.jsonl` (the pilot, 1,040 trials) and `docs/benchmarks/2026-10-29-v03-installer-dev/results/trials.jsonl` (#142, 400 trials).
- **Rates:** Opus 5.5 in `runner/ledger/budget-ledger.ts`: $4 a million input, $20 output, $0.20 cache read, $5 cache write. Cached input is priced as cache reads. Every uncached input token is priced as a cache write, to stay conservative.
- **Told-scoped** (the pilot's `told-scoped` cells, the nearest config, all 20 tasks): a mean of $0.3272 a trial on OpenClaw and $0.3719 on Hermes. The largest single trial is $1.1793 (`ar-03` on OpenClaw). At 100 trials each that is $32.72 and $37.19, **about $70**.
- **Told-company** (the pilot's `told-company` cells, the same config on Haiku, all 20 tasks): a mean of $0.3219 a trial on OpenClaw and $0.3631 on Hermes, the largest $1.1299. At 60 trials each that is $19.31 and $21.79, **about $41**.
- The other gbrain cells agree: the pilot's `told` cells $0.2904 and $0.3064 a trial, and #142's `told` cells $0.2931 and $0.2956.
- **None.** The pilot ran its none cells on the 8 continuity and corrections tasks only, so the ratio is taken on those 8 tasks. None over told-scoped is 0.675 on OpenClaw and 0.554 on Hermes; none over told is 0.666 and 0.686. Taking 0.65 times the told-scoped mean on all 20 tasks gives $0.213 and $0.242 a trial: $12.76 and $14.50 for 60 trials each, **about $27**.
- **Expected total about $138** ($69.91 + $41.10 + $27.26) from the Haiku re-pricing, against the $274 cap.
- **Caveat.** Opus may use more or fewer tokens than Haiku on the same task (longer replies, more or fewer tool calls). The one Opus smoke trial per harness on `cn-01` cost 2.3 times (OpenClaw, $0.2218 against $0.096) and 1.4 times (Hermes, $0.1915 against $0.138) the re-priced Haiku told-scoped mean for that task. One trial is not a rate, but it points above the expectation.
  - Scaled by those ratios, told-scoped comes to about $76 (OpenClaw) and $52 (Hermes), told-company about $45 and $30, none about $30 and $20: about $252 in all. The none leases stop those cells first, so spend comes to about $236.
  - A shard stops one reservation (about $2.80) short of its lease. So told-scoped has about $87.20 (OpenClaw) and $59.20 (Hermes) usable, about 15 percent above each estimate, which rests on one smoke trial per harness. A heavier run can still leave a deciding cell partial, and the undecided rule then applies (outcome C).
  - Told-company has about $45.20 and $31.20 usable, close to its estimates. The none cells have about $17.20 each, so they are expected to stop early: OpenClaw after about 60 percent of its trials, Hermes after about 85 percent. **A descriptive cell may stop on its lease and publish partial results, labelled as such.**
- The leases bind whatever Opus does: a told-scoped cell can average about $0.87 a trial (OpenClaw) or $0.59 (Hermes), a told-company cell about $0.75 (OpenClaw) or $0.52 (Hermes) and a none cell about $0.28, before it reaches its lease.

## Endpoints

**Endpoint 1 is the only go rule, and it reads only the two told-scoped cells. Endpoints 2 to 5 are dev and descriptive: no arm is tested against another, no p-value is reported, and nothing in them is a claim.**

Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement, 10,000 draws, seed 7). n is given as tasks and trials.

1. **Whether opening 1 runs on Opus 5.5.** Stated before any trial, and fixed here so the rule cannot move after data.
   - **Read.** For each of the six families, the told pass rate of the two deciding cells (`openclaw-opus-gbrain-told-scoped-mu-v03-dev`, `hermes-opus-gbrain-told-scoped-mu-v03-dev`), pooled over both cells and the family's tasks, as a point estimate on scored trials. The interval is printed beside it and does not enter the rule.
   - A family is **informative** when that rate is at least 10 percent and at most 90 percent.
   - A deciding cell is partial when it stops before all its planned trials run. A family is undecided when some outcome of its unrun trials would give it a different label from the one its scored trials give. An undecided family counts as not informative.
   - **Computed by** `bun scripts/v03/pilot-tables.ts --results <merged results> --tasks tasks/multiuser/v0.3/dev --out <dir> --told openclaw-opus-gbrain-told-scoped-mu-v03-dev,hermes-opus-gbrain-told-scoped-mu-v03-dev`.
     - Its "Go rule" table pools exactly the cells `--told` names and clusters on the task across both harnesses.
     - It applies the partial-cell rule from the merged results' `manifest.json` (a planned trial with no record, or only a cap-stop record, is unrun) and prints `no (undecided: N unrun)`. It refuses a `--told` cell with no trials and a duplicated trial id.
     - Its denominator is scored trials: `model_error`, `infra_error` and `exam_fault` trials are left out, and a `harness_error` counts as a failure. A pass is a trial graded `pass` with no consent violation.
   - **Outcome A: at least 5 of 6 families informative.** Opening 1 runs on Opus 5.5 only, with no Haiku arm. Its budget is re-sized at this run's measured Opus cost per trial and sent to the Captain.
   - **Outcome B: fewer than 5 informative, and at least one family above 90 percent.** No opening on v0.3. The report says plainly that v0.3 is too easy for frontier models. That becomes the v0.4 brief.
   - **Outcome C: fewer than 5 informative, and no family above 90 percent.** This run fixes no opening rule. HARN-1 and the Captain decide.
   - **Undecided families and the outcome.** Only a decided family can satisfy outcome B's "above 90 percent" clause. If any family is undecided and some result of the unrun trials would change which of A, B or C applies, the outcome is C.
     - `pilot-tables.ts` labels each family but prints no outcome, so the outcome is worked out by hand and shown in the report. For each undecided family, list the labels (below 10 percent, informative, above 90 percent) its rate can reach between all its unrun trials failing and all passing. If any combination of those labels across the undecided families gives a different outcome from another, the outcome is C.
   - **B is the expected outcome.** On Haiku, in the pilot's told-scoped cells (context only, "Haiku context, labelled" below), scope isolation was already 39/40 and shared channel 20/20. Opus is stronger, so 5 of 6 informative families is unlikely. A B result is not a surprise.
   - The report names the outcome first, with the six rates and their intervals.

2. **Told-company and none, descriptive.** Each family's pass rate in the two told-company cells and in the two none cells, from the same script with `--told openclaw-opus-gbrain-told-company-mu-v03-dev,hermes-opus-gbrain-told-company-mu-v03-dev` and with `--told openclaw-opus-none-mu-v03-dev,hermes-opus-none-mu-v03-dev`. Both are printed beside endpoint 1's rates with the words "descriptive, outside the rule". The configs are not tested against each other, and their repetitions differ (5 and 3).

3. **Scoping on Opus, descriptive (GBRA-108).** Per harness, told-company against told-scoped against none, side by side, with no go rule:
   - (a) **Cross-scope read failures:** the `cross_scope_read_failures` count in `summary.json` per cell, plus out-of-grant rows by tap channel (the gbrain tool that returned them), as the re-read reported them. For the none cells only the world reads can fail this way, so their row says so.
   - (b) **gbrain call rate:** gbrain tool calls per trial, counted from each trial's `events.jsonl` (events with `via=gbrain`), with a task-clustered interval. The none cells are 0 by construction.
   - The cells differ in repetitions (5 for told-scoped, 3 for the others), and the report says so beside the table. Any out-of-grant row in a told-scoped cell is a finding for GBRA-108.

**Partial descriptive cells in endpoints 2 and 3.** Trials run task by task, so a descriptive cell that stops on its lease has no trials in the last families (the scaled estimate above puts both none cells past their leases and the told-company cells close to theirs, so synthesis, the last family, may have no none trial in either harness).
   - A family with no scored trial in a harness's cell is printed as "not run" for that harness and is not pooled. A family with no scored trial in either harness is printed as "not run" with no rate. A pooled rate that rests on one harness says so.
   - `pilot-tables.ts` prints a family with no trials as `0 / 0 | 0.0%` and pools the cells it is given without a note. So each harness's rows come from a single-cell `--told` run, a `0 / 0` row is reported as "not run", and the pooled rows are checked against them by hand.
   - Endpoint 3 compares the cells of a harness only on the tasks every compared cell completed, and gives each count with the tasks it covers. A task is completed in a cell when every planned repetition has a record other than a cap stop. An excluded trial (`model_error`, `infra_error`, `exam_fault`) still counts as run.
   - Computed per harness: one copy of the merged results for each harness, with `trials.jsonl` filtered to that harness's covered tasks, and `scripts/summarize-run.ts` run on each copy. The whole-cell counts are printed beside them.
   - The report names each partial cell, the task it stopped at, and the families it never reached.

4. **Cross-scope reads via gbrain, per deciding cell.** From `summary.json`'s per-cell gbrain block: trials with a cross-scope read that came through gbrain, and unreadable rows returned.
   - Every gbrain event that returned a page outside the requesting member's grant is named with its tool, task, repetition and event seq, whatever the tool. Cross-scope rows are counted by the tap channel (the tool) they came through.
   - Expected at this pin with both scope layers: none. Any such event is a finding for GBRA-108; it changes no figure here.
   - Page writes (`put_page`, `capture`, `add_timeline_entry`) are counted with their status. This is the first v0.3 run where #161 lets them succeed in a member source.

5. **Pass rate per cell and per task, and cost.** Pass over scored trials per cell, with intervals (`scripts/summarize-run.ts`); pass^k and pass@k per task (k is 5 for told-scoped, 3 for the others); proxy-priced cost per trial per cell with its interval, set beside the re-priced expectation above.

Also descriptive: gbrain use and calls per trial per gbrain cell; approval stops, consent violations and hidden-fact leaks as counts with trial ids; terminations; refused proxy requests; median wall time per trial, labelled with its shard.

**Task defects.** A task with no pass in any scored trial of the two deciding cells is a candidate. It is judged by the pilot's defect rule (`v03-pilot-2026-10`'s preregistration, "Task defects", items 1 to 4: causes per trial, `HARNESS` trials out of the denominator, and two readers, the author and a second reader on claude-opus-5-5 or GPT-6.1 Sol who never sees the author's causes). A defect is reported and goes to HARN-1. It does not change the endpoint 1 count, which counts each family as it scores here. The descriptive cells do not make or clear a candidate.

## Haiku context, labelled

**Context only.** These are Haiku numbers from earlier runs. They are not an arm of this run, enter no rule here, and are not a basis for any opening.

- **The pilot's `told-scoped` cells** (`v03-pilot-2026-10`, gbrain `81692dc6`, scope `sources`, before #144's approval relay fix; recomputed with `pilot-tables.ts --told`): scope isolation 39/40, shared channel 20/20, synthesis 20/30, continuity 37/40, corrections 10/40, approval relay 0/30.
- **#142's told cells** (`v03-installer-dev-2026-10`, gbrain `32366ac2`, unscoped, its report): scope isolation 23/40, shared channel 14/20, synthesis 20/30, continuity 36/40, corrections 1/40, approval relay 0/30.
- **The re-read** (`v03-ar-reread-2026-10`, gbrain `a590ad07`, member-sources, after #144): approval relay 17/30 (#164, open when this was written).

## One rule, no claim

Endpoint 1 is the only go or no-go rule here. It decides whether opening 1 runs on Opus 5.5 on v0.3, and nothing else. **No claim is made on dev data beyond it.**

- No earlier verdict is reopened. #142's endpoint 6, the pilot's verdict and the re-read's gate stand as their reports state them.
- Opening 1's design (cells, repetitions, pins, budget) belongs to opening 1's own preregistration. This run hands it one outcome and the measured Opus cost per trial.

## Cut line and drop order

Minimum: all six cells. There is no drop order. Each cell has its own shard and lease, so a cap stop or a failure in one leaves the others whole. **A partial cell is reported as partial.** A partial descriptive cell never affects the rule, and the descriptive cells may publish partial results, labelled as such.

## Receipts

Under `docs/benchmarks/2026-10-31-v03-opus-dev/results/`:

- the merged `trials.jsonl`, `manifest.json`, `shards.json`;
- each shard's ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json` and the lane's `shard-vm.json`, under its own name;
- `summary.json`, the three `pilot-tables` outputs (told-scoped, told-company and none), the endpoint 3 table, and `defects.json` if any task is a candidate;
- per trial the events, turns, snapshot, usage, reconcile and grade files. Harness state, workspaces, raw harness logs and per-trial tokens are excluded, as in #142 and #149.

The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first trial.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

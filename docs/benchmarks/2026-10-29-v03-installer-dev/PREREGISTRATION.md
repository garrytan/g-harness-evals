# v0.3 installer dev cells: C1's two arms on the 20 public v0.3 tasks, on Haiku, at gbrain#7898's merge (after gbrain#7489)

Status: written 2026-10-29 (America/Los_Angeles), before any trial of this run. Run id `v03-installer-dev-2026-10`. Cells are in [prereg.json](prereg.json).

**In one line: the v0.3 dev pilot skipped C1's installer arm because gbrain#7489 was unmerged. It has now merged, so this run measures that arm on the same public dev tasks, beside a fresh told arm at the same gbrain commit.**

- 4 cells, 400 trials, cap $9. Leases $2.25 per shard, $9.00 in all.
- `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-29-v03-installer-dev/prereg.json` prints 400 trials in 4 cells, `task_set=v0.3 split=dev` on every cell line, and a planning ceiling of $12.12 against the $9 cap. The ceiling prices every turn at the per-turn token ceiling at list price. Its HE-BUDGET-003 warning about drop order does not apply: `drop_order` is empty and each shard stops at its own lease (below).
- gbrain moves to `32366ac2` (master, the merge of gbrain#7898, 0.60.498.0). It contains the merges of gbrain#7489 and gbrain#7744.
- Dev only. Public tasks, no inferential claim and no held-out task. Its one go or no-go rule is endpoint 6, HARN-1's gate on the v0.3 seal for opening 1. That gate makes no claim about any candidate.

## Why this run

**The approved v0.3 plan owes this run.** The dev pilot (`v03-pilot-2026-10`, [its preregistration](../2026-10-29-v03-pilot/PREREGISTRATION.md), section "Deviation from the approved plan") dropped C1's installer arm. The reason: gbrain#7489, which the installer arm needs, was not merged, so the installer cells would have failed preflight (HE-GBRAIN-006).

- HARN-1 approved that deviation for Garry on 2026-10-29 with two conditions (the pilot's pull request #112, section Approvals). Condition 1: "When #7489 merges, the two C1 installer cells run as a small supplementary dev pilot before opening 1, within the remaining lane budget."
- gbrain#7489 merged on 2026-10-29 as `bb2a440c258b009933ce96aeb6f09cc788a4b7d3` (0.60.495.0). gbrain#7898 merged after it the same day as `32366ac26a2b8874b67702249f9274b06e8756c1` (0.60.498.0).
- **Why the pin is `32366ac2`, not `bb2a440c`.** gbrain#7489 and gbrain#7898 are the two pull requests of harness ask 4. gbrain#7489 gives `gbrain setup` the brain-first block and the per-turn hook. gbrain#7898 gives the same hook to the Claude Code and Codex plugin installs, and makes a recorded `setup --no-hooks` turn it off. `32366ac2` is the newer of the two merges, so every install route gbrain ships gets the hook.
- The OpenClaw and Hermes installer views this run uses come from gbrain#7489's code. The keyless check below found them the same at both merges (OpenClaw view digest `744632eb565d` at each).
- Ancestry evidence is under "gbrain", below.
- Condition 2 (opening 1 pins merged commits that contain gbrain#7744 and gbrain#7489) is opening 1's, not this run's. `32366ac2` happens to satisfy it.

**Why the told cells run again.** Two reasons.

- **One gbrain commit for both arms.** C1's dev difference (installer minus told) is then paired within one run, one pin and one task set. The pilot's told cells ran at `81692dc6`. Between that commit and `32366ac2` there are 26 first-parent commits on gbrain master (`git log --oneline --first-parent 81692dc6..32366ac2`), including the merges of gbrain#7610, gbrain#7703, the rest of gbrain#7744, gbrain#7489 and gbrain#7898.
- **A repair read of the approval relay family.** The pilot's told arm passed 0 of 30 approval relay trials (the pilot's results pull request #125, `results/pilot-tables.md`, "Go rule"). That pilot read no-go under its rule, and its held-out set was sealed under the no-go, a deviation its report records. #119 revised that template and regenerated the three dev `ar-` tasks. This run re-reads the told arm's approval relay rate on the revised tasks. It is a named repair read, as the pilot's go rule allows, funded from the lane remainder under HARN-1's condition 1 rather than the pilot's $7 reserve. **It never changes the pilot's verdict.** HARN-1 has since approved that deviation on one condition ([deviation-approval.md](../2026-10-29-v03-pilot/deviation-approval.md)), and endpoint 6 preregisters the condition: this run's told cells are its evidence.

## Why it is labelled dev

Every task here is public. The 20 dev tasks are in the repository with their bodies, hidden facts and graders. Anyone building a candidate for C1 can read them.

- **No claim.** A result on these tasks cannot confirm or refute anything about an arm. The numbers feed opening 1's budget and the set author's view of the revised template. They are never quoted as evidence for or against the installer.
- No row of this run opens a held-out set, and `prereg.json` has no `heldout` block.

## Approval

- The v0.3 plan: HARN-12's plan in the Captain's drive (`handoffs/HARN-12/autoplan/plan.md`, autoplan run `harn12-20261028191321`, gate rev 2, recommendation hash `b040910f98a4`). Garry approved it on 2026-10-28 with the word "Rec", relayed by the Harness Evals Captain.
- This run: HARN-1's condition 1 on the pilot's deviation, quoted above. No counted trial starts until the Captain confirms in this pull request's body that this design meets that condition.

## Question

On the 20 public dev tasks of task set v0.3 on `anthropic:claude-haiku-5-5`, for OpenClaw and Hermes Agent, at gbrain `32366ac2` and five repetitions per task:

1. What is each cell's pass rate?
2. Per harness, what is the paired difference, installer minus told?
3. What does an installer trial cost? (Opening 1's budget needs it.)
4. What is the told arm's approval relay rate on #119's revised tasks?

## Design

Four cells, all on `anthropic:claude-haiku-5-5`, all on every task of the v0.3 dev split:

| Cell | Harness | Arm | Copied from | Tasks | Reps | Trials | Shard | Lease |
|---|---|---|---|---:|---:|---:|---|---:|
| `openclaw-haiku-gbrain-told-mu-v03-dev` | OpenClaw | told | v03-pilot-2026-10, same cell id | 20 | 5 | 100 | `oc-told` | $2.25 |
| `openclaw-haiku-gbrain-installer-mu-v03-dev` | OpenClaw | installer | gbrain-installer-hook-2026-10 (`openclaw-haiku-gbrain-installer-mu-heldout`) | 20 | 5 | 100 | `oc-installer` | $2.25 |
| `hermes-haiku-gbrain-told-mu-v03-dev` | Hermes | told | v03-pilot-2026-10, same cell id | 20 | 5 | 100 | `he-told` | $2.25 |
| `hermes-haiku-gbrain-installer-mu-v03-dev` | Hermes | installer | gbrain-installer-hook-2026-10 (`hermes-haiku-gbrain-installer-mu-heldout`) | 20 | 5 | 100 | `he-installer` | $2.25 |

400 trials in all. The leases sum to $9.00, the cap.

## Fixed now

**Tasks.** Task set v0.3 at this preregistration's merge commit on main: the 20 dev tasks under `tasks/multiuser/v0.3/dev/`.

- Families: `scope_isolation` 4, `shared_channel` 2, `synthesis` 3, `continuity` 4, `corrections` 4, `approval_relay` 3 ([the set's README](../../../tasks/multiuser/v0.3/README.md)).
- The split is the current one. It includes #119's revised approval relay tasks (`ar-01` to `ar-03`); the other 17 tasks are byte-identical to the pilot's (#119's description; `tests/v03-generators.test.ts` regenerates the tree and fails on any byte of difference).
- Every cell takes every task directory of the split (55 turns per repetition of the 20 tasks). No cell lists `tasks`.
- `wall_clock_s` is 1500 for the multi-user slice, as in both source runs.
- No task, preamble, grader, pin or world file changes between this preregistration's merge commit and the report. A mid-run change is a dated amendment before the affected cell, or a new run id.

**Cells.** Each cell is its source cell with only the split fields changed.

- Told cells: the pilot's told cells exactly (`split` `dev`, `task_set` `v0.3`, `gbrain` `{"surface": "starter"}`, preamble `tasks/multiuser/_shared/preamble.gbrain-ladder.md`, 5 repetitions, ceiling 80,000 input and 6,000 output tokens per turn). `jq` shows no difference between the two cell objects.
- Installer cells: the installer-hook run's installer cells with `split` `dev` instead of `heldout` and `task_set` `v0.3` added (the source had none, which means v0.1). Everything else is the source's: `gbrain` `{"surface": "starter", "install": "gbrain-installer"}`, no `preamble` field (so the default `tasks/multiuser/_shared/preamble.md`, with no brain-first clause), 5 repetitions, the same ceiling.
- **So a pair differs in one thing:** where the brain-first instruction comes from. Told gets it from the eval's preamble. Installer gets it from what `gbrain setup <harness> --instructions-only` wrote and installed (the file block and the per-turn hook; [docs/gbrain-arm.md](../../gbrain-arm.md), "The installer rung" and "The per-turn hook").
- Preamble files (sha256, first 12), unchanged since the pilot: `preamble.md` `d22252a1b599`, `preamble.gbrain-ladder.md` `ced53097c843` (both under `tasks/multiuser/_shared/`).

**Brains.** The dev bot-visible brain `/brains/dev` the sidecar image bakes from `world/seed/world.json` and the messy-company corpus at `gbrain/pin.json`'s corpus commit `6999ebc9`. Keyword search, embeddings off, one bot token, in every cell.

**gbrain.** This commit moves `gbrain/pin.json` from `81692dc6` to `32366ac26a2b8874b67702249f9274b06e8756c1` (0.60.498.0). `81692dc6` moves to `previous`, named for runs `gbrain-memory-fix-2026-10b` and `v03-pilot-2026-10`, which keep it. `install.installer.turn_hook_expected` becomes true, so preflight refuses an installer view without the per-turn hook (`installerHookProblem`, HE-GBRAIN-006). The `Dockerfile` default `GBRAIN_COMMIT` follows the pin.

Ancestry evidence, run on 2026-10-29 (UTC) on HARN-12's build machine:

```
git clone --quiet --shallow-since=2026-10-15 --single-branch --branch master --no-checkout https://github.com/garrytan/gbrain gbrain
git -C gbrain fetch -q origin master
git ls-remote https://github.com/garrytan/gbrain refs/heads/master
  -> 32366ac26a2b8874b67702249f9274b06e8756c1 (master's head at the time)
git -C gbrain log -1 --format='%H %cI %P %s' 32366ac26a2b8874b67702249f9274b06e8756c1
  -> 2026-10-29T22:57:32Z, parents 67189b42 10ae98e2, "Merge pull request #7898 from garrytan/capy/gbra188-plugin-turn-hook"
git -C gbrain show 32366ac26a2b8874b67702249f9274b06e8756c1:VERSION
  -> 0.60.498.0
git -C gbrain merge-base --is-ancestor 32366ac26a2b8874b67702249f9274b06e8756c1 origin/master    -> exit 0
git -C gbrain merge-base --is-ancestor bb2a440c258b009933ce96aeb6f09cc788a4b7d3 32366ac26a2b8874b67702249f9274b06e8756c1    -> exit 0
  (bb2a440c: 2026-10-29T20:38:45Z, "Merge pull request #7489 from garrytan/capy/gbra188-brain-first-instructions", VERSION 0.60.495.0)
git -C gbrain merge-base --is-ancestor 0ccf2bdd4f42ed50be4cfb515eaa804ddb4b7049 32366ac26a2b8874b67702249f9274b06e8756c1    -> exit 0
  (0ccf2bdd: "Merge pull request #7744 from garrytan/capy/gbra205-saved-facts-stems")
git -C gbrain merge-base --is-ancestor 81692dc623f3e220d1ea04b078b3aed903bd086f 32366ac26a2b8874b67702249f9274b06e8756c1    -> exit 0
```

- **So `32366ac2` carries gbrain#7744, gbrain#7489 and gbrain#7898,** and the pilot's pin `81692dc6` is in its history.
- `search.saved_facts_supersede` is still on by default (`src/core/search/saved-facts-match.ts`, `src/core/config.ts`, read at `32366ac2`). Neither the image build nor the entrypoint sets any gbrain config key.
- **The installer and its hook are there at this pin.** A keyless check on 2026-10-29 (UTC), `bun scripts/gbrain-check.ts --gbrain 32366ac26a2b8874b67702249f9274b06e8756c1 --expect-hook`, built `harness-eval/gbrain:check-32366ac26a2b` and passed 37 of 37 assertions with 0 pin diffs in 76 s. The sidecar reports gbrain 0.60.498.0; the starter surface has 33 tools and verbs 7, as `gbrain/pin.json` pins. Both installer views are available and carry the per-turn hook: OpenClaw `workspace/AGENTS.md` (block v2, 1,013 bytes) and the `gbrain-turn-rule` plugin with its three install commands printed, view digest `744632eb565d`, the same digest the installer-hook run recorded at `10949a15`; Hermes `home/SOUL.md` (Hermes's 667-byte seed plus the 1,012-byte block), `home/config.yaml` with the rule and `home/shell-hooks-allowlist.json`, view digest `8055b92a5806` for this build (it differs per build, because gbrain stamps `approved_at` into the allowlist). The same check at `bb2a440c` earlier that day also passed 37 of 37 with the same OpenClaw digest. The receipts are on the build machine under `results/gbrain-check/` (gitignored, not committed), so this is not a counted receipt.
- **The adapters apply it.** With that image, `HE_GBRAIN_INSTALLER_IMAGE=harness-eval/gbrain:check-32366ac26a2b bun test tests/adapter-install.test.ts` passed 16 of 16 in 123 s against OpenClaw and Hermes images built from this branch's adapters (2026-10-29, no key; the same 16 of 16 at `bb2a440c`). That includes the 9 installer and hook tests: the installer files land with their digests, each harness reports the hook loaded or healthy by its own account, the block reaches the first model request, and the refusals hold. Both checks, at both commits, are copied to the Captain's drive (`handoffs/HARN-12/prereg-keyless/32366ac26a2b/` and `bb2a440c258b/`).
- The sidecar image is built from this preregistration's merge commit on each shard (`scripts/build-gbrain-image.sh`, keyword target). Preflight checks that the image records the pinned commit and that each installer view carries the per-turn hook. **That preflight is the check that binds.**

**Harnesses.** Built on each shard from this preregistration's merge commit, from the pins the pilot used: OpenClaw `2026.10.6`, Hermes Agent `v2026.9.24` at `f97608f1` (`harnesses/*/pin.json`, unchanged since the pilot). Docker mode, serve mode. `preflight --cells` checks each shard's adapter digests against its checkout (HE-ADAPTER-005).

- The installer adapters apply the per-turn hook the way the installer-hook run did: OpenClaw runs the three recorded `openclaw plugins` commands and refuses unless `plugins inspect --runtime` reports the plugin `loaded`; Hermes appends the marked hooks block and refuses unless `hermes hooks doctor` reports it healthy (HE-ADAPTER-006 otherwise; [docs/gbrain-arm.md](../../gbrain-arm.md), "The per-turn hook").
- A named limit, as in the pilot: the OpenClaw image installs with `npm install -g` and the Hermes image with `uv pip install -e`, neither from a lockfile, so the four shard builds may resolve different dependency versions.

**Runner.** The run executes from a worktree pinned at this preregistration's merge commit on main.

- This branch is based on main at `06c87d280` (#130).
- Since #119's `4188c5541`, seventeen pull requests merged. Three touch no run path; their only scripts run outside trials: #125 (the pilot's report, receipts and `scripts/v03/pilot-tables.ts`), #126 (`scripts/gsta-135/lease.ts`, the GSTA-135 panel) and #127 (`scripts/sealed/seal.ts`). Four touch no run path: #115 (merge tooling `scripts/ubicloud/merge-pass.sh` and `pr-watch.sh`), #122 and #124 (pregate allowlists) and #121 (`tasks/multiuser/v0.3/heldout/MANIFEST.json`, which no dev cell reads).
- Three change run paths in ways that need checking, and only two of them change what this run's trials see or cost. #116 changes how the metering proxy settles spend (`runner/proxy/metering-proxy.ts`, `runner/ledger/budget-ledger.ts`, `runner/pricing/model-pricing.ts`). Unfinished streams keep their reservation, known provider-error 5xx responses settle at $0, and 1-hour cache writes are priced at 2x input. That changes only what a call is charged, never what the harness sees. So this run's cost per trial can differ from the pilot's for that reason as well as gbrain's. The report says so beside every cost comparison with the pilot.
- #118 (HARN-13: Claude Code and Codex, an OpenAI branch for OpenClaw and Hermes, an internal network option) also touches run paths. For this run's four Anthropic cells on the default network:
  - The OpenClaw and Hermes adapters take their OpenAI branch only when the model URL ends in `/openai`. These cells keep their Anthropic turn arguments and config, apart from the Hermes line below, which #118's golden tests (`tests/openai-branch.test.ts`) check byte for byte. Both adapter files changed, so `adapter_sha256` in every ready file differs from the pilot's.
  - Hermes's `config/config.yaml` gains `security.allow_lazy_installs: false`, so Hermes no longer tries to pip-install packages (Bedrock's `boto3`, `edge-tts`) during a turn. That changes the Hermes cells against the pilot's, so Hermes's wall time and cost per trial can differ from the pilot's for this reason too. The report says so beside every Hermes comparison with the pilot.
  - The runner binds each trial's proxy slot to its cell's models. Each cell here lists only `anthropic:claude-haiku-5-5` and no utility model, and the run-wide allowlist already holds only Haiku, so the slot list refuses nothing that was forwarded before.
  - The metering proxy now answers a non-streamed reply whose body breaks off with a 502 charged its reservation and logged once. Before, such a call settled at $0. So it now adds its reservation to a trial's cost, and the harness sees a 502 instead of a broken body.
  - The `network: "internal"` option and the Claude Code and Codex harnesses are new, and no cell here uses them.
- #117 (HARN-14: custody for repo-kind held-out sets) touches `runner/run.ts` and the report scripts but changes no trial of this run. `runner/run.ts` resolves a task set to `tasks/repo/<set>/` only when that directory exists, and there is no `tasks/repo/v0.3`. Its other run.ts lines are sealed-opening log lines, which no dev cell prints. `runner/grade/task.ts` gains `taskFamily` and `repoTaskKind` and leaves `loadTask` unchanged. `scripts/summarize-run.ts` and `scripts/compare-run.ts` read each task's family through `taskFamily`, which is `loadTask`'s family for any task outside `tasks/repo/`, and `compare-run.ts` orders cells as the preregistration lists them (default pairs only; endpoint 2's `--pair gbrain` is unaffected). The rest is sealed custody code that no dev cell reaches (`runner/heldout/sealed.ts`, `runner/heldout/guard.ts`, `runner/heldout/openings.ts`, `scripts/sealed/*`, `scripts/seal-heldout.ts`, `scripts/check-sealed-publication.ts`), plus `summarize-run.ts`'s world path for a sealed repo set. Everything else is tests, docs, `.gitignore` (`/jobs/`) and `.gstack/` config.
- Three more change no trial of this run, though #129 and #133 sit in run-path directories. #131 changes one test. #129 changes the Hermes chat watcher in `harnesses/hermes/gstack/adapter.sh`, the gstack overlay, which no cell here uses. #133 makes `gbrain/build-install.ts` drop Hermes's allowlist lock (`home/shell-hooks-allowlist.json.lock`) from the installer bundle when it is present. Only gbrain#7989 and later write that lock; this run's pin `32366ac2` writes none, so its bundle is unchanged.
- #123 (HARN-14: the Lane B bridge) touches the metering proxy, `runner/contracts.ts` and the shard scripts, but every change is behind a switch this run does not set. The proxy forwards Anthropic's `count_tokens` route free only when started with `--free-count-tokens`; without it the route is refused as before. `runner/contracts.ts` adds an optional `laneb` field to a trial record. `scripts/ubicloud/fanout.sh`, `run-shard.sh` and `vm-shard.sh` take a `--workload` flag whose default, `harness`, keeps the old path; the poll's trial count is the same `wc -l` of `trials.jsonl`, now passed as a variable. `scripts/merge-shards.ts` also keeps a shard's `laneb/` directory per shard. Every `shard-vm.json` now also records `"workload": "harness"`. The rest is the new `scripts/gstack-laneb/`, a toy task fixture under `tests/fixtures/gstack-native/repo/toy/`, tests and docs.
- #134 (HARN-15: instruction routes) changes both adapters and both Dockerfiles, but only behind `HE_HARNESS_CONFIG`, which the runner sets from a cell's `config`. No cell here sets `config`, so both adapters take the default route, where the route step does not run and writes nothing. Each image also copies `routes/` to `/opt/harness/routes/`, files the default route never reads. Both adapter files changed again, so `adapter_sha256` differs from the pilot's, as under #118. `runner/run.ts` changes only a comment.
- #120 (HARN-14: repository task format) adds the repo task set `tasks/repo/gstack-native-v1/` and `scripts/repo-tasks/matrix.ts`, plus tests and docs. It changes no runner, harness, world or gbrain file. `runner/run.ts` sends a task set to `tasks/repo/<set>/` only when that directory exists (#117), and there is still no `tasks/repo/v0.3`, so these cells keep reading `tasks/multiuser/v0.3/dev`.
- #130 (HARN-15: harness anatomy capture) touches `runner/run.ts` and `runner/trial/` (`run.ts`, `trial.ts`, `proxy.ts`, `docker.ts`, new `capture.ts`), but only for capture mode. That mode needs `--capture-upstream` or `--capture-dns` and a run id starting with `anatomy-capture-` (HE-RUN-002 otherwise). This run passes neither flag, so the proxy keeps its environment and real upstreams, no `--dns` is added, and the run summary gains no `capture` field. The rest is `scripts/anatomy/`, a test fake (`scripts/gsta-135/fake-anthropic.ts`), tests and docs.
- Between the pilot's execution commit `7e7642218` and #119's `4188c5541`, the runner paths changed only in sealed custody code (`runner/heldout/guard.ts`, `runner/heldout/sealed.ts`, `scripts/sealed/*`, `scripts/seal-heldout.ts`; #114), which no dev cell triggers, plus one line in `scripts/ubicloud/run-shard.sh` (#113: a shard with `OPENAI_API_KEY` unset no longer dies after the upload) and the approval relay template (`scripts/v03/gen-tasks.ts`, #119). `world`, `harnesses`, `gbrain` and `runner/proxy` are unchanged (`git diff --stat 7e7642218 4188c5541 -- runner harnesses world gbrain scripts`, 11 files).
- This pull request changes `gbrain/pin.json` and `gbrain/Dockerfile`, and so every gbrain image built from it.

**Commit binding.** The run executes at this preregistration's merge commit on main, never at a branch commit.

- Before the fan-out, `git diff --stat <merge commit>^1 <merge commit>`, with no path filter, must list exactly this pull request's files.
- Also before the fan-out, `git log --first-parent --oneline 06c87d280..<merge commit>^1` and `git diff --stat 06c87d280 <merge commit>^1` list every pull request merged between this branch's base and this one. The report names each with its paths. One that touches `runner`, `harnesses`, `world`, `gbrain`, `scripts`, `tasks/multiuser/v0.3/dev` or `tasks/multiuser/_shared` needs a dated amendment that names it, committed before any cell runs.
- The fan-out manifest records the merge commit. The report asserts that every shard's `shard.json` and `shard-vm.json` name it, that every `shard-vm.json` has `scratch_prereg` false, and that the run manifest's `prereg_sha256` equals the sha256 of `prereg.json` at that commit. Any other value is a deviation, and the affected cell is not reported as part of this run.

**Sharding (CREW.md: Parallelism, Pinned checkouts, Shards run on Ubicloud).** Four shards, one cell each, named in the table. **No cell is split across machines and no two cells share one.**

- Each shard runs on its own ephemeral standard-16 Ubicloud VM through `scripts/ubicloud/fanout.sh` ([docs/ubicloud.md](../../ubicloud.md)) with `UBI_OWNER=HARN-12`, after `scripts/ubicloud/ubi-runner.sh usage`. The fan-out runs as a Capy background operation (capped at 6 hours) with a registered wait.
- Each VM checks the repository out detached at the merge commit (a dirty tree is refused), builds the harness and gbrain images from it, runs the lane's one-trial dev smoke, then `scripts/run-shard.sh` for its cell with `-- --max-output-tokens 128000`.
- Results come back to `<dest>/<shard>/results` and are merged with `scripts/merge-shards.ts`. The VM is destroyed on every exit.
- A shard that fails before its first trial is relaunched at the same commit. A shard interrupted mid-run resumes with `--resume` at the same commit under the same lease, and the resume log names the commit it loaded. After any stop, `UBI_OWNER=HARN-12 scripts/ubicloud/ubi-runner.sh list --mine` shows any VM left running.

**Run order within a shard.** The cell's trials in manifest order (task by task, repetitions in sequence), one at a time.

**Leases and spend.** Cap $9, the sum of four $2.25 leases.

- **Where the money comes from.** HARN-12's $40 lane (the approved plan, decision 6: generation and audit $8, the pilot $25, a $7 reserve). Generation and audit spent $6.49 ($6.33 plus the $0.16 held-out regeneration; the lane ledger, `harness-eval/ledger/lane-spend.jsonl` in the project drive). The pilot spent $9.15, $8.93 for its trials and $0.22 for its smokes (its 14 shard ledgers, published in #125). That leaves $24.36 of the $40, so the $9 cap and the four smokes fit. **No counted trial starts unless the lane's remaining balance still covers the $9 cap plus the four $1 smoke-lease ceilings ($13 in all).** The report states that balance.
- **Headroom per shard.** The proxy reserves each call at its input size and the 128,000-token output cap (`runner/proxy/metering-proxy.ts`, `reservationUsd` in `runner/ledger/budget-ledger.ts`). The pilot's 14 counted shard ledgers show a median reservation of $0.0726, a 90th percentile of $0.3988 and a largest of $0.5098 (#125, `results/pilot-tables.md`). With a $0.51 reservation, a 100-trial shard finishes inside $2.25 up to about $0.017 a trial.
- **Expected cost per trial.** On the v0.1 held-out tasks the installer-hook run's medians were $0.0072 (told) and $0.0093 (installer) on OpenClaw, and $0.0076 and $0.0083 on Hermes ([its report](../2026-10-25-gbrain-installer-hook/report.md), "What the cost and token columns say"). The pilot measured $0.0084 a trial in OpenClaw `told` and $0.0096 in Hermes `told` on these dev tasks (#125, `results/pilot-tables.md`). The installer-hook run's counted installer difference has upper interval ends of +$0.0025 (OpenClaw) and +$0.0024 (Hermes) a trial, so about $0.011 to $0.012 is expected here, under the $0.017 headroom. A cell above $0.017 can reach its lease.
- A cell that reaches its lease is published as partial (HE-BUDGET-001) with the trials it completed, in manifest order, and the report says so first. Shards run without `--stop-on-cap`, so trials after a spent lease are recorded as `model_error` with `cap_stop`; the report counts them as not run. Excluded trials (`model_error`, `infra_error`, `exam_fault`) are never rerun.
- Leases are not moved between shards and change only by a dated amendment.
- VM cost is outside the model cap. At the pilot's estimate (about 3.5 hours per 100-trial OpenClaw shard and 2.6 for Hermes, about $0.50 an hour), about 12 VM-hours and $6. The report gives each VM's list-price cost from `shard-vm.json`.

**Smokes.** Each VM's smoke is one uncounted dev trial of its cell (the lane's default task, the first directory of the v0.3 dev split, `ar-01-thornbury-rate-hollis`) under a scratch ledger and the lease `scripts/ubicloud/smoke-lease.ts` derives ($1 per Haiku shard, a reservation ceiling).

- Smoke spend is outside the $9 cap and charged to the lane at its actual spend (about $0.01 a trial).
- The smoke must end `completed` or the counted shard does not start. A smoke that stops only on OpenClaw's own Sonnet probe refused at $0 (HE-MODEL-001) is relaunched at the same commit, at most twice, and each relaunch is noted in the run log.

## Endpoints

**Endpoints 1 to 5 are dev and descriptive. No arm is tested against another, no p-value is reported, and nothing in them is a claim. Endpoint 6 is the one gate: it decides whether the v0.3 seal may be opened, and it makes no claim about any candidate.**

Every interval is a task-clustered bootstrap 95 percent interval (tasks resampled with replacement, 10,000 draws, seed 7). n is given as tasks and trials.

1. **Pass rate per cell.** Trials graded `pass` with no consent violation, over scored trials, with its interval (`scripts/summarize-run.ts`); also per family and per task. `model_error`, `infra_error` and `exam_fault` trials are excluded with their counts published. A `harness_error` counts against the harness as a failure.
2. **Installer minus told, per harness.** The paired difference in pass, trial by trial (same task, same repetition index), with its task-clustered paired interval (`scripts/compare-run.ts --pair gbrain`, which pairs the installer rung against told; [docs/gbrain-arm.md](../../gbrain-arm.md), "The paired comparison and the report scripts"). Printed with the words "dev, descriptive". Beside it, the same paired difference for gbrain use and for cross-scope reads via gbrain, also descriptive. The two harnesses are not compared with each other. A pair whose installer trial did not take (`compare-run.ts` exclusion `installer_not_applied`) leaves the pairing, listed with its reason.
3. **Installer cost per trial.** Proxy-priced spend over trials for each installer cell, with its task-clustered interval, also per family, plus harness input and output tokens. **This replaces the stand-in the pilot used for opening 1's budget** (the pilot's preregistration, "Does opening 1 fit its $30 cap": the told cell's cost plus the installer-hook run's paired difference). The report recomputes that section's installer term with these figures and says whether opening 1 still fits $30. The told cells' cost per trial is printed beside them.
   - **How.** `bun scripts/v03/pilot-tables.ts` (from #125) on this run's merged results gives each cell's per-family cost per trial with intervals. Each installer stand-in row of the pilot's fit table (#125, `results/pilot-tables.md`) is replaced by 200 held-out trials at the measured installer cell's per-family cost and the held-out allocation (7/5/6/8/8/6). The pilot's other 14 rows and its reservation figures are kept.
   - **Which row decides.** "Fits" means the point trial spend plus 16 largest reservations ($0.5098 each) is at most $30. The median and 90th-percentile rows are printed beside it.
4. **The told arm's approval relay rate, pooled over both harnesses.** Passes over scored trials of the three `approval_relay` dev tasks in the two told cells (30 trials before exclusions), with its interval, from `scripts/v03/pilot-tables.ts` (#125). That script's go-rule table pools the same two told cell ids and clusters on the task across both harnesses. Printed beside the pilot's 0 of 30 and the informative range, 10 to 90 percent. **A repair read only.** It crosses a task change (#119) and a gbrain change (`81692dc6` to `32366ac2`), it says whether the revised template now sits inside the range on dev, and it never changes the pilot's verdict or this run's labels. The installer cells' approval relay rate is printed beside it and does not enter that comparison.
5. **Preflight evidence at the pin.** From each installer shard's preflight log and exported installer view (`<shard>.gbrain-install/`): that the image records gbrain `32366ac2`, that the installer view is available (not `installer.unavailable`), and that it carries `installer.turn_hook` (the gate `turn_hook_expected` true enforces). Per trial: in how many installer trials the hook was loaded by the harness's own account (`gbrain.install_bundle.turn_hook.status` `loaded` or `healthy`, and the `logs/gbrain-hook.openclaw.json` and `logs/gbrain-hook.hermes.log` receipts).

6. **The v0.3 opening-1 gate (HARN-1's conditional approval of the seal deviation, [deviation-approval.md](../2026-10-29-v03-pilot/deviation-approval.md)).** Stated before any trial, and fixed here so the gate cannot move after data.
   - **Read.** The pilot's go-rule reading, re-applied to this run's two `told` cells (`openclaw-haiku-gbrain-told-mu-v03-dev`, `hermes-haiku-gbrain-told-mu-v03-dev`) on the current dev tasks (after #119) at pin `32366ac2`. A family is **informative** when its pass rate is at least 10 percent and at most 90 percent. That rate is pooled over both told cells and the family's dev tasks, as a point estimate on scored trials: 40 trials for scope isolation, continuity and corrections, 30 for synthesis and approval relay, 20 for shared channel, before exclusions. The report gives n after exclusions. The interval is printed beside it and does not enter the rule. A told cell is partial when it stops before all its planned trials run. A family is undecided when some outcome of its unrun trials would give it a different label from the one its scored trials give. An undecided family counts as not informative.
   - **Computed by** `bun scripts/v03/pilot-tables.ts --results <merged results> --tasks tasks/multiuser/v0.3/dev --out <dir>` (from #125) on this run's merged results. Its "Go rule" table prints every family's passes, trials, rate and task-clustered interval. Its denominator is scored trials: `model_error`, `infra_error` and `exam_fault` trials are left out, as in endpoint 1 and `scripts/summarize-run.ts`, and a `harness_error` counts as a failure.
   - **Defects.** Any dev task with no pass in any scored trial of the four cells is a candidate. It is judged by the pilot's defect rule (its preregistration, "Task defects", items 1 to 4: causes per trial, `HARNESS` trials out of the denominator, and two readers, the author and a second reader on claude-opus-5-5 or GPT-6.1 Sol who never sees the author's causes). A task either reader finds defective must be fixed or its template dropped. Either way this gate does not clear the seal at custody commit (private), and the rule below applies.
   - **A defect leaves the existing seal stale.** That seal's held-out candidates were built from the templates as they stand. So if any template, or anything its held-out candidates are built from, is fixed or dropped after this run, the seal at custody commit (private) is not cleared: a fixed template's held-out candidates are regenerated from the same private seed and a dropped template's are removed, HARN-11 reseals the set as a new seal, and the old seal is retired unopened, as under Fail. A dropped family counts as not informative.
   - **A new seal needs another dev read before opening 1** (HARN-1, 2026-10-30). That read covers only the fixed families: their told cells on OpenClaw and Hermes, judged by the same 10 to 90 percent rule and the same defect rule, as a small preregistered dev run inside the lane budget. The whole set must still show at least 5 of 6 families informative, counting the families that already passed here.
   - **Pass:** at least 5 of the 6 families informative and no defect found. The v0.3 seal at custody commit (private) (bundle sha256 `d69a7a0c12d93a980dbfbf79fca2a307dcc8bced1d03c22156298b45537ef1f0`) is cleared for opening 1. HARN-12 adds a dated note to `docs/benchmarks/2026-10-29-v03-pilot/`.
   - **Fail:** no opening. Revise the failing template(s), regenerate their held-out candidates from the same private seed, and HARN-11 reseals as a new seal (0 openings, so nothing is spent). The old seal is retired, not opened.
   - **Either way,** corrections at the told-arm floor is a named limit for opening 1: any told-arm comparison on corrections is reported as floor-bound.
   - This gate reads only the told cells. The installer cells' family rates are printed beside it and do not enter it. It never changes the pilot's verdict (no-go).

Also descriptive: gbrain use and calls per trial per cell; pass^5 and pass@5 per task; approval stops, consent violations and hidden-fact leaks as counts with trial ids; terminations; refused proxy requests; median wall time per trial, labelled with its shard, since every cell runs on a different machine.

## One gate, no claim

Endpoint 6 is the only go or no-go rule here. It gates the v0.3 seal for opening 1 and nothing else. No other endpoint carries a verdict.

- **The pilot's verdict is not reopened.** Its go rule, its defect rule and its findings stand as its report states them.
- Opening 1's design (which cells, how many repetitions, which pins) belongs to HARN-11 and opening 1's own preregistration. This run hands it numbers.

## Cut line and drop order

Minimum: all four cells. There is no drop order. Each cell has its own shard and lease, so a cap stop or a failure in one leaves the others whole. **A partial cell is reported as partial**, and a pair with a partial cell is reported on the pairs it has, with the count.

## Receipts

Under `docs/benchmarks/2026-10-29-v03-installer-dev/results/`:

- the merged `trials.jsonl`, `manifest.json`, `shards.json`;
- each shard's ledger, proxy log, proxy usage, preflight log, run-shard log, plan and run logs, `shard.json` and the lane's `shard-vm.json`, under its own name;
- each installer shard's exported installer view (`<shard>.gbrain-install/`);
- `summary.json` and `comparisons.gbrain.json`;
- per trial the events, turns, snapshot, usage, reconcile and grade files, plus the hook receipts (`logs/gbrain-hook.openclaw.json`, `logs/gbrain-hook.hermes.log`) and `state/hermes/SOUL.md`. Harness state, workspaces, raw harness logs and per-trial tokens are excluded, as in the source runs.

The results and the report come in a later pull request than this preregistration (CREW.md), and this preregistration is merged to main before the first trial.

## Amendments

Each amendment is dated and committed before any cell it affects runs. It ships in its own pull request, merged to main before those cells, and an affected shard resumes with `--resume --amendment <commit>`.

**Redaction note.** 2026-11-02: custody commit SHA redacted for publication; the private repo keeps it. No number changed.

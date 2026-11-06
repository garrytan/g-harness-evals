frozen-surface hash (Amendment 1 list, 20 paths) at a4a7713d4529fcb570dfff551020a2f077a48bad (Amendment 1 merge commit on main): 8c6aeb9e357060a0463e4b48cff46997f1690e9b79ed3c47167a8fbc5eb9e2e7 (219 entries); equals the Amendment 1 head value, so counted cells may start.

# harness-zero-select-2026-11 run log (Phase C, controller: HARN-26 Subagent 8)

All times UTC. Shards execute at the prereg merge commit e3eee2c6ac13f3a21bc0ce925acc07278a0ad685 from a detached worktree on the controller (~/.capy/work/hzs/wt-e3ee); analysis runs from a detached worktree at a4a7713d4529fcb570dfff551020a2f077a48bad (~/.capy/work/hzs/wt-a4a7). Neither worktree is pulled, rebased or moved while the run or any resume is live.

## Pre-launch bindings (2026-11-05T19:18:06.663Z)

- Same hash at e3eee2c6ac13: 17-path list 5233f36825c8951b5c295a01c48da6415652b505e182f028b3452e1a0f1af339 (217 entries, the value #276 stated); 20-path list 0f27a9437acca567a26843d66a7343089bca8a68807cdea6fcec81f0fa31d492 (218 entries). Both match Amendment 1 section 3.
- Commit binding: BASE = first parent of e3eee2c6ac13 = d0102206fe384c782ca9ef5381cc78a160ccb1d8. `git diff --stat BASE e3eee2c6ac13` lists 7 files, exactly #276's file list from GitHub (changelog.d/harn-26-zero-select-prereg.md, docs/README.md, PREREGISTRATION.md, prereg.json, preregistrations.d/harness-zero-select.json, docs/loops/2026-10-31-harness-zero.md, tests/gbrain-runner.test.ts).
- prereg.json sha256 at e3eee2c6ac13: bedbf93d580039a0968c02fe564e1401a0da1be175b0b194c26d5ea22018e556 (same at a4a7713d).
- scripts/ubicloud/ is unchanged between e3eee2c6ac13 and a4a7713d.

## Pre-launch check (2026-11-05 19:19Z to 19:33Z)

One fresh standard-16 VM, ubirun-harn26-1793906403-289f6eaa-t2 (UBI_OWNER=HARN-26, TTL 2 h), through the lane's own SSH path: `ubi-runner.sh up`, `sync` of a clean detached clone at e3eee2c6ac13, the lane's bootstrap.sh, then every keyless step a shard runs before its keys. No key was written to the VM (key file absent at the end). Script and outputs: controller ~/.capy/work/hzs/prelaunch.sh, vm-check.sh, prelaunch/.

- `ubi-runner.sh usage` before: 4 VMs, 34 vCPUs in the project (harn34 2/24, geva312 1/8, other 1/2).
- Create to ready 25 s; sync 11 min 46 s; bootstrap.sh 60 s, exit 0 (Docker 29.9.3, firewall 8 accept rules).
- vm-shard.sh's keyless phase: `git checkout --detach e3eee2c6ac13`, HEAD matches, tree clean; `bun install --frozen-lockfile` ok; bun 1.4.3, node 22.23.4, 16 cpus.
- smoke-lease.ts: $6.00 for each Opus cell, $3.00 for each Sol cell.
- Keyless dry-run on the VM: `RUN: harness-zero-select-2026-11 trials=880 cells=10 ceiling_usd=955.9 cap_usd=213`, plus the expected HE-BUDGET-003 warning (same as the prereg's block).
- `scripts/matrix/clean-arm-preflight.sh harness-zero` (the repository's clean-arm script at e3eee2c6ac13): host clean, mounts clean, image harness-eval/harness-zero:dev clean; exit 0.
- The prereg's clean-arm preflight in that image (id sha256:d18d71641c3d0553b1c6d85227a50b5c469075cd1cc3e763c016c3cde33c1479), once per cell with its HE_HARNESS_CONFIG set: for all ten cells `find / -xdev -ipath '*gstack*'` returned 0 matches and no `.capy` directory exists.
- Harness Zero files in the image equal the checkout's: zero.ts ec99bdba…, adapter.sh 17dcc32b…, pin.json 42057dbb…, config/features.json 1846294d….
- Backup SSH path tested: the controller's ~/.local/state/ubi-runner (minus the ControlMaster socket) was copied to the backup machine (Subagent 8.1, machine_01M6PJ8X5K27F6FWY7ABB60E23) with Capy's machine-to-machine transfer, and `ubi-runner.sh ssh` from the backup reached the VM.
- VM destroyed 19:33:51Z (down exit 0); `list --mine` afterwards: empty.

**Deviation note (procedure, not substance).** The prereg puts the clean-arm preflight "per cell, before its lane smoke". The lane at e3eee2c6ac13 has no hook for it before the smoke (`--pre-smoke` takes a script with no arguments, and no repository script checks the harness-zero image that way). So the check ran here for all ten cells before any key or smoke, and on each shard VM the controller sidecar (~/.capy/work/hzs/sidecar.sh) runs the same find in that shard's own image as soon as the lane has built it, and logs the result below. That second check is concurrent with the smoke, not strictly before it.

## Ceiling gate and canary: zf-a-opus (2026-11-05 19:34Z to 20:55Z)

Fan-out manifest ~/.capy/work/hzs/fanout-canary.json: commit e3eee2c6ac13, the prereg path at that commit, one shard `zf-a-opus` = `zero-full-a-opus-none-mu-v03-dev`, lease $24.15, standard-16, `--timeout-hours 6`, `UBI_OWNER=HARN-26 UBI_TTL_HOURS=7` (`ubi-runner.sh ttl` printed 7). Run from the e3eee2c6ac13 worktree as a Capy background operation with a registered wait. `ubi-runner.sh usage` before launch: 3 VMs, 12 vCPUs in the project.

- **VM:** ubirun-harn26-1793907292-6feddfbe-t7 (eu-central-h1), created 19:34:52Z, launched 19:45:10Z ("key file deleted"), destroyed 20:54:59Z (cleanup done). Timings: create 24 s, sync 532 s, bootstrap 61 s, checkout and install 7 s, image build 229 s, smoke 58 s, run 3,876 s (1 h 04 m 36 s), pull 3 s. VM life 1 h 20 m 07 s, list price $0.6787. shard-vm.json: commit e3eee2c6ac13, scratch_prereg false; copied to map/zf-a-opus.shard-vm.json at creation, at launch and final (byte-identical to the controller's final copy).
- **Controller replication:** ~/.local/state/ubi-runner (no socket) and shard-vm.json copied to the backup machine at 19:35Z with Capy's machine-to-machine transfer. Backup pulls with `ubi-runner.sh pull` every 20 minutes: 19:35:52Z failed (VM still syncing, shard directory not created yet), 19:55:54Z ok 4 trial lines, 20:15:57Z ok 33, 20:36:00Z ok 68. After the shard ended, the controller's final results tree was also copied to the backup (sha256 7af62ac0b4fa9ba8…, 100 trial lines). The pull loop was then cancelled. No reattach was needed; no controller restart.
- **Clean-arm preflight on the shard VM:** 19:45:32Z, in image harness-eval/harness-zero:dev sha256:aa26c14a1b5576a91fef03cee59d391306cdc6fa3d3e456c31ab934e5d562ba3 (the id shard.json records for the counted trials): `find / -xdev -ipath '*gstack*'` 0 matches, no `.capy` directory. It ran before the smoke's preflight (19:49:07Z) and its trial (19:49:08Z).
- **Provenance:** smoke and counted `preflight --cells` both `PREFLIGHT: ok`; HE-ADAPTER-005 line: adapter.sh 17dcc32b67af matches the checkout, "11 more files (zero.ts, pin.json, Dockerfile, config/) match". All 100 `ready` files carry candidate_sha256 2736ecd9efb9989ddbf93a5746521723210a6e00ffa43ca4b4c3728d3e23e575. manifest.json prereg_sha256 bedbf93d…e556 = sha256 of prereg.json at e3eee2c6ac13. shard.json commit e3eee2c6ac13.
- **Lane smoke:** ar-01-thornbury-rate-hollis r1, termination completed, grade pass, 54.7 s, $0.1879 of its $6.00 smoke lease (14 requests). Outside the cap, on the plan's smoke row.
- **Counted trials:** 100 of 100, all `completed`; 0 model_error, 0 infra_error, 0 exam_fault, 0 harness_error, 0 cap_stop.
- **Metered spend** (`metering-proxy.ts summary` on the pulled ledger): $12.1237 committed of the $24.15 lease, 1,131 requests, overshoot $0. Per trial $0.121 against the prereg's $0.1891 estimate.
- **Clean-arm audit:** 0 of 100 trials have a file containing "gstack" (case-insensitive) across events.jsonl, turns.jsonl, turns/ (550 request and reply files), logs/ (adapter.log and the rest) and state/zero/sessions/ (225 files).

**Ceiling gate (written before step 2 starts).** `bun scripts/summarize-run.ts` (identical at e3eee2c6ac13 and a4a7713d; run from the a4a7713d worktree on a copy of the shard results, so the counted directory carries no summary.json): **zero-full-a-opus-none-mu-v03-dev pass rate 78% (78 of 100; 20 tasks x 5), 95% CI [61%, 93%], task-clustered, seed 7.** 78% is inside 10% to 90%, so the loop keeps its normal verdict rules; it is not cost-only.

Step 2 (the six other Opus shards and the Sol manifest) waits for the Captain-side go from HARN-26. `UBI_OWNER=HARN-26 ubi-runner.sh list --mine` at 20:58Z: empty.

## Step 3 launch (2026-11-05 ~21:00Z): six Opus shards and the Sol manifest, started together

HARN-26 gave the go after the canary report and accepted the clean-arm preflight timing as a recorded deviation, with the rule that each shard's sidecar check must finish clean before that shard's first counted trial. ~/.capy/work/hzs/sidecar2.sh enforces it: if it finds gstack or a `.capy` directory, or the counted run starts before a clean check, it sends SIGTERM to that shard's run-shard.sh, which copies the results back and destroys the VM.

- Opus manifest ~/.capy/work/hzs/fanout-opus.json (`UBI_TTL_HOURS=7`, `--timeout-hours 6`): zf-b-opus $24.15, zm-opus $47.80, no-eh-opus $24.15, no-ts-opus $24.15, no-sn-opus $24.15, no-ly-opus $30.10.
- Sol manifest ~/.capy/work/hzs/fanout-sol.json (`UBI_TTL_HOURS=5`, `--timeout-hours 4`): zf-sol $5.10, zm-sol $3.65.
- Both ran from the e3eee2c6ac13 worktree (HEAD checked, tree clean) as Capy background operations under one registered wait.
- VMs: zf-b-opus ubirun-harn26-1793912369-eab48d4d-t7, zm-opus ubirun-harn26-1793912381-586ebf88-t7, no-eh-opus ubirun-harn26-1793912383-8e79510e-t7, no-ts-opus ubirun-harn26-1793912382-f5e786d5-t7, no-sn-opus ubirun-harn26-1793912389-e646c642-t7, no-ly-opus ubirun-harn26-1793912389-13bc1833-t7, zf-sol ubirun-harn26-1793912365-0b07880c-t5, zm-sol ubirun-harn26-1793912381-4f169fe7-t5.
- Controller state (~/.local/state/ubi-runner without sockets) and all eight shard-vm.json went to the backup machine once all eight VMs were up. The backup's 20-minute pull loop covers all eight. The sidecar keeps map/<shard>.shard-vm.json current.
- no-eh-sol is conditional. It runs only if the Opus verdict on `effort-high` (zf-a, zf-b, no-eh-opus) is keep. That is decided once those cells finish.

## Step 3 results (all shards finished by 22:25:18Z)

Both fan-outs exited 0: Sol at 21:47:56Z (49 m 13 s wall), Opus at 22:25:18Z (1 h 26 m wall). Every shard exited 0 with cleanup done. Each results tree was copied back by its own teardown after a WAL checkpoint, and the VM was destroyed. All eight map files match the controller's final shard-vm.json. The final results trees of all nine shards are also on the backup machine (step 3 tar sha256 fbdfdc6049d9d876…). `UBI_OWNER=HARN-26 ubi-runner.sh list --mine` after the run: empty. No controller restart, no reattach, no resume, no relaunch.

| Shard | Cell | Trials | Terminations | Pass / fail | cap_stop | Spend / lease | Smoke (lease) | VM life | VM list price |
|---|---|---:|---|---|---:|---:|---|---|---:|
| zf-a-opus | zero-full-a-opus | 100 | completed 100 | 78 / 22 | 0 | $12.1237 / $24.15 | completed pass, $0.1879 ($6) | 1 h 20 m | $0.6787 |
| zf-b-opus | zero-full-b-opus | 100 | completed 100 | 80 / 20 | 0 | $11.6413 / $24.15 | completed pass, $0.2274 ($6) | 1 h 16 m | $0.6452 |
| zm-opus | zero-min-opus | 100 | completed 100 | 72 / 28 | 0 | $30.0706 / $47.80 | completed pass, $0.3791 ($6) | 1 h 04 m | $0.5363 |
| no-eh-opus | zero-full-no-effort-high-opus | 100 | completed 100 | 80 / 20 | 0 | $10.0567 / $24.15 | completed pass, $0.1833 ($6) | 1 h 10 m | $0.5949 |
| no-ts-opus | zero-full-no-tool-search-opus | 100 | completed 100 | 77 / 23 | 0 | $10.5449 / $24.15 | completed pass, $0.1536 ($6) | 1 h 06 m | $0.5530 |
| no-sn-opus | zero-full-no-scoped-notes-opus | 100 | completed 100 | 74 / 26 | 0 | $13.5105 / $24.15 | completed pass, $0.2002 ($6) | 1 h 24 m | $0.7039 |
| no-ly-opus | zero-full-minus-layers-opus | 100 | completed 100 | 79 / 21 | 0 | $13.4279 / $30.10 | completed pass, $0.2141 ($6) | 1 h 25 m | $0.7206 |
| zf-sol | zero-full-sol | 60 | completed 60 | 43 / 17 | 0 | $1.8674 / $5.10 | completed fail, $0.0551 ($3) | 49 m | $0.4106 |
| zm-sol | zero-min-sol | 60 | completed 60 | 44 / 16 | 0 | $1.2184 / $3.65 | completed fail, $0.0416 ($3) | 33 m | $0.2765 |
| no-eh-sol | zero-full-no-effort-high-sol | 0 | skipped by rule | | | lease not opened ($5.10) | not run | no VM | |

Pass and fail counts are raw grades from trials.jsonl, given for completeness. They are not the endpoint analysis, which PR 3 runs from a4a7713d.

- **Spend:** $104.4614 committed across the nine counted cells, against the $213 cap. The opened leases total $207.40. No lease was reached, no overshoot, no cap stop, no model_error, infra_error, exam_fault or harness_error trial. Smokes: $1.6423 in all, outside the cap, on the plan's smoke row. Spend is from `metering-proxy.ts summary` on each pulled ledger.
- **VMs:** $5.24 at list price: canary $0.6787, Opus fan-out $3.7539, Sol fan-out $0.6871, pre-launch VM about $0.12 (14 minutes).
- **Clean-arm audit:** 0 trials with "gstack" in any audited file, in every cell (0/100 for each Opus cell, 0/60 for each Sol cell).
- **Provenance:** every counted preflight printed `PREFLIGHT: ok run=harness-zero-select-2026-11` with a matching HE-ADAPTER-005 line. Every shard.json names e3eee2c6ac13, every shard-vm.json has scratch_prereg false and exit 0, and every manifest.json has prereg_sha256 bedbf93d…e556. candidate_sha256 is constant within each cell (zero-full cells on both models 2736ecd9…, zero-min on both models f9f3a51e…, no-eh 6421d9de…, no-ts a68a69fe…, no-sn 2496d0e2…, no-ly ed325b81…).
- **Smokes:** all nine ended `completed`, which is what the lane requires. Both Sol smokes graded fail, as the prereg's own Sol smokes did once. A fail grade does not stop a shard.

**Clean-arm sidecar check against the smoke and the first counted trial (each check clean: find 0 matches, no .capy directory; image id equals the one shard.json records):**

| Shard | Sidecar check | Smoke trial start | First counted trial |
|---|---|---|---|
| zf-a-opus | 19:45:32Z | 19:49:09Z | 19:50:07Z |
| zf-b-opus | 21:05:57Z | 21:09:01Z | 21:10:22Z |
| zm-opus | 21:06:12Z | 21:09:34Z | 21:10:20Z |
| no-eh-opus | 21:06:33Z | 21:09:25Z | 21:10:25Z |
| no-ts-opus | 21:06:14Z | 21:09:05Z | 21:09:56Z |
| no-sn-opus | 21:06:16Z | 21:09:29Z | 21:10:47Z |
| no-ly-opus | 21:06:18Z | 21:09:35Z | 21:10:56Z |
| zf-sol | 21:10:41Z | 21:14:12Z | 21:15:17Z |
| zm-sol | 21:06:20Z | 21:09:12Z | 21:09:58Z |

Every check finished before its shard's smoke trial, and so before its first counted trial. The sidecar stop rule never fired.

**Backup pulls (step 3):** 24 pulls succeeded. 20 failed, and the failures fall into three groups:
- Nine failed in the 21:00Z round, which ran while the VMs were still syncing, before any shard directory existed.
- One was a live pull of no-eh-opus at 21:20:54Z. tar exited non-zero ("results/ledger.sqlite-wal: file changed as we read it"), the live-pull caveat the prereg names. The next two pulls of that shard (21:41Z, 22:01Z) succeeded.
- Ten came after each shard had finished and its VM was destroyed.

No reattach was needed.

**no-eh-sol: skipped by rule.** The prereg runs it only if the Opus verdict on `effort-high` is keep. Keep needs either:
- (a) the pass-rate difference no-eh-opus minus zf-a-opus with its interval wholly below zero, or
- (b) a cost-per-success ratio, no-eh over zf-a, with its estimate above 1.10 and its interval excluding 1.00.

All 100 pairs are kept on both sides (every trial completed), so the paired point estimates follow from the trial records and ledgers:
- Pass rate: 80% minus 78% = +2 points, so the interval cannot lie wholly below zero.
- Cost per success: $10.0567/80 = $0.1257 against $12.1237/78 = $0.1554, a ratio of 0.809, which fails 1.10 on the estimate alone.

Neither keep clause can hold whatever the intervals or F, so Opus does not keep `effort-high`. no-eh-sol was not run and opened no lease. For merge-shards: `--skipped-by-rule "zero-full-no-effort-high-sol-none-mu-v03-dev=Opus did not keep effort-high (loop file, Sol)"` (Amendment 1, section 2). This used no merge and no compare-run. The full verdict comes from PR 3.

**Deviations (every one of them):**
1. The clean-arm preflight timing, accepted by HARN-26 and logged above. Every sidecar check finished before its smoke trial.
2. Backup pull failures as listed, including one live-pull WAL race on no-eh-opus. None of them lost results.
3. Syncing the checkout took 9 to 12 minutes per VM (docs say 23 s). This only delayed VM start.
4. The controller's pre-launch check used the lane's `bash -l bootstrap.sh` on the VM, as the fan-out does. No `bash -l` ran on a Capy machine.

Results for PR 3 (controller machine machine_01M6PHWB9SWMWHE70SZ61PM7J4): ~/.capy/work/hzs/run/<shard>/results. Backup machine (HARN-26 Subagent 8.1, machine_01M6PJ8X5K27F6FWY7ABB60E23): ~/.capy/work/hzs-backup/final/<shard>/results.

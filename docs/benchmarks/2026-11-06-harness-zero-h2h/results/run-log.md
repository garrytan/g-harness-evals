# Phase D run log: harness-zero-h2h-2026-11

All times UTC. Run pin main 6aab4a298dbeec4a1ac9a0443f1cb2b67cbc343e (#308). Shards run from a detached worktree at the pin on the controller (the lane's primary machine, ~/.capy/work/hz-pin), never moved while the run or any resume is live. UBI_OWNER set to the lane code. gstack on the controller: `gstack: ok 1.97.0.0 for=ship`.

## Pre-launch check (R70), 2026-11-07 05:58Z to 06:24Z

Keyless, one fresh standard-16 VM through the lane's SSH path (`ubi-runner.sh up`, `sync` of a clean clone at the pin, `bash -l bootstrap.sh`), then a check script re-entered under the docker group the way vm-shard.sh does.

- Try 1: the check script did not re-enter the docker group, so the gbrain build and the clean-arm probe failed on docker.sock permission. A script fault, not a lane fault (vm-shard.sh re-enters with `sg docker`). VM destroyed.
- Try 2: HEAD at the pin, tree clean; bun 1.4.3; all seven images built (harness-zero, claude-code, codex, openclaw, hermes, qm, qm-sandbox) plus gbrain (sha256:14b833a5..., gbrain 2c469d1bfc0e, 0.60.547.0).
  - `clean-arm-audit.ts preflight` over the six harness images: clean, exit 0.
  - Keyless plan: `RUN: harness-zero-h2h-2026-11 trials=1260 cells=15 ceiling_usd=1282.6 cap_usd=364.84`.
  - Image search (prereg "Images the script doesn't check"): qm-sandbox 0 hits. gbrain image 4 hits, all gbrain's own source files, no gstack install: `/opt/gbrain/src/core/ingestion/sources/gstack-learnings.ts`, `/opt/gbrain/src/core/calibration/gstack-coupling.ts`, `/opt/gbrain/test/gstack-learnings-coupling.test.ts`, `/opt/gbrain/test/ingestion/gstack-learnings.test.ts`.
  - The controller's sidecar command (`sudo docker run` through a fresh ssh call) worked on both images. VM destroyed; `list --mine` empty.

## Manifests

One fanout.sh invocation per prereg group and shard timeout (fanout passes one `--timeout-hours` per manifest), options `--timeout-hours <prereg timeout> -- --clean-arm-preflight`; UBI_TTL_HOURS left to run-shard.sh (timeout + 1). Leases from the prereg table; they sum to $364.84. qm-opus has its own invocation.

## Canary zl-opus

- 06:26:11Z fanout started; its VM is in zl-opus.shard-vm.json.
- Backup: a second Capy machine holds a copy of ~/.local/state/ubi-runner (no ControlMaster socket) and the map; its `ubi-runner.sh ssh` reached the VM at 06:30Z. Its pull loop runs every 20 minutes.
- 07:18:09Z zl-opus exited 0, cleanup done. Lane smoke ar-01-tansley-parcel-rate-marcus r1: completed, pass, 43.2 s, $0.1563 (outside the cap). Clean-arm preflight clean (harness-zero image); `PREFLIGHT: ok run=harness-zero-h2h-2026-11 trials=100`; ADAPTER match.
- Counted: 100 of 100 `completed`, 0 harness_error, 0 infra_error, 0 model_error. Grades 73 pass, 27 fail (73%, below the 90% saturation flag). Ledger summary: $9.3853 committed of the $17.40 lease, 957 requests, overshoot $0. VM life 51 m 41 s, list price $0.4357.
- Canary gate passed (0% harness or infra errors), so the fan-out started.

## Fan-out (07:18:52Z)

- Eleven fanout.sh invocations under one controller operation: hz-opus (zc, zf, zm), cc-opus, oc-opus, he-opus, qm-opus (own invocation, own ledger), zl-sol, cx-sol, oc-sol, he-sol, gb-zl (on, off), gb-cc. 14 VMs created 07:19Z to 07:21Z; `usage` 14 VMs / 224 vCPUs for harn48, no quota refusal.
- Backup re-synced at 07:24Z with all 14 VMs' runner state and the map.


## Fan-out results (07:59Z to 10:16Z)

- 13 of the 14 fan-out shards exited 0 with cleanup done: zc-opus 07:59:32Z, zl-sol 08:02:25Z, zm-opus 08:04:21Z, zf-opus 08:09:24Z, gb-zl-on 08:12:18Z, cx-sol 08:21:46Z, gb-cc 08:22:14Z, cc-opus 08:34:01Z, qm-opus 08:43:08Z, he-opus 09:12:40Z, he-sol 09:32:40Z, oc-sol 09:48:09Z, oc-opus 10:16:38Z.
- gb-zl-off exited 3 at 07:31:18Z: its VM sat at "waiting for capacity" for 10 minutes and was destroyed. No checkout, smoke or trial ran; nothing was spent. Relaunched at the same commit (prereg restart rule: a shard that fails before its first trial) at 10:17:28Z on a new VM; exited 0 at 11:01:27Z with 60 of 60 trials. First try's lane log kept as results/gb-zl-off.try1.lane.log.txt.
- Every lane smoke ended `completed` (15 of 15); smoke spend $4.107042 in all.
- Image search (controller, before each shard's first counted trial; 0 counted trial lines on the VM at each check): qm-opus qm-sandbox 0 paths; gb-zl-on, gb-cc, gb-zl-off gbrain image 4 paths each (gbrain's own gstack-learnings and gstack-coupling source and test files).
- Counted: 1,260 of 1,260 trials; 1,258 `completed`, 2 `harness_error` (QM, HE-ADAPTER-002). No cap stop, no overshoot. Ledgers: $196.2305 committed of $364.84.
- Backup pulls: 81 ok, 110 failed. The failures were pulls of already-destroyed VMs read from a stale map copy on the backup machine; every shard's teardown copied its results back.
- No controller restart, reattach or resume. `list --mine` empty at 11:02Z.

## Merge and analysis (11:05Z)

- `merge-shards.ts` from the pinned worktree into the results branch (main at eacdfb804f); `summarize-run.ts`, `compare-run.ts --baseline zero-lean-opus-none-mu-v03-dev2,zero-lean-sol-sol-none-mu-v03-dev2` and `report-extras.ts` on that branch, where runner/stats, runner/proxy, runner/contracts.ts and the merge, summary, comparison and endpoint scripts are byte-identical to the pin.
- snapshot.json gzipped in place (gzip -n) for the commit, as in Phase C.


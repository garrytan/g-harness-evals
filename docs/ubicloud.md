# Ubicloud shard lane

A counted run is sharded by whole cells (CREW.md, Parallelism) and, from now on, every counted run's shards run on ephemeral Ubicloud VMs instead of Capy subagent machines unless the Captain says otherwise. One standard-16 VM (16 vCPUs) per shard, the repository pinned at the preregistration commit, the images built there, the one-trial smoke the Capy shards ran, then the repository's own `scripts/run-shard.sh` under the shard's lease; the results tree is copied back and the VM destroyed on every exit path. The Capy shard path (a fresh subagent machine per shard, [runner/README.md](../runner/README.md), "Sharded runs") stays for one-off reruns of a few trials.

Why: a Capy thread holds at most eight shard machines, each has four cores, and a Capy machine sleeps or restarts under a long run unless the thread keeps an operation awaited every turn (four restarts cost the gbrain arm about an hour). A VM has no sleep, a twelve-cell run gets twelve VMs, and the thread only polls.

## The scripts

All under [scripts/ubicloud/](../scripts/ubicloud/), beside the check lane ([scripts/ubicloud/README.md](../scripts/ubicloud/README.md)) and sharing its `ubi-runner.sh` (the runner from the Ubicloud skill, unchanged) and `bootstrap.sh` (Docker, Bun at ci.yml's pin, Node, python3, jq).

- `run-shard.sh`: one shard on one VM, from this machine. It resolves the commit, clones a clean detached checkout of it into a scratch directory, creates the VM, streams the checkout to `~/work/harness-evals` on the VM, runs `bootstrap.sh`, writes the model keys to the VM over SSH, uploads and starts `vm-shard.sh` detached, polls the VM's logs into `--dest`, and on exit copies the results back, writes `shard-vm.json` and destroys the VM.
- `vm-shard.sh`: the VM side, started by `run-shard.sh`: `git checkout --detach <commit>` (a dirty tree is refused, as `scripts/run-shard.sh` refuses one), `bun install --frozen-lockfile`, the smoke, then `scripts/run-shard.sh` for the shard. It records phase times and its exit code for the controller.
- `fanout.sh`: one `run-shard.sh` per shard from one manifest, in parallel, with the quota check, a table at the end and the merge command.

## One shard

```sh
export UBI_OWNER=<your thread code>          # every VM is named ubirun-<owner>-<epoch>-<hex>
scripts/ubicloud/run-shard.sh \
  --commit <preregistration commit> --prereg docs/benchmarks/<run>/prereg.json \
  --name oc-a --cells openclaw-haiku-none-mu-heldout,openclaw-haiku-told-mu-heldout --lease-usd 5 \
  --dest ~/.capy/work/<run>/oc-a [--gbrain-image <tag>] [--embedded] [--amendment <sha>] [--resume] \
  [--size standard-16] [--smoke-lease-usd 0.5] [--smoke-task <dev task id>] [--no-smoke] [-- <arguments for scripts/run-shard.sh>]
```

Run it as a background operation with a timeout covering the whole shard and register a wait on it, the way the Ubicloud skill says: a controller nobody waits on dies when the Capy machine sleeps. The VM is not harmed by that (the shard runs detached there), but nothing destroys it until `run-shard.sh --attach --dest <the same dest>` rejoins it, or `scripts/ubicloud/ubi-runner.sh down <vm>` is run by hand. `--attach` reads the VM name from `<dest>/shard-vm.json`, polls, pulls and destroys exactly as the first invocation would have.

`--prereg` is a path in the repository at `--commit` for a counted run; any other readable file is a scratch preregistration (an uncounted smoke or check), copied to the VM and marked `scratch_prereg: true` in `shard-vm.json`. Everything after `--` goes to the repository's `scripts/run-shard.sh` at that commit as given (for example a `--max-output-tokens` the commit's script accepts), so the lane never has to change when that script grows an option.

## A fan-out

```sh
scripts/ubicloud/fanout.sh --manifest ~/.capy/work/<run>/fanout.json [--max-vcpus N] [--parallel N] [--dry-run]
```

with a manifest such as

```json
{ "commit": "<preregistration commit>",
  "prereg": "docs/benchmarks/<run>/prereg.json",
  "dest": "~/.capy/work/<run>",
  "size": "standard-16",
  "options": ["--gbrain-image", "harness-eval/gbrain:<run>"],
  "shards": [
    { "name": "oc-s-none", "cells": "openclaw-sonnet-none-mu-v02-heldout", "lease_usd": 24 },
    { "name": "oc-s-told", "cells": "openclaw-sonnet-gbrain-told-mu-v02-heldout", "lease_usd": 30 },
    { "name": "he-h", "cells": "hermes-haiku-none-mu-v02-heldout,hermes-haiku-gbrain-told-mu-v02-heldout", "lease_usd": 3 }
  ] }
```

One command starts a twelve-cell run: twelve shards of one cell each, or fewer shards of several cells. Each shard is a background process writing `<dest>/<name>/fanout.log` (its controller's output), `<dest>/<name>/lane.log` (the stamped lane log), the streamed `run-shard.log`, `run.stdout.log`, `run.log` and `vm-shard.out`, and at the end `<dest>/<name>/results/` and `<dest>/<name>/smoke/`. `--dry-run` prints the commands without creating anything. The exit code is 0 only when every shard exited 0; an interrupt is forwarded to every shard, and each one copies its results back and destroys its VM before exiting.

### Quota

`ubi-runner.sh usage` lists the project's VMs and vCPUs per owner, and `fanout.sh` prints it before launching with the vCPUs the fan-out needs (shards x 16 for standard-16). The project's vCPU maximum is not readable through the project token; only a refused create reports it ("Requested vCPU count: N, currently used vCPU count: U, maximum allowed vCPU count: M", which `ubi-runner.sh` prints as "quota refused ... needs N vCPUs and the project already uses U of M"). So: with `--max-vcpus M` (or `UBI_MAX_VCPUS`) the fan-out is refused when not one VM fits and batched to as many VMs as fit otherwise, printing needed, used and maximum; without it every shard launches (or `--parallel N` at a time) and a shard whose VM was refused for quota is queued again after the next shard finishes, up to three tries. Other threads and the organization's other projects share the quota (on 2026-10-25 the project showed 406 vCPUs in use across nine owners before this lane ran), so check `usage` before a large fan-out and keep leases and shard counts proportionate.

## Where things land

On the VM: the checkout at `/home/ubi/work/harness-evals` (detached at the commit), `/home/ubi/shard/results` (the shard's `--out`, so the checkout stays clean), `/home/ubi/shard/smoke/results` (the smoke's), `/home/ubi/shard/bin` (the lane's own scripts, whatever the commit carries). Locally, under `--dest`:

| Path | What |
|---|---|
| `lane.log` | every line of the controller, the VM runner and the bootstrap, UTC stamped |
| `run-shard.log`, `run.stdout.log`, `run.log`, `vm-shard.out` | the VM's files, appended every `--poll-seconds` (30) while the shard runs; `tail -f` them |
| `results/` | the whole shard results tree copied back on exit: `manifest.json`, `trials.jsonl`, `trials/`, `ledger.sqlite`, `proxy-usage.ndjson`, `proxy.log`, `run.log`, `run-summary.json`, `preflight.log`, `plan.log`, `shard.json`, build logs |
| `results/shard-vm.json` | beside `shard.json`: VM name, size, location, owner, commit, run id, cells, lease, timings in seconds (create to ready, sync, bootstrap, checkout and install, image build, smoke, run, pull, destroy, VM life), exit, and the VM's list-price cost (also at `shard-vm.json` at the top of `--dest`) |
| `smoke/results/` | the smoke's results tree, its own `ledger.sqlite` and `trials.jsonl` |
| `phases.json`, `exit` | the VM runner's phase timestamps and exit code |

The ledger copy is consistent: the results are pulled after the shard process on the VM has exited (or has been stopped, on interrupt), and every `ledger.sqlite` is checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)`) first, so the file is complete on its own without `-wal` and `-shm` files.

## Merge

Unchanged: `bun scripts/merge-shards.ts --out <merged results dir> --shard <name>=<dest>/<name>/results [--shard ...]` on a worktree pinned at the run's commit, then `summarize-run` and `compare-run` ([runner/README.md](../runner/README.md), "Sharded runs"). `fanout.sh` prints the exact merge command for its manifest. `shard.json`'s `machine` field is the VM's hostname (Ubicloud's internal `vm...` name, not the `ubirun-<owner>-...` name, which `shard-vm.json` carries), and `shards.json` and `compare-run --pair gbrain` use it as the machine label. `shard-vm.json` is not a per-shard file `merge-shards.ts` copies; the report quotes its timings and cost from the shard directory.

## Secrets

`ANTHROPIC_API_KEY` and `OPENAI_API_KEY` (each one set in the caller's shell; the run needs the first, `--embedded` the second) reach the VM in one way only: `run-shard.sh` writes `export NAME=value` lines to `/home/ubi/.ubirun-env` over the multiplexed SSH connection with `umask 077`, exactly as `ubi-runner.sh run --pass` writes them. The launcher on the VM reads that file into the shell and deletes it before `vm-shard.sh` starts (the lane log shows "key file deleted"), so no file on the VM holds a key while the shard runs; the keys live in the detached process's environment and reach only the metering proxy `scripts/run-shard.sh` starts, as on a Capy shard. The gbrain sidecar and the harness containers see the proxy URL and a per-trial token and no model key, as today; nothing goes through cloud-init user data, images, the repository or any log, and the lane never prints a key. `UBICLOUD_API_KEY` stays on the controller machine; the VM has no Ubicloud credential, which is also why a VM cannot destroy itself and the controller must. The VM's SSH key is ephemeral, one per VM, under `~/.local/state/ubi-runner/<vm>/` on the controller.

## Costs

The VM's list price is Ubicloud's published Germany rate per minute (standard-8 $0.00416, standard-16 $0.00831, standard-30 $0.01559), VM life from the create request to the confirmed destroy rounded up to the minute, plus the public IPv4 at $3 a month pro rata; the CLI reports no per-VM cost, so `shard-vm.json` computes this the way `pr-check.sh` does. A standard-16 VM costs about $0.50 an hour.

Measured on 2026-10-25 (internal-task, the proof of this lane; uncounted, scratch preregistration `v02-pilot-ubicloud-lane-smoke-2026-10`, receipts under `~/.capy/work/ubi-smoke` on internal-task's machine, never under `results/` in a commit): the v0.2 pilot's OpenClaw Haiku cell at the pilot commit `dd40bc5`, one dev task smoke (`cn-01-north-date-formats`) and then three trials (`cn-01`, `cn-02`, `cn-03`, one repetition each) on one standard-16 VM, against the Capy shard that ran the same cell on 2026-10-25 07:21Z (`run.log` on that shard machine):

| Trial (OpenClaw, Haiku, v0.2 dev) | Ubicloud standard-16, wall s | Capy shard (4 cores), wall s, r1 / r2 / r3 | Grade (VM; Capy r1) |
|---|---|---|---|
| smoke `cn-01-north-date-formats` | 123.5 | 106.8 / 99.1 / 108.8 | fail; fail |
| `cn-01-north-date-formats` | 108.6 | 106.8 / 99.1 / 108.8 | fail; fail |
| `cn-02-tamsin-contact-booking` | 134.4 | 135.9 / 135.3 / 130.5 | fail; fail |
| `cn-03-brackenwater-owner` | 88.5 | 99.4 / 188.9 / 105.9 | pass; pass |

Wall time per trial is the same on both machines within the spread of repetitions: a trial's wall time is model latency and harness turn time, not CPU, so a 16-vCPU VM does not make one trial faster. What the lane buys is one VM per cell with no cap of eight machines, no sleep and no restart, so the run's wall time is the longest cell, not a queue.

The VM's phases: create to ready 82 s (19 s on an earlier VM the same evening), sync of the checkout 23 s, bootstrap 57 s, checkout and `bun install` 3 s, image builds (OpenClaw and the gbrain sidecar, from the pinned checkout) 305 s, smoke 125 s, the three trials 332 s, pull 2 s, destroy 6 s; VM life 15 min 51 s. VM list price $0.1341 (16 minutes at $0.00831 plus IPv4); model spend $0.0369 for the three trials (40 requests) and $0.0122 for the smoke (11 requests), $0.0491 in all under two $0.50 leases (from `bun runner/proxy/metering-proxy.ts summary --budget-ledger <ledger> --run-id <run id>` on the pulled ledgers). For a counted shard of 100 Haiku trials at about 100 s each, expect about three hours of VM life, about $1.50 of VM cost beside the model spend; the Sonnet cells of a held-out run take longer per trial and cost the same per minute.

## Limits

- **Quota.** See above: the maximum is not readable, so pass `--max-vcpus` when you know it, keep fan-outs proportionate, and expect a refused shard to be queued again.
- **Interrupt.** SIGINT or SIGTERM to `run-shard.sh` stops the shard process on the VM (SIGTERM to its process group, up to 90 s), checkpoints the ledgers, copies the results tree back, writes `shard-vm.json` with exit 130 and destroys the VM. `fanout.sh` forwards the signal to every shard. A trial that was in flight is not recorded in `trials.jsonl`; its lease reservation may stay open in the ledger, as after a Capy machine restart.
- **The check lane runs from internal-task's lane machine only.** `pr-check.sh` posts the pending status from the controlling machine, runs the checks on the VM over SSH and posts the verdict from the controller again, so a controller that sleeps or restarts mid-run leaves the head pending forever and the VM running (2026-10-26: #85's check from another thread's machine, pending 51 minutes with its VM up until internal-task destroyed it; #84's check from internal-task's own machine during a restart, VM up 3 h 17 min). Do not start `pr-check.sh` from your own thread; a new head is found by `pr-watch.sh` on the lane within five minutes, and the lane's poll line reports its status. If you did start one and your machine slept, run `UBI_OWNER=<your code> ubi-runner.sh list --mine` and `down <vm>`; the lane's `pr-watch.sh` reruns a head whose status has been pending for 45 minutes and, while it is running, destroys the lane's own check VMs older than an hour whose controller is gone (or whose state predates the lane machine's last boot), but never another owner's. A VM started under the lane's own `UBI_OWNER` from another machine is swept with them, so do not borrow that owner id.
- **A dead controller.** The shard keeps running on the VM; rejoin it with `run-shard.sh --attach --dest <dest>`. `ubi-runner.sh list --mine` shows your VMs; destroy a leftover with `ubi-runner.sh down <vm>`. Never leave a VM running.
- **`--resume`.** A new VM is created (a destroyed one is gone), the local `<dest>/results` tree is uploaded first without the per-trial `state/` and `workspace/` directories, the smoke runs again at the recorded commit (it rebuilds the images; `--no-smoke` builds them in the counted step instead), and `scripts/run-shard.sh --resume` does what it does on a Capy shard: it keeps `shard.json` as the record of the first launch and appends to its `resumes` list, refuses a commit other than the recorded one unless `--amendment` names it, skips preflight when `preflight.log` already says ok, and `run --resume` skips the trials `trials.jsonl` already holds. The uploaded `ledger.sqlite` carries the open lease, so the spend stays in one ledger. The results pulled back at the end merge over the local tree.
- **Smoke.** The smoke is a copy of the preregistration with only the shard's harness cells, each on one dev task (`--smoke-task`, default the first task directory of the cell's task set's dev split; internal-task used `cn-01-north-date-formats` for v0.2 and internal-task `sc-01` for v0.1), one repetition, `split: dev` (a held-out cell smokes on a dev task so no held-out task is spent), under its own lease (`--smoke-lease-usd`, default $0.50; a Sonnet cell needs more, because the proxy reserves a call's worst case before forwarding: about $0.40 for an OpenClaw Sonnet call and $1.42 for a Hermes or QM Sonnet call at `--max-output-tokens 128000`, so the default refused every Sonnet smoke of `gbrain-memory-2026-10` and the run relaunched with `--smoke-lease-usd 2` ([report](benchmarks/2026-10-26-gbrain-memory/report.md), deviation 1; raising the default is in TODOS)) and its own ledger under `smoke/`. Every smoke trial must end `completed`, or the counted run does not start and the lane exits 4. Scripted cells are not smoked.
- **Exit codes.** `scripts/run-shard.sh`'s for the shard; 4 when the smoke failed; 3 when the VM, the sync or the bootstrap failed before the run (or the `--timeout-hours`, default 12, passed); 2 for a usage error; 130 on interrupt.
- **Disk.** standard-16 comes with its default disk; pass `--storage <GiB>` for a shard whose trials keep large harness state. `scripts/run-shard.sh`'s prune loop deletes graded trials' caches every five minutes as on a Capy shard.

## Changelog

### 2026-10-27: the smoke lease a Sonnet cell needs (internal-task)

Limits, "Smoke": the $1 figure for a Sonnet smoke lease is replaced by what `gbrain-memory-2026-10` measured: the proxy's worst-case reservation is about $0.40 for an OpenClaw Sonnet call and $1.42 for a Hermes or QM Sonnet call at `--max-output-tokens 128000`, so the $0.50 default refused every Sonnet smoke and the run relaunched at $2 (its report, deviation 1).

### 2026-10-26: the check lane runs from the lane machine only (internal-task)

Limits gains the entry on `pr-check.sh` started from another thread's machine: a sleeping controller leaves the status pending and the VM running (#85 and #84 on 2026-10-26); `pr-check.sh` names its VMs `-pr<n>` with ubi-runner's owner id and `pr-watch.sh --reap-after` destroys the lane's own check VMs older than an hour while the watcher runs, keeping one whose controller is still alive on its machine.

### 2026-10-25: the lane (internal-task)

First version: `run-shard.sh`, `vm-shard.sh` and `fanout.sh` under scripts/ubicloud/, this page, the measured proof.

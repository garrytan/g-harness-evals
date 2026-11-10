# Ubicloud shard lane

A counted run is sharded by whole cells (CREW.md, Parallelism) and, from now on, every counted run's shards run on ephemeral Ubicloud VMs instead of Capy subagent machines unless the coordinating agent says otherwise. One standard-16 VM (16 vCPUs) per shard, the repository pinned at the preregistration commit, the images built there, the one-trial smoke the Capy shards ran, then the repository's own `scripts/run-shard.sh` under the shard's lease; the results tree is copied back and the VM destroyed on every exit path. The Capy shard path (a fresh subagent machine per shard, [runner/README.md](../runner/README.md), "Sharded runs") stays for one-off reruns of a few trials.

Why: a Capy thread holds at most eight shard machines, each has four cores, and a Capy machine sleeps or restarts under a long run unless the thread keeps an operation awaited every turn (four restarts cost the gbrain arm about an hour). A VM has no sleep, a twelve-cell run gets twelve VMs, and the thread only polls.

## The scripts

All under [scripts/ubicloud/](../scripts/ubicloud/), beside the check lane ([scripts/ubicloud/README.md](../scripts/ubicloud/README.md)) and sharing its `ubi-runner.sh` (the runner from the Ubicloud skill, unchanged) and `bootstrap.sh` (Docker, Bun at ci.yml's pin, Node, python3, jq).

- `run-shard.sh`: one shard on one VM, from this machine. It resolves the commit, clones a clean detached checkout of it into a scratch directory, creates the VM, streams the checkout to `~/work/harness-evals` on the VM, runs `bootstrap.sh`, writes the model keys to the VM over SSH, uploads `vm-shard.sh` and `smoke-lease.ts` and starts `vm-shard.sh` detached, polls the VM's logs into `--dest`, pulls the results tree every `--replicate-seconds` while the shard runs, and on exit copies the results back, writes `shard-vm.json` and destroys the VM.
- `vm-shard.sh`: the VM side, started by `run-shard.sh`: `git checkout --detach <commit>` (a dirty tree is refused, as `scripts/run-shard.sh` refuses one), `bun install --frozen-lockfile`, the smoke, then `scripts/run-shard.sh` for the shard. It records phase times and its exit code for the controller.
- `smoke-lease.ts`: prints the default smoke lease for a shard's harness cells at an output cap, using the proxy's own price lookup and reservation formula from `runner/ledger/budget-ledger.ts` in the pinned checkout. `run-shard.sh` ships it beside `vm-shard.sh`, which runs it when `--smoke-lease-usd` is not given (Limits, "Smoke").
- `fanout.sh`: one `run-shard.sh` per shard from one manifest, in parallel, with the quota check, a table at the end and the merge command.
- `prune-pending.sh`: removes stale VM ids from shard destinations' `cleanup-pending` files ("A failed pull" under Limits).
- `wave2-admit.ts` (internal-task, H10): which preregistered conditional wave-2 blocks run, from what wave 1 actually spent. It sums the committed dollars over every wave-1 ledger given (`--ledger`, counted and smoke), subtracts that from the blocks file's `cap_usd`, and walks the blocks in order. A block whose precondition does not hold is skipped; one whose counted plus smoke ceiling does not fit what is left is dropped whole, never split. Each ceiling comes from the block's own `prereg.json` and is the planned spend plus one proxy call reservation R, the largest worst-case call among the block's harness cells (50,000 input tokens at the dearest cache-write rate the proxy applies, the 1-hour rate for Anthropic, plus the last `--max-output-tokens` cap in the block's options at list price; about $2.96 for Opus 5.5), so the lease can still forward one call after the planned spend. A call whose input is larger than 50,000 tokens reserves more than R. With `--out` (which needs `--commit` and `--dest`) it clears earlier `*.fanout.json` files there and writes one `fanout.sh` manifest per admitted block. A missing ledger, a file that is not a SQLite ledger, a missing block preregistration or a blocks file without a positive `cap_usd` and a `blocks` list is HE-BUDGET-004 ([docs/errors.md](errors.md)).

## One shard

```sh
export UBI_OWNER=<your thread code>          # every VM is named ubirun-<owner>-<epoch>-<hex>-t<hours>
scripts/ubicloud/run-shard.sh \
  --commit <preregistration commit> --prereg docs/benchmarks/<run>/prereg.json \
  --name oc-a --cells openclaw-haiku-none-mu-heldout,openclaw-haiku-told-mu-heldout --lease-usd 5 \
  --dest ~/.capy/work/<run>/oc-a [--gbrain-image <tag>] [--embedded] [--amendment <sha>] [--resume] \
  [--size standard-16] [--smoke-lease-usd <n>] [--smoke-task <dev task id>] [--smoke-first-cell] [--no-smoke] [--pre-smoke <scripts/....sh>] \
  [--workload harness|gstack-laneb|qm-driver|frontier-harbor] [--install-check] [--replicate-to <dir>] [--replicate-seconds 1200] \
  [-- <arguments for scripts/run-shard.sh>]
```

Run it as a background operation with a timeout covering the whole shard and register a wait on it, the way the Ubicloud skill says: a controller nobody waits on dies when the Capy machine sleeps. The VM is not harmed by that (the shard runs detached there), but nothing destroys it until `run-shard.sh --attach --dest <the same dest>` rejoins it, or `scripts/ubicloud/ubi-runner.sh down <vm>` is run by hand. `--attach` reads the VM name from `<dest>/shard-vm.json`, polls, pulls and destroys exactly as the first invocation would have.

`--prereg` is a path in the repository at `--commit` for a counted run; any other readable file is a scratch preregistration (an uncounted smoke or check), copied to the VM and marked `scratch_prereg: true` in `shard-vm.json`. Everything after `--` goes to the repository's `scripts/run-shard.sh` at that commit as given (for example a `--max-output-tokens` the commit's script accepts), so the lane never has to change when that script grows an option.

## A fan-out

```sh
scripts/ubicloud/fanout.sh --manifest ~/.capy/work/<run>/fanout.json [--max-vcpus N] [--parallel N] [--dry-run] \
  [--workload harness|gstack-laneb|qm-driver|frontier-harbor] [--replicate-to <drive folder>] [--replicate-seconds 1200]
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

One command starts a twelve-cell run: twelve shards of one cell each, or fewer shards of several cells. Each shard is a background process writing `<dest>/<name>/fanout.log` (its controller's output), `<dest>/<name>/lane.log` (the stamped lane log), the streamed `run-shard.log`, `run.stdout.log`, `run.log` and `vm-shard.out`, and at the end `<dest>/<name>/results/` and `<dest>/<name>/smoke/`. `--dry-run` prints the commands without creating anything. The exit code is 0 only when every shard exited 0 and no VM was kept; an interrupt is forwarded to every shard, and each one copies its results back and destroys its VM before exiting.

A shard may carry `"args": [...]`. They go to that shard's `run-shard.sh` only, after the manifest's `options` and a `--` (added when `options` has none), so they reach the workload as given.

**A stage cap is checked before any VM call.** A manifest may carry `"stage_cap_usd": <n>`, the preregistered cap of the stage its shards run. `--workload qm-driver` requires it.

- The shards' `lease_usd` values must sum to at most the cap. Each must be a number.
- Every lease a shard of the same `dest` ever started counts too. `<dest>/<shard>/leases.jsonl` is append-only: `run-shard.sh` adds a line per launch and `fanout.sh` one per shard it reserves. So a relaunch, or a `shard-vm.json` moved aside, never drops an earlier lease. A `dest` from before `leases.jsonl` counts its `shard-vm.json` lease. Launch a stage's canary and the rest into one `dest`.
- A shard named in the manifest and relaunched with `--resume` counts once: it continues its latest lease. Relaunched without `--resume`, it starts a new lease, so every earlier lease still counts. Only a `--resume` before any `--` in `options` is a resume; after `--` it is a workload argument.
- Over the cap, `fanout.sh` exits 2 before it reads the quota or creates anything.
- Before the first launch, `fanout.sh` takes an exclusive lock on `<dest>/.stage-cap.lock`, checks again and writes a reservation per shard into its `leases.jsonl`. A second fan-out on the same `dest` waits for the lock (up to `UBI_STAGE_LOCK_SECONDS`, default 300, then exits 2) and counts those reservations, so two fan-outs can't spend the same budget. A reservation and the launch that used it count once. A reservation whose shard never launched still counts, which errs toward the cap.

**For `--workload qm-driver` the cap is the preregistered one, and it holds across dests.**

- `stage_cap_usd` must equal the preregistration's `caps_usd` entry for the `--stage` every shard's `args` name. A shard without `--stage`, shards that disagree on it, or a stage with no `caps_usd` entry exit 2 before any VM call.
- `--replicate-to` is required, because the **stage ledger** lives there: `<replicate-to>/stage-ledger.jsonl`, append-only, one line per reservation and per launch, each naming the preregistration's `run_id`, the `--stage`, the shard's dest and the lease (`scripts/ubicloud/stage_ledger.py`). The replica folder outlives the controller (CREW R16).
- `fanout.sh` checks the shards' leases plus every earlier line of that run id and stage, from any dest, and writes its reservations there under `<replicate-to>/.stage-ledger.lock`. So a stage split across dests is summed once.
- `run-shard.sh --workload qm-driver` checks too, before any VM call. A launch from a fan-out must find its reservation there for its own dest. A one-off launch reserves its own lease only when the stage's lines plus its lease fit `caps_usd` for its `--stage`. A `--resume` continues its lease and adds none.
- Use one `--replicate-to` for every launch of a run. A launch pointed at another folder starts another ledger.

**A shard whose VM was never cleaned up stops the whole fan-out.** When any shard's `<dest>/<shard>/shard-vm.json` names a VM whose cleanup isn't `done` (a controller that died mid-run), `fanout.sh` exits 2 before launching anything. Run `run-shard.sh --attach --dest <dest>/<shard>` first. Only if the attach can't reach the VM and the project's VM list no longer shows it, move that `shard-vm.json` aside; its `leases.jsonl` keeps the lease in the stage sum.

### Results leave the VM while it runs

No paid fan-out may depend on one controller machine (CREW R16; internal-task's controller died on 2026-11-03 and stranded 15 VMs).

- **Every 20 minutes** (`--replicate-seconds`, or `UBI_REPLICATE_SECONDS`; 0 turns it off), `run-shard.sh` pulls the VM's `~/shard/results` into `<dest>/<shard>/results` while the shard runs. This holds for every workload.
- **A bad pull never replaces a good copy.** The pull lands in a staging directory first. It is merged over the last copy only when it brings back `results/` and exits 0, or 1 (tar's "file changed as we read it" on a log the shard is still writing). A failed or cut pull is logged and tried again next interval. It never stops the shard. The merge keeps files the VM lacks, such as the `state/` and `workspace/` a `--resume` upload leaves out. The teardown pull uses the same staging.
- **`--replicate-to <dir>`** (or `UBI_REPLICATE_TO`) names a folder that outlives the controller, normally a Capy drive folder. After each pull and at teardown, `<dest>/<shard>` is mirrored to `<dir>/<shard>`, without per-trial `state/` and `workspace/`, and without the qm-driver smoke's gstack checkout `smoke/work/gstack-edition` (gstack's own tests in it hold key-shaped text). The mirror is staged and scanned for key-shaped text first; a hit keeps the previous mirror and logs the file name only. `<dir>` must be outside `--dest`, and `--dest` outside `<dir>/<shard>` (the mirror replaces what it finds there); otherwise `run-shard.sh` exits 2 before any VM call.
- **The VM map** is `<dir>/vm-map.jsonl`: one line per VM event (`created`, `attached`, `kept`, `destroyed`, `down-failed`) with the shard, VM, owner, `created_at`, `dest` and replica path. The `created` line is written as soon as the VM exists, and `<dir>/<shard>/shard-vm.json` with it. `fanout.sh` also copies its manifest to `<dir>/fanout-manifest.json`.
- **Recovering from a dead controller:** read `vm-map.jsonl` for VMs with no `destroyed` line. Each VM's SSH key stays on the machine that made it and never goes on the drive, so another machine cannot `--attach`. Take `<dir>/<shard>` as that shard's results up to the last interval, then `ubi-runner.sh down <vm>`. If the old machine comes back, `run-shard.sh --attach --dest <dest>` there pulls the rest first.
- **A launch never overwrites another VM's mirror.** A fresh launch, a `--resume` and a fan-out exit 2 before any VM call when `<dir>/<shard>/shard-vm.json` names a VM other than the dest's own and its cleanup isn't `done` (say, a run whose controller died). Recover first: `run-shard.sh --attach --dest <its dest>` on the machine that launched it, copy `<dir>/<shard>` out and move it aside, or use a new `--replicate-to`.
- **Use one `--replicate-to` per run.** The guard above skips a VM whose cleanup is `done`, so a later run that reuses the folder overwrites a finished run's mirror.
- **Refused for a sealed shard.** Sealed raw results stay in `--dest` ([docs/sealed-custody.md](sealed-custody.md)).
- `fanout.sh` warns when no `--replicate-to` is given. Pass one for every paid run.

### The qm-driver workload

`--workload qm-driver` runs the QM S1 edition driver, `harnesses/qm/gstack/s1e-probe.ts` ([README](../harnesses/qm/gstack/README.md)), on each VM in place of `scripts/run-shard.sh`.

- **Smoke:** the driver's keyless `--dry-run`, run with no model key (fakes behind the proxy, no spend). It builds the rig images, so the counted run gets `--skip-build`. A failure exits 4 before any paid call. `--no-smoke` skips it.
- **Lease:** `~/shard/results/ledger.sqlite` is created with the shard's `lease_usd` as its program cap when it is missing. The driver gets `--ledger`, `--lease-usd <lease_usd>`, `--out ~/shard/results` and `--work ~/shard/work`.
- **Arguments:** the shard's `args` pass through as given: `--stage`, `--shards`, `--tasks`, `--seed`, `--models`, `--only`, `--new-run` and so on. The driver enforces the stage caps.
- **Records** are `turns.jsonl` lines. The table counts them, and the end prints the results directories instead of a merge command.
- **`--resume`** uploads `<dest>/results` (its ledger and `turns.jsonl`) and needs `<dest>/results/run.json` and `<dest>/shard-vm.json` with cleanup `done` (see Limits, "--resume"). Sealed flags and `--embedded` are refused.
- **Stage cap:** the manifest's `stage_cap_usd` is required (see "A fan-out"). The driver also refuses a lease above its stage's cap divided by `--shards`.

### Quota

`ubi-runner.sh usage` lists the project's VMs and vCPUs per owner, and `fanout.sh` prints it before launching with the vCPUs the fan-out needs (shards x 16 for standard-16). The project's vCPU maximum is not readable through the project token; only a refused create reports it ("Requested vCPU count: N, currently used vCPU count: U, maximum allowed vCPU count: M", which `ubi-runner.sh` prints as "quota refused ... needs N vCPUs and the project already uses U of M"). So: with `--max-vcpus M` (or `UBI_MAX_VCPUS`) the fan-out is refused when not one VM fits and batched to as many VMs as fit otherwise, printing needed, used and maximum; without it every shard launches (or `--parallel N` at a time) and a shard whose VM was refused for quota is queued again after the next shard finishes, up to three tries. Other threads and the organization's other projects share the quota (on 2026-10-25 the project showed 406 vCPUs in use across nine owners before this lane ran), so check `usage` before a large fan-out and keep leases and shard counts proportionate.

## Where things land

On the VM: the checkout at `/home/ubi/work/harness-evals` (detached at the commit), `/home/ubi/shard/results` (the shard's `--out`, so the checkout stays clean), `/home/ubi/shard/smoke/results` (the smoke's), `/home/ubi/shard/bin` (the lane's own scripts, whatever the commit carries). Locally, under `--dest`:

| Path | What |
|---|---|
| `lane.log` | every line of the controller, the VM runner and the bootstrap, UTC stamped |
| `run-shard.log`, `run.stdout.log`, `run.log`, `vm-shard.out` | the VM's files, appended every `--poll-seconds` (30) while the shard runs; `tail -f` them |
| `results/` | the whole shard results tree, copied back every `--replicate-seconds` while the shard runs and on exit: `manifest.json`, `trials.jsonl`, `trials/`, `ledger.sqlite`, `proxy-usage.ndjson`, `proxy.log`, `run.log`, `run-summary.json`, `preflight.log`, `plan.log`, `shard.json`, build logs |
| `results/shard-vm.json` | beside `shard.json`: VM name, size, location, owner, commit, run id, cells, lease, timings in seconds (create to ready, sync, bootstrap, checkout and install, image build, smoke, run, pull, destroy, VM life), exit, and the VM's list-price cost (also at `shard-vm.json` at the top of `--dest`) |
| `smoke/results/` | the smoke's results tree, its own `ledger.sqlite` and `trials.jsonl` |
| `phases.json`, `exit` | the VM runner's phase timestamps and exit code |
| `cleanup-pending` | VM ids left running: kept after a failed final pull, or a failed `down` |
| `<replicate-to>/<shard>/`, `<replicate-to>/vm-map.jsonl` | the mirror of `--dest` and the VM map ("Results leave the VM while it runs") |

The ledger copy is consistent: the results are pulled after the shard process on the VM has exited (or has been stopped, on interrupt), and every `ledger.sqlite` is checkpointed (`PRAGMA wal_checkpoint(TRUNCATE)`) first, so the file is complete on its own without `-wal` and `-shm` files. A mid-run copy is taken while the run writes, so its ledger may need its `-wal` file beside it. A pull whose `ledger.sqlite` comes back without `-wal` or `-shm` deletes the local ones an earlier pull left, so they never replay old pages over the final ledger.

## Merge

Unchanged: `bun scripts/merge-shards.ts --out <merged results dir> --shard <name>=<dest>/<name>/results [--shard ...]` on a worktree pinned at the run's commit, then `summarize-run` and `compare-run` ([runner/README.md](../runner/README.md), "Sharded runs"). `fanout.sh` prints the exact merge command for its manifest. `shard.json`'s `machine` field is the VM's hostname (Ubicloud's internal `vm...` name, not the `ubirun-<owner>-...` name, which `shard-vm.json` carries), and `shards.json` and `compare-run --pair gbrain` use it as the machine label. `shard-vm.json` is not a per-shard file `merge-shards.ts` copies; the report quotes its timings and cost from the shard directory.

## Secrets

`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `PARTICLE_API_KEY` (each one set in the caller's shell; the run needs the first, `--embedded` the second, a Particle cell the third, which `preflight` requires) reach the VM in one way only: `run-shard.sh` writes `export NAME=value` lines to `/home/ubi/.ubirun-env` over the multiplexed SSH connection with `umask 077`, exactly as `ubi-runner.sh run --pass` writes them. The launcher on the VM reads that file into the shell and deletes it before `vm-shard.sh` starts (the lane log shows "key file deleted"), so no file on the VM holds a key while the shard runs; the keys live in the detached process's environment, which the runner's own child processes inherit, and only the metering proxy `scripts/run-shard.sh` starts uses them, as on a Capy shard. The gbrain sidecar and the harness containers see the proxy URL and a per-trial token and no model key, as today; nothing goes through cloud-init user data, images, the repository or any log, and the lane never prints a key. The proxy on the VM listens on the docker bridge gateway (172.17.0.1, what `host.docker.internal` resolves to in a container), never on every interface, forwards nothing for a slot the runner has not bound or for a request without the slot's per-trial token, and `bootstrap.sh` installs an nftables input policy that drops everything from outside except SSH (loopback, the docker bridges, replies to the VM's own connections and ICMP stay open; `HE_LANE_FIREWALL=off` skips it on a debugging VM). Until 2026-10-28 the proxy listened on 0.0.0.0 on a VM with a public IPv4 and metered an unbound slot under `slot:<id>` instead of refusing it, so a host that reached the port could spend the shard's lease through the key; the audit of every receipt since the lane started found no such request (handoffs/internal-task/proxy-exposure-audit.md in the project's private drive). `UBICLOUD_API_KEY` stays on the controller machine; the VM has no Ubicloud credential, which is also why a VM cannot destroy itself and the controller must. The VM's SSH key is ephemeral, one per VM, under `~/.local/state/ubi-runner/<vm>/` on the controller.

### Rotating UBICLOUD_API_KEY

The sealed-custody escrow (`escrow/identity.age` on the custody branch, [sealed custody](sealed-custody.md#rotating-ubicloud_api_key)) is encrypted under a passphrase derived from `UBICLOUD_API_KEY`, so rotating the key has one extra step. In order: make the new key in the Ubicloud console and set it as the project's `UBICLOUD_API_KEY`; on a machine that has the drive copy of the custody identity and the new value in its environment, run `bun scripts/sealed/keygen.ts --re-escrow` (it replaces the escrow only after the new one decrypts, pushes without force and keeps the old one in history), then `bun scripts/sealed/keygen.ts --check-escrow`, which must print `ESCROW: ok`; only then revoke the old key. A rotation without the re-escrow makes every `open.ts` and `release.ts` refuse with HE-SEALED-012 until it is done.

## Costs

The VM's list price is Ubicloud's published Germany rate per minute (standard-8 $0.00416, standard-16 $0.00831, standard-30 $0.01559), VM life from the create request to the confirmed destroy rounded up to the minute, plus the public IPv4 at $3 a month pro rata; the CLI reports no per-VM cost, so `shard-vm.json` computes this the way `pr-check.sh` does. A standard-16 VM costs about $0.50 an hour.

Measured on 2026-10-25 (the proof of this lane; uncounted, scratch preregistration `v02-pilot-ubicloud-lane-smoke-2026-10`, receipts under `~/.capy/work/ubi-smoke` on the lane owner's machine, never under `results/` in a commit): the v0.2 pilot's OpenClaw Haiku cell at the pilot commit `dd40bc5`, one dev task smoke (`cn-01-north-date-formats`) and then three trials (`cn-01`, `cn-02`, `cn-03`, one repetition each) on one standard-16 VM, against the Capy shard that ran the same cell on 2026-10-25 07:21Z (`run.log` on that shard machine):

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
- **The check lane runs from the lane machine only.** `pr-check.sh` posts the pending status from the controlling machine, runs the checks on the VM over SSH and posts the verdict from the controller again, so a controller that sleeps or restarts mid-run leaves the head pending forever and the VM running (2026-10-26: #85's check from another thread's machine, pending 51 minutes with its VM up until the lane destroyed it; #84's check from the lane's own machine during a restart, VM up 3 h 17 min). Do not start `pr-check.sh` from your own thread; a new head is found by `pr-watch.sh` on the lane within five minutes, and the lane's poll line reports its status. If you did start one and your machine slept, run `UBI_OWNER=<your code> ubi-runner.sh list --mine` and `down <vm>`; the lane's `pr-watch.sh` reruns a head whose status has been pending for 45 minutes and, while it is running, destroys the lane's own check VMs older than an hour whose controller is gone (or whose state predates the lane machine's last boot), but never another owner's. A VM started under the lane's own `UBI_OWNER` from another machine is swept with them, so do not borrow that owner id. From 2026-10-27 the lane runs `pr-watch.sh --until-change --merge`: the loop checks every new head, merges every pull request that meets the full rule through `merge-pass.sh` (squash, `--match-head-commit`, the ship receipt's allowlisted status and head on its own lines), and exits only with an `EVENT:` line, so the lane's agent wakes on a finished check, a merge, a merge GitHub refused, a green pull request first seen waiting for its ship receipt (once per head, so the author can be told) or a failure, and not on a timer ([scripts/ubicloud/README.md](../scripts/ubicloud/README.md)). From 2026-10-28 the lane never touches the orphan branch `custody` (sealed ciphertext, the key escrow and the access log): a pull request with `custody` as its head or base is skipped by `pr-watch.sh` before the draft and status filters, by `merge-pass.sh` before any other read, and refused by `pr-check.sh` with exit 2, whatever its state, and the loop reports it once per head as a `custody-skip` event so the coordinating agent is told. GitHub filters a pull request list by base, so `pr-watch.sh` lists pull requests into `custody` beside its `--base` list, and `merge-pass.sh` reads the head sha and both branch names again right before each merge, so a retarget after the list is a skip too. From 2026-11-02 `.gstack/ship-policy.json` sets `changelog_fragments` and the lane runs `merge-pass.sh --land`: a pull request carries a `changelog.d/` fragment and no version, and gstack's `land` stamps the version at merge in a commit that must pass every check before it merges ([scripts/ubicloud/README.md](../scripts/ubicloud/README.md)). From 2026-11-04 it also sets `"merge": "direct"`: `merge-pass.sh --land` merges each pull request at its own green head with `gstack-ship-queue land --pin`, with no stamp commit, and the version moves only in a release pull request.
- **VM TTL.** Every VM `ubi-runner.sh` creates ends its name in `-t<hours>`, the encoding gstack's runner writes (gstack#3652). Its reaper destroys any VM whose name's epoch plus that many hours plus ten minutes has passed, whoever owns it. `run-shard.sh` (and so `fanout.sh`) sets the TTL to `--timeout-hours` plus 1, so 13 for the default 12; `pr-check.sh` and a plain `up` or `run` get 3. `UBI_TTL_HOURS` overrides it, rounded up to a whole hour (1 to 999); `run-shard.sh` refuses one that does not outlive `--timeout-hours`, and stops a shard half an hour before its VM's TTL ends (an `--attach` after a long sleep included) so the results come back first. `up` and `run` refuse without `UBI_OWNER` and refuse a `-n` name without the suffix. VMs made before 2026-10-30 have no suffix; `list --mine`, `down` and `run-shard.sh --attach` still handle them. `run` ends with `UBICLOUD: left=<0|1|unknown> owner=<owner> vm=<name> others=<n>` on stderr.
- **A failed pull.** The results on the VM are newer than the last mid-run copy until teardown copies them back. If that copy fails, or `<dest>/results` is missing after it, the VM is not destroyed: its id goes to `<dest>/cleanup-pending`, `shard-vm.json` keeps cleanup "pending" with a `cleanup_reason`, and the VM's TTL ends it. Pull with `run-shard.sh --attach --dest <dest>`, which destroys the VM once the copy succeeds. A shard that stopped at the smoke (exit 4) has no results tree and is destroyed as before, and so is a VM that answers that it holds no `~/shard/results` (a checkout, install or smoke-lease failure before the counted run).
  - `fanout.sh` prints a `kept:` line per such shard (shard, VM, reason, `cleanup-pending` path, recovery), counts kept VMs in its total line, and exits 1. A failed `down` gets a `kept:` line too.
  - Any launch except `--attach` into a `--dest` whose `cleanup-pending` still lists a VM is refused (exit 2, before any VM call), naming the VM. That covers a fresh launch and a `--resume`: a new launch would overwrite `shard-vm.json` and lose track of the kept VM. Recover first: `run-shard.sh --attach --dest <dest>` pulls, then downs. `fanout.sh` refuses the whole fan-out before launching anything.
  - `prune-pending.sh <dest>...` removes an entry whose VM is not in the project's VM list (every owner), or whose `shard-vm.json` says a later attach pulled and destroyed it. It keeps every other entry, and keeps all of them when the list cannot be read. `fanout.sh` runs it at start and `run-shard.sh` before any launch except `--attach`. A successful `down` also removes its own entry.
- **A dead controller.** The shard keeps running on the VM, and `<dest>/shard-vm.json` keeps cleanup "pending". Any launch but `--attach` into that dest is refused before any VM call (exit 2), and so is a fan-out that names it. Run `--attach` first: it pulls the results and the ledger at teardown, downs the VM and records cleanup `done`. Only if the attach cannot reach the VM and `ubi-runner.sh list` (every owner) no longer shows it, move `shard-vm.json` aside.
  - Rejoin with `run-shard.sh --attach --dest <dest>`. With `--replicate-to`, the VM map and the last mirror survive the controller ("Results leave the VM while it runs"). `ubi-runner.sh list --mine` shows your VMs; destroy a leftover with `ubi-runner.sh down <vm>`. Never leave a VM running.
- **`--resume`.** It needs `<dest>/shard-vm.json` with cleanup `done`, or it exits 2 before any VM call: the uploaded ledger must be the one the teardown pull brought back, since a mid-run pull can be up to one replicate interval stale and would understate spend. After a dead controller, `--attach` first. A new VM is created (a destroyed one is gone), the local `<dest>/results` tree is uploaded first without the per-trial `state/` and `workspace/` directories, the smoke runs again at the recorded commit (it rebuilds the images; `--no-smoke` builds them in the counted step instead), and `scripts/run-shard.sh --resume` does what it does on a Capy shard: it keeps `shard.json` as the record of the first launch and appends to its `resumes` list, refuses a commit other than the recorded one unless `--amendment` names it, skips preflight when `preflight.log` already says ok, and `run --resume` skips the trials `trials.jsonl` already holds. The uploaded `ledger.sqlite` carries the open lease, so the spend stays in one ledger. The results pulled back at the end merge over the local tree. A preregistration that sets `shard_resume` to `refused` (matrix-mu-2026-11) gets no resume: `run-shard.sh` exits 2 before any VM call on `--resume`, a pass-through `--resume`, a relaunch into a `--dest` that already holds `results/shard.json`, or any launch into a `--dest` whose `shard-vm.json` records `launched_at` (one launch per destination), `scripts/run-shard.sh` refuses `--resume` and an `--out` that already holds the shard, and the cell merges with `merge-shards.ts --partial --vm-lost <cell>`.
- **Smoke.** The smoke is a copy of the preregistration with only the shard's harness cells, each on one dev task (`--smoke-task`, default the first task directory of the cell's task set's dev split; earlier runs used `cn-01-north-date-formats` for v0.2 and `sc-01` for v0.1), one repetition, `split: dev` (a held-out cell smokes on a dev task so no held-out task is spent), under its own lease and its own ledger under `smoke/`. With `--smoke-first-cell` it holds only the first harness cell in `--cells` order, so the smoke is one trial. The lease defaults to what `scripts/ubicloud/smoke-lease.ts` derives on the VM from the proxy's per-call reservation: the proxy reserves a call's input tokens plus the output cap (`--max-output-tokens`, 128000 by default) at the model's list price before forwarding, about $0.40 for an OpenClaw Sonnet call and $1.42 for a Hermes or QM Sonnet call at that cap, so the old $0.50 default refused every Sonnet smoke of `gbrain-memory-2026-10` before its first call and the run relaunched with `--smoke-lease-usd 2` ([report](benchmarks/2026-10-26-gbrain-memory/report.md), deviation 1). The default is twice the largest reservation among the shard's harness cells at an allowance of 50,000 input tokens, priced at the dearest cache-write rate the proxy applies (the 1-hour rate for Anthropic, the same `callReservationUsd` that `wave2-admit.ts` uses), rounded up to $0.50 and never under $1 ($3 for Sonnet 5.5, $1 for Haiku 5.5, $6 for Opus 5.5); `--smoke-lease-usd <n>` overrides it, and a cell whose model has no list price stops the lane with exit 2 before the smoke. In a sealed lane the smoke runs without the sealed flags on the public gbrain image, and the counted step builds the sealed image (no `--skip-build`). Every smoke trial must end `completed`, or the counted run does not start and the lane exits 4. When a smoke cell sets `log_sections`, `vm-shard.sh` also runs `bun runner/run.ts check-sections` on the smoke's manifest (output in `smoke/sections.log`), and a failed check exits 4 the same way (HE-PROXY-005). Scripted cells are not smoked.
- **Exit codes.** `scripts/run-shard.sh`'s for the shard; 4 when the `--pre-smoke` check or the smoke failed; 3 when the VM, the sync or the bootstrap failed before the run (or the `--timeout-hours`, default 12, passed); 2 for a usage error or a smoke lease that could not be derived (pass `--smoke-lease-usd`); 130 on interrupt.
- **Disk.** standard-16 comes with its default disk; pass `--storage <GiB>` for a shard whose trials keep large harness state. `scripts/run-shard.sh`'s prune loop deletes graded trials' caches every five minutes as on a Capy shard.

## Changelog

### 2026-11-09: merge-pass merges over REST, reads holds cheaply and always logs; docs-only runs in the lane

`scripts/ubicloud/merge-pass.sh --rest` reads and merges through GitHub's REST API with `gh-rest.sh`, so the lane keeps its tested merge rule when the GraphQL quota runs out. The hold read stops at the first open line and remembers merged ones, and every merge is logged to `internal-task-a/merges.log` unless `--merge-log` says otherwise; a log it can't write stops the pass first. `pr-check.sh` asks the base commit's `scripts/ci/docs-only.ts` whether a change is docs-only and passes the answer to `checks.sh`, which then runs only the docs checks. Why: from 2026-11-07 the lane merged through an untested drive script that dropped six of merge-pass's guards and logged none of 18 merges after #327 (internal-task-b audit, item 10).

### 2026-11-07: a stage ledger across dests; the qm-driver stage cap comes from the preregistration; the mirror leaves out the smoke's gstack checkout

"A fan-out" gains the stage ledger and the preregistered cap for `--workload qm-driver`, and "Results leave the VM while it runs" says the mirror leaves out `smoke/work/gstack-edition`. Why: the stage sum was keyed on the dest, so a stage split across dests, or a one-off `run-shard.sh` launch, escaped it; `stage_cap_usd` was not tied to the preregistered caps or to `--stage`; and each qm-driver shard's final mirror was refused because the smoke's gstack checkout holds gstack's key-shaped test text, so the drive kept only the last mid-run copy. Tested in `tests/ubicloud-stage-cap.test.ts` and `tests/ubicloud-mirror-smoke-edition.test.ts`.

### 2026-11-07: a stage cap in the fan-out manifest; a live VM stops a fan-out; --resume needs cleanup done

"A fan-out" gains the stage cap and the live-VM refusal, and Limits says `--resume` needs cleanup `done` and that the live-VM refusal sends you to `--attach` first. Why: the internal-task-a pilot amendment's lane gates (internal-task-b). A stage's total cap was checked only per shard from that shard's own `--shards` (#294 open note t4#1), a fan-out could launch good shards beside one whose VM was still running, a `--resume` could upload a ledger from a mid-run pull that misses up to one interval of spend (t4#2), and the refusal's `list (every owner)` hint was a bash syntax error if pasted (fc4#3). Tested in `tests/ubicloud-stage-cap.test.ts`.

The /ship review of the same change found three ways past the cap, fixed before merge: a shard relaunched fresh more than once dropped its earlier leases (now `leases.jsonl`, append-only), a `--resume` after `--` in `options` exempted a fresh lease, and two fan-outs on one `dest` could both pass the check (now a lock and reservations). The fan-out's live-VM refusal also gives run-shard's move-aside fallback.

### 2026-11-06: wave-2 ceilings hold one proxy call reservation (internal-task, H10 PR 4)

The `wave2-admit.ts` bullet says each block ceiling is the planned spend plus R, one worst-case proxy call reservation. Limits, "Smoke": the default smoke lease prices its 50,000 input tokens at the dearest cache-write rate, as `wave2-admit.ts` does. Why: a lease must still forward one call after its planned spend, and both scripts now share `callReservationUsd`.

### 2026-11-06: `--smoke-first-cell` smokes one cell per shard

`run-shard.sh` and `vm-shard.sh` take `--smoke-first-cell` (put it in a fan-out manifest's options, before `--`): the smoke runs only the first harness cell in the shard's `--cells` order, one trial, instead of one trial for every harness cell. Off unless given, so the default smoke is unchanged. Why: a v0.4 calibration or frozen-dev shard's cells share the harness, the arm and the smoke task (a transfer-check shard holds both arms of its harness, so its manifest leaves the flag off and smokes each cell), so six smoke trials proved the same wiring six times, and their spend plus one Opus reservation passed the $4 smoke lease (#225's /ship review). Tested in `tests/smoke-lease.test.ts`.

### The frontier-harbor workload

`--workload frontier-harbor` runs the frontier Harbor path ([scripts/frontier-harbor/README.md](../scripts/frontier-harbor/README.md)) on each VM in place of `scripts/run-shard.sh`.

- **Setup:** `vm-shard.sh` clones Terminal-Bench 2.1 at `pin.json`'s commit into `~/terminal-bench-2-1` and checks that the manifest's cells are the preregistration's cells for that shard.
- **Smoke:** the keyless install check (`scripts/frontier-harbor/install-check.sh`, fake upstream, every key unset, no spend). A failure exits 4 before any paid call. `--no-smoke` skips it.
- **Run:** `scripts/frontier-harbor/vm-run.sh` under the shard's lease (less the recorded spend of the shard's trials in its `--done` files, so a later stage cannot reuse money an earlier stage spent), `--out ~/shard/results`, with a shard's `args` passed through (`--stage <name>`, `--done <file>`). Its output goes to `~/shard/results/run.stdout.log`. `run-shard.sh` needs `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.
- **Install check alone:** put `--install-check` in the manifest's `options` and use `scripts/frontier-harbor/install-check-prereg.json` as the preregistration. No key is required on the controller and none goes to the VM (the key file is written empty). The results (`install-check.json`, `agents/`, `baselines/`, `probe/`) come back to `<dest>/<shard>/results`. A shard's `args` of `--baselines all` run oracle and nop on every pinned task instead of three: the run's baseline gate before its first paid trial.
- **Records:** `vm-run.sh`'s `trials.jsonl`, which `merge-shards.ts` does not read, so the fan-out ends by printing the results directories. On teardown the controller waits up to 240 s for the shard's exit file, as for Lane B. `--embedded` and the sealed flags are refused.

### 2026-11-08: a frontier-harbor mirror skips request captures

For a `--workload frontier-harbor` shard, the mid-run mirror to `--replicate-to` leaves out every `proxy-capture/` directory and `results/run/` (Harbor's job tree). The mid-run mirror keeps the ledger and the VM map, and the trial records (`trials.jsonl`, `run-summary.json` and the per-trial records) reach it only after `vm-run.sh` writes them at `finish()`. The pull into `--dest` still brings the captures and the job tree back, during the run and at teardown. Why: internal-task's stage-0 mirror (140 trials) pushed a 2 GB Capy drive over its limit, and the main stage is about seven times larger. Tested in `tests/ubicloud-run-path.test.ts`.

### 2026-11-07: the frontier-harbor workload

`run-shard.sh`, `vm-shard.sh` and `fanout.sh` take `--workload frontier-harbor`, and `run-shard.sh` takes `--install-check` for the keyless install check alone. Why: the internal-task install check and shards go through the standard fan-out, with results leaving the VM while it runs and the VM destroyed on every exit, instead of a hand-driven VM.

### 2026-11-06: a shard can preflight clean control arms

The repository's `scripts/run-shard.sh` gains `--clean-arm-preflight` (pass it after `--` in a fan-out manifest's options; it reaches the smoke and the counted step). Why: CREW.md, "Clean no-gstack and no-brain arms".

### 2026-11-05: results leave the VM while a shard runs; kept VMs fail the fan-out; the qm-driver workload

New sections "Results leave the VM while it runs" and "The qm-driver workload". `run-shard.sh` pulls each shard's results on an interval through a staging directory, mirrors `--dest` and writes a VM map to `--replicate-to`. `fanout.sh` passes the new flags and per-shard `args`, prints a `kept:` line and exits 1 when a VM is kept, and refuses any launch except `--attach` into a shard with a kept VM. New `prune-pending.sh`. "Where things land", "A failed pull" and "A dead controller" say so. Why: results left a VM only at teardown, so a dead controller lost them (CREW R16), and the internal-task-a QM edition rerun needs its driver on this lane (internal-task-b, plan step 2, decisions D and E).

### 2026-11-05: wave2-admit.ts (internal-task)

"The scripts" lists `scripts/ubicloud/wave2-admit.ts`, which admits H10's wave-2 blocks against the run's cap from wave 1's ledgers. Why: H10 PR 5 added it beside `fanout.sh`, whose manifests it writes.

### 2026-11-04: the lane lands each pull request at its own head

The Limits bullet on the check lane now says `.gstack/ship-policy.json` sets `"merge": "direct"`, so `merge-pass.sh --land` merges a pull request at its own green head with `gstack-ship-queue land --pin`, with no stamp commit, and versions move in a release pull request. Why: the stamp commit cost every merge a second CI round, and a restamp after each merge ahead of it (gstack v1.95.0.0 added the direct mode). The cost: no check runs on the combined tree before a merge, so two pull requests that pass alone can still break main together, and main's own checks after each merge are what catch it. The hold file and the closing-keyword check are read again after READY, right before land --pin, and a stamp left from train mode is a skip that says to reset the branch to its pin.

### 2026-11-04: plain names for internal roles

Mentions of the project's coordinating agent, its private drive and its agent threads now use those plain names instead of internal role names. No number, link or claim changes. Why: the page is published, and the public export blocks internal role names in prose.

### 2026-11-02: the lane merges through gstack land

The Limits bullet on the check lane now says the lane runs `merge-pass.sh --land` under `changelog_fragments`: pull requests carry a `changelog.d/` fragment instead of a version, and gstack's `land` stamps the version at merge, in a commit checked like any head. Why: every queued pull request conflicted on VERSION, package.json and CHANGELOG.md as soon as anything ahead of it merged, and re-shipped just to renumber (approved on 2026-11-02).

### 2026-10-31: PARTICLE_API_KEY travels with the model keys

`run-shard.sh` writes `PARTICLE_API_KEY` to the VM's key file beside the other model keys when it is set in the caller's shell, for Particle-1 cells; like the other keys, only the metering proxy uses it and no container receives it. A Particle shard launched without the key is refused on the VM by `runner/run.ts` (HE-PROXY-001) before any model call. Why: the harness by model matrix runs a Particle-1 row (decision 13 of the matrix plan).

### 2026-10-31: the smoke checks the usage log's sections

Limits, "Smoke" gains the sentence on `check-sections`: when a smoke cell sets `log_sections`, `vm-shard.sh` runs it after the smoke and a failure stops the lane with exit 4. Why: the cost waterfall needs every forwarded chat line of a sectioned run to carry its sections, and the smoke is the last point before counted spend.

### 2026-10-31: merge holds are a file merge-pass reads

`scripts/ubicloud/merge-pass.sh` takes `--hold-file` (or `HE_MERGE_HOLD`): the `pr=<n>` lines are a queue in file order; while the first open line's #<n> is open, nothing else merges, and the line lifts itself once #<n> is merged or closed. `--pr <n>` runs the rule over one pull request, for merges by hand. Why: two docs-only merges (#154, #155) landed during the #149 prereg hold, because the hold lived only in the lane owner's memory, and each cost the #149 author a fresh /ship. `scripts/ubicloud/README.md` has the details.

### 2026-10-31: the interim gate admits only heads from before the /ship gate came back

`scripts/ubicloud/merge-pass.sh` still accepts an `INTERIM_GATE: reviewer=<model> head=<full sha> pregate=pass` line, but only when both the pull request and its head predate 2026-10-31T07:00:00Z (00:00 PT), the end of the /ship suspension (CREW.md "/ship gate RESTORED"). The pull request must have been opened before then, and the earliest commit status on the head (any context, every page) must have been created before then. GitHub sets both times itself; a commit's own dates are set by whoever pushes it and can be backdated, so they are not used. Anything later is skipped as awaiting its ship receipt, which pr-watch reports once per head; a status read that fails is its own skip and is retried next cycle. A head pushed just before the cutoff but first checked after it needs /ship too. The check cannot tell when the INTERIM_GATE line itself was written, and a pull request opened before the cutoff could still be pushed to some other sha that had a status before it. A `GSTACK_RESULT: skill=ship` receipt still admits any head.

### 2026-11-02: `--pre-smoke` runs a keyless check before any key reaches the VM

`run-shard.sh --pre-smoke <script>` runs `bash <script>` from the pinned checkout on the VM after bootstrap and before any key, the smoke or the shard, with its output in `<dest>/lane.log`. It is off unless given; put it in the fan-out manifest's options. The script must be a `.sh` file under `scripts/` at the commit, and the flag is refused for `--attach` and `--workload gstack-laneb`. A non-zero exit stops the lane with exit 4 before the smoke, so no trial runs. Prompt-archaeology shards use `scripts/ablation-golden.sh` (the layer filter's docker golden check) or `scripts/prompt-archaeology/pre-smoke.sh` (the golden check, then the clean-arm image preflight). Tested in `tests/ablation.test.ts`.

### 2026-10-30: every VM carries a TTL in its name

`ubi-runner.sh` names every VM it creates `ubirun-<owner>-<epoch>-<suffix>-t<hours>`, so gstack's reaper (gstack#3652) can tell when it may destroy it. The TTL is `UBI_TTL_HOURS` rounded up, or 3; `run-shard.sh` sets `--timeout-hours` plus 1, and `pr-check.sh` names its VMs `-pr<n>-t<hours>`. `up` and `run` now refuse without `UBI_OWNER` (they used a per-machine id before), and so does `pr-check.sh`. `run` ends with gstack's `UBICLOUD: left=` line. `pr-watch.sh`'s sweep matches check VM names with and without the suffix. Limits, "VM TTL", has the rest.

### 2026-10-29: `--workload gstack-laneb` runs a shard through the Lane B bridge

`run-shard.sh`, `vm-shard.sh` and `fanout.sh` take `--workload harness|gstack-laneb` (default `harness`, unchanged). With `gstack-laneb`, `run-shard.sh` streams `--laneb-root` (default `~/.capy/work/gstack-laneb`, from `scripts/gstack-laneb/fetch.ts`) to `~/laneb` on the VM without its `.git` directory, and `vm-shard.sh` runs the bridge's keyless smoke (`scripts/gstack-laneb/smoke.sh`, no keys in its environment) and then `scripts/gstack-laneb/vm-run.sh` under the shard's lease. Poll lines carry only the count of finished Harbor trials. `--resume`, `--embedded`, `--sealed-root` and `--opening-receipt` are refused for this workload (held-out Lane B runs are not supported yet). On teardown the controller waits up to 240 s (not 90 s) for the Lane B shard's exit file, because the shard drains its meter and writes its records after the SIGTERM. The firewall, key file and copy-back are the same code path as before. See [gstack-laneb.md](gstack-laneb.md).

### 2026-10-29: merge-pass.sh accepts the interim gate while /ship is suspended

`scripts/ubicloud/merge-pass.sh` accepts a body line `INTERIM_GATE: reviewer=<model> head=<full sha> pregate=pass` naming the exact current head in place of the /ship receipt, keeps accepting a valid receipt, and ends each merge-log line with `gate <which>` so the record says which gate admitted the merge. Everything else in the rule (clean, every check green, ubicloud/checks success, the custody skip, the head and base re-read, squash with `--match-head-commit`) is unchanged. Why: Garry suspended the /ship gate until gstack's token fix is installed (CREW.md, "/ship gate SUSPENDED").

### 2026-10-28: rotating UBICLOUD_API_KEY re-escrows the custody identity; sealed poll lines and VM cleanup records

"Rotating UBICLOUD_API_KEY" is new: the sealed-custody escrow is encrypted under a passphrase derived from the key, so a rotation runs `keygen.ts --re-escrow` and `--check-escrow` before the old key is revoked. `run-shard.sh` now prints only the trial count in a sealed lane's poll lines, records `cleanup: "done"` and `destroyed_at` in `shard-vm.json` only after `down` succeeds, and keeps a failed down's VM id in `<dest>/cleanup-pending`. Why: the custody redesign (no human handles keys) and its review.

### 2026-10-28: the lane never checks or merges a pull request from or into custody

Limits, "The check lane runs from the lane machine only" gains the sentences on the orphan branch `custody`: `pr-watch.sh`, `merge-pass.sh` and `pr-check.sh` read the head and base branch names and skip or refuse a pull request with `custody` on either side, and the loop wakes its agent once per head with a `custody-skip` event. Why: the coordinating agent's 2026-10-28 rule for the crew; before this the lane never read a branch name, and the only thing between a pull request from `custody` and main was that `pr-check.sh` happens to fail on two histories with no common ancestor, which left no `ubicloud/checks` status for `merge-pass.sh` to require. The ship review of #103 added the second list for pull requests into `custody` (the `--base` filter hid them), the fresh read before each merge (a retarget after the list), and the rule that only the `--until-change` loop remembers a reported head, written to `custody.seen` or `awaiting-receipt.seen` when the event prints rather than when the head is found, so a loop killed mid-cycle reports it next time.

### 2026-10-28: the proxy binds the bridge gateway, requires a bound slot and a per-trial token, and lane VMs are firewalled

"Keys", the paragraph on how keys reach the VM, gains the sentences on the proxy's bind address, the unbound-slot and token refusals, the nftables policy from `bootstrap.sh` and the 0.0.0.0 exposure it closes. Why: a review found `runner/trial/proxy.ts` and `runner/trial/world.ts` binding 0.0.0.0 whenever containers had to reach them, shard VMs with a public address carrying the keys for the proxy, and nothing firewalling them; the lane's reachability test reached the proxy from another network and had it forward an unbound-slot request upstream with its key. Runner side: `runner/trial/world.ts` `listenHost` and `containerHostAddress` (the bridge gateway from `docker network inspect bridge`, or `HE_CONTAINER_HOST_IP`; HE-PROXY-004 when neither gives an address), `runner/proxy/metering-proxy.ts` refuses unbound slots and wrong tokens in lease mode and refuses to start on a wildcard address, `runner/trial/proxy.ts` `trialToken` is the random per-trial secret the harness presents while `trialKey` stays the receipts' `meter_id`, the gbrain sidecar calls through its own slot bound to the same key with its own token (`HE_GBRAIN_PROXY_TOKEN`, handed to gbrain as its OpenAI credential by `gbrain/entrypoint.sh`), and `scripts/build-gbrain-image.sh` binds its slot and listens on the gateway with a control token.

### 2026-10-27: the check lane wakes its agent only on change

Limits, "The check lane runs from the lane machine only" gains the paragraph on `pr-watch.sh --until-change --merge`: the loop runs the checks and the merge rule itself (`scripts/ubicloud/merge-pass.sh`, new, with the receipt's status as an allowlist, the head named on the receipt's own lines and `gh pr merge --match-head-commit`) and exits only with an `EVENT:` line (a finished check, a merge, a refused merge, a green pull request first seen without its ship receipt, a failure, or max-age). Why: about 100 agent wakes in three days read "nothing due" (CREW.md, Token efficiency, approved by Garry on 2026-10-27, autoplan run wake-on-change-20261027212641).

### 2026-10-27: the default smoke lease comes from the proxy's reservation

The scripts list gains `smoke-lease.ts`, and `run-shard.sh` is described as shipping it with `vm-shard.sh`. The `--smoke-lease-usd` usage shows no fixed default. Limits, "Smoke": the $0.50 default is replaced by a lease derived on the VM from the proxy's per-call reservation, which is twice the largest reservation among the shard's harness cells at 50,000 input tokens and the `--max-output-tokens` cap, rounded up to $0.50 and never under $1 ($3 for Sonnet 5.5, $1 for Haiku 5.5, $6 for Opus 5.5). `--smoke-lease-usd` still overrides it, and a cell whose model has no list price stops the lane with exit 2 before the smoke; the exit codes line names that case. Why: the old default was below the $1.42 that a Hermes or QM Sonnet call reserves, so the first fan-out of `gbrain-memory-2026-10` failed every smoke before its first call.

### 2026-10-27: the smoke lease a Sonnet cell needs

Limits, "Smoke": the $1 figure for a Sonnet smoke lease is replaced by what `gbrain-memory-2026-10` measured: the proxy's worst-case reservation is about $0.40 for an OpenClaw Sonnet call and $1.42 for a Hermes or QM Sonnet call at `--max-output-tokens 128000`, so the $0.50 default refused every Sonnet smoke and the run relaunched at $2 (its report, deviation 1).

### 2026-10-26: the check lane runs from the lane machine only

Limits gains the entry on `pr-check.sh` started from another thread's machine: a sleeping controller leaves the status pending and the VM running (#85 and #84 on 2026-10-26); `pr-check.sh` names its VMs `-pr<n>` with ubi-runner's owner id and `pr-watch.sh --reap-after` destroys the lane's own check VMs older than an hour while the watcher runs, keeping one whose controller is still alive on its machine.

### 2026-10-25: the lane

First version: `run-shard.sh`, `vm-shard.sh` and `fanout.sh` under scripts/ubicloud/, this page, the measured proof.

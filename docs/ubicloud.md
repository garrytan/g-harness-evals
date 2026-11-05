# Ubicloud shard lane

A counted run is sharded by whole cells (CREW.md, Parallelism) and, from now on, every counted run's shards run on ephemeral Ubicloud VMs instead of Capy subagent machines unless the coordinating agent says otherwise. One standard-16 VM (16 vCPUs) per shard, the repository pinned at the preregistration commit, the images built there, the one-trial smoke the Capy shards ran, then the repository's own `scripts/run-shard.sh` under the shard's lease; the results tree is copied back and the VM destroyed on every exit path. The Capy shard path (a fresh subagent machine per shard, [runner/README.md](../runner/README.md), "Sharded runs") stays for one-off reruns of a few trials.

Why: a Capy thread holds at most eight shard machines, each has four cores, and a Capy machine sleeps or restarts under a long run unless the thread keeps an operation awaited every turn (four restarts cost the gbrain arm about an hour). A VM has no sleep, a twelve-cell run gets twelve VMs, and the thread only polls.

## The scripts

All under [scripts/ubicloud/](../scripts/ubicloud/), beside the check lane ([scripts/ubicloud/README.md](../scripts/ubicloud/README.md)) and sharing its `ubi-runner.sh` (the runner from the Ubicloud skill, unchanged) and `bootstrap.sh` (Docker, Bun at ci.yml's pin, Node, python3, jq).

- `run-shard.sh`: one shard on one VM, from this machine. It resolves the commit, clones a clean detached checkout of it into a scratch directory, creates the VM, streams the checkout to `~/work/harness-evals` on the VM, runs `bootstrap.sh`, writes the model keys to the VM over SSH, uploads `vm-shard.sh` and `smoke-lease.ts` and starts `vm-shard.sh` detached, polls the VM's logs into `--dest`, and on exit copies the results back, writes `shard-vm.json` and destroys the VM.
- `vm-shard.sh`: the VM side, started by `run-shard.sh`: `git checkout --detach <commit>` (a dirty tree is refused, as `scripts/run-shard.sh` refuses one), `bun install --frozen-lockfile`, the smoke, then `scripts/run-shard.sh` for the shard. It records phase times and its exit code for the controller.
- `smoke-lease.ts`: prints the default smoke lease for a shard's harness cells at an output cap, using the proxy's own price lookup and reservation formula from `runner/ledger/budget-ledger.ts` in the pinned checkout. `run-shard.sh` ships it beside `vm-shard.sh`, which runs it when `--smoke-lease-usd` is not given (Limits, "Smoke").
- `fanout.sh`: one `run-shard.sh` per shard from one manifest, in parallel, with the quota check, a table at the end and the merge command.

## One shard

```sh
export UBI_OWNER=<your thread code>          # every VM is named ubirun-<owner>-<epoch>-<hex>-t<hours>
scripts/ubicloud/run-shard.sh \
  --commit <preregistration commit> --prereg docs/benchmarks/<run>/prereg.json \
  --name oc-a --cells openclaw-haiku-none-mu-heldout,openclaw-haiku-told-mu-heldout --lease-usd 5 \
  --dest ~/.capy/work/<run>/oc-a [--gbrain-image <tag>] [--embedded] [--amendment <sha>] [--resume] \
  [--size standard-16] [--smoke-lease-usd <n>] [--smoke-task <dev task id>] [--no-smoke] [--pre-smoke <scripts/....sh>] \
  [-- <arguments for scripts/run-shard.sh>]
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
- **A dead controller.** The shard keeps running on the VM; rejoin it with `run-shard.sh --attach --dest <dest>`. `ubi-runner.sh list --mine` shows your VMs; destroy a leftover with `ubi-runner.sh down <vm>`. Never leave a VM running.
- **`--resume`.** A new VM is created (a destroyed one is gone), the local `<dest>/results` tree is uploaded first without the per-trial `state/` and `workspace/` directories, the smoke runs again at the recorded commit (it rebuilds the images; `--no-smoke` builds them in the counted step instead), and `scripts/run-shard.sh --resume` does what it does on a Capy shard: it keeps `shard.json` as the record of the first launch and appends to its `resumes` list, refuses a commit other than the recorded one unless `--amendment` names it, skips preflight when `preflight.log` already says ok, and `run --resume` skips the trials `trials.jsonl` already holds. The uploaded `ledger.sqlite` carries the open lease, so the spend stays in one ledger. The results pulled back at the end merge over the local tree. A preregistration that sets `shard_resume` to `refused` (matrix-mu-2026-11) gets no resume: `run-shard.sh` exits 2 before any VM call on `--resume`, a pass-through `--resume`, a relaunch into a `--dest` that already holds `results/shard.json`, or any launch into a `--dest` whose `shard-vm.json` records `launched_at` (one launch per destination), `scripts/run-shard.sh` refuses `--resume` and an `--out` that already holds the shard, and the cell merges with `merge-shards.ts --partial --vm-lost <cell>`.
- **Smoke.** The smoke is a copy of the preregistration with only the shard's harness cells, each on one dev task (`--smoke-task`, default the first task directory of the cell's task set's dev split; earlier runs used `cn-01-north-date-formats` for v0.2 and `sc-01` for v0.1), one repetition, `split: dev` (a held-out cell smokes on a dev task so no held-out task is spent), under its own lease and its own ledger under `smoke/`. The lease defaults to what `scripts/ubicloud/smoke-lease.ts` derives on the VM from the proxy's per-call reservation: the proxy reserves a call's input tokens plus the output cap (`--max-output-tokens`, 128000 by default) at the model's list price before forwarding, about $0.40 for an OpenClaw Sonnet call and $1.42 for a Hermes or QM Sonnet call at that cap, so the old $0.50 default refused every Sonnet smoke of `gbrain-memory-2026-10` before its first call and the run relaunched with `--smoke-lease-usd 2` ([report](benchmarks/2026-10-26-gbrain-memory/report.md), deviation 1). The default is twice the largest reservation among the shard's harness cells at an allowance of 50,000 input tokens, rounded up to $0.50 and never under $1 ($3 for Sonnet 5.5, $1 for Haiku 5.5, $6 for Opus 5.5); `--smoke-lease-usd <n>` overrides it, and a cell whose model has no list price stops the lane with exit 2 before the smoke. In a sealed lane the smoke runs without the sealed flags on the public gbrain image, and the counted step builds the sealed image (no `--skip-build`). Every smoke trial must end `completed`, or the counted run does not start and the lane exits 4. Scripted cells are not smoked.
- **Exit codes.** `scripts/run-shard.sh`'s for the shard; 4 when the `--pre-smoke` check or the smoke failed; 3 when the VM, the sync or the bootstrap failed before the run (or the `--timeout-hours`, default 12, passed); 2 for a usage error or a smoke lease that could not be derived (pass `--smoke-lease-usd`); 130 on interrupt.
- **Disk.** standard-16 comes with its default disk; pass `--storage <GiB>` for a shard whose trials keep large harness state. `scripts/run-shard.sh`'s prune loop deletes graded trials' caches every five minutes as on a Capy shard.

## Changelog

### 2026-11-04: the lane lands each pull request at its own head

The Limits bullet on the check lane now says `.gstack/ship-policy.json` sets `"merge": "direct"`, so `merge-pass.sh --land` merges a pull request at its own green head with `gstack-ship-queue land --pin`, with no stamp commit, and versions move in a release pull request. Why: the stamp commit cost every merge a second CI round, and a restamp after each merge ahead of it (gstack v1.95.0.0 added the direct mode). The cost: no check runs on the combined tree before a merge, so two pull requests that pass alone can still break main together, and main's own checks after each merge are what catch it. The hold file and the closing-keyword check are read again after READY, right before land --pin, and a stamp left from train mode is a skip that says to reset the branch to its pin.

### 2026-11-04: plain names for internal roles

Mentions of the project's coordinating agent, its private drive and its agent threads now use those plain names instead of internal role names. No number, link or claim changes. Why: the page is published, and the public export blocks internal role names in prose.

### 2026-11-02: the lane merges through gstack land

The Limits bullet on the check lane now says the lane runs `merge-pass.sh --land` under `changelog_fragments`: pull requests carry a `changelog.d/` fragment instead of a version, and gstack's `land` stamps the version at merge, in a commit checked like any head. Why: every queued pull request conflicted on VERSION, package.json and CHANGELOG.md as soon as anything ahead of it merged, and re-shipped just to renumber (approved on 2026-11-02).

### 2026-10-31: PARTICLE_API_KEY travels with the model keys

`run-shard.sh` writes `PARTICLE_API_KEY` to the VM's key file beside the other model keys when it is set in the caller's shell, for Particle-1 cells; like the other keys, only the metering proxy uses it and no container receives it. A Particle shard launched without the key is refused on the VM by `runner/run.ts` (HE-PROXY-001) before any model call. Why: the harness by model matrix runs a Particle-1 row (decision 13 of the matrix plan).

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

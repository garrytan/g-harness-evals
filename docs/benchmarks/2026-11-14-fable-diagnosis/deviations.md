# Deviations for run fable-diagnosis-2026-11

## 2026-11-15: shards ran from two commits

- **s01 (the canary)** ran from 790160a65ab4a71d77583dbe2973a5628750794f (amendment 2). It was already running when amendment 3 was committed.
- **s02 to s11** run from e5c9d8d9f5d597c32e157a936975f13737b03df6 (amendment 3).

`git diff --stat 790160a6 e5c9d8d9` lists five files:
- `docs/benchmarks/2026-11-14-fable-diagnosis/amendments/2026-11-15-mirror-runtime.md`: the amendment note.
- `scripts/ubicloud/run-shard.sh`: the results mirror (`--replicate-to`) leaves out each `.../gstack/agents/run/gstack/*/runtime` tree. This runs on the controller after results are pulled, so it only decides what gets copied off the VM.
- `scripts/ubicloud/vm-shard.sh`: the keyless pre-trial smoke (`install-check.sh` against a fake upstream, no spend) is retried, but only after an AgentSetupTimeoutError. Any other smoke failure still ends the shard. The smoke runs before the counted run starts, and the line that starts `scripts/frontier-harbor/vm-run.sh` is unchanged.
- `tests/ubicloud-lane-retry.test.ts` and `tests/ubicloud-mirror-smoke-edition.test.ts`: tests only.

No file that runs inside a trial, scores a trial or builds a task image differs between the two commits. That includes vm-run.sh, the harness adapters, the egress sidecar, the verifier, plan.ts, materialize.ts, to-trials.ts, the pins, the plan files and feature-split.ts. So every counted trial in s01 and in s02 to s11 ran the same trial path.

On s01, the keyless smoke's installed gstack runtime directories (`~/shard/smoke/results/gstack/agents/run/gstack/*/runtime`, smoke install files, not counted results) were deleted on the VM before teardown, so the 790160a6 controller would not copy about 3.5 GB into the results mirror. The run log records the command and the sizes removed.

## 2026-11-15: smoke-retry audit (the d81fad5b retry flaw)

Amendment 3's smoke retry also retried a try that failed its egress, canary or zdr check, as long as that try also had an AgentSetupTimeoutError. Main fixed this in #466. This run kept amendment 3's code. Instead, the run agent watched every shard's kept per-try smoke logs (`~/shard/smoke/try<n>.*.log`) and stopped a shard before its counted run on any egress or canary failure, any zdr status other than `no_capture`, or a zdr `no_capture` on a cell whose own trial did not time out in setup.

- **s06:** try 1 had a Hermes setup timeout, plus zdr `no_capture` on hermes-sol (the cell that timed out). Egress and canary passed. It was stopped at 12:34Z with 0 counted trials and $0.89 of VM time, then relaunched fresh at e5c9d8d9.
- **s04:** retried once. Try 1 had a setup timeout, and egress, canary and zdr passed, so it continued.
- The run log has one line per shard on its smoke retries.


## 2026-11-15: the controller machine slept mid-run

- The Capy machine that ran the shard controllers slept from about 13:49Z to 18:37Z. The run agent had sent a report without first registering a wait on the running controller operations, so the machine went idle and every controller process on it ended.
- The VMs kept running, and every trial ran on its VM, so no trial was affected. Each shard was re-joined with `run-shard.sh --attach`, which kept its original 9-hour deadline, pulled its results with exit 0 and destroyed the VM. `list --mine` printed nothing afterwards.
- Most VMs had finished hours before the re-attach and sat idle until then, which added about a quarter to the VM time of s02 to s11: VM life was 1.26 times the time from VM creation to the last trial's end plus 5 minutes (1.00 to 1.63 times per shard). That is included in the $42.47 VM total in spend-internal.md.

## 2026-11-15: launch problems that spent nothing

- s11's first launch stopped on a full controller disk before any VM was created.
- Ubicloud's vCPU quota made s08 to s11 wait for earlier shards to finish. A requeue bug in the run agent's retry script retried them every few minutes; no VM was created and nothing was spent.

## Reruns

- None. `to-trials.ts scan-verifier` found 0 `verifier_unavailable` trials ([results/verifier-unavailable.json](results/verifier-unavailable.json)), and every shard scored all its trials with 0 infra errors.


# Pilot: gstack on particle-1 and two frontier models (R111)

**All three arms passed their pilot checks, so the counted run can use all three.** Each arm ran 42 uncounted trials (6 model and harness pairs, the first 7 tasks of the shared order, 1 attempt) on 2026-11-26 and 27. They ran from commit `2bc625de08c891e59cddb1fe83a6a22dfec02bfc` of this plan's branch under [prereg-pilot.json](prereg-pilot.json).

- **The part under test ran in every arm.** No gstack: no gstack in any container and no gstack file read. gstack installed: setup passed and the skill listing reached the model in every trial where the harness installed, 41 of 42. In the 42nd, particle-1 on Hermes (adaptive-rejection-sampler), Hermes's own installer failed before gstack's setup began; it is an excluded infra error under the plan change of 2026-11-27 in the [preregistration](../PREREGISTRATION.md#pilot). gstack told: the told line reached the model in all 42 trials, and the model ran build-check in all 6 pairs.
- **The tasks can be supplied.** Every trial got its pinned task. Every trial where the harness installed (125 of 126) got a passing git step and model answers. There were no `HE-FRONTIER-016`, `HE-DELIVERY` or web-tool errors.
- **The pilot cost $60.57 in model calls,** well under the three pilot caps ($172 in all). Its prices set the counted leases in the [Cost projection](../PREREGISTRATION.md#cost-projection).

Pilot trials are never counted, so this page gives no pass rates.

## What each arm showed

| Arm | Trials | Scored | Excluded | Model spend | Pilot cap | VM (list price) |
|---|---|---|---|---|---|---|
| No gstack | 42 | 42 | 0 | $17.63 | $45 | $2.28 |
| gstack installed | 42 | 41 | 1 (`no_model_response`) | $21.28 | $56 | $2.62 |
| gstack told | 42 | 42 | 0 | $21.65 | $71 | $2.26 |

"Scored" counts finished trials, agent timeouts (3, 4 and 2 per arm, each scored as a fail, including one no-gstack Opus 5.5 trial on Hermes, gpt2-codegolf, whose verifier passed after the time limit) and one OpenClaw `harness_error` (GPT-6.2 Sol, no-gstack arm, cobol-modernization). The one excluded trial is particle-1 on Hermes in the installed arm (adaptive-rejection-sampler). Its record shows the harness install exiting non-zero before gstack's setup began, with no model request. The VM's run log, which is not committed, gave Hermes's installer message as "app products or command publication failed". The told shard's first smoke also stopped on a Hermes install (below); that log is not committed either.

### No gstack

- The clean-arm check before any trial found no gstack and no Capy drive on the VM ([pilot-none/preflight-clean-arm.json](pilot-none/preflight-clean-arm.json)). No trial's container held gstack (`gstack_found` empty in all 42).
- The audit found 0 gstack file reads and 0 gstack skill listings in all 6 cells ([pilot-none/audit-summary.json](pilot-none/audit-summary.json)).

### gstack installed

- gstack's setup exited 0, gstack-harness status saw every skill and the start hook was active, at setup and again at launch, in 41 of 41 trials where the harness installed. In the 42nd, Hermes itself never installed (above).
- The audit found the skill listing and the start note in every captured trial: 41 of 41. Without being told, particle-1 opened a gstack skill in 3 trials on OpenClaw but never build-check, and GPT-6.2 Sol opened build-check and ran it in all 7 of its trials on OpenClaw. That happened in no Hermes trial ([pilot-installed/audit-summary.json](pilot-installed/audit-summary.json)).

### gstack told

- Setup and launch health passed in 42 of 42 trials.
- The told line reached the model in 42 of 42. The model opened build-check in all 42, and the audit counts 41 as `followed` (6 of 7 for particle-1 on OpenClaw, 7 of 7 everywhere else). `followed` means a checks, end or log step of build-check ran; the audit has no separate count of the start step. The audit classed build-check's checks outcome as `ran` in 5 trials and `no_tests` in 36 ([pilot-told/audit-summary.json](pilot-told/audit-summary.json)). `ran` also covers detection output and skipped-check messages, so it does not show that the task's tests ran.

### In every arm

- **GPT-6.2 Sol:** every answer named `gpt-6.2-sol` (243, 295 and 328 answers per arm), and none was missing its model. Particle answers named `particle-ai/particle-1`. The proxy records no model for Anthropic answers, as the plan's Settings say.
- **Effort high:** every agent-loop request carried the cell's effort (876, 984 and 1,041 requests, all matching).
- **Git:** the agent's own check saw git and `origin/main` in every trial that started.
- **Web tools:** no trial was offered a web tool.
- **Audit flags:** 6 trials per arm were flagged, all on llm-inference-batching-scheduler, all canary-only. The canary is in the header of the task's own `/app/scripts/cost_model.py`, as in the frontier harness run, so none is an answer-key receipt.

## Keyless checks before the pilot

- **Agent install check** (one VM, fake upstream, no key, 2026-11-26; [keyless/install-check-trials.jsonl](keyless/install-check-trials.jsonl)): 13 trials across the 6 particle-1 cells and GPT-6.2 Sol on Hermes in the installed arm. All 13 finished. Every installed and told trial passed setup and launch health. These records hold no exposure measures, so this check does not show the listing, start note or told line reaching the model; the paid pilot's audits below show that. Sol's answers named `gpt-6.2-sol`.
- **Zero-data-retention check** (`run-shard.sh --install-check`, same commit): Hermes and OpenClaw on GPT-6.2 Sol sent no chained Responses request. This is the `--zdr-gate` every shard with a Sol cell needs.

## What went differently from the plan

- **The told shard ran twice.** Its first VM's smoke (the repository's whole keyless install check) failed because Hermes did not install for Hermes on Grok 4.7, a pair outside this plan. No trial ran and nothing was spent on models. That VM's list price has no receipt here, so it is not counted in the table above. The shard was launched again at the same commit and passed.
- **The told rerun ran without the mid-run copy of its results.** Results came back when the shard ended, as for the others.

## Files

- `pilot-<arm>/trials.jsonl`, `ledger.sqlite`, `shard-vm.json`: each arm's trial records, metering ledger and VM receipt, the inputs [../plan-cost-receipt.json](../plan-cost-receipt.json) prices from.
- `pilot-<arm>/audit-summary.json`: the audit's per-cell counts and flags. It quotes no model text.
- `pilot-<arm>/run-summary.json`, `accounting.json`, `manifest.json`, `attestation.json`, `preflight-clean-arm.json`, `zdr.json` and, for the gstack arms, `gstack-bundle-check.json`: the runner's receipts.

# v0.4 transfer check on the rehearsal set, Opus 5.5

Status: written 2026-11-02 (UTC), before any trial. Run id `v04-transfer-2026-11`. Cells are in [prereg.json](prereg.json).

**In one line: does each family's told-live rate on 6 fresh rehearsal tasks sit inside the 10 to 90 percent band, beside its dev rate? Descriptive only. The rules, arms, budget, shards and clean-arm checks are in [round 1's preregistration](../2026-11-02-v04-cal-r1/PREREGISTRATION.md) ("The transfer check").**

- **Tasks.** The 6 public rehearsal tasks, task set `v0.4/rehearsal` (one per family, all at L2, 21 turns in all), generated through the quiet path on a fresh world slice from a private seed and published with that world (deviation 2 in round 1's preregistration, accepted by the Captain on 2026-11-02).
- **Cells.** 4: told-live (2 repetitions) and none (1 repetition) on OpenClaw and Hermes. 36 trials, $13.44 expected.
- **Its own run** because its gbrain cells read the rehearsal world (`tasks/multiuser/v0.4/rehearsal/world/world.json`, `babe36472c2a`), and one gbrain image holds one world's brains. `scripts/run-shard.sh` builds that image with `build-gbrain-image.sh --world`, tagged `harness-eval/gbrain:world-babe36472c2a`.
- **Shards.** Two, one per harness (`tc-oc`, `tc-he`), 0.71 hours of trial time each at the slowest pace. Leases $16 and $11: the $27 cap, reserved inside the $170 calibration cap.
- **When.** Alongside calibration round 1, from a worktree at the same merge commit. Smoke task `rx-06-wv2db9`, $4 lease per shard. A shard holds both arms of its harness, so its smoke runs without `--smoke-first-cell`: one trial of each of its 2 cells.
- **Merge.** All four cells named, so the merge checks each shard's clean-arm preflight: `bun scripts/merge-shards.ts --out docs/benchmarks/2026-11-02-v04-transfer/results --cells openclaw-opus-gbrain-told-live-mu-v04-rehearsal,openclaw-opus-none-mu-v04-rehearsal,hermes-opus-gbrain-told-live-mu-v04-rehearsal,hermes-opus-none-mu-v04-rehearsal --shard tc-oc=<dir> --shard tc-he=<dir>`.
- **How it is read.** Per family: the rehearsal told-live rate (4 trials) beside the dev told-live rate at L2 and at the frozen level, and whether it sits in the band. A family frozen at L2 is checked directly; one frozen elsewhere is context only. It changes no frozen level and gates nothing.
- **gbrain pin:** `2c469d1bfc0e096646b2a2b1caba4fdea4592f00` (0.60.547.0, the GBRA-277 hotfix), the same version as every other v0.4 gbrain arm. Rehearsal member brain page-list digest: `eda5251ea8b5` (26 pages; round 1's "The gbrain pin"). GBRA-279 (the stdio MCP server and the remaining hook lanes) is not in the pin; these arms reach gbrain only over the sidecar's HTTP MCP route, so they do not run those lanes. Ingested facts reach the model inside gbrain#8367's quote fence.
- Model `anthropic:claude-opus-5-5`. No claim.

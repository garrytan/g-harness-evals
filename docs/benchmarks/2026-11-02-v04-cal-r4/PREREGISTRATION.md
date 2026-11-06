# v0.4 calibration round 4 on Opus 5.5

Status: written 2026-11-02 (UTC), before any trial. Run id `v04-cal-r4-2026-11`. Cells are in [prereg.json](prereg.json).

**In one line: round 4 of the v0.4 calibration loop. Its rules, arms, budget, shards and clean-arm checks are preregistered in [round 1's preregistration](../2026-11-02-v04-cal-r1/PREREGISTRATION.md), which governs this run.**

- **Cells.** The same 96 cells as round 1 (every family, level, arm and harness; told-live 2 repetitions, none 1), under this run id, so a confirmation rerun gets its own trial ids. `prereg.json` differs from round 1's only in the run id and the round number.
- **What runs.** Only the cells the rule picks: `scripts/v04/next-round.ts` over the committed round files of rounds 1 to 3, priced with [cell-costs.json](../2026-11-02-v04-cal-r1/cell-costs.json), written to `round/decision.json` in this directory and pushed before the fan-out.
- **A confirmation-only round.** Round 4 runs only families in CONFIRM, or rerunning after a short round with a verdict pending, at their current level. If no family awaits confirmation after round 3, this run never starts.
- **The run may not happen.** If the loop stops before round 4 (4 of the 5 primary families frozen, the round limit, or the cap), nothing runs under this run id and the report says so.
- **Cap.** The shared $170 calibration cap, through the cap remaining before this round and the shard leases ("Leases and the cap" in round 1's preregistration). Amendment 3 (2026-11-06) raises the shared cap to $350 before this round.
- **gbrain pin:** `2c469d1bfc0e096646b2a2b1caba4fdea4592f00` (0.60.547.0, the GBRA-277 hotfix), the same version for every gbrain arm as in round 1. GBRA-279 (the stdio MCP server and the remaining hook lanes) is not in it; these arms reach gbrain only over the sidecar's HTTP MCP route, so they do not run those lanes (round 1's "Known open item: GBRA-279"). Ingested facts reach the model inside gbrain#8367's quote fence (round 1's "The quote fence").
- Model `anthropic:claude-opus-5-5`, OpenClaw and Hermes, dev tasks only, no claim.

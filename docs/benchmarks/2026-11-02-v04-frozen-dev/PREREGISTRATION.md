# v0.4 frozen-dev read of all four arms, Opus 5.5

Status: written 2026-11-02 (UTC), before any trial. Run id `v04-frozen-dev-2026-11`. Cells are in [prereg.json](prereg.json).

**In one line: after calibration stops, fresh rows on every family frozen in band, at its frozen level, for told-live, told-scoped, untold-gbrain and none on OpenClaw and Hermes. Descriptive; it sizes opening 1. The rules, arms, budget, shards and clean-arm checks are in [round 1's preregistration](../2026-11-02-v04-cal-r1/PREREGISTRATION.md) ("The frozen-dev read").**

- **Cells.** 192 preregistered: every family, level, arm and harness. told-live and none at 2 repetitions, told-scoped and untold-gbrain at 1. Only the frozen families' cells at their frozen levels run (8 cells per family), picked by the stop decision of `scripts/v04/next-round.ts`, committed under `round/decision.json` here before the fan-out.
- **Fresh rows only.** No calibration row enters this read or its MDD.
- **Cap $240.** Expected $184.32 if all six families freeze at L4, $102.40 if all six freeze at L1, $71.68 for the four cheapest primary families at L1.
- **Shards.** At most 8, one per harness and arm (`fd-oc-live`, `fd-oc-scoped`, `fd-oc-untold`, `fd-oc-none` and the same for Hermes), each under 3.23 hours of trial time at the slowest pace. Leases by the rule in round 1's preregistration against $240.
- **Reported:** per arm and harness pass rates with task-clustered intervals, untold-gbrain's gbrain call rate, the descriptive comparisons, retired record per arm, and the projected MDD for told-live against none per harness on the five primary families (`scripts/paired-mdd.ts --project`, alpha 0.0125 two-sided, power 0.8, 36 tasks by 3 repetitions, 15 points).
- **The untold verdict:** "untold route: CUT-CANDIDATE confirmed on Opus" goes to HARN-1 only if untold-gbrain calls gbrain in fewer than 5 percent of trials on both harnesses and its pass rate is within the interval of none's.
- **gbrain pin:** `2c469d1bfc0e096646b2a2b1caba4fdea4592f00` (0.60.547.0, the GBRA-277 hotfix), one version for told-live, told-scoped and untold-gbrain. GBRA-279 (the stdio MCP server and the remaining hook lanes) is not in it; these arms reach gbrain only over the sidecar's HTTP MCP route, so they do not run those lanes (round 1's "Known open item: GBRA-279"). Ingested facts reach told-live's and untold-gbrain's model inside gbrain#8367's quote fence (round 1's "The quote fence").
- If fewer than 4 primary families freeze, this run waits for the Captain (3 frozen) or does not run (2 or fewer), as the fallback in round 1's preregistration says.
- Model `anthropic:claude-opus-5-5`. Dev, no claim.

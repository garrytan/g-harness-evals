# Amendments: h10-rule-placement-rerun-2026-11

The preregistration was merged as `f59e43890984` (#532). Every amendment here is dated and committed on this run's results branch before the trials it covers. The commit that adds an amendment is the commit the trials it covers run from.

## 2026-11-23: gbrain moves to v0.60.766.0, the newest release at launch

**What changes.** `gbrain_commit` in [prereg.json](prereg.json) and [pilot/prereg-pilot.json](pilot/prereg-pilot.json) moves from `6a507316104fd23e0f1c9fb7e2ebabd8fdc5488c` (v0.60.754.0) to `ae4bef02cea6f7f2bb5c3a8565a9927de08162dc` (v0.60.766.0, gbrain's release tag `v0.60.766.0`). The question's build name moves with it. Nothing else in the plan changes: no task, preamble, grader, world, harness pin, rule or placebo byte, cell, budget or analysis.

**Why.** The plan's launch rule ("Release pin and launch check"): right before the first pilot trial, move to gbrain main's newest release, re-render the rule for every harness, re-pin any bytes that changed, rerun the keyless check, the scope probe, the R94 gate and the preflight, and freeze that build for the pilot and the counted run. Every number this run publishes is measured on v0.60.766.0, not on v0.60.754.0 as the preregistration's first lines say.

**The build.** v0.60.766.0 is tagged at `ae4bef02` (committed 2026-11-23 13:40 UTC, gbrain#10156). It was the newest release tag on gbrain's main branch when these checks ran (2026-11-23 23:00 UTC). Main was 9 commits further on, at `8cb62d1c`; none of those is in a release, so none is used.

**Every check matches v0.60.754.0.** All of them ran keyless on 2026-11-23. Outputs are in [preflight/amend-2026-11-23/](preflight/amend-2026-11-23/).

1. **The rule bytes are unchanged on every harness.** `renderBrainFirstTurnRule({ kind: 'mcp', server: 'gbrain', surface: 'starter' }, harness)` from `src/core/setup/brain-first.ts`, run at `ae4bef02` and, as a control, at `6a507316`, gives the same bytes at both: generic, Claude Code and Codex 289 bytes `4a81cb9b...`, OpenClaw 569 bytes `9506febd...`, Hermes 491 bytes `10421cbc...`. These are the sha256s the plan pins ("The rule bytes per harness"), so no route file, placebo, adapter or test moves. harnesses/routes/README.md keeps naming `6a507316` as the rendering's source, which stays true.
2. **The control's carrier is unchanged.** The starter surface's tool definitions (every tool's name, description and input schema, from `buildToolDefs(filterOpsForSurface(operations, 'starter'))`) hash to `ecb8cf5f...` at both commits. The sidecar serves 34 tools on the starter surface, as on v0.60.754.0.
3. **Keyless gbrain-check** at `ae4bef02` with `--expect-hook`: 37 passed, 0 failed, 0 pin diffs. The starter surface serves 34 tools and the verbs surface 7.
4. **Scope probe and R94 gate** on the sidecar image built at `ae4bef02` (`harness-eval/gbrain:h10-ae4bef02cea6`, `sha256:d883d5636514`). All 19 brain and setting pairs return the same counts as the same probe on v0.60.761.0 (the shared-brain access run's launch amendment), which matched v0.60.754.0. The only differences are the `since` timestamps in the serves line. Explicit serves one still equals the open default, with no error.
5. **Runner preflight** of every cell, on a scratch copy of the plan with only `gbrain_commit` changed, against that image: `PREFLIGHT: ok`, 360 trials. The sidecar reports gbrain 0.60.766.0 with 34 starter tools. All four route harness images carry their provenance files at this checkout's sha256: Claude Code 10 files, Codex 8, Hermes 9, OpenClaw 11.

**What changed in gbrain between the two releases.** There are 88 commits on gbrain's main branch from `6a507316` to `ae4bef02`, 12 of them release commits.

- **Not on the measured path.** These are installer changes:
  - gbrain#9972, the OpenClaw and Hermes install steps writing the brain-first rule;
  - gbrain#9975, Hermes install without approval or scanner changes;
  - gbrain#10043, setup with HERMES_HOME and commented OpenClaw configs.

  In this run the adapters deliver the rule themselves, and gbrain runs as the sidecar's MCP server. The rest of the 88 are sync, connector, Rust-engine, dream, doctor, repair, logging and skill-resolver changes that this run's sidecar doesn't use.
- **On the path, and only after a gbrain call returns.** Three changes alter what a search, query or get_page result says:
  - gbrain#9972 adds a "Saved facts (remember)" block after search and query rows when a remembered fact matches (`src/mcp/saved-facts-notice.ts`, `src/mcp/dispatch.ts`);
  - gbrain#9903 makes search say when it couldn't check for outdated pages;
  - gbrain#9981 makes get_page suggest a valid call after a bad one.

  None changes a tool's name, description or schema (item 2), and none reaches the model before its first gbrain call of a turn. So the primary endpoint for a turn (a gbrain call before that turn's first reply) can move only through what an earlier turn's results said. The saved-facts block appears only when a fact saved with remember matches the search; I haven't checked whether the run's brains hold any before the agent saves one. How each could move the secondary measures:
  - **#9972's saved-facts block** adds up to 1,500 characters to a matching search or query result. Load (what the agent reads from gbrain) could rise on turns after a remember. Pass could move either way if a saved fact answers the question or points at a stale one.
  - **#9903's outdated-pages note** adds a line to a search result when the check couldn't run. Load could rise by that line. Pass could move only if the note changes which page the agent trusts.
  - **#9981's get_page suggestion** follows a bad get_page call with a valid one. Load could rise if the agent retries with the suggestion, and pass could rise if the retry fetches a page it needed.

**Decision.** The run's lead put these three changes to the Harness Evals Captain before any trial. The Captain's answer on 2026-11-23: "do it. Freeze v0.60.766.0 (ae4bef02) by dated amendment, naming #9972, #9903 and #9981 and how each could move the load and pass measures." This amendment freezes v0.60.766.0 for the pilot and the counted run together. The report names these three changes beside any load or pass difference from the original.

## 2026-11-24: counted leases from the pilot's costs, the runner change, and the fan-out options

Written after the pilot ([pilot/README.md](pilot/README.md)) and before any counted trial.

**Counted leases move to what the pilot's costs project, inside each arm's budget.** The plan's counted leases are 1.5 times what the original's cells spent. The pilot shows GPT-6.2 Sol on Hermes and OpenClaw spending more on one member turn ($0.160 and $0.129 per trial) than the plan expects for a whole trial ($0.147 and $0.108 for about four turns, from the original's receipts). If the counted trials scale with their turns, Hermes would need about $51 and OpenClaw about $31, against leases of $18 and $10. The shared-brain access run lost 51 Hermes GPT-6.2 Sol trials to leases priced the same way.

So each counted lease becomes the larger of the plan's lease and 4.4 times the arm's mean pilot trial per counted trial (four turns per trial, plus a tenth). It is capped at the arm's budget minus its pilot spend and its smoke lease. Arm budgets, smoke leases, the $320 cap and everything else stay as planned. Leases are caps, not spend: the plan's expected spend still applies, and only a runaway or a costlier model can use the room.

| Shard | Trials | Pilot mean per trial | Plan lease | Counted lease | Arm budget left after pilot and smoke |
|---|---:|---:|---:|---:|---:|
| `cx` Codex | 90 | $0.064 | $21 | $25.40 | $57.98 |
| `he` Hermes | 80 | $0.160 | $18 | $34.80 (the arm's budget) | $34.80 |
| `oc` OpenClaw | 60 | $0.129 | $10 | $34.10 | $44.70 |
| `cc-cli` Claude Code cli | 60 | $0.216 | $25 | $56.90 | $61.87 |
| `cc-sdk` Claude Code Agent SDK | 50 | $0.229 | $21 | $50.40 | $57.78 |
| `qm` QM | 20 | $0.060 | $3 | $5.30 | $18.14 |

Counted leases add up to $206.90. With the smoke leases ($29.54) and the pilot's spend ($5.19), that's $241.63 inside the $320 cap. Hermes is capped by its arm budget. If its trials cost four times the pilot's, its cells may end partial at the lease, and the report will say so.

**The runner change the plan names.** The plan requires the runner pull request that keeps one broken cell from ending an invocation to merge before the counted trials. It also requires the launch amendment to name its commit before the first pilot trial. That pull request is #584, merged as `be31b04edcbd3ecfd4549a202c59e7ed36d1bb68` ("A harness that fails to start no longer ends the run"). It is an ancestor of the launch amendment's commit `13910b21`, so the pilot and the counted run both use it. The launch amendment did not name it, which was a lapse: it is named here, after the pilot and before any counted trial.

**The fan-out options.** The counted shards use the plan's options with one change: `--gbrain-image harness-eval/gbrain:ae4bef02` instead of `harness-eval/gbrain:6a507316`. That's only the image's tag. The image is built from `gbrain_commit` in prereg.json, which the launch amendment moved to `ae4bef02`. The full options are `--timeout-hours 4 --gbrain-image harness-eval/gbrain:ae4bef02 --smoke-task sy-01-quarrendon-ticket-numbers --smoke-lease-usd <the shard's smoke lease> --pre-smoke scripts/matrix/clean-arm-preflight.sh -- --max-output-tokens 128000`.

The pilot ran without `--pre-smoke` and without an explicit `--max-output-tokens`. The output-token default in `scripts/run-shard.sh` is the same 128000, and the pilot's README says what checked in place of the pre-smoke. The pilot's six VMs went up and came down through the same SSH path the fan-out uses, at the launch amendment's commit. They stand in for the plan's one-VM pre-smoke.

Order as planned: `cx` alone as the canary, then `he`, `oc`, `cc-cli`, `cc-sdk` and `qm`, one VM at a time.

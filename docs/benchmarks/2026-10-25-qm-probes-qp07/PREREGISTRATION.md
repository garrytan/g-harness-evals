# QM probe qp-07 rerun preregistration: one sandbox per channel, with QM's directory seeded

Status: written 2026-10-25 (America/Los_Angeles), after run `qm-probes-2026-10` and before any trial of this run. Run id `qm-probes-qp07-2026-10`. Cells are in [prereg.json](prereg.json); `bun runner/run.ts dry-run --prereg docs/benchmarks/2026-10-25-qm-probes-qp07/prereg.json` prints 6 trials in 2 cells under the $1 cap. Thread HARN-4 of the Harness Evals crew; the Captain's decision on finding F5 (2026-10-25): treat it as a rig limitation until shown otherwise, seed the directory from the adapter, rerun qp-07 under a new run id, and write the result into [docs/qm-findings.md](../../qm-findings.md).

**Declared deviation (2026-10-25):** this preregistration was committed at `a76ed6224a5eb9f24ebdd1d705b8f5c7aed80f31` on branch `harn4/qp07-directory` before any trial, and the run executed from a worktree pinned at that commit (`results/run.wrapper.log` names it). The same pull request (#67) carried the results, and its squash merge put preregistration and results into one commit on `main` (`86d59d0078ba`), so `main`'s history cannot show the preregistration preceding the trials; `docs/benchmarks/preregistrations.d/qm-probes-qp07.json` declares this and the order check prints it as a warning. The branch commit is on `origin`.

## Why this run exists

In `qm-probes-2026-10` probe qp-07 (a member asks the bot to write a file in its workspace from #north-team; another member asks it to read the file back in a new thread a day later) failed 0 of 3 in both QM cells: every channel-scoped `execute` returned "this scope has no default sandbox" and `sandbox create` returned "sandbox access requires permission to use its owning scope" ([finding F5](../../qm-findings.md)). QM decides who may use a channel's sandbox from its directory store, which only its Slack worker or `POST /v1/directory` fills; the rig ran core without the worker, so no channel had a member. This run changes one thing in the rig and nothing in the product: before the first turn the QM adapter now reads the bot's channels and their rosters from the world's Slack API and pushes them to core (`harnesses/qm/qm-directory.mjs`, `qm-api.mjs post /v1/directory`; [harnesses/qm/README.md](../../../harnesses/qm/README.md)). Members are not pushed; identity classification is unchanged. The rest of the probe suite is not rerun: its other results did not depend on channel membership (DM scopes pass by identity, memory and org settings do not read the roster).

## Cells

| Cell | Harness and config | Probe | Repetitions |
|---|---|---|---|
| `qm-pi-haiku-qp07` | QM `pi-probe` | qp-07 | 3 |
| `qm-claude-haiku-qp07` | QM `claude-probe` | qp-07 | 3 |

Model `anthropic:claude-haiku-5-5`, the only model on the proxy allowlist. 900 s per turn. One lease, cap $1 ($0.14 ceiling at list price). Minimum: the pi cell; drop order: the claude cell. QM `v0.1.15` at `7417aa2a` from pin.json, image rebuilt from the running commit; task, oracle, preamble, grader, world and probe configs unchanged from `qm-probes-2026-10` (5 s memory quiet time in the probe configs, as before). The run executes from a worktree detached at this preregistration's commit on the HARN-4 thread machine, trials sequential.

## Outcomes, stated in advance

Two readings per trial, both published, the product reading first:

- **Product reading** (the claim: one sandbox per channel scope, reached by a second member in a new session): upheld when the trial's sandbox manifest (`qm-sandboxes.json`, written by `capture.sh`) lists exactly one sandbox container whose owner scope is the channel (`ownerScopeId: "channel:<id>"` in the `sandbox create` result row of `session_entries`) holding `notes/north-handoff.txt`, and turn 2's `execute` result row in the database dump, in the new session, returns the line `NORTH-HANDOFF-MARIGOLD-8814`. Not upheld when turn 2's `execute` fails or returns a different workspace, or two sandbox containers exist for the channel. Not exercised when turn 1 never reached a sandbox (no `execute` or `sandbox` call, or the directory push was refused, which the adapter treats as a harness error).
- **Grade** (the member-visible outcome, the task's required predicate `t2_read`): the bot's turn-2 reply in #north-team carries the line. This is the same oracle as `qm-probes-2026-10` and is reported as pass or fail per trial. The grade can fail while the product reading is upheld when the model reads the file and declines to paste it (Hermes did this once in `qm-probes-2026-10`; QM did it in the smoke below): that is reported as the model's conduct, not as the product's.

Expected: the product reading upheld in 3 of 3 for both cells (the smoke); the grade is the model's choice and no expectation is written. Finding F5 is then rewritten as "channel membership must be synced before channel-scoped execute works; the permission error does not name the missing permission", with the product note kept. If the product reading is not upheld in any trial, F5 stands as a QM defect with the seeded directory as the receipt.

## Reporting rules

k of 3 per cell for each reading, never pooled with `qm-probes-2026-10` or across cells; no interval; the `qm-probes-2026-10` qp-07 row stays as published. Spend from the ledger summary. The report quotes the directory push (`qm-directory.json`: channels pushed, core's `{ok, channels}`) and the roster of #north-team for one trial.

## Smoke evidence this preregistration rests on

`harn4-smoke-d-2026-10` (2026-10-25, one trial, qp-07 on `pi-probe`, QM image built from the working tree, $0.0063, not counted, receipts not committed): the adapter pushed 8 channels and 58 memberships (`{"ok":true,"channels":8}`; #north-team's roster held Dana, Ilse, one more member and the bot by Slack id). Turn 1's first `execute` still returned "no default sandbox" (no sandbox existed yet), the bot's `sandbox create` then succeeded with `ownerScopeId: "channel:C16V9M1OB60"`, `set_default` followed, and the write and read-back returned the line. Turn 2, a new session by Ilse in a new thread, ran `cat /root/workspace/notes/north-handoff.txt` in the same sandbox and got the line back; the bot then declined to paste it ("It's in my private workspace, not in a channel or shared file you can open"), so the grade was fail while the product reading was upheld. The manifest listed one sandbox container with the file.

## Receipts

Under `docs/benchmarks/2026-10-25-qm-probes-qp07/results/` after the run: `manifest.json`, `trials.jsonl`, per-trial directories (`logs/*` excluded except `adapter.log`), `ledger.sqlite`, `ledger-summary.json`, `proxy-usage.ndjson`, `proxy.log`, `run.log`, `summary.json`, and `report.md`; the finding update in docs/qm-findings.md.

## Amendments

None yet.

# QM probe qp-07 rerun report: one sandbox per channel, with the directory seeded

Run `qm-probes-qp07-2026-10`, preregistered in [PREREGISTRATION.md](PREREGISTRATION.md) (no amendments), two cells, 6 trials, probe `qp-07-sandbox-shared-channel` on QM `pi-probe` and `claude-probe`, model `anthropic:claude-haiku-5-5`. Executed from a worktree detached at the preregistration commit `a76ed6224a5eb9f24ebdd1d705b8f5c7aed80f31` on the internal-task thread machine, QM and sandbox images rebuilt from it (`harness-eval/qm:dev` `sha256:35363130`, `qm-sandbox:dev` `sha256:f7f88a9c`), trials sequential, 09:06:24 to 09:09:38 UTC on 2026-10-25 ([results/run.wrapper.log](results/run.wrapper.log)). Spend $0.0372 on the $1 lease, 81 forwarded requests ([results/ledger-summary.json](results/ledger-summary.json)); ceiling $0.14. All 6 trials `completed`, nothing excluded, HE-MODEL-001 never fired.

The one change from `qm-probes-2026-10` is in the rig: before the first turn the QM adapter reads the bot's channels and their rosters from the world's Slack API and pushes them to core through `POST /v1/directory` ([harnesses/qm/README.md](../../../harnesses/qm/README.md)). In every trial the push landed: 8 channels, 58 memberships, core answered `{"ok":true,"channels":8}` (`logs/qm-directory.json`, quoted from `qm-pi-haiku-qp07/r1`'s adapter log; the roster of #north-team was Dana `U2Q88O0N6PU`, Ilse `U142Z4ZB8TT`, one more member and the bot `UASSISTANT0`). Product and task are unchanged.

## Result

| Cell | Product reading: one channel-owned sandbox, turn 2 reads the file in a new session | Grade (reply carries the line) | USD | Wall median |
|---|---|---|---|---|
| `qm-pi-haiku-qp07` | upheld 3 of 3 | 3 of 3 | $0.0124 | 30 s |
| `qm-claude-haiku-qp07` | upheld 3 of 3 | 3 of 3 | $0.0248 (15 refused `HEAD /api/hello` lines, F2) | 33 s |

Evidence per trial, from the database dumps and sandbox manifests (not committed; [results/trials/](results/trials/) holds the graded records): the first `execute` in turn 1 still returned "this scope has no default sandbox" because none existed yet, the bot's `sandbox create` then succeeded with `ownerScopeId: "channel:C16V9M1OB60"`, `set_default` followed, and the write returned the line; turn 2, a new QM session for Ilse's new thread, ran `cat` in the same sandbox and its `execute` result row carried `NORTH-HANDOFF-MARIGOLD-8814` (two sessions per trial with that result row, the turn-1 and the turn-2 session); `qm-sandboxes.json` lists exactly one container per trial, scope `sandbox-<id>`, holding `notes/north-handoff.txt`. The reply then carried the line in all six trials; the model's refusal to paste seen in the smoke did not recur.

Reading against the preregistration: the product reading is upheld in 3 of 3 in both cells, so finding F5 is rewritten as "channel membership must be synced before a channel-scoped `execute` works; the permission error does not name the missing permission" ([docs/qm-findings.md](../../qm-findings.md)). The `qm-probes-2026-10` qp-07 row stays as published (0 of 3, empty directory); this run is its own check and is not pooled with it.

## Limits

Six trials of one probe; a product check, not a rate. The directory the rig pushes is the world's, so this tests QM's rule given a complete roster, not its Slack worker's sync. The probe configs keep the 5 s memory quiet time (not exercised by this probe).

## Receipts

[results/manifest.json](results/manifest.json), [results/trials.jsonl](results/trials.jsonl) (6 records), per-trial directories (`logs/*` excluded except `adapter.log`), [results/ledger.sqlite](results/ledger.sqlite), [results/ledger-summary.json](results/ledger-summary.json), [results/proxy-usage.ndjson](results/proxy-usage.ndjson), [results/proxy.log](results/proxy.log), [results/run.log](results/run.log), [results/summary.json](results/summary.json).

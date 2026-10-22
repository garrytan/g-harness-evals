# Error codes

Every runner, proxy and adapter failure prints one line that starts with its code, says what happened with the values involved, and ends with the fix command or the human prerequisite. Codes are stable; add a row here in the same commit that introduces one. Areas: PREREG, PIN, RUN, BUDGET, PROXY, ADAPTER, EGRESS, SCORE, TASK, PUBLISH.

| Code | What | Fix / recovery | Where |
|---|---|---|---|
| HE-PREREG-001 | preregistration file not found | pass `--prereg docs/benchmarks/<run>/prereg.json` | runner/run.ts |
| HE-PREREG-002 | unsupported schema_version | set `schema_version: 1` | runner/run.ts |
| HE-PREREG-003 | no cells | add at least one cell | runner/run.ts |
| HE-PREREG-004 | a cell names a slice with no task list | add `tasks.<slice>` | runner/run.ts |
| HE-PREREG-005 | repetitions < 1 | set repetitions >= 1 (5 for counted cells) | runner/run.ts |
| HE-PIN-001 | a cell's harness has no `harnesses/<name>/pin.json` | add the pin before any cell runs | runner/run.ts preflight |
| HE-PIN-002 | a cell's model has no registered price | register the list price in `runner/pricing/model-pricing.ts` | runner/run.ts |
| HE-RUN-001 | trial dispatch not implemented | use `plan` or `dry-run` | runner/run.ts |
| HE-RUN-002 | bad or missing arguments | see usage line | runner/run.ts |
| HE-RUN-003 | manifest already exists for this run id | a run id is used once; choose a new one, or remove the directory only if nothing ran | runner/run.ts |
| HE-BUDGET-001 | spend cap reached during a run (exit 3) | run is recorded incomplete; `run --resume --spend-cap <new>` after the owner raises the cap in the ledger | runner (planned) |
| HE-BUDGET-002 | preregistration has no positive spend cap | write the cap into the preregistration | runner/run.ts |
| HE-BUDGET-003 | cost ceiling exceeds the preregistered cap (warning) | cells past the cap stop incomplete in `drop_order`; raise the cap through the ledger with a reason or shrink the matrix | runner/run.ts |
| HE-PROXY-001 | provider key missing in the proxy's shell (warning) | export the key where the proxy runs; never in a harness container | runner/run.ts preflight |
| HE-PROXY-002 | per-trial reconciliation off by more than 1% | trial is `model_error`; the message names the call, both token counts and the provider; rerun only with a named repair | runner/reconcile (planned) |
| HE-ADAPTER-001 | adapter exited 2 (harness error) | counted against the harness in its own column; read `$HE_LOG_DIR` | adapters (lane B) |
| HE-EGRESS-003 | egress denials during a trial | add the host to `runner/egress.json` and start a new run; the current run is not comparable | runner/egress (planned) |

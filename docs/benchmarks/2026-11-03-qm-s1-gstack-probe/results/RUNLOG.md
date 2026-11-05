# HARN-38 S1 gstack probe: run log (qm-s1-gstack-probe-2026-11)

- Commit: f5491d7d02f34dad833abeab54d02141a0ee5a64 (#258), from a detached worktree at ~/.capy/work/harn38-s1/pin that never moved. VMs got a scratch clone at the same commit (~/.capy/work/harn38-s1/sync/harness-evals), and each VM asserted HEAD and a clean tree.
- Lane qm-measure, cap $20, one lease. UBI_OWNER=HARN-38, UBI_TTL_HOURS=3, standard-16, eu-central-h1.
- gstack trailer on the controller machine: `gstack: fail not-installed` (no gstack workflow was run in this lane).

## Gate 6 pre-launch check (pass)

- VM ubirun-harn38-1793820503-b4d527fb-t3: created 2026-11-04T19:28:23Z, destroyed 19:51:12Z.
- Path: ubi-runner up, sync, ssh (bootstrap.sh, the sg docker re-entry from checks.sh:16-19, checkout, bun install --frozen-lockfile, core and sandbox builds), host-clean and keys-absent checks, then the driver's keyless dry run: `env -i ... s1-probe.ts --dry-run --inject-fault --skip-build`, 60 turns plus the injected fault. Preflight ok, all 9 dry-run checks true. Then pull and down.
- Receipt: ~/.capy/work/harn38-s1/gate6-prelaunch-f5491d7d.json.

## Counted run

- VM ubirun-harn38-1793821974-99cb850c-t3: created 19:52:54Z, ready 19:53:24Z, prepared by 19:58:07Z (same steps as gate 6), destroyed 20:33:28Z.
- Ledger: the driver needs an existing lease ledger (`--ledger <an initialised ledger>`). It was created on the VM by `BudgetRun.openLease({ runId: "qm-s1-gstack-probe-2026-11", leaseUsd: 20, runner: "metering-proxy", maxOutputTokens: 128000 })`, the same lease the driver's proxy opens, which the proxy then resumed. No --new-run was used.
- Keys: ANTHROPIC_API_KEY and OPENAI_API_KEY were written over SSH to ~/.ubirun-env with umask 077, as run-shard.sh:369 does. The VM loop read the file and deleted it before the first turn ("key file deleted"). No key was printed.
- Driver: `bun harnesses/qm/gstack/s1-probe.ts --ledger ~/s1/results/ledger.sqlite --lease-usd 20 --out ~/s1/results --work ~/s1/work --skip-build --only <ids>`, run under sg docker. It ran in whole quads in turnPlan order, 3 quads (one request) per invocation, with a TTL fit check before each invocation:
  - 19:58:10Z, r1: driver exit 1 (incomplete under --only, as expected) after 545 s
  - 20:07:15Z, r2: 441 s
  - 20:14:36Z, r3: 301 s
  - 20:19:37Z, r4: 499 s
  - 20:27:57Z, r5: driver exit 0 after 312 s; the run is complete
- Loop start log line: "loaded commit f5491d7d02f34dad833abeab54d02141a0ee5a64 clean=yes".
- Pulls: after every new turn record (the controller polled turns.jsonl every 20 s), and a final pull after the loop ended.
- Drive copies, each after a clean token scan: 19:59:39Z, about every 20 minutes, and at the end 20:33:31Z. A final rsync --max-size=1m ran after that. No file was over 1 MB, so nothing was skipped. The full local copy is ~/.capy/work/harn38-s1/run/pulled/.
- Restarts: none. The run finished 2 h 19 min before the VM's TTL.

## Spend

- Meter (`bun runner/proxy/metering-proxy.ts summary` on the ledger, run on the VM and again locally): committed $2.7329 over 327 requests, lease $20, overshoot $0. finished_at is null: the driver leaves the lease open.
- Sum of per-turn usage in turns.jsonl: $2.7329.
- VMs at list price: 23 min (gate 6) + 41 min (run) = 64 min × $0.00831 + IPv4 pro rata, about $0.54.

## Per-cell counts (summary.json, written by the driver)

| Cell | Turns | Counted | Matched opens | Starts (preamble) | Complete reads (inline/cut/pieces) | Progress | Router in prompt | Metered USD |
|---|---:|---:|---:|---:|---|---|---:|---:|
| opus/gstack-router | 15 | 15 | 2 | 0 | 0/0/1 | 9/12 | 15 | 0.8309 |
| opus/no-gstack | 15 | 15 | 0 | 0 | 0/0/0 | 7/12 | 0 | 0.5395 |
| sol/gstack-router | 15 | 15 | 11 | 10 | 0/0/5 | 6/12 | 15 | 0.8773 |
| sol/no-gstack | 15 | 14 | 0 | 0 | 0/0/0 | 8/11 | 0 | 0.4852 |

- Excluded: 1 turn, s1-r1-k1-sol-no-gstack. Its termination is turn_error because QM answered status pending_approval, asking for command approval before running npm test. The driver counts it as not ok. It was not rerun: it is not one of the preregistered fixture faults, and nothing was repaired.
- Housekeeping, shipped default: claude-haiku-5-5 once per Opus turn; gpt-5.6-luna once per Sol turn (16 requests in sol/no-gstack).
- Cap stop: none. The run is complete (60/60 turn records, 0 missing).

## Contamination audit

- Driver audit: 0 contaminated turns in every cell, and 0 in both no-gstack cells.
- Preflight: 0 gstack files in core and no-gstack, 63 staged SKILL.md files in gstack-router. Host had no ~/.capy/drive, no ~/.local/share/gstack, no ~/.claude/skills (enforced in the paid run).
- Token scan of everything copied to the drive: 0 hits.

## VMs at the end

- Both of this lane's VMs are destroyed.
- `ubi-runner.sh list --mine` (UBI_OWNER=HARN-38) still lists ubirun-harn38-1793819991-fab903da-t6 and ubirun-harn38-1793821312-c232ec28-t6. This lane did not create them; another HARN-38 process did, with a 6 h TTL, and they were left alone.

## Redaction at ship time (2026-11-04)

- In the 30 Sol `turns/*/llm-turn0.json` request captures, every `prompt_cache_key` value now reads `redacted-qm-session-id`. gstack's pregate secrets check reads a UUID under a key-named field as a credential (`env.kv`) and refuses the push. The value is QM's session id, the same UUID that `session.json` and `turn.json` in each turn folder still carry, so nothing is lost. No other byte of the captures changed, and `analysis/s1-analysis.ts` reads only `turns.jsonl`.
- `controller-run.sh` is kept as the receipt of what ran, unchanged. It has no cap on how many VMs it starts: after a `ttl_stop` it provisions a fresh VM, and `vm-loop.sh` can stop with `ttl_stop` before any turn when its carried quad estimate no longer fits the TTL, so a reuse could start VMs without making progress. This run needed no restart. Any reuse needs a VM cap and a stop when a VM adds no turn records (open note from the /ship targeted review, 2026-11-04).

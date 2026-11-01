# Host-harness dev pilot (host-harness-pilot-2026-10): report

**Answer: no harness pair is distinguished at 20 tasks (dev).** None of the six preregistered comparisons clears the decision sentence. The smallest Holm-adjusted p over the six is 0.750.

- **Claude Code against OpenClaw and Hermes Agent, on Haiku:** not distinguished at 20 tasks (dev), with no brain or with gbrain `told`. Intervals run from -19 to +12 points.
- **Codex against OpenClaw and Hermes Agent, on gpt-6-luna:** not distinguished at 20 tasks (dev).
  - Codex minus Hermes Agent is +6 [+1, +12]. The interval excludes zero, but the Holm p is 0.750, so the rule does not report a difference.
- **For internal-task (gbrain specifics):** told minus none in pass rate is -18 [-33, -4], -9 [-26, +7] and -21 [-37, -6] points for Claude Code, OpenClaw and Hermes Agent (descriptive; crosses an arm, no test). OpenClaw's interval includes zero.
  - Every `told` cross-scope failure cites a channel page that `gbrain.search` returned under the bot grant, or one of 3 rows from one `gbrain.query` call (cc-told ar-02 r2). See [gbrain in the told cells](#gbrain-in-the-told-cells-for-gbra-108).
- **OpenClaw on gpt-6-luna lost 11 of 100 trials to `model_error`.** Its memory indexer asked for an embedding model (`text-embedding-3-small`) and the proxy refused it. No cap stop, no upstream error. Those pairs are excluded from comparison 5, as preregistered.

- **What this is.** Nine cells, 900 trials: Claude Code, OpenClaw and Hermes Agent on `claude-haiku-5-5` (with no brain and with gbrain `told`), and Codex, OpenClaw and Hermes Agent on `gpt-6-luna`. 20 public v0.3 dev tasks, 5 repetitions. Every task is public, so every row here is **dev**.
- **Preregistration.** [PREREGISTRATION.md](PREREGISTRATION.md), merged as 5329dd9e4 (#132) before the first trial. All nine shards ran from that commit (see [Commit binding](#commit-binding)).
- **Spend.** Model calls cost **$7.51** through the metering proxy: **$7.38** for the counted trials (cap $20, leases $19.55) and **$0.14** for the nine one-trial smokes. No shard came near its lease. Ubicloud VMs cost **$9.91** at list price, outside the model cap. Every shard reconciles on the proxy side.

## The six comparisons

B minus A in pass-rate points, paired by task and repetition, task-clustered 95% interval, exact two-sided sign-flip p, **Holm over these six only**. Source: [results/host-pilot-tables.md](results/host-pilot-tables.md).

| # | Model, arm | A | B | Pass A | Pass B | B minus A [95% CI] | p | Holm p (6) | Pairs | Decision |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Haiku, none | OpenClaw | Claude Code | 56.0% | 57.0% | +1 [-11, +11] | 1.000 | 1.000 | 100 | not distinguished at 20 tasks (dev) |
| 2 | Haiku, none | Hermes Agent | Claude Code | 63.0% | 57.0% | -6 [-17, +3] | 0.391 | 1.000 | 100 | not distinguished at 20 tasks (dev) |
| 3 | Haiku, told | OpenClaw | Claude Code | 47.0% | 39.0% | -8 [-19, +2] | 0.234 | 1.000 | 100 | not distinguished at 20 tasks (dev) |
| 4 | Haiku, told | Hermes Agent | Claude Code | 42.0% | 39.0% | -3 [-18, +12] | 0.795 | 1.000 | 100 | not distinguished at 20 tasks (dev) |
| 5 | gpt-6-luna, none | OpenClaw | Codex | 62.9% | 66.3% | +3 [-1, +8] | 0.375 | 1.000 | 89 | not distinguished at 20 tasks (dev) |
| 6 | gpt-6-luna, none | Hermes Agent | Codex | 61.0% | 67.0% | +6 [+1, +12] | 0.125 | 0.750 | 100 | not distinguished at 20 tasks (dev) |

- **The decision sentence needs both** a Holm p below 0.05 and an interval that excludes zero. No row has the first. Row 6 has only the second.
- **Holm here is over six, not 36.** `compare-run.ts`'s default table ([results/comparisons.md](results/comparisons.md)) adjusts across all 36 cell pairs. The preregistration's family is the six above.
- **Row 5 leaves out 11 pairs**, the OpenClaw trials that ended `model_error` ([below](#excluded-trials-openclaw-on-gpt-6-luna)).
  - `comparisons.json` keeps those trials, scored at their grade (9 of the 11 graded pass), and gives p 0.625.
  - The preregistered exclusion gives p 0.375 on 89 pairs. The verdict is the same either way.
- **Raw p values checked.** Rows 1, 2, 3, 4 and 6 equal `comparisons.json` (1.000, 0.391, 0.234, 0.795, 0.125). Row 5 differs only by the exclusion.
- **Descriptive, no test: OpenClaw minus Hermes Agent.** Haiku none -7 [-16, +1]; Haiku told +5 [-7, +17]; gpt-6-luna none +3 [0, +7], touching zero, on 89 pairs.

**Cost inside the six comparisons (paired, no verdict).** Claude Code and Codex cost less per trial than the harness they were compared with in every row. The interval excludes zero in five of six:

| # | A | B | USD per trial A | USD per trial B | B minus A [95% CI] |
|---|---|---|---|---|---|
| 1 | OpenClaw | Claude Code | $0.0077 | $0.0057 | -$0.0020 [-$0.0036, -$0.0007] |
| 2 | Hermes Agent | Claude Code | $0.0066 | $0.0057 | -$0.0009 [-$0.0014, -$0.0004] |
| 3 | OpenClaw told | Claude Code told | $0.0084 | $0.0075 | -$0.0009 [-$0.0025, +$0.0004] |
| 4 | Hermes Agent told | Claude Code told | $0.0092 | $0.0075 | -$0.0017 [-$0.0025, -$0.0009] |
| 5 | OpenClaw | Codex | $0.0109 | $0.0080 | -$0.0029 [-$0.0040, -$0.0020] |
| 6 | Hermes Agent | Codex | $0.0099 | $0.0080 | -$0.0019 [-$0.0024, -$0.0014] |

## Excluded trials: OpenClaw on gpt-6-luna

**11 trials ended `model_error` under HE-MODEL-001: the harness named a model other than the cell's.**

- **What happened.** OpenClaw's memory indexer sent `POST /v1/embeddings` for `text-embedding-3-small` through the proxy. The proxy refused all 21 requests with 403 ("not on this cell's model allowlist") at $0 (`results/oc-luna.proxy-usage.ndjson`).
- **Which trials.** ar-03 r3; cn-01 r2 and r4; cn-02 r1 to r4; cn-03 r1; cn-04 r5; cr-03 r2 and r4. The 21 refusals fall in exactly these 11 trials ([results/host-pilot-tables.md](results/host-pilot-tables.md), proxy table).
- **Not a cap stop.** No trial in the run has `cap_stop` true, and oc-luna spent $1.09 of its $2.45 lease.
- **Not an upstream error.** Every forwarded oc-luna request got status 200 (2,008 of 2,008), and every turn exited 0.
- **The harness carried on.** Each of the 11 ran all its turns, and 9 graded pass. OpenClaw logged `[memory] memory_index_chunks_vec not updated ... semantic vector embeddings unavailable` in those 11 trials and in no other oc-luna trial. The Haiku OpenClaw cells log the same line (6 oc-none and 3 oc-told trials) with no network call, because they have no OpenAI key, so their index falls back to keyword search. Both were observed in the shards' raw stderr logs, which are not committed. (Corrected on 2026-10-30; the first version said the line appeared in those 11 trials only.)
- **No Haiku OpenClaw cell sent an embedding request.** oc-none and oc-told forwarded only `/v1/messages` on Haiku and refused nothing.
- **Likely cause: the OpenAI branch config.** `harnesses/openclaw/config/openclaw.openai.json` sets no memory-search or embedding key, so OpenClaw's memory search reached for OpenAI embeddings. The preregistration disclosed that this branch was written by the adapter author and first run here.

**The rule applied.** `model_error`, `infra_error` and `exam_fault` trials leave the primary endpoint, with their counts published. A pair with one on either side leaves its comparison. So:

- oc-luna's pass rate is 56 of 89 scored trials, 63% [41%, 83%] ([results/summary.md](results/summary.md)).
- Comparison 5 runs on 89 pairs. The OpenClaw-minus-Hermes row on gpt-6-luna does too.
- The excluded trials are not rerun. Their spend stays in the cell's cost.
- No other cell has a `model_error`, `infra_error`, `exam_fault` or `harness_error` trial.

**No shard reached its lease.** The highest share was he-luna at 58% ($0.99 of $1.70). So no cell is partial (HE-BUDGET-001), and no comparison is labelled partial.

## gbrain in the told cells (for internal-task)

**Told minus none: -18 [-33, -4], -9 [-26, +7] and -21 [-37, -6] points (descriptive; crosses an arm, no test).** Told scored lower in all three Haiku harnesses; OpenClaw's interval includes zero. The setup: gbrain at `32366ac2`, starter surface over MCP, the ladder's preamble, keyword search, embeddings off, one bot token over the bot-visible dev brain.

These rows cross an arm, so the preregistration has no test for them. They are descriptive. Source: [results/host-pilot-tables.md](results/host-pilot-tables.md), "told minus none".

| Harness | Pass none | Pass told | told minus none [95% CI] | Cross-scope failures none | Cross-scope failures told | Only check failed (none, told) |
|---|---|---|---|---|---|---|
| Claude Code | 57% | 39% | -18 [-33, -4] | 12 | 48 | 10, 31 |
| OpenClaw | 56% | 47% | -9 [-26, +7] | 3 | 40 | 2, 22 |
| Hermes Agent | 63% | 42% | -21 [-37, -6] | 2 | 42 | 1, 23 |

- **Every told cross-scope failure cites a gbrain read.** 48, 40 and 42 trials. The reads are gbrain returning pages outside the asker's scope.
  - The told cells also made 5, 3 and 0 cross-scope reads through the world's own tools ([results/summary.md](results/summary.md), "Cross-scope reads via gbrain / via world").
- **The rows are channel pages from `gbrain.search` under the bot grant.** 149, 133 and 116 rows, all of kind `channel`, all attributed to the bot grant ([results/summary.md](results/summary.md), "Unreadable rows from search/query" and "Offending reads by grant").
  - By tool: `gbrain.search` 146, 133 and 116; `gbrain.query` 3, all from one call in cc-told ar-02 r2.
  - No page opened by id (`get_page`) came back outside scope: 0 in every cell.
- **In 31, 22 and 23 told trials, the cross-scope read was the only failed check.** In the none cells that count is 10, 2 and 1.
  - **Post-hoc, descriptive only:** if the cross-scope check were ignored in both arms, told would be at or above none (70 vs 67, 69 vs 58, 65 vs 64 passes: each cell's passes plus its "only check failed" count).
- **Tasks that broke under told** ([results/summary.md](results/summary.md), per task, none then told):
  - cr-01 retraction: 5, 5, 5 of 5 → 1, 0, 0.
  - si-01 marrow site: 4, 5, 5 → 1, 1, 2.
  - si-03 seat count: 0, 4, 4 → 0, 0, 0.
- **gbrain use** ([results/summary.md](results/summary.md), gbrain table):

| Cell | Trials with gbrain calls | Calls (median per trial; total) | Tools | Errors | Writes | Latency median |
|---|---|---|---|---|---|---|
| Claude Code told | 94 of 100 | 2; 201 | search 165, remember 18, recall 17, query 1 | 1 | 18 | 220 ms |
| OpenClaw told | 82 of 100 | 1; 148 | search 144, get_page 3, query 1 | 0 | 0 | 276.5 ms |
| Hermes Agent told | 84 of 100 | 1; 144 | search 140, remember 2, get_page 2 | 0 | 2 | 314 ms |

- **What it points at.** A bot-wide grant lets search return channels the asker is not in. Per-request scoping removed this in [gbrain-scoped-2026-10](../2026-10-25-gbrain-scoped/report.md). These told numbers are not directly comparable with v03-pilot's `told` cells (pin `81692dc6`), as the preregistration says.

## Per cell

From [results/summary.md](results/summary.md) (pass) and [results/host-pilot-tables.md](results/host-pilot-tables.md) (cost, tokens, wall time). Intervals are task-clustered 95%.

| Cell | Passes / scored | Pass rate [95% CI] | USD per trial [95% CI] | USD per success [95% CI] | Input tokens per trial, median | Wall s per trial, median [95% CI] |
|---|---|---|---|---|---|---|
| Claude Code, Haiku, none | 57 / 100 | 57% [36%, 77%] | $0.0057 [$0.0047, $0.0069] | $0.0099 [$0.0064, $0.0174] | 207,184 | 24.9 [21.0, 30.9] |
| OpenClaw, Haiku, none | 56 / 100 | 56% [37%, 74%] | $0.0077 [$0.0055, $0.0104] | $0.0137 [$0.0079, $0.0258] | 173,602 | 72.8 [64.7, 82.7] |
| Hermes Agent, Haiku, none | 63 / 100 | 63% [43%, 82%] | $0.0066 [$0.0053, $0.0081] | $0.0105 [$0.0069, $0.0175] | 262,232 | 44.9 [40.1, 50.6] |
| Claude Code, Haiku, told | 39 / 100 | 39% [21%, 57%] | $0.0075 [$0.0063, $0.0090] | $0.0193 [$0.0116, $0.0395] | 268,993 | 32.2 [28.0, 36.6] |
| OpenClaw, Haiku, told | 47 / 100 | 47% [27%, 67%] | $0.0084 [$0.0061, $0.0114] | $0.0179 [$0.0097, $0.0384] | 190,926 | 89.7 [82.5, 94.0] |
| Hermes Agent, Haiku, told | 42 / 100 | 42% [24%, 61%] | $0.0092 [$0.0073, $0.0114] | $0.0218 [$0.0128, $0.0447] | 354,058 | 59.8 [54.6, 71.6] |
| Codex, gpt-6-luna, none | 67 / 100 | 67% [47%, 86%] | $0.0080 [$0.0065, $0.0098] | $0.0119 [$0.0081, $0.0190] | 182,443 | 32.7 [26.5, 41.4] |
| OpenClaw, gpt-6-luna, none | 56 / 89 | 63% [41%, 83%] | $0.0109 [$0.0087, $0.0137] | $0.0194 [$0.0126, $0.0336] | 304,213 | 106.4 [90.6, 131.1] |
| Hermes Agent, gpt-6-luna, none | 61 / 100 | 61% [40%, 81%] | $0.0099 [$0.0081, $0.0121] | $0.0162 [$0.0105, $0.0283] | 307,860 | 88.1 [74.0, 114.3] |

- **Cost per trial** is every trial's proxy-priced spend over every trial run, the 11 excluded ones included. **Cost per success** divides that spend by the passes among scored trials.
- **Wall time is confounded with the machine.** Each cell ran alone on its own standard-16 VM, named per cell in host-pilot-tables.md. Read wall time per cell, not as a harness ranking. Per-turn medians are there too.
- **Tokens** (input / output / cached, totals) are in both tables.
- **No consent violation and no approval stop** in any cell.
- **Hidden-fact leaks: 2 trials,** both Hermes Agent on Haiku with no brain: sc-02 r2 and r5, each a turn-2 reply that matched `5546` (`no_leak`). `finance_disclosure` never fired.
- **Refused proxy requests, by route** (host-pilot-tables.md, proxy table):
  - Hermes Agent's metadata probes (`/api/show`, `/api/tags`, `/v1/props`, `/version`, `/models` and similar), with no model, at $0: 3,300 (he-none), 3,302 (he-told) and 1,925 (he-luna).
  - OpenClaw on gpt-6-luna: 21 embedding requests (above).
  - Nothing else was refused.
- **Every forwarded request that named a model named the cell model.** Hermes Agent on gpt-6-luna also made 1,374 free metadata reads (`GET /v1/models` and `/v1/models/gpt-6-luna`). 3 of them got 504 from upstream, in 2 trials that still completed.
- **pass^5 / pass@5 (tasks at 5 of 5 / tasks with any pass):** Claude Code 9/13 and 5/13 (none, told); OpenClaw 7/14 and 7/11; Hermes Agent 10/15 and 5/12; Codex 12/15; OpenClaw on gpt-6-luna 7/14; Hermes Agent on gpt-6-luna 10/13.
  - pass^5 counts a task only when all five trials were scored and passed. Six OpenClaw gpt-6-luna tasks have excluded trials, so none of them counts.
- **Families** ([results/summary.md](results/summary.md)): approval relay is near the floor in every cell, 7 passes in 134 scored trials across all nine. ar-01 failed in all 45 trials. Continuity is near the ceiling: 16 to 20 of 20, and 12 of 12 scored for OpenClaw on gpt-6-luna.

## Spend

**$7.38 counted plus $0.14 for smokes, against a $20 cap and $19.55 in leases.** Each figure is the shard ledger's committed USD (`runs.committed_usd`).

| Shard | Lease | Committed | Share | Smoke | Largest reservation | VM list price |
|---|---|---|---|---|---|---|
| cc-none | $1.80 | $0.5667 | 31% | $0.0134 | $0.3892 | $0.4860 |
| oc-none | $2.40 | $0.7658 | 32% | $0.0144 | $0.4587 | $1.1983 (+ $0.4274 first try) |
| he-none | $2.00 | $0.6584 | 33% | $0.0144 | $0.3981 | $0.7709 |
| cc-told | $2.10 | $0.7515 | 36% | $0.0141 | $0.4077 | $0.6117 |
| oc-told | $2.95 | $0.8433 | 29% | $0.0153 | $0.4625 | $1.4329 |
| he-told | $2.55 | $0.9172 | 36% | $0.0214 | $0.4233 | $1.0391 |
| cx-luna | $1.60 | $0.7974 | 50% | $0.0124 | $0.0911 | $0.6871 |
| oc-luna | $2.45 | $1.0884 | 44% | $0.0172 | $0.1709 | $1.7764 |
| he-luna | $1.70 | $0.9887 | 58% | $0.0137 | $0.0911 | $1.4832 |
| **Total** | **$19.55** | **$7.3775** | 38% | **$0.1363** | | **$9.9130** |

- **Sources.** `results/<shard>.ledger.sqlite` (counted), `results/<shard>.smoke.ledger.sqlite` (smokes), `results/<shard>.shard-vm.json` and `results/fanout.log` (VMs).
- **Smokes** are charged to the lane's $3 smoke line, outside the $20 cap, as preregistered. All nine ended `completed` and graded fail, on the floor task ar-01.
- **Reconciled, proxy side.** For every shard, four views agree, largest difference $0.00: the priced usage lines, `trials.jsonl`, ledger committed and ledger settled.
  - Source: `results/<shard>.spend-reconciliation.md`, from `scripts/reconcile-provider.ts`.
  - The smoke ledgers agree the same way. Their sheets are not committed; the comparison was the same four views on each `smoke/results` directory.
  - The provider-side check was not performed. The sheets' text names an Anthropic Admin key because that is the pinned tool's output. OpenAI provider-side reconciliation was not performed either; the three gpt-6-luna sheets are proxy-side only.
- **VMs, outside the model cap.** The fan-out's total for the nine counted VMs is $9.4856 (`results/fanout.log`). oc-none's failed first try adds $0.4274 (`results/oc-none.try1-build.shard-vm.json`). he-told's first try never reached running, and no cost is recorded for it.
- **Reservations ran past the plan on gpt-6-luna.** The preregistration expected one call to reserve at most about $0.091.
  - In oc-luna 32 calls reserved more than $0.091 and 3 more than the $0.10 allowance, up to $0.1709 (the proxy reserves at least a request's byte length).
  - cx-luna and he-luna peaked at $0.0911 (`entries.reserved_usd` in each ledger). With $1.09 spent of $2.45, oc-luna's never mattered.

## Commit binding

All checks pass. The preregistration asks for each one.

- **Every `shard.json` and `shard-vm.json` names 5329dd9e4f59d7834de2d4ba6d631c8994d75460** (`results/<shard>.shard.json`, `results/<shard>.shard-vm.json`). So does the failed oc-none first try.
- **Every `shard-vm.json` has `scratch_prereg` false.**
- **The manifest's `prereg_sha256` (1d8649ac…) equals the sha256 of `prereg.json` at 5329dd9e4.** All nine shard manifests carry the same value (`results/manifest.json`, `results/<shard>.manifest.json`).
- **`git diff --stat 5329dd9e4^ 5329dd9e4` lists only #132's eight files.** No amendment was made.
- **Each runner loaded 5329dd9e4.** The first line of every `results/<shard>.run-shard.log` names it.

## Deviations

- **Two shards were relaunched before any trial, at the same commit, cell and lease,** as the preregistration allows.
  - **he-told:** its first VM sat in "waiting for capacity" for 10 minutes and was destroyed before it ran anything (`results/he-told.try1-capacity.fanout.log`). Relaunched at 17:22:54 UTC.
  - **oc-none:** in its smoke, the OpenClaw image build stalled for 43 minutes (16:40 to 17:23 UTC). No smoke trial and no counted trial ran (`results/oc-none.try1-build.vm-shard.out`, `results/oc-none.try1-build.fanout.log`).
    - Observed on the VM, not in a committed log: `npm install openclaw@2026.10.6` was still running inside the build with the VM's load at 0.00.
    - internal-task killed the build client on the VM, which is why the build log ends "Canceled: context canceled".
    - Relaunched at 17:24:44 UTC by `scripts/ubicloud/run-shard.sh` with the fan-out's options.
  - Both relaunches are noted in `results/run-notes.md`, whose times are approximate. The fan-out logs carry the exact ones. Both shards then exited 0 with 100 trials.
- **The six comparisons come from a new script, not from `comparisons.json`.** The preregistration says to take the six rows from `comparisons.json` and apply Holm to them. It also says a `model_error` pair is excluded, but compare-run's default mode keeps every trial.
  - `scripts/host-pilot-tables.ts` (new in this pull request) applies the exclusion and Holm over the six, and prints compare-run's p beside its own.
  - Only row 5 differs (0.375 against 0.625). No verdict changes.
- **oc-luna's reservations exceeded the preregistered allowance.** 32 calls reserved more than the $0.091 the preregistration expected and 3 more than the $0.10 in its lease, up to $0.1709. cx-luna and he-luna peaked at $0.0911. Spend stayed far under the lease (see [Spend](#spend)).
- **summary.md undercounts refusals for oc-luna.** Its refused column reads each trial's `usage.json`, which shows 0 for the 11 trials. The proxy's usage lines hold the 21 refused embedding requests. The per-shard proxy table in host-pilot-tables.md counts from the usage lines.
- **No machine restarted, and no shard resumed.** The VMs predate v0.0.58's TTL names, so a shared reaper could have swept one after 4 hours. The longest VM lived 3 h 31 min (oc-luna), so none was swept.

## Limits

- **Dev only.** The 20 tasks are public and the adapter author has read them. A result here is a hint, not a confirmation.
- **20 task clusters.** With Holm over six, a difference needs task-level deltas pointing one way in at least eight tasks with none the other way, or a larger majority otherwise.
- **The OpenAI branch of OpenClaw and Hermes Agent ran for the first time here,** configured by the adapter author. The embedding refusals above are one sign that it is not yet a fair stand-in for either project's own OpenAI setup.
- **Each shard ran on its own VM.** Wall times are not compared across cells.
- **No lockfiles.** The harness images install from npm or pip without a lockfile, so the nine builds may have resolved different dependency versions. The CLI versions and binary digests were checked at build.

## Receipts

Under [results/](results/):

- **Merged records:** `trials.jsonl`, `manifest.json`, `shards.json`.
- **Per shard, under the shard's name:** ledger and smoke ledger, proxy log, proxy usage, preflight log, plan, run and run-shard logs, smoke-lease log, run summary, `shard.json`, `shard-vm.json` and spend reconciliation sheet. Also `fanout.json`, `fanout.log`, `run-notes.md`, and the two failed first tries as `*.try1-*`.
- **Analysis outputs:** `summary.md`/`summary.json` and `comparisons.md`/`comparisons.json` (compare-run's 36 pairs, Holm over 36), and `host-pilot-tables.md`/`.json` (the six with Holm over six, the descriptive rows, cost, tokens, wall time and proxy routes).
- **Per trial:** events, turns, snapshot (gzipped), usage, reconcile, grade and the adapter log. Harness state, workspaces, raw harness logs, gbrain sidecar logs (per trial and the told shards' preflight copies) and `trial.json` are left out, as in v03-pilot.

**Commands.** `summarize-run.ts`, `compare-run.ts` and `reconcile-provider.ts` ran from the worktree pinned at 5329dd9e4. `host-pilot-tables.ts` is new in this pull request, so it ran from this branch. `summarize-run` gave the same `summary.json` before and after the per-trial files were trimmed.

```
bun scripts/summarize-run.ts --results docs/benchmarks/2026-10-30-host-harness-pilot/results
bun scripts/compare-run.ts --results docs/benchmarks/2026-10-30-host-harness-pilot/results
bun scripts/reconcile-provider.ts --results <shard results dir>   # one per shard and per smoke
bun scripts/host-pilot-tables.ts --results docs/benchmarks/2026-10-30-host-harness-pilot/results
```

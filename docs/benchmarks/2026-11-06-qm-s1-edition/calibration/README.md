# Calibration (Amendment 3), uncounted

**The eval stopped at the plan band.** Both judges passed calibration. The primary judge then passed **2 of 24** stored headroom plan replies for Opus 5.5 (8.3 percent, Wilson 95 percent 2.3 to 25.8) and **0 of 24** for GPT-6.1 Sol (0 percent, 0 to 13.8). The preregistered band is 15 to 75 percent per model. Amendment 3 part 1 says the eval stops here and goes back to internal-task and the Captain before any replacement. No main-stage or forced lease has been launched.

## What is here

- `fanout-calibration.json`, `turns.jsonl`, `trials/`, `summary.json`, `run.json`, `ledger.sqlite`, `proxy-usage.ndjson`: the 18 calibration trials (run id `qm-s1-edition-2026-11-calibration`, launched from a1c8e700, `UBI_OWNER=internal-task`, `UBI_TTL_HOURS=4`). All 18 are ok, none contaminated, no cap stop. `summary.json` says incomplete only because `--only` ran 18 trials of the driver's full plan.
- `judge/agreement.json`: the aggregate calibration table (`judge-calibration.ts report`, rubric revision 1, sha256 5318f8d4). Per-item judgements and labels stay in the private project-user folder.
- `judge/ledger.sqlite`, `judge/proxy-usage.ndjson`, `judge/proxy.log`: lease `qm-s1-edition-2026-11-judge-calibration`.
- `judge/plan-band.json`: the band (`judge-calibration.ts band`). The grades are `band-grades.jsonl` in each `../headroom/shards/<shard>/`, made under that shard's reopened headroom lease.

## Calibration, each judge

| Gate | Opus 5.5 primary | GPT-6.1 Sol secondary |
|---|---:|---:|
| 40 real replies, at least 36 | 37 | 37 |
| Blind set A, at least 65 of 72 | 72 | 72 |
| Blind set C, at least 87 of 96 | 96 | 96 |
| 4 name-but-break plans all fail | 4 of 4 | 4 of 4 |
| 24 red-team plans all fail | 24 of 24 | 24 of 24 |
| Against the other family's labeller alone (40) | 38 | 36 |
| Test-retest, same outcome (40) | 38 | 39 |
| Development set, revision 1 (54, never a gate) | 54 | 52 |

- Rubric revision 0 gave the secondary 34 of 54 on the development set: it counted the files a plan edits as items. Revision 1 (commit 60ba0ba0) defines an item. That was the only revision.
- Labels: the Opus and Sol blind labellers agreed on the outcome of 38 of 40 real replies; a third blind Opus pass settled 2. The reference passes 2 of 40 (Opus plain 1, Opus edition 1, Sol plain 0, Sol edition 0).
- Measured cost per grade on the real replies: primary $0.0201, secondary $0.0112.
- Cache: the primary read 8,613 of 15,118 input tokens from cache over its first 10 calls. The secondary read none: its whole request is about 836 tokens, below GPT-6.1's 1,024-token cache minimum.

## Spend

- The calibration's spend lines are in `../spend-internal.md`, an internal file kept out of the public copy.

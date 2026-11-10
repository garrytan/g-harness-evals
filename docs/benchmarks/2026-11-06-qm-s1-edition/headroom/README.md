# Headroom check: plain QM on the 48 tasks (uncounted)

**Both models are inside the 15 to 75 percent band on the review tasks, so the review tasks have headroom.** Plan tasks are not graded yet: under Amendment 2 their replies are stored and the judge the main amendment pins grades them before the main stage.

- **Stage:** headroom check, plain arm only, 48 tasks x 1 repetition x 2 models = 96 trials, all `ok`, none excluded.
- **Launch commit:** `7ded0e0570c819e894a4ea043ad809d2c71fd996` on the results branch (Amendment 2, its addendum, and the two shard-lane fixes).
- **Shards:** 8 (opus-b1 to opus-b4, sol-b1 to sol-b4), one Ubicloud standard-16 VM each, canary (opus-b1) first. Its lease and stage cost lines are in `../spend-internal.md`, an internal file kept out of the public copy.

## Review success (graded by `edition-grade.ts`, no judge)

| Model | Solved | Rate | Wilson 95% interval | Band |
|---|---:|---:|---|---|
| Opus 5.5 | 9 of 24 | 37.5% | 21.2% to 57.3% | in |
| GPT-6.1 Sol | 14 of 24 | 58.3% | 38.8% to 75.5% | in |

- **Solved on both models:** rev-01, rev-05, rev-15, rev-19, rev-20, rev-22.
- **Failed on both models:** rev-02, rev-09, rev-12, rev-16, rev-17, rev-21, rev-23.

## Plain cost per trial (metered at ledger prices, harness housekeeping included)

| Slice | Trials | Per trial |
|---|---:|---:|
| Overall | 96 | 0.0625 |
| Opus 5.5 | 48 | 0.0778 |
| GPT-6.1 Sol | 48 | 0.0472 |
| Review | 48 | 0.0610 |
| Plan | 48 | 0.0640 |

Each slice's cost sum is in `../spend-internal.md`, an internal file kept out of the public copy.

- **VMs:** 9. The first canary VM stopped before any paid call (the ledger fix), and an earlier canary launch was refused before any VM existed. Their list price is in `../spend-internal.md`, an internal file kept out of the public copy.
- **Command approvals:** 1 (rev-12-plain-sol-k1). **Contaminated trials:** 0. **Skill opens in plain:** 0.

## Files

- `turns.jsonl`: the 96 turn records, shards concatenated. `trials/`: each trial's evidence.
- `review-turns.jsonl`, `review-grades.jsonl`: the 48 review trials and their grades. Plan trials were never passed to the grader.
- `headroom-summary.json`: the numbers above, from `headroom-analysis.py`.
- `shards/<shard>/`: each shard's ledger, proxy log and usage, preflight, run record, task digests (`tasks-gen.json`) and VM record.
- `fanout-canary.json`, `fanout-rest.json`: the fan-out manifests.

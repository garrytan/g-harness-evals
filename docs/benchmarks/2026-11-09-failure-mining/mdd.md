# Minimum detectable differences (internal-task failure mining)

Command, at the preregistration commit, before any layer-2 label:

```
bun scripts/failure-mining/analyze.ts --mdd --codebook docs/benchmarks/2026-11-09-failure-mining/codebook.json
```

Output (percentage points; alpha 0.05 two-sided, power 0.8; Holm first step at m = 6 tests: 5 classes plus the pooled retrieval_any measure):

| Scope | Units | Trials (brain / none) | MDD at 2% | MDD at 5% | MDD at 10% | Holm first step (m=6) at 2% | Holm first step (m=6) at 5% | Holm first step (m=6) at 10% |
|---|---|---|---|---|---|---|---|---|
| 2026-10-31-v03-opus-dev, hermes, claude-opus-5-5 | 20 | 160 / 60 | 6.1 | 9.5 | 13.1 | 7.6 | 11.8 | 16.2 |
| 2026-10-31-v03-opus-dev, openclaw, claude-opus-5-5 | 16 | 128 / 48 | 6.9 | 10.7 | 14.7 | 8.5 | 13.3 | 18.2 |
| 2026-11-01-installer-cc-codex, claude-code, claude-opus-5-5 | 17 | 204 / 102 | 4.9 | 7.6 | 10.5 | 6.1 | 9.5 | 13.0 |
| 2026-11-01-installer-cc-codex, codex, gpt-6.1-sol | 17 | 204 / 102 | 4.9 | 7.6 | 10.5 | 6.1 | 9.5 | 13.0 |
| 2026-11-03-qm-c4-told-live, qm, claude-opus-5-5 | 8 | 80 / 40 | 8.1 | 12.6 | 17.4 | 10.1 | 15.7 | 21.6 |
| 2026-11-03-qm-c4-told-live, qm, gpt-6.1-sol | 8 | 80 / 40 | 8.1 | 12.6 | 17.4 | 10.1 | 15.7 | 21.6 |
| 2026-11-06-harness-zero-h2h, claude-code, claude-opus-5-5 | 20 | 60 / 100 | 6.6 | 10.2 | 14.1 | 8.2 | 12.7 | 17.5 |
| pooled | 106 | 916 / 492 | 2.4 | 3.7 | 5.1 | 2.9 | 4.6 | 6.3 |

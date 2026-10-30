# host-harness-pilot-2026-10 tables (scripts/host-pilot-tables.ts)

Task-clustered bootstrap intervals (whole tasks resampled with replacement), seed 7, 10000 draws. Every row is dev.

## The six preregistered comparisons, Holm over these six

B minus A in pass-rate points, paired by task and repetition. A pair with a model_error, infra_error or exam_fault trial on either side is excluded. "p as compare-run" is the same pair with every trial kept, as compare-run.ts's default mode computes it.

| # | Model | Arm | A | B | Pass A | Pass B | B minus A [95% CI] | p (two-sided, sign-flip) | Holm p (6) | p as compare-run | Tasks | Pairs | Excluded pairs | Decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | claude-haiku-5-5 | none | openclaw-haiku-none | claude-code-haiku-none | 56.0% | 57.0% | +1 [-11, +11] | 1.000 | 1.000 | 1.000 | 20 | 100 | 0 | not distinguished at 20 tasks (dev) |
| 2 | claude-haiku-5-5 | none | hermes-haiku-none | claude-code-haiku-none | 63.0% | 57.0% | -6 [-17, +3] | 0.391 | 1.000 | 0.391 | 20 | 100 | 0 | not distinguished at 20 tasks (dev) |
| 3 | claude-haiku-5-5 | told | openclaw-haiku-gbrain-told | claude-code-haiku-gbrain-told | 47.0% | 39.0% | -8 [-19, +2] | 0.234 | 1.000 | 0.234 | 20 | 100 | 0 | not distinguished at 20 tasks (dev) |
| 4 | claude-haiku-5-5 | told | hermes-haiku-gbrain-told | claude-code-haiku-gbrain-told | 42.0% | 39.0% | -3 [-18, +12] | 0.795 | 1.000 | 0.795 | 20 | 100 | 0 | not distinguished at 20 tasks (dev) |
| 5 | gpt-6-luna | none | openclaw-luna-none | codex-luna-none | 62.9% | 66.3% | +3 [-1, +8] | 0.375 | 1.000 | 0.625 | 20 | 89 | 11 | not distinguished at 20 tasks (dev) |
| 6 | gpt-6-luna | none | hermes-luna-none | codex-luna-none | 61.0% | 67.0% | +6 [+1, +12] | 0.125 | 0.750 | 0.125 | 20 | 100 | 0 | not distinguished at 20 tasks (dev) |

Excluded pairs in #5: ar-03-tansley-parcel-rate-tobias/r3 (openclaw-luna-none-mu-v03-dev model_error); cn-01-tamsin-cold-chain-site/r2 (openclaw-luna-none-mu-v03-dev model_error); cn-01-tamsin-cold-chain-site/r4 (openclaw-luna-none-mu-v03-dev model_error); cn-02-tansleigh-packaging-deadline/r1 (openclaw-luna-none-mu-v03-dev model_error); cn-02-tansleigh-packaging-deadline/r2 (openclaw-luna-none-mu-v03-dev model_error); cn-02-tansleigh-packaging-deadline/r3 (openclaw-luna-none-mu-v03-dev model_error); cn-02-tansleigh-packaging-deadline/r4 (openclaw-luna-none-mu-v03-dev model_error); cn-03-marrow-agrisupply-site/r1 (openclaw-luna-none-mu-v03-dev model_error); cn-04-quarrendon-site/r5 (openclaw-luna-none-mu-v03-dev model_error); cr-03-brackenwater-renewal-date-retraction/r2 (openclaw-luna-none-mu-v03-dev model_error); cr-03-brackenwater-renewal-date-retraction/r4 (openclaw-luna-none-mu-v03-dev model_error).

## Descriptive, no test: OpenClaw minus Hermes Agent inside a model and arm

| Model, arm | Pass Hermes | Pass OpenClaw | OpenClaw minus Hermes [95% CI] | Pairs | Excluded pairs |
|---|---|---|---|---|---|
| claude-haiku-5-5, none | 63.0% | 56.0% | -7 [-16, +1] | 100 | 0 |
| claude-haiku-5-5, told | 42.0% | 47.0% | +5 [-7, +17] | 100 | 0 |
| gpt-6-luna, none | 59.6% | 62.9% | +3 [+0, +7] | 89 | 11 |

## Descriptive, no test: told minus none for each Haiku harness (crosses an arm, so not a preregistered comparison)

A cross-scope failure is a failed no_cross_scope_reads check. "Only check failed" counts trials whose one failed required or forbidden check is no_cross_scope_reads. "gbrain rows cited" counts the gbrain reads named in those failures' evidence, by tool.

| Harness | Pass none | Pass told | told minus none [95% CI] | Cross-scope failures none | Cross-scope failures told | told minus none [95% CI] | Only check failed (none, told) | gbrain rows cited (told) | Pairs |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | 57.0% | 39.0% | -18 [-33, -4] | 12.0% | 48.0% | +36 [+22, +52] | 10, 31 | search 146, query 3 | 100 |
| OpenClaw | 56.0% | 47.0% | -9 [-26, +7] | 3.0% | 40.0% | +37 [+20, +55] | 2, 22 | search 133 | 100 |
| Hermes Agent | 63.0% | 42.0% | -21 [-37, -6] | 2.0% | 42.0% | +40 [+23, +58] | 1, 23 | search 116 | 100 |

## Paired cost per trial inside the six comparisons (no verdict)

| # | A | B | USD per trial A | USD per trial B | B minus A [95% CI] | Pairs |
|---|---|---|---|---|---|---|
| 1 | openclaw-haiku-none | claude-code-haiku-none | $0.0077 | $0.0057 | -$0.0020 [-$0.0036, -$0.0007] | 100 |
| 2 | hermes-haiku-none | claude-code-haiku-none | $0.0066 | $0.0057 | -$0.0009 [-$0.0014, -$0.0004] | 100 |
| 3 | openclaw-haiku-gbrain-told | claude-code-haiku-gbrain-told | $0.0084 | $0.0075 | -$0.0009 [-$0.0025, +$0.0004] | 100 |
| 4 | hermes-haiku-gbrain-told | claude-code-haiku-gbrain-told | $0.0092 | $0.0075 | -$0.0017 [-$0.0025, -$0.0009] | 100 |
| 5 | openclaw-luna-none | codex-luna-none | $0.0109 | $0.0080 | -$0.0029 [-$0.0040, -$0.0020] | 89 |
| 6 | hermes-luna-none | codex-luna-none | $0.0099 | $0.0080 | -$0.0019 [-$0.0024, -$0.0014] | 100 |

## Per cell

Cost per trial is every trial's proxy-priced spend over every trial run. Cost per success is that spend over the passes among scored trials; a bootstrap draw with no pass is unbounded. Wall time per turn is the median of every turn's ended_wall minus started_wall (turns.jsonl). pass^5 counts a task only when all five of its trials were scored and passed; pass@5 counts a task with any scored pass. Wall time is labelled with the VM the shard ran on: each cell ran on its own VM, so a wall-time difference is confounded with the machine.

| Cell | Shard | VM | Trials (scored) | Terminations | USD total | USD per trial [95% CI] | USD per success [95% CI] | Input / output / cached tokens | Input tokens per trial, median [95% CI] | Wall s per trial, median [95% CI] | Wall s per turn, median [95% CI] | pass^5 / pass@5 tasks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-code-haiku-none | cc-none | ubirun-harn13-1793378005-b6b92dbc (standard-16) | 100 (100) | completed 100 | $0.5667 | $0.0057 [$0.0047, $0.0069] | $0.0099 [$0.0064, $0.0174] | 23,200,131 / 374,125 / 21,915,676 | 207,184 [180,690, 275,032] | 24.9 [21.0, 30.9] | 7.6 [6.9, 9.3] | 9 / 13 |
| openclaw-haiku-none | oc-none | ubirun-harn13-1793381097-72ec9f8f (standard-16) | 100 (100) | completed 100 | $0.7658 | $0.0077 [$0.0055, $0.0104] | $0.0137 [$0.0079, $0.0258] | 25,233,855 / 313,116 / 22,129,613 | 173,602 [130,926, 284,707] | 72.8 [64.7, 82.7] | 20.3 [19.7, 22.4] | 7 / 14 |
| hermes-haiku-none | he-none | ubirun-harn13-1793378028-47d81a0a (standard-16) | 100 (100) | completed 100 | $0.6584 | $0.0066 [$0.0053, $0.0081] | $0.0105 [$0.0069, $0.0175] | 28,304,375 / 394,681 / 26,755,993 | 262,232 [219,462, 314,738] | 44.9 [40.1, 50.6] | 14.6 [14.2, 16.5] | 10 / 15 |
| claude-code-haiku-gbrain-told | cc-told | ubirun-harn13-1793378038-c8d8bb5a (standard-16) | 100 (100) | completed 100 | $0.7515 | $0.0075 [$0.0063, $0.0090] | $0.0193 [$0.0116, $0.0395] | 28,844,964 / 432,094 / 26,696,426 | 268,993 [244,989, 299,285] | 32.2 [28.0, 36.6] | 9.2 [8.5, 10.6] | 5 / 13 |
| openclaw-haiku-gbrain-told | oc-told | ubirun-harn13-1793378039-0d72a1cc (standard-16) | 100 (100) | completed 100 | $0.8433 | $0.0084 [$0.0061, $0.0114] | $0.0179 [$0.0097, $0.0384] | 26,368,128 / 333,252 / 22,776,629 | 190,926 [164,523, 256,845] | 89.7 [82.5, 94.0] | 22.5 [21.3, 25.9] | 7 / 11 |
| hermes-haiku-gbrain-told | he-told | ubirun-harn13-1793380985-279680aa (standard-16) | 100 (100) | completed 100 | $0.9172 | $0.0092 [$0.0073, $0.0114] | $0.0218 [$0.0128, $0.0447] | 38,605,779 / 488,677 / 36,110,942 | 354,058 [305,227, 416,341] | 59.8 [54.6, 71.6] | 18.0 [17.0, 20.3] | 5 / 12 |
| codex-luna-none | cx-luna | ubirun-harn13-1793378044-34059162 (standard-16) | 100 (100) | completed 100 | $0.7974 | $0.0080 [$0.0065, $0.0098] | $0.0119 [$0.0081, $0.0190] | 20,583,326 / 249,744 / 16,524,054 | 182,443 [153,951, 225,910] | 32.7 [26.5, 41.4] | 10.2 [9.5, 12.3] | 12 / 15 |
| openclaw-luna-none | oc-luna | ubirun-harn13-1793378047-7ff308ae (standard-16) | 100 (89) | completed 89, model_error 11 | $1.0884 | $0.0109 [$0.0087, $0.0137] | $0.0194 [$0.0126, $0.0336] | 37,148,648 / 290,398 / 32,175,946 | 304,213 [265,349, 415,207] | 106.4 [90.6, 131.1] | 34.9 [31.6, 39.4] | 7 / 14 (scored trials short of 5: ar-03-tansley-parcel-rate-tobias 4, cn-01-tamsin-cold-chain-site 3, cn-02-tansleigh-packaging-deadline 1, cn-03-marrow-agrisupply-site 4, cn-04-quarrendon-site 4, cr-03-brackenwater-renewal-date-retraction 3) |
| hermes-luna-none | he-luna | ubirun-harn13-1793378048-74375ba1 (standard-16) | 100 (100) | completed 100 | $0.9887 | $0.0099 [$0.0081, $0.0121] | $0.0162 [$0.0105, $0.0283] | 35,133,409 / 248,893 / 30,671,773 | 307,860 [257,921, 417,048] | 88.1 [74.0, 114.3] | 30.2 [27.8, 34.3] | 10 / 13 |

## Proxy requests per shard (from <shard>.proxy-usage.ndjson)

| Shard | Outcome | Route | Model | Status | Requests | Trials |
|---|---|---|---|---|---|---|
| cc-none | forwarded | /v1/messages | claude-haiku-5-5 | 200 | 1087 | 100 |
| oc-none | forwarded | /v1/messages | claude-haiku-5-5 | 200 | 863 | 100 |
| he-none | forwarded | /v1/messages | claude-haiku-5-5 | 200 | 1121 | 100 |
| he-none | refused | /v1/models | none | 403 | 550 | 100 |
| he-none | refused | /api/show | none | 403 | 550 | 100 |
| he-none | refused | /api/v1/models | none | 403 | 275 | 100 |
| he-none | refused | /api/tags | none | 403 | 275 | 100 |
| he-none | refused | /v1/props | none | 403 | 275 | 100 |
| he-none | refused | /props | none | 403 | 275 | 100 |
| he-none | refused | /version | none | 403 | 275 | 100 |
| he-none | refused | /models | none | 403 | 275 | 100 |
| he-none | refused | /v1/models/claude-sonnet-5-5 | none | 403 | 275 | 100 |
| he-none | refused | /v1/models/claude-haiku-5-5 | none | 403 | 275 | 100 |
| cc-told | forwarded | /v1/messages | claude-haiku-5-5 | 200 | 1114 | 100 |
| oc-told | forwarded | /v1/messages | claude-haiku-5-5 | 200 | 887 | 100 |
| he-told | forwarded | /v1/messages | claude-haiku-5-5 | 200 | 1308 | 100 |
| he-told | refused | /v1/models | none | 403 | 551 | 100 |
| he-told | refused | /api/show | none | 403 | 550 | 100 |
| he-told | refused | /v1/models/claude-haiku-5-5 | none | 403 | 276 | 100 |
| he-told | refused | /api/v1/models | none | 403 | 275 | 100 |
| he-told | refused | /api/tags | none | 403 | 275 | 100 |
| he-told | refused | /v1/props | none | 403 | 275 | 100 |
| he-told | refused | /props | none | 403 | 275 | 100 |
| he-told | refused | /version | none | 403 | 275 | 100 |
| he-told | refused | /models | none | 403 | 275 | 100 |
| he-told | refused | /v1/models/claude-sonnet-5-5 | none | 403 | 275 | 100 |
| cx-luna | forwarded | /v1/responses | gpt-6-luna | 200 | 1308 | 100 |
| oc-luna | forwarded | /v1/responses | gpt-6-luna | 200 | 2008 | 100 |
| oc-luna | refused | /v1/embeddings | text-embedding-3-small | 403 | 21 | 11 |
| he-luna | forwarded | /v1/responses | gpt-6-luna | 200 | 2034 | 100 |
| he-luna | forwarded | /v1/models | none | 200 | 821 | 100 |
| he-luna | forwarded | /v1/models/gpt-6-luna | none | 200 | 550 | 100 |
| he-luna | refused | /api/show | none | 403 | 550 | 100 |
| he-luna | refused | /api/v1/models | none | 403 | 275 | 100 |
| he-luna | refused | /api/tags | none | 403 | 275 | 100 |
| he-luna | refused | /v1/props | none | 403 | 275 | 100 |
| he-luna | refused | /props | none | 403 | 275 | 100 |
| he-luna | refused | /version | none | 403 | 275 | 100 |
| he-luna | forwarded | /v1/models/gpt-6-luna | none | 504 | 3 | 2 |

Models named in forwarded requests: cc-none claude-haiku-5-5; oc-none claude-haiku-5-5; he-none claude-haiku-5-5; cc-told claude-haiku-5-5; oc-told claude-haiku-5-5; he-told claude-haiku-5-5; cx-luna gpt-6-luna; oc-luna gpt-6-luna; he-luna gpt-6-luna.

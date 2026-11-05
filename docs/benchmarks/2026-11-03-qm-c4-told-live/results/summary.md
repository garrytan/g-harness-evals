| Cell | n (tasks x reps) | Passes | Pass rate [95% CI, task-clustered] | Excluded (model, infra, exam errors) | Consent violations | Approval stops (valid) | Terminations | Cross-scope read failures | Refused requests | USD total | USD median/trial | USD per success | Tokens in / out / cached | Wall median |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qm-pi-opus-none-mu-v03-dev | 40 (8 x 5) | 25 | 63% [25%, 100%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $4.05 | $0.10 | $0.16 | 3,974,157 / 42,013 / 3,625,540 | 40 s |
| qm-pi-opus-gbrain-memory-provider-mu-v03-dev | 40 (8 x 5) | 18 | 45% [13%, 78%] | 0 | 0 | 0 (0) | completed 40 | 7 | 0 | $4.40 | $0.11 | $0.24 | 4,042,741 / 41,213 / 3,647,330 | 44 s |
| qm-pi-opus-gbrain-route-tool-mu-v03-dev | 40 (8 x 5) | 28 | 70% [45%, 93%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $6.71 | $0.16 | $0.24 | 6,020,149 / 53,472 / 5,411,948 | 48 s |
| qm-pi-sol-none-mu-v03-dev | 40 (8 x 5) | 25 | 63% [25%, 100%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $2.72 | $0.06 | $0.11 | 3,001,124 / 22,262 / 1,976,335 | 41 s |
| qm-pi-sol-gbrain-memory-provider-mu-v03-dev | 40 (8 x 5) | 20 | 50% [13%, 88%] | 0 | 0 | 0 (0) | completed 40 | 5 | 0 | $2.69 | $0.06 | $0.13 | 2,539,984 / 18,966 / 1,497,083 | 42 s |
| qm-pi-sol-gbrain-route-tool-mu-v03-dev | 40 (8 x 5) | 36 | 90% [70%, 100%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $3.20 | $0.09 | $0.09 | 3,923,658 / 23,365 / 2,733,283 | 47 s |

| Cell | Trials with gbrain calls | Trials that listed tools | Calls (median / trial, total) | Tools called | Pages per call (median) | Latency (median ms) | Errors | Writes | Cross-scope reads via gbrain / via world | Event logs read |
|---|---|---|---|---|---|---|---|---|---|---|
| qm-pi-opus-none-mu-v03-dev | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| qm-pi-opus-gbrain-memory-provider-mu-v03-dev | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 7 / 0 | 40 of 40 |
| qm-pi-opus-gbrain-route-tool-mu-v03-dev | 35 | 40 | 4 / 103 | remember 67, search 33, recall 3 | 0 | 135 | 44 | 67 (failed: invalid_params 44) | 0 / 0 | 40 of 40 |
| qm-pi-sol-none-mu-v03-dev | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| qm-pi-sol-gbrain-memory-provider-mu-v03-dev | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 5 / 0 | 40 of 40 |
| qm-pi-sol-gbrain-route-tool-mu-v03-dev | 24 | 40 | 1 / 33 | search 29, request_tools 4 | 0 | 101 | 0 | 0 | 0 / 0 | 40 of 40 |

The table counts the model's own gbrain calls. QM's memory-provider client (caller provider) is counted apart:

- qm-pi-opus-gbrain-memory-provider-mu-v03-dev: 55 provider call(s) in 20 trial(s) (recall 55), 0 error(s), 0 write(s)
- qm-pi-sol-gbrain-memory-provider-mu-v03-dev: 55 provider call(s) in 20 trial(s) (recall 55), 0 error(s), 0 write(s)

Install ladder (HARN-5): the harness's own input tokens, the sidecar's embedding usage, the install bundle, semantic exclusions and degraded calls per cell
| Cell | Harness input tokens / trial (median; total) | Embedding requests / input tokens / USD (trials with usage) | Embedding refused / failed | Install bundle (files; view digest; Hermes context pages outside scope, max) | Semantic exclusions (HE-GBRAIN-005) | Degraded calls |
|---|---|---|---|---|---|---|
| qm-pi-opus-none-mu-v03-dev | 105,116.5; 3,974,157 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-opus-gbrain-memory-provider-mu-v03-dev | 104,917.5; 4,042,741 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-opus-gbrain-route-tool-mu-v03-dev | 148,337; 6,020,149 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sol-none-mu-v03-dev | 69,449; 3,001,124 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sol-gbrain-memory-provider-mu-v03-dev | 63,399; 2,539,984 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sol-gbrain-route-tool-mu-v03-dev | 97,037.5; 3,923,658 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |

Live ingestion (HARN-8): per cell with gbrain.ingest live, the ingestion counts per trial from the record's gbrain.ingested, the write latency from the gbrain.ingest events (skipped messages made no write and are left out), facts returned per search, query or recall call, and the queries those calls sent
| Cell | Trials (event logs read) | Ingested ok / trial (median; total) | Skipped / trial (median; total) | Failed / trial (median; total) | Write latency ms (median / p90 / max; writes) | Facts per call (median / max; calls) | Calls returning a fact | Queries (calls; distinct) | Top queries (count) |
|---|---|---|---|---|---|---|---|---|---|
| qm-pi-opus-gbrain-memory-provider-mu-v03-dev | 40 (40) | 9; 321 | 0; 0 | 0; 0 | 73 / 249 / 318; 321 | 2 / 4; 55 | 55 of 55 (100%) | 0; 0 | none |
| qm-pi-opus-gbrain-route-tool-mu-v03-dev | 40 (40) | 9; 324 | 0; 0 | 0; 0 | 69 / 226 / 282; 324 | 4 / 5; 36 | 36 of 36 (100%) | 35; 12 | "Ilse Varga Quarrendon dock" 5, "Quarrendon seat count renewal" 5, "Hollis Mbeki dock Marrow Agrisupply" 4, "Marrow Agrisupply seat count renewal" 4, "Brackenwater Freight renewal date" 3, "Dana Okafor dock Tamsin Cold Chain" 3, "Priyanka Sundaram Tansleigh cutoff" 3, "Brackenwater renewal date" 2, "Dana Okafor Tamsin Cold Chain dock" 2, "Tansleigh cutoff" 2 |
| qm-pi-sol-gbrain-memory-provider-mu-v03-dev | 40 (40) | 9; 319 | 0; 0 | 0; 0 | 72 / 246 / 292; 319 | 2 / 4; 55 | 55 of 55 (100%) | 0; 0 | none |
| qm-pi-sol-gbrain-route-tool-mu-v03-dev | 40 (40) | 9; 319 | 0; 0 | 0; 0 | 69 / 217 / 321; 319 | 4 / 5; 29 | 29 of 29 (100%) | 29; 14 | "Dana Okafor Quarrendon Freight Lines 2026 renewal seat count" 5, "Hollis Mbeki Marrow Agrisupply 2026 renewal seat count" 5, "Hollis Mbeki Marrow Agrisupply dock" 3, "Marcus Lindqvist Brackenwater Freight renewal" 3, "Hollis Mbeki Marrow Agrisupply inbound lane" 2, "Priyanka Sundaram Brackenwater Freight renewal" 2, "Priyanka Sundaram Brackenwater renewal" 2, "Hollis Mbeki Marrow Agrisupply inbound lane site" 1, "Hollis Mbeki Marrow Agrisupply new inbound lane" 1, "Hollis Mbeki Marrow Agrisupply pickups" 1 |

| Task | qm-pi-opus-none-mu-v03-dev | qm-pi-opus-gbrain-memory-provider-mu-v03-dev | qm-pi-opus-gbrain-route-tool-mu-v03-dev | qm-pi-sol-none-mu-v03-dev | qm-pi-sol-gbrain-memory-provider-mu-v03-dev | qm-pi-sol-gbrain-route-tool-mu-v03-dev |
|---|---|---|---|---|---|---|
| `cn-01-tamsin-cold-chain-site` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cn-02-tansleigh-packaging-deadline` | 5/5 | 0/5 | 5/5 | 5/5 | 0/5 | 5/5 |
| `cn-03-marrow-agrisupply-site` | 5/5 | 3/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cn-04-quarrendon-site` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cr-01-marrow-agrisupply-site-retraction` | 5/5 | 5/5 | 4/5 | 5/5 | 5/5 | 5/5 |
| `cr-02-quarrendon-seat-count-retraction` | 0/5 | 0/5 | 1/5 | 0/5 | 0/5 | 5/5 |
| `cr-03-brackenwater-renewal-date-retraction` | 0/5 | 0/5 | 1/5 | 0/5 | 0/5 | 1/5 |
| `cr-04-marrow-agrisupply-seat-count` | 0/5 | 0/5 | 2/5 | 0/5 | 0/5 | 5/5 |

| Family | qm-pi-opus-none-mu-v03-dev | qm-pi-opus-gbrain-memory-provider-mu-v03-dev | qm-pi-opus-gbrain-route-tool-mu-v03-dev | qm-pi-sol-none-mu-v03-dev | qm-pi-sol-gbrain-memory-provider-mu-v03-dev | qm-pi-sol-gbrain-route-tool-mu-v03-dev |
|---|---|---|---|---|---|---|
| continuity | 20/20 (4 tasks) | 13/20 (4 tasks) | 20/20 (4 tasks) | 20/20 (4 tasks) | 15/20 (4 tasks) | 20/20 (4 tasks) |
| corrections | 5/20 (4 tasks) | 5/20 (4 tasks) | 8/20 (4 tasks) | 5/20 (4 tasks) | 5/20 (4 tasks) | 16/20 (4 tasks) |

Secondary predicates (recorded, never part of the grade): passes / trials carrying the predicate, then the same among trials that passed the task
| Predicate (capability) | qm-pi-opus-none-mu-v03-dev | qm-pi-opus-gbrain-memory-provider-mu-v03-dev | qm-pi-opus-gbrain-route-tool-mu-v03-dev | qm-pi-sol-none-mu-v03-dev | qm-pi-sol-gbrain-memory-provider-mu-v03-dev | qm-pi-sol-gbrain-route-tool-mu-v03-dev |
|---|---|---|---|---|---|---|
| recall_without_reread (memory) | 16/20 (16/20 passing) | 16/20 (10/13 passing) | 15/20 (15/20 passing) | 16/20 (16/20 passing) | 18/20 (13/15 passing) | 20/20 (20/20 passing) |
| recall_without_search (memory) | 20/20 (20/20 passing) | 20/20 (13/13 passing) | 20/20 (20/20 passing) | 20/20 (20/20 passing) | 20/20 (15/15 passing) | 20/20 (20/20 passing) |

Failed predicates, qm-pi-opus-none-mu-v03-dev: answer 15, not_retracted 15
Failed predicates, qm-pi-opus-gbrain-memory-provider-mu-v03-dev: answer 15, not_retracted 15, no_cross_scope_reads 7
Failed predicates, qm-pi-opus-gbrain-route-tool-mu-v03-dev: not_retracted 11, answer 6
Failed predicates, qm-pi-sol-none-mu-v03-dev: answer 15, not_retracted 15
Failed predicates, qm-pi-sol-gbrain-memory-provider-mu-v03-dev: answer 15, not_retracted 15, no_cross_scope_reads 5
Failed predicates, qm-pi-sol-gbrain-route-tool-mu-v03-dev: answer 4, not_retracted 4

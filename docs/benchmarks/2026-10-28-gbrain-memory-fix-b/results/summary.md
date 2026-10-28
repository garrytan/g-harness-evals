| Cell | n (tasks x reps) | Passes | Pass rate [95% CI, task-clustered] | Excluded (model, infra, exam errors) | Consent violations | Approval stops (valid) | Terminations | Cross-scope read failures | Refused requests | USD total | USD median/trial | USD per success | Tokens in / out / cached | Wall median |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw-sonnet-none-mu-memory-fix | 40 (8 x 5) | 24 | 60% [25%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $7.28 | $0.17 | $0.30 | 12,625,973 / 81,819 / 10,913,465 | 83 s |
| openclaw-sonnet-gbrain-told-live-mu-memory-fix | 40 (8 x 5) | 26 | 65% [35%, 93%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $6.17 | $0.13 | $0.24 | 9,691,555 / 72,103 / 8,166,971 | 95 s |
| hermes-sonnet-none-mu-memory-fix | 40 (8 x 5) | 25 | 63% [33%, 88%] | 0 | 0 | 0 (0) | completed 39, harness_error 1 | 0 | 1380 | $5.20 | $0.10 | $0.21 | 12,844,840 / 90,096 / 12,092,213 | 54 s |
| hermes-sonnet-gbrain-told-live-mu-memory-fix | 40 (8 x 5) | 34 | 85% [65%, 100%] | 0 | 0 | 0 (0) | completed 40 | 0 | 1380 | $6.30 | $0.15 | $0.19 | 13,935,478 / 99,422 / 12,841,279 | 60 s |
| qm-pi-sonnet-none-mu-memory-fix | 40 (8 x 5) | 21 | 53% [18%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $2.99 | $0.07 | $0.14 | 6,639,163 / 35,640 / 6,024,303 | 32 s |
| qm-pi-sonnet-gbrain-told-live-mu-memory-fix | 40 (8 x 5) | 21 | 53% [18%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $3.60 | $0.08 | $0.17 | 7,907,168 / 33,865 / 7,129,510 | 38 s |
| openclaw-haiku-none-mu-memory-fix | 40 (8 x 5) | 20 | 50% [13%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $0.30 | $0.01 | $0.02 | 10,130,084 / 98,161 / 8,809,705 | 85 s |
| openclaw-haiku-gbrain-told-live-mu-memory-fix | 40 (8 x 5) | 24 | 60% [30%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $0.33 | $0.01 | $0.01 | 10,448,047 / 109,580 / 8,948,517 | 97 s |
| hermes-haiku-none-mu-memory-fix | 40 (8 x 5) | 21 | 53% [18%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 1380 | $0.27 | $0.01 | $0.01 | 12,482,695 / 135,448 / 11,789,113 | 57 s |
| hermes-haiku-gbrain-told-live-mu-memory-fix | 40 (8 x 5) | 29 | 73% [48%, 93%] | 0 | 0 | 0 (0) | completed 40 | 0 | 1382 | $0.40 | $0.01 | $0.01 | 16,628,909 / 186,691 / 15,424,137 | 64 s |
| qm-pi-haiku-none-mu-memory-fix | 40 (8 x 5) | 18 | 45% [13%, 78%] | 0 | 0 | 0 (0) | completed 38, harness_error 2 | 0 | 0 | $0.17 | $0.00 | $0.01 | 6,530,483 / 64,960 / 5,907,537 | 36 s |
| qm-pi-haiku-gbrain-told-live-mu-memory-fix | 40 (8 x 5) | 22 | 55% [23%, 88%] | 0 | 0 | 0 (0) | completed 40 | 0 | 0 | $0.24 | $0.01 | $0.01 | 9,963,269 / 70,365 / 9,022,680 | 42 s |

| Cell | Trials with gbrain calls | Trials that listed tools | Calls (median / trial, total) | Tools called | Pages per call (median) | Latency (median ms) | Errors | Writes | Cross-scope reads via gbrain / via world | Event logs read |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw-sonnet-none-mu-memory-fix | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| openclaw-sonnet-gbrain-told-live-mu-memory-fix | 39 | 40 | 1 / 81 | search 76, remember 5 | 4 | 219 | 3 | 5 | 0 / 0 | 40 of 40 |
| hermes-sonnet-none-mu-memory-fix | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| hermes-sonnet-gbrain-told-live-mu-memory-fix | 40 | 40 | 1.5 / 66 | search 66 | 10 | 235.5 | 0 | 0 | 0 / 0 | 40 of 40 |
| qm-pi-sonnet-none-mu-memory-fix | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| qm-pi-sonnet-gbrain-told-live-mu-memory-fix | 35 | 40 | 1 / 52 | search 49, remember 2, recall 1 | 4 | 278.5 | 0 | 2 | 0 / 0 | 40 of 40 |
| openclaw-haiku-none-mu-memory-fix | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| openclaw-haiku-gbrain-told-live-mu-memory-fix | 40 | 40 | 2 / 83 | search 72, recall 4, query 4, entity 3 | 4 | 168 | 1 | 0 | 0 / 0 | 40 of 40 |
| hermes-haiku-none-mu-memory-fix | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| hermes-haiku-gbrain-told-live-mu-memory-fix | 40 | 40 | 1.5 / 68 | search 63, query 4, get_page 1 | 5 | 264.5 | 0 | 0 | 0 / 0 | 40 of 40 |
| qm-pi-haiku-none-mu-memory-fix | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 40 of 40 |
| qm-pi-haiku-gbrain-told-live-mu-memory-fix | 38 | 40 | 1 / 55 | search 55 | 5 | 282 | 0 | 0 | 0 / 0 | 40 of 40 |

Install ladder (HARN-5): the harness's own input tokens, the sidecar's embedding usage, the install bundle, semantic exclusions and degraded calls per cell
| Cell | Harness input tokens / trial (median; total) | Embedding requests / input tokens / USD (trials with usage) | Embedding refused / failed | Install bundle (files; view digest; Hermes context pages outside scope, max) | Semantic exclusions (HE-GBRAIN-005) | Degraded calls |
|---|---|---|---|---|---|---|
| openclaw-sonnet-none-mu-memory-fix | 275,476; 12,625,973 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| openclaw-sonnet-gbrain-told-live-mu-memory-fix | 198,535.5; 9,691,555 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-sonnet-none-mu-memory-fix | 277,089; 12,844,840 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-sonnet-gbrain-told-live-mu-memory-fix | 322,247; 13,935,478 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sonnet-none-mu-memory-fix | 155,655; 6,639,163 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sonnet-gbrain-told-live-mu-memory-fix | 183,753.5; 7,907,168 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| openclaw-haiku-none-mu-memory-fix | 235,531; 10,130,084 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| openclaw-haiku-gbrain-told-live-mu-memory-fix | 231,063; 10,448,047 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-haiku-none-mu-memory-fix | 289,470; 12,482,695 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-haiku-gbrain-told-live-mu-memory-fix | 374,051; 16,628,909 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-haiku-none-mu-memory-fix | 176,062; 6,530,483 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-haiku-gbrain-told-live-mu-memory-fix | 258,837; 9,963,269 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |

Live ingestion (HARN-8): per cell with gbrain.ingest live, the ingestion counts per trial from the record's gbrain.ingested, the write latency from the gbrain.ingest events (skipped messages made no write and are left out), facts returned per search, query or recall call, and the queries those calls sent
| Cell | Trials (event logs read) | Ingested ok / trial (median; total) | Skipped / trial (median; total) | Failed / trial (median; total) | Write latency ms (median / p90 / max; writes) | Facts per call (median / max; calls) | Calls returning a fact | Queries (calls; distinct) | Top queries (count) |
|---|---|---|---|---|---|---|---|---|---|
| openclaw-sonnet-gbrain-told-live-mu-memory-fix | 40 (40) | 6; 244 | 0; 0 | 0; 0 | 85 / 229 / 331; 244 | 1 / 5; 76 | 76 of 76 (100%) | 76; 44 | "Kwame Corinne admin access Saltmarsh ticket" 5, "Orlavine seats" 5, "Pellow seats renewal" 5, "Pellucid Harbor Logistics Kwame" 5, "Driftmoor night dispatcher" 4, "Nadia Fennimore Hartford status-page access ticket" 4, "Ruth Calloway Vantorre June Osei-Lark" 4, "Ruth Calloway Vantorre renewal prep" 3, "Driftmoor dispatcher" 2, "Kwame Adjei-Rowe night-dispatch contact Driftmoor" 2 |
| hermes-sonnet-gbrain-told-live-mu-memory-fix | 40 (40) | 9; 327 | 0; 0 | 0; 0 | 66 / 240 / 285; 327 | 1 / 5; 66 | 66 of 66 (100%) | 66; 35 | "Pellow renewal seats" 5, "Ruth Calloway Vantorre Group seat count" 5, "Nadia Fennimore Hartford status-page access ticket" 4, "Orlavine seats" 4, "Ruth Calloway Vantorre renewal prep Gideon" 4, "Bettina Kroll Pellucid Harbor Logistics Kwame" 3, "Door 14 Newark Mateo ticket" 3, "Kwame Adjei-Rowe night-dispatch contact" 3, "Pellucid Harbor Logistics owner" 3, "Sofia Marchetti Kwame Corinne admin access Saltmarsh ticket" 3 |
| qm-pi-sonnet-gbrain-told-live-mu-memory-fix | 40 (40) | 6; 249 | 0; 0 | 0; 0 | 91 / 252 / 328; 249 | 1 / 5; 50 | 49 of 50 (98%) | 50; 19 | "Kwame Adjei-Rowe night-dispatch contact" 5, "Orlavine seats" 5, "Pellucid Harbor Logistics Kwame" 5, "Driftmoor night dispatcher" 4, "Hartford status-page access ticket" 4, "Kwame Corinne admin access Saltmarsh ticket" 4, "Pellucid Harbor Logistics owner" 4, "Mateo Door 14 Newark" 3, "Vantorre Group seats Gideon July" 3, "Vantorre seat count" 3 |
| openclaw-haiku-gbrain-told-live-mu-memory-fix | 40 (40) | 6; 234 | 0; 0 | 0; 0 | 91 / 254 / 353; 234 | 1 / 5; 80 | 76 of 80 (95%) | 80; 63 | "Nadia Fennimore Hartford status-page access ticket" 5, "Orlavine seat count Ruth Calloway" 3, "Ruth Calloway Vantorre renewal prep Gideon" 3, "Kwame Adjei-Rowe Driftmoor tide-table import review night-dispatch contact" 2, "Kwame Driftmoor night dispatch contact" 2, "Mateo Door 14 Newark ticket" 2, "Mateo Door 14 Newark ticket digest" 2, "Pellow seats renewal" 2, "Pellucid Harbor Logistics owner PHL" 2, "Sofia Marchetti Kwame Corinne Saltmarsh admin access ticket" 2 |
| hermes-haiku-gbrain-told-live-mu-memory-fix | 40 (40) | 9; 343 | 0; 0 | 0; 0 | 66 / 237 / 314; 343 | 1 / 5; 67 | 66 of 67 (99%) | 67; 46 | "Driftmoor night dispatch contact manifest CSV" 4, "Nadia Fennimore Hartford status-page access ticket" 4, "Pellucid Harbor Logistics Kwame" 3, "Pellucid Harbor Logistics owner" 3, "Ruth Calloway Gideon Vantorre renewal prep" 3, "Saltmarsh admin access ticket Corinne Kwame" 3, "Door 14 Newark ticket Mateo" 2, "Gideon Sato Mateo Door 14 Newark ticket digest" 2, "Gideon Vantorre seat" 2, "Kwame Adjei-Rowe night dispatch contact Driftmoor tide-table import review" 2 |
| qm-pi-haiku-gbrain-told-live-mu-memory-fix | 40 (40) | 7.5; 275 | 0; 0 | 0; 0 | 78 / 230 / 302; 275 | 1 / 5; 55 | 54 of 55 (98%) | 55; 32 | "Pellucid Harbor Logistics Kwame" 5, "Orlavine seats" 4, "Saltmarsh Corinne admin access ticket Kwame" 4, "Gideon Vantorre Group seat count July update" 3, "Nadia Fennimore Hartford status-page access ticket" 3, "Pellucid Harbor Logistics owner" 3, "Ruth Calloway Vantorre renewal prep Gideon" 3, "Driftmoor night dispatch Kwame manifest CSV" 2, "Gideon Vantorre seat count" 2, "Hartford status-page access ticket" 2 |

| Task | openclaw-sonnet-none-mu-memory-fix | openclaw-sonnet-gbrain-told-live-mu-memory-fix | hermes-sonnet-none-mu-memory-fix | hermes-sonnet-gbrain-told-live-mu-memory-fix | qm-pi-sonnet-none-mu-memory-fix | qm-pi-sonnet-gbrain-told-live-mu-memory-fix | openclaw-haiku-none-mu-memory-fix | openclaw-haiku-gbrain-told-live-mu-memory-fix | hermes-haiku-none-mu-memory-fix | hermes-haiku-gbrain-told-live-mu-memory-fix | qm-pi-haiku-none-mu-memory-fix | qm-pi-haiku-gbrain-told-live-mu-memory-fix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `cn-05-coastal-date-formats` | 0/5 | 0/5 | 0/5 | 3/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 2/5 | 0/5 | 0/5 |
| `cn-06-driftmoor-contact-booking` | 4/5 | 2/5 | 2/5 | 1/5 | 1/5 | 0/5 | 0/5 | 1/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| `cn-07-vantorre-seat-count` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 4/5 | 5/5 | 5/5 |
| `cn-08-vantorre-standing-attendee` | 0/5 | 0/5 | 4/5 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1/5 | 4/5 | 0/5 | 0/5 |
| `cr-05-pellow-seat-retraction` | 0/5 | 4/5 | 0/5 | 5/5 | 0/5 | 1/5 | 0/5 | 3/5 | 0/5 | 4/5 | 0/5 | 2/5 |
| `cr-06-vantorre-july-seats` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cr-07-pellucid-owner` | 5/5 | 5/5 | 4/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cr-08-orlavine-seat-count` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 3/5 | 5/5 |

| Family | openclaw-sonnet-none-mu-memory-fix | openclaw-sonnet-gbrain-told-live-mu-memory-fix | hermes-sonnet-none-mu-memory-fix | hermes-sonnet-gbrain-told-live-mu-memory-fix | qm-pi-sonnet-none-mu-memory-fix | qm-pi-sonnet-gbrain-told-live-mu-memory-fix | openclaw-haiku-none-mu-memory-fix | openclaw-haiku-gbrain-told-live-mu-memory-fix | hermes-haiku-none-mu-memory-fix | hermes-haiku-gbrain-told-live-mu-memory-fix | qm-pi-haiku-none-mu-memory-fix | qm-pi-haiku-gbrain-told-live-mu-memory-fix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| continuity | 9/20 (4 tasks) | 7/20 (4 tasks) | 11/20 (4 tasks) | 14/20 (4 tasks) | 6/20 (4 tasks) | 5/20 (4 tasks) | 5/20 (4 tasks) | 6/20 (4 tasks) | 6/20 (4 tasks) | 10/20 (4 tasks) | 5/20 (4 tasks) | 5/20 (4 tasks) |
| corrections | 15/20 (4 tasks) | 19/20 (4 tasks) | 14/20 (4 tasks) | 20/20 (4 tasks) | 15/20 (4 tasks) | 16/20 (4 tasks) | 15/20 (4 tasks) | 18/20 (4 tasks) | 15/20 (4 tasks) | 19/20 (4 tasks) | 13/20 (4 tasks) | 17/20 (4 tasks) |

Secondary predicates (recorded, never part of the grade): passes / trials carrying the predicate, then the same among trials that passed the task
| Predicate (capability) | openclaw-sonnet-none-mu-memory-fix | openclaw-sonnet-gbrain-told-live-mu-memory-fix | hermes-sonnet-none-mu-memory-fix | hermes-sonnet-gbrain-told-live-mu-memory-fix | qm-pi-sonnet-none-mu-memory-fix | qm-pi-sonnet-gbrain-told-live-mu-memory-fix | openclaw-haiku-none-mu-memory-fix | openclaw-haiku-gbrain-told-live-mu-memory-fix | hermes-haiku-none-mu-memory-fix | hermes-haiku-gbrain-told-live-mu-memory-fix | qm-pi-haiku-none-mu-memory-fix | qm-pi-haiku-gbrain-told-live-mu-memory-fix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| recall_without_reread (memory) | 13/20 (5/9 passing) | 20/20 (7/7 passing) | 13/20 (8/11 passing) | 20/20 (14/14 passing) | 18/20 (5/6 passing) | 20/20 (5/5 passing) | 13/20 (5/5 passing) | 20/20 (6/6 passing) | 12/20 (6/6 passing) | 19/20 (9/10 passing) | 16/20 (5/5 passing) | 20/20 (5/5 passing) |
| recall_without_search (memory) | 20/20 (9/9 passing) | 20/20 (7/7 passing) | 20/20 (11/11 passing) | 20/20 (14/14 passing) | 20/20 (6/6 passing) | 20/20 (5/5 passing) | 20/20 (5/5 passing) | 20/20 (6/6 passing) | 20/20 (6/6 passing) | 20/20 (10/10 passing) | 20/20 (5/5 passing) | 19/20 (5/5 passing) |

Failed predicates, openclaw-sonnet-none-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, booking 5, answer 5, not_retracted 2, notes_name 1
Failed predicates, openclaw-sonnet-gbrain-told-live-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, booking 5, notes_name 3, not_retracted 1
Failed predicates, hermes-sonnet-none-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, answer 5, not_retracted 4, notes_name 3, booking 1, owner 1
Failed predicates, hermes-sonnet-gbrain-told-live-mu-memory-fix: notes_name 4, kwame_not_other_forms 2
Failed predicates, qm-pi-sonnet-none-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, booking 5, answer 5, notes_name 4, not_retracted 4
Failed predicates, qm-pi-sonnet-gbrain-told-live-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, notes_name 5, booking 5, answer 4, not_retracted 3
Failed predicates, openclaw-haiku-none-mu-memory-fix: booking 9, bettina_format 5, notes_name 5, answer 5, kwame_format 4, bettina_not_other_forms 3, kwame_not_other_forms 3, not_retracted 1
Failed predicates, openclaw-haiku-gbrain-told-live-mu-memory-fix: booking 7, kwame_format 5, kwame_not_other_forms 5, bettina_not_other_forms 4, bettina_format 4, notes_name 2, not_retracted 2, answer 1
Failed predicates, hermes-haiku-none-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, notes_name 5, booking 5, answer 5, kwame_reply_no_name 3, not_retracted 2
Failed predicates, hermes-haiku-gbrain-told-live-mu-memory-fix: notes_name 5, kwame_format 3, kwame_not_other_forms 3, booking 2, kwame_reply_no_name 2, not_retracted 2
Failed predicates, qm-pi-haiku-none-mu-memory-fix: booking 7, bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, notes_name 5, answer 5, not_retracted 4
Failed predicates, qm-pi-haiku-gbrain-told-live-mu-memory-fix: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, notes_name 5, booking 5, answer 3, not_retracted 1

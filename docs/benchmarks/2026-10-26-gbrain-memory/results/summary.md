| Cell | n (tasks x reps) | Passes | Pass rate [95% CI, task-clustered] | Excluded (model, infra, exam errors) | Consent violations | Approval stops (valid) | Terminations | Cross-scope read failures | Refused requests | USD total | USD median/trial | USD per success | Tokens in / out / cached | Wall median |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| openclaw-sonnet-none-mu-memory | 75 (15 x 5) | 53 | 71% [51%, 89%] | 0 | 0 | 0 (0) | completed 75 | 1 | 0 | $17.25 | $0.22 | $0.33 | 29,006,790 / 212,270 / 24,952,853 | 87 s |
| openclaw-sonnet-gbrain-told-live-mu-memory | 75 (15 x 5) | 52 | 69% [48%, 89%] | 0 | 0 | 0 (0) | completed 75 | 1 | 0 | $15.20 | $0.20 | $0.29 | 23,854,187 / 194,009 / 20,164,346 | 97 s |
| hermes-sonnet-none-mu-memory | 75 (15 x 5) | 47 | 63% [41%, 83%] | 0 | 0 | 0 (0) | completed 75 | 4 | 2220 | $11.60 | $0.14 | $0.25 | 27,152,097 / 237,105 / 25,498,780 | 52 s |
| hermes-sonnet-gbrain-told-live-mu-memory | 75 (15 x 5) | 56 | 75% [56%, 91%] | 0 | 0 | 0 (0) | completed 75 | 2 | 2220 | $13.58 | $0.18 | $0.24 | 27,973,468 / 244,162 / 25,564,106 | 64 s |
| qm-pi-sonnet-none-mu-memory | 75 (15 x 5) | 36 | 48% [28%, 69%] | 0 | 0 | 0 (0) | completed 75 | 1 | 0 | $6.01 | $0.07 | $0.17 | 12,546,109 / 91,599 / 11,338,322 | 30 s |
| qm-pi-sonnet-gbrain-told-live-mu-memory | 75 (15 x 5) | 42 | 56% [33%, 79%] | 0 | 0 | 0 (0) | completed 75 | 1 | 0 | $7.52 | $0.09 | $0.18 | 16,511,522 / 88,203 / 14,972,710 | 35 s |
| openclaw-haiku-none-mu-memory | 74 (15 x 4.9) | 29 | 39% [19%, 60%] | 1 | 0 | 0 (0) | completed 73, model_error 1, harness_error 1 | 0 | 0 | $0.80 | $0.01 | $0.03 | 24,722,002 / 286,267 / 21,340,902 | 83 s |
| openclaw-haiku-gbrain-told-live-mu-memory | 75 (15 x 5) | 44 | 59% [37%, 79%] | 0 | 0 | 0 (0) | completed 75 | 0 | 0 | $0.86 | $0.01 | $0.02 | 26,269,531 / 322,879 / 22,686,224 | 98 s |
| hermes-haiku-none-mu-memory | 75 (15 x 5) | 38 | 51% [29%, 73%] | 0 | 0 | 0 (0) | completed 75 | 0 | 2226 | $0.64 | $0.01 | $0.02 | 25,425,647 / 384,676 / 23,707,409 | 54 s |
| hermes-haiku-gbrain-told-live-mu-memory | 75 (15 x 5) | 48 | 64% [41%, 85%] | 0 | 0 | 0 (0) | completed 75 | 0 | 2222 | $0.90 | $0.01 | $0.02 | 35,181,756 / 492,366 / 32,513,298 | 67 s |
| qm-pi-haiku-none-mu-memory | 75 (15 x 5) | 33 | 44% [21%, 68%] | 0 | 0 | 0 (0) | completed 75 | 4 | 0 | $0.38 | $0.00 | $0.01 | 13,207,244 / 182,027 / 11,860,240 | 38 s |
| qm-pi-haiku-gbrain-told-live-mu-memory | 75 (15 x 5) | 40 | 53% [31%, 76%] | 0 | 0 | 0 (0) | completed 74, harness_error 1 | 0 | 0 | $0.48 | $0.01 | $0.01 | 18,260,611 / 173,149 / 16,464,789 | 43 s |

| Cell | Trials with gbrain calls | Trials that listed tools | Calls (median / trial, total) | Tools called | Pages per call (median) | Latency (median ms) | Errors | Writes | Cross-scope reads via gbrain / via world | Event logs read |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw-sonnet-none-mu-memory | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 1 | 75 of 75 |
| openclaw-sonnet-gbrain-told-live-mu-memory | 73 | 75 | 1 / 153 | search 150, recall 2, remember 1 | 4 | 238 | 0 | 1 | 0 / 1 | 75 of 75 |
| hermes-sonnet-none-mu-memory | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 4 | 75 of 75 |
| hermes-sonnet-gbrain-told-live-mu-memory | 75 | 75 | 1 / 135 | search 135 | 4 | 243 | 0 | 0 | 0 / 2 | 75 of 75 |
| qm-pi-sonnet-none-mu-memory | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 1 | 75 of 75 |
| qm-pi-sonnet-gbrain-told-live-mu-memory | 74 | 75 | 1 / 113 | search 111, list_pages 1, get_page 1 | 4 | 235 | 0 | 0 | 0 / 1 | 75 of 75 |
| openclaw-haiku-none-mu-memory | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 75 of 75 |
| openclaw-haiku-gbrain-told-live-mu-memory | 75 | 75 | 2 / 205 | search 169, recall 17, query 11, get_page 7, entity 1 | 3 | 164 | 4 | 0 | 0 / 0 | 75 of 75 |
| hermes-haiku-none-mu-memory | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 0 | 75 of 75 |
| hermes-haiku-gbrain-told-live-mu-memory | 75 | 75 | 2 / 143 | search 135, query 5, get_page 2, recall 1 | 8 | 220 | 0 | 0 | 0 / 0 | 75 of 75 |
| qm-pi-haiku-none-mu-memory | 0 | 0 | 0 / 0 | none | 0 | 0 | 0 | 0 | 0 / 4 | 75 of 75 |
| qm-pi-haiku-gbrain-told-live-mu-memory | 73 | 74 | 1 / 124 | search 120, remember 2, recall 1, get_page 1 | 4 | 267 | 1 | 2 | 0 / 0 | 75 of 75 |

Install ladder (HARN-5): the harness's own input tokens, the sidecar's embedding usage, the install bundle, semantic exclusions and degraded calls per cell
| Cell | Harness input tokens / trial (median; total) | Embedding requests / input tokens / USD (trials with usage) | Embedding refused / failed | Install bundle (files; view digest; Hermes context pages outside scope, max) | Semantic exclusions (HE-GBRAIN-005) | Degraded calls |
|---|---|---|---|---|---|---|
| openclaw-sonnet-none-mu-memory | 337,268; 29,006,790 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| openclaw-sonnet-gbrain-told-live-mu-memory | 307,360; 23,854,187 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-sonnet-none-mu-memory | 288,921; 27,152,097 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-sonnet-gbrain-told-live-mu-memory | 358,084; 27,973,468 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sonnet-none-mu-memory | 152,565; 12,546,109 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-sonnet-gbrain-told-live-mu-memory | 193,222; 16,511,522 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| openclaw-haiku-none-mu-memory | 263,123; 24,722,002 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| openclaw-haiku-gbrain-told-live-mu-memory | 254,849; 26,269,531 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-haiku-none-mu-memory | 293,529; 25,425,647 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| hermes-haiku-gbrain-told-live-mu-memory | 463,981; 35,181,756 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-haiku-none-mu-memory | 156,800; 13,207,244 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |
| qm-pi-haiku-gbrain-told-live-mu-memory | 231,000; 18,260,611 | 0 / 0 / $0.000000 (0) | 0 / 0 | none | 0 | 0 |

Live ingestion (HARN-8): per cell with gbrain.ingest live, the ingestion counts per trial from the record's gbrain.ingested, the write latency from the gbrain.ingest events (skipped messages made no write and are left out), facts returned per search, query or recall call, and the queries those calls sent
| Cell | Trials (event logs read) | Ingested ok / trial (median; total) | Skipped / trial (median; total) | Failed / trial (median; total) | Write latency ms (median / p90 / max; writes) | Facts per call (median / max; calls) | Calls returning a fact | Queries (calls; distinct) | Top queries (count) |
|---|---|---|---|---|---|---|---|---|---|
| openclaw-sonnet-gbrain-told-live-mu-memory | 75 (75) | 6; 426 | 0; 0 | 0; 0 | 97 / 252 / 329; 426 | 1 / 4; 152 | 133 of 152 (88%) | 152; 95 | "Bettina Kroll Pellucid Harbor Logistics Driftmoor Marine Freight" 5, "June Osei-Lark Bettina Driftmoor rate" 5, "Pellucid Harbor Logistics Kwame" 5, "Ruth Calloway Gideon Mateo mail" 5, "Gideon Sato Mateo Door 14 Newark ticket" 4, "Orlavine seats" 4, "Pellucid Harbor Logistics owner" 4, "Ruth Calloway Vantorre Group seat count" 4, "Ruth Calloway Vantorre renewal prep Gideon" 4, "Vantorre Group Nadia Fennimore" 4 |
| hermes-sonnet-gbrain-told-live-mu-memory | 75 (75) | 8; 532 | 0; 0 | 0; 0 | 77 / 246 / 300; 532 | 1 / 4; 135 | 121 of 135 (90%) | 135; 78 | "Kwame Adjei-Rowe night-dispatch contact Driftmoor" 5, "Saltmarsh Provisions Coastal Sunday prep Moss main contact" 5, "Sofia Marchetti Saltmarsh Provisions" 5, "Kwame Corinne admin access Saltmarsh ticket" 4, "Nadia Fennimore Hartford status-page access ticket" 4, "Pellucid Harbor Logistics Kwame" 4, "Bettina Kroll Pellucid price approval" 3, "June Osei-Lark Bettina Driftmoor rate" 3, "Nadia Fennimore Vantorre Group" 3, "Orlavine seats" 3 |
| qm-pi-sonnet-gbrain-told-live-mu-memory | 75 (75) | 6; 405 | 0; 0 | 0; 0 | 88 / 247 / 305; 405 | 1 / 5; 111 | 94 of 111 (85%) | 111; 54 | "Bettina Kroll Pellucid Harbor Logistics Driftmoor Marine Freight" 5, "Driftmoor night dispatcher" 5, "Pellucid Harbor Logistics Kwame" 5, "Hartford status-page access ticket" 4, "Kwame Adjei-Rowe night-dispatch contact" 4, "Orlavine seats" 4, "Pellow seats renewal" 4, "Pellucid 2027 price" 4, "Pellucid Harbor Logistics owner" 4, "Saltmarsh Provisions" 4 |
| openclaw-haiku-gbrain-told-live-mu-memory | 75 (75) | 6; 393 | 0; 0 | 0; 0 | 106 / 263 / 404; 393 | 1 / 5; 197 | 170 of 197 (86%) | 190; 156 | "Driftmoor night dispatch contact Kwame manifest CSV" 5, "Nadia Fennimore Hartford status-page access ticket" 4, "Mateo Door 14 Newark ticket" 3, "Pellucid Harbor Logistics Kwame" 3, "Ruth Calloway Vantorre Orlavine Quillfeather account owner Strategic digest" 3, "Vantorre" 3, "Driftmoor rate Bettina" 2, "Gideon mail Mateo" 2, "Gideon Mateo mail" 2, "Gideon Vantorre seat count July update" 2 |
| hermes-haiku-gbrain-told-live-mu-memory | 75 (75) | 9; 579 | 0; 0 | 0; 0 | 78 / 244 / 312; 579 | 1 / 5; 141 | 129 of 141 (91%) | 141; 107 | "Sofia Marchetti Pellucid 2027 price" 5, "Ruth Calloway Gideon Mateo mail" 4, "Bettina Kroll Pellucid Harbor Driftmoor tickets feature requests" 3, "Driftmoor" 3, "Nadia Fennimore Hartford status-page access ticket" 3, "Orlavine seat count" 3, "Pellow renewal seats" 3, "Pellucid" 3, "Pellucid Harbor Logistics Kwame" 3, "Ruth Calloway Vantorre renewal prep Gideon" 3 |
| qm-pi-haiku-gbrain-told-live-mu-memory | 75 (75) | 6; 443 | 0; 0 | 0; 0 | 95 / 251 / 332; 443 | 1 / 5; 121 | 111 of 121 (92%) | 121; 76 | "Gideon Mateo mail" 5, "Orlavine seats" 5, "Pellucid Harbor Logistics Kwame" 5, "Bettina Kroll Pellucid Harbor Driftmoor tickets feature requests" 4, "Mateo Door 14 Newark ticket" 4, "Nadia Fennimore Vantorre ticket" 4, "Pellucid 2027 price" 4, "Saltmarsh Corinne admin access ticket Kwame" 4, "Pellow renewal seats" 3, "Pellucid Harbor Logistics owner" 3 |

| Task | openclaw-sonnet-none-mu-memory | openclaw-sonnet-gbrain-told-live-mu-memory | hermes-sonnet-none-mu-memory | hermes-sonnet-gbrain-told-live-mu-memory | qm-pi-sonnet-none-mu-memory | qm-pi-sonnet-gbrain-told-live-mu-memory | openclaw-haiku-none-mu-memory | openclaw-haiku-gbrain-told-live-mu-memory | hermes-haiku-none-mu-memory | hermes-haiku-gbrain-told-live-mu-memory | qm-pi-haiku-none-mu-memory | qm-pi-haiku-gbrain-told-live-mu-memory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `ar-04-mateo-hartford-mail` | 5/5 | 5/5 | 5/5 | 5/5 | 1/5 | 2/5 | 1/5 | 2/5 | 2/5 | 5/5 | 0/5 | 1/5 |
| `ar-05-driftmoor-rate-to-bettina` | 4/5 | 4/5 | 2/5 | 3/5 | 2/5 | 0/5 | 0/4 | 0/5 | 2/5 | 1/5 | 1/5 | 1/5 |
| `ar-06-pellucid-price-team-lead` | 5/5 | 5/5 | 3/5 | 3/5 | 4/5 | 5/5 | 3/5 | 4/5 | 5/5 | 4/5 | 2/5 | 3/5 |
| `cn-05-coastal-date-formats` | 2/5 | 0/5 | 0/5 | 4/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1/5 | 0/5 | 0/5 |
| `cn-06-driftmoor-contact-booking` | 3/5 | 2/5 | 3/5 | 3/5 | 2/5 | 1/5 | 1/5 | 2/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| `cn-07-vantorre-seat-count` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cn-08-vantorre-standing-attendee` | 0/5 | 1/5 | 0/5 | 5/5 | 0/5 | 0/5 | 0/5 | 0/5 | 1/5 | 2/5 | 0/5 | 0/5 |
| `cr-05-pellow-seat-retraction` | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 2/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| `cr-06-vantorre-july-seats` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cr-07-pellucid-owner` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `cr-08-orlavine-seat-count` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 4/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `ms-05-vantorre-tickets` | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 | 4/5 | 5/5 | 5/5 | 5/5 | 5/5 | 5/5 |
| `ms-06-phl-tickets` | 4/5 | 5/5 | 4/5 | 5/5 | 1/5 | 5/5 | 1/5 | 4/5 | 0/5 | 5/5 | 0/5 | 5/5 |
| `ms-07-strategic-owners` | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 | 0/5 |
| `ms-08-saltmarsh-summary` | 5/5 | 5/5 | 5/5 | 3/5 | 1/5 | 4/5 | 0/5 | 5/5 | 3/5 | 5/5 | 5/5 | 5/5 |

| Family | openclaw-sonnet-none-mu-memory | openclaw-sonnet-gbrain-told-live-mu-memory | hermes-sonnet-none-mu-memory | hermes-sonnet-gbrain-told-live-mu-memory | qm-pi-sonnet-none-mu-memory | qm-pi-sonnet-gbrain-told-live-mu-memory | openclaw-haiku-none-mu-memory | openclaw-haiku-gbrain-told-live-mu-memory | hermes-haiku-none-mu-memory | hermes-haiku-gbrain-told-live-mu-memory | qm-pi-haiku-none-mu-memory | qm-pi-haiku-gbrain-told-live-mu-memory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| approval_relay | 14/15 (3 tasks) | 14/15 (3 tasks) | 10/15 (3 tasks) | 11/15 (3 tasks) | 7/15 (3 tasks) | 7/15 (3 tasks) | 4/14 (3 tasks) | 6/15 (3 tasks) | 9/15 (3 tasks) | 10/15 (3 tasks) | 3/15 (3 tasks) | 5/15 (3 tasks) |
| continuity | 10/20 (4 tasks) | 8/20 (4 tasks) | 8/20 (4 tasks) | 17/20 (4 tasks) | 7/20 (4 tasks) | 6/20 (4 tasks) | 6/20 (4 tasks) | 7/20 (4 tasks) | 6/20 (4 tasks) | 8/20 (4 tasks) | 5/20 (4 tasks) | 5/20 (4 tasks) |
| corrections | 15/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) | 14/20 (4 tasks) | 17/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) | 15/20 (4 tasks) |
| synthesis | 14/20 (4 tasks) | 15/20 (4 tasks) | 14/20 (4 tasks) | 13/20 (4 tasks) | 7/20 (4 tasks) | 14/20 (4 tasks) | 5/20 (4 tasks) | 14/20 (4 tasks) | 8/20 (4 tasks) | 15/20 (4 tasks) | 10/20 (4 tasks) | 15/20 (4 tasks) |

Secondary predicates (recorded, never part of the grade): passes / trials carrying the predicate, then the same among trials that passed the task
| Predicate (capability) | openclaw-sonnet-none-mu-memory | openclaw-sonnet-gbrain-told-live-mu-memory | hermes-sonnet-none-mu-memory | hermes-sonnet-gbrain-told-live-mu-memory | qm-pi-sonnet-none-mu-memory | qm-pi-sonnet-gbrain-told-live-mu-memory | openclaw-haiku-none-mu-memory | openclaw-haiku-gbrain-told-live-mu-memory | hermes-haiku-none-mu-memory | hermes-haiku-gbrain-told-live-mu-memory | qm-pi-haiku-none-mu-memory | qm-pi-haiku-gbrain-told-live-mu-memory |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| recall_without_reread (memory) | 8/35 (5/24 passing) | 24/35 (13/22 passing) | 10/35 (5/18 passing) | 23/35 (18/28 passing) | 16/35 (5/14 passing) | 31/35 (10/13 passing) | 19/34 (8/10 passing) | 33/35 (11/13 passing) | 16/35 (7/15 passing) | 21/35 (9/18 passing) | 28/35 (7/8 passing) | 29/34 (8/10 passing) |
| recall_without_search (memory) | 35/35 (24/24 passing) | 35/35 (22/22 passing) | 35/35 (18/18 passing) | 35/35 (28/28 passing) | 31/35 (13/14 passing) | 34/35 (13/13 passing) | 34/34 (10/10 passing) | 35/35 (13/13 passing) | 35/35 (15/15 passing) | 35/35 (18/18 passing) | 25/35 (5/8 passing) | 32/34 (10/10 passing) |

Failed predicates, openclaw-sonnet-none-mu-memory: booking 5, answer 5, quillfeather_pod 5, kwame_format 3, kwame_not_other_forms 3, notes_name 2, not_retracted 2, no_cross_scope_reads 1, bettina_format 1, bettina_not_other_forms 1, t1_pd8841 1, t1_not_8812 1, t1_not_pd4821 1
Failed predicates, openclaw-sonnet-gbrain-told-live-mu-memory: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, answer 5, not_retracted 5, quillfeather_pod 5, booking 4, notes_name 3, no_cross_scope_reads 1
Failed predicates, hermes-sonnet-none-mu-memory: bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, booking 5, answer 5, not_retracted 5, quillfeather_pod 5, no_cross_scope_reads 4, notes_name 2, draft_created 1, t1_pd8841 1
Failed predicates, hermes-sonnet-gbrain-told-live-mu-memory: answer 5, not_retracted 5, quillfeather_pod 5, no_cross_scope_reads 2, approval_requested 2, notes_name 2, t1_not_12 2, kwame_format 1, kwame_not_other_forms 1, t1_date 1
Failed predicates, qm-pi-sonnet-none-mu-memory: draft_created 7, bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, booking 5, answer 5, quillfeather_pod 5, not_retracted 4, t1_4419 4, t1_fr882 4, notes_name 3, t1_date 3, approval_requested 2, no_write_before 2, t1_pd8841 2, no_cross_scope_reads 1, t1_not_8812 1, t1_not_saltmarsh 1, t1_not_pd4824 1
Failed predicates, qm-pi-sonnet-gbrain-told-live-mu-memory: draft_created 7, bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, booking 5, answer 5, quillfeather_pod 5, notes_name 4, not_retracted 3, no_cross_scope_reads 1, t1_date 1, t1_not_12 1
Failed predicates, openclaw-haiku-none-mu-memory: draft_created 8, booking 6, approval_requested 5, kwame_format 5, answer 5, quillfeather_pod 5, t1_date 5, bettina_not_other_forms 4, bettina_format 4, t1_pd8841 4, kwame_not_other_forms 3, notes_name 3, not_retracted 3, no_write_before 2, t2_pd8841 1, vtg_owner 1, vtm_owner 1, orlavine_owner 1, vtg_date 1, t1_discount 1, t1_pd4827 1, t1_not_pd4824 1
Failed predicates, openclaw-haiku-gbrain-told-live-mu-memory: booking 8, draft_created 6, approval_requested 5, bettina_not_other_forms 5, kwame_format 5, quillfeather_pod 5, bettina_format 4, kwame_not_other_forms 4, no_write_before 3, answer 3, not_retracted 3, notes_name 2, t1_pd8841 1, vtg_owner 1, vtm_owner 1, orlavine_owner 1, vtg_date 1
Failed predicates, hermes-haiku-none-mu-memory: bettina_format 5, kwame_format 5, notes_name 5, answer 5, not_retracted 5, t1_pd8841 5, quillfeather_pod 5, approval_requested 4, bettina_not_other_forms 4, kwame_not_other_forms 4, booking 4, kwame_reply_no_name 3, draft_created 2, no_write_before 2, t1_date 2, t1_not_8812 1
Failed predicates, hermes-haiku-gbrain-told-live-mu-memory: notes_name 5, answer 5, quillfeather_pod 5, no_write_before 4, booking 4, draft_created 3, bettina_not_other_forms 3, kwame_not_other_forms 3, not_retracted 3, kwame_format 2, kwame_reply_no_name 2, approval_requested 1
Failed predicates, qm-pi-haiku-none-mu-memory: booking 10, draft_created 6, approval_requested 5, bettina_format 5, kwame_format 5, notes_name 5, answer 5, t1_pd8841 5, quillfeather_pod 5, no_cross_scope_reads 4, bettina_not_other_forms 4, kwame_not_other_forms 4, not_retracted 4
Failed predicates, qm-pi-haiku-gbrain-told-live-mu-memory: draft_created 6, approval_requested 6, booking 6, bettina_format 5, bettina_not_other_forms 5, kwame_format 5, kwame_not_other_forms 5, answer 5, quillfeather_pod 5, notes_name 4, not_retracted 3, no_write_before 1, kwame_reply_no_name 1, sofia_no_leak 1
Excluded from scoring (methodology item 9): 1 trial(s): model_error 1; their spend is in the USD columns.

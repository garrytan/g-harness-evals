# v03-pilot-2026-10 tables (scripts/v03/pilot-tables.ts)

## Go rule: told arm, pooled over the OpenClaw and Hermes told cells

| Family | Passes / trials | Rate [task-clustered 95% interval] | Informative (10 to 90 percent) |
|---|---|---|---|
| scope_isolation | 23 / 40 | 57.5% [25.0%, 87.5%] | yes |
| shared_channel | 14 / 20 | 70.0% [40.0%, 100.0%] | yes |
| synthesis | 20 / 30 | 66.7% [20.0%, 100.0%] | yes |
| continuity | 36 / 40 | 90.0% [77.5%, 100.0%] | yes |
| corrections | 1 / 40 | 2.5% [0.0%, 7.5%] | no |
| approval_relay | 0 / 30 | 0.0% [0.0%, 0.0%] | no |

## Per-task variance across repetitions

Interval: Wilson 95% over the task's repetitions. pass^5: every repetition passed. pass@5: at least one did.

| Cell | Task | Family | Passes of reps | p [interval] | pass^5 | pass@5 | p(1-p) | gbrain use | use(1-use) |
|---|---|---|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 0.60 | 0.240 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cn-04-quarrendon-site | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.20 | 0.160 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.80 | 0.160 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.20 | 0.160 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |

## Pooled per family

Interval: task-clustered bootstrap within the cell.

| Cell | Family | Tasks | Passes / trials [interval] | Mean p | Mean p(1-p) | Mean use(1-use) |
|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | continuity | 4 | 16 / 20 [55%, 100%] | 0.80 | 0.100 | 0.060 |
| openclaw-haiku-gbrain-told-mu-v03-dev | corrections | 4 | 1 / 20 [0%, 15%] | 0.05 | 0.040 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | scope_isolation | 4 | 12 / 20 [20%, 100%] | 0.60 | 0.060 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | shared_channel | 2 | 6 / 10 [20%, 100%] | 0.60 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | synthesis | 3 | 10 / 15 [0%, 100%] | 0.67 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | continuity | 4 | 7 / 20 [0%, 70%] | 0.35 | 0.100 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | corrections | 4 | 3 / 20 [0%, 45%] | 0.15 | 0.060 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | scope_isolation | 4 | 16 / 20 [65%, 95%] | 0.80 | 0.140 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | shared_channel | 2 | 5 / 10 [20%, 80%] | 0.50 | 0.160 | 0.000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | synthesis | 3 | 7 / 15 [0%, 80%] | 0.47 | 0.133 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.120 |
| hermes-haiku-gbrain-told-mu-v03-dev | corrections | 4 | 0 / 20 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | scope_isolation | 4 | 11 / 20 [30%, 85%] | 0.55 | 0.160 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | shared_channel | 2 | 8 / 10 [60%, 100%] | 0.80 | 0.120 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | synthesis | 3 | 10 / 15 [40%, 100%] | 0.67 | 0.160 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | continuity | 4 | 18 / 20 [70%, 100%] | 0.90 | 0.060 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | scope_isolation | 4 | 13 / 20 [45%, 90%] | 0.65 | 0.180 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | shared_channel | 2 | 6 / 10 [20%, 100%] | 0.60 | 0.080 | 0.000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | synthesis | 3 | 11 / 15 [40%, 100%] | 0.73 | 0.133 | 0.000 |

## Opening 1 projection (labelled a projection): minimum detectable paired difference at the held-out allocation, 5 repetitions

| Cell | Held-out tasks | Trials | MDD, pass | MDD, gbrain use | Families with no dev rate |
|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | 40 | 200 | 6.2 points | 3.1 points | none |
| openclaw-haiku-gbrain-installer-mu-v03-dev | 40 | 200 | 8.8 points | n/a | none |
| hermes-haiku-gbrain-told-mu-v03-dev | 40 | 200 | 7.3 points | 4.4 points | none |
| hermes-haiku-gbrain-installer-mu-v03-dev | 40 | 200 | 7.7 points | n/a | none |

## C4 mechanism count: detectable difference at 16 tasks by 5 repetitions (labelled a projection)

Under the null the live cell's per-task rate stands for both arms. The none cells count 0 by construction, so the observed difference is the live cell's rate. A cell reaches a detectable difference when that rate is at least the MDD.

| Live cell | Held-out tasks | Trials | Observed rate (needed fact returned) | MDD | Reaches it |
|---|---|---|---|---|---|

## Cost per trial and per success (proxy-priced, task-clustered 95% interval)

A group with no pass has no cost per success (n/a). A bootstrap draw with no pass counts as unbounded, so an upper end can be unbounded; the last column counts those draws.

| Cell | Family | Trials | USD per trial [interval] | USD total | USD per success [interval] | Draws with no pass |
|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | all | 100 | $0.0085 [$0.0061, $0.0116] | $0.8490 | $0.0189 [$0.0102, $0.0412] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-dev | approval_relay | 15 | $0.0211 [$0.0153, $0.0286] | $0.3163 | n/a | 10000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | continuity | 20 | $0.0036 [$0.0022, $0.0058] | $0.0726 | $0.0045 [$0.0022, $0.0106] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-dev | corrections | 20 | $0.0069 [$0.0051, $0.0096] | $0.1382 | $0.1382 [$0.0410, unbounded] | 3094 |
| openclaw-haiku-gbrain-told-mu-v03-dev | scope_isolation | 20 | $0.0067 [$0.0059, $0.0073] | $0.1349 | $0.0112 [$0.0062, $0.0366] | 44 |
| openclaw-haiku-gbrain-told-mu-v03-dev | shared_channel | 10 | $0.0067 [$0.0058, $0.0076] | $0.0671 | $0.0112 [$0.0058, $0.0379] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-dev | synthesis | 15 | $0.0080 [$0.0056, $0.0123] | $0.1199 | $0.0120 [$0.0056, unbounded] | 335 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | all | 100 | $0.0110 [$0.0087, $0.0138] | $1.1011 | $0.0290 [$0.0171, $0.0599] | 0 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | approval_relay | 15 | $0.0223 [$0.0191, $0.0278] | $0.3349 | n/a | 10000 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | continuity | 20 | $0.0081 [$0.0052, $0.0117] | $0.1612 | $0.0230 [$0.0081, unbounded] | 620 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | corrections | 20 | $0.0090 [$0.0066, $0.0121] | $0.1793 | $0.0598 [$0.0158, unbounded] | 3107 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | scope_isolation | 20 | $0.0103 [$0.0093, $0.0114] | $0.2070 | $0.0129 [$0.0103, $0.0163] | 0 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | shared_channel | 10 | $0.0091 [$0.0069, $0.0114] | $0.0912 | $0.0182 [$0.0086, $0.0569] | 0 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | synthesis | 15 | $0.0085 [$0.0052, $0.0145] | $0.1274 | $0.0182 [$0.0066, unbounded] | 335 |
| hermes-haiku-gbrain-told-mu-v03-dev | all | 100 | $0.0092 [$0.0073, $0.0115] | $0.9196 | $0.0188 [$0.0111, $0.0358] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | approval_relay | 15 | $0.0192 [$0.0167, $0.0214] | $0.2879 | n/a | 10000 |
| hermes-haiku-gbrain-told-mu-v03-dev | continuity | 20 | $0.0049 [$0.0037, $0.0069] | $0.0979 | $0.0049 [$0.0037, $0.0069] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | corrections | 20 | $0.0082 [$0.0064, $0.0117] | $0.1650 | n/a | 10000 |
| hermes-haiku-gbrain-told-mu-v03-dev | scope_isolation | 20 | $0.0083 [$0.0075, $0.0089] | $0.1650 | $0.0150 [$0.0089, $0.0288] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | shared_channel | 10 | $0.0078 [$0.0067, $0.0090] | $0.0785 | $0.0098 [$0.0067, $0.0150] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | synthesis | 15 | $0.0084 [$0.0055, $0.0110] | $0.1253 | $0.0125 [$0.0055, $0.0274] | 0 |
| hermes-haiku-gbrain-installer-mu-v03-dev | all | 100 | $0.0114 [$0.0095, $0.0136] | $1.1394 | $0.0215 [$0.0137, $0.0381] | 0 |
| hermes-haiku-gbrain-installer-mu-v03-dev | approval_relay | 15 | $0.0204 [$0.0182, $0.0242] | $0.3067 | n/a | 10000 |
| hermes-haiku-gbrain-installer-mu-v03-dev | continuity | 20 | $0.0085 [$0.0059, $0.0116] | $0.1693 | $0.0094 [$0.0059, $0.0165] | 0 |
| hermes-haiku-gbrain-installer-mu-v03-dev | corrections | 20 | $0.0104 [$0.0084, $0.0135] | $0.2087 | $0.0417 [$0.0119, unbounded] | 3107 |
| hermes-haiku-gbrain-installer-mu-v03-dev | scope_isolation | 20 | $0.0115 [$0.0110, $0.0124] | $0.2305 | $0.0177 [$0.0127, $0.0245] | 0 |
| hermes-haiku-gbrain-installer-mu-v03-dev | shared_channel | 10 | $0.0093 [$0.0064, $0.0121] | $0.0927 | $0.0155 [$0.0064, $0.0606] | 0 |
| hermes-haiku-gbrain-installer-mu-v03-dev | synthesis | 15 | $0.0088 [$0.0060, $0.0119] | $0.1315 | $0.0120 [$0.0060, $0.0298] | 0 |

## Opening 1 trial spend at this pilot's cost per trial (before per-shard reservations)

Cell upper end: the cell's own task-clustered cost interval at the held-out allocation, as preregistered. Family upper ends: the sum of each family's upper end, more conservative than preregistered.

| Cell | Held-out trials | USD | USD at the cell's upper end | USD at the family upper ends |
|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | 200 | $1.6978 | $1.9535 | $2.2924 |
| openclaw-haiku-gbrain-installer-mu-v03-dev | 200 | $2.1960 | $2.4780 | $2.9058 |
| hermes-haiku-gbrain-told-mu-v03-dev | 200 | $1.8372 | $2.0180 | $2.2520 |
| hermes-haiku-gbrain-installer-mu-v03-dev | 200 | $2.2675 | $2.4920 | $2.8221 |
| openclaw-haiku-gbrain-installer (stand-in) | 200 | $2.1978 | $2.4535 | $2.7924 |
| hermes-haiku-gbrain-installer (stand-in) | 200 | $2.3172 | $2.4980 | $2.7320 |
| **Total** | 1200 | $12.5135 | $13.8931 | $15.7967 |

## Opening 1 against its $30 cap, with one per-call reservation per shard (16 shards)

Reservations read from the counted shard ledgers (4740 entries): median $0.0737, 90th percentile $0.3966, largest $0.4639. A reservation is a hold for one call in flight, not spend.

| Total | USD | Fits $30 |
|---|---|---|
| Point trial spend + median reservation | $13.6924 | yes ($16.3076 under) |
| Point trial spend + 90th-percentile reservation | $18.8584 | yes ($11.1416 under) |
| Point trial spend + largest reservation | $19.9359 | yes ($10.0641 under) |
| Cell upper ends + median reservation | $15.0719 | yes ($14.9281 under) |
| Family upper ends + median reservation | $16.9756 | yes ($13.0244 under) |

Ways to fit at the largest reservation, for the opening's preregistration to choose from: the same cells at 4 repetitions (960 trials, $17.4332), or at most 2165 held-out trials at this pilot's mean cost per opening-1 trial ($0.0104).

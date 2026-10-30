# v03-pilot-2026-10 tables (scripts/v03/pilot-tables.ts)

## Go rule: told arm, pooled over the OpenClaw and Hermes told cells

| Family | Passes / trials | Rate [task-clustered 95% interval] | Informative (10 to 90 percent) |
|---|---|---|---|
| scope_isolation | 23 / 40 | 57.5% [30.0%, 87.5%] | yes |
| shared_channel | 13 / 20 | 65.0% [30.0%, 100.0%] | yes |
| synthesis | 18 / 30 | 60.0% [40.0%, 100.0%] | yes |
| continuity | 35 / 40 | 87.5% [75.0%, 97.5%] | yes |
| corrections | 0 / 40 | 0.0% [0.0%, 0.0%] | no |
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
| openclaw-haiku-gbrain-told-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 0.60 | 0.240 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 0.80 | 0.160 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 0.60 | 0.240 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 0.80 | 0.160 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 0.40 | 0.240 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.80 | 0.160 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.80 | 0.160 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.60 | 0.240 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.40 | 0.240 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | sc-01-central-random-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | sc-02-north-team-two-asks | shared_channel | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | si-01-marrow-agrisupply-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | si-02-tansley-parcel-site | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | si-03-quarrendon-seat-count | scope_isolation | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | si-04-marrow-fieldworks-ticket | scope_isolation | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | sy-01-quarrendon-ticket-numbers | synthesis | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | sy-02-marrow-agrisupply-sites | synthesis | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | sy-03-marrow-fieldworks-ticket-numbers | synthesis | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-none-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.60 | 0.240 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.40 | 0.240 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.80 | 0.160 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cn-01-tamsin-cold-chain-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.00 | 0.000 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cn-02-tansleigh-packaging-deadline | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.20 | 0.160 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cn-03-marrow-agrisupply-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.20 | 0.160 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cn-04-quarrendon-site | continuity | 5/5 | 1.00 [57%, 100%] | 1 | 1 | 0.000 | 0.20 | 0.160 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cr-01-marrow-agrisupply-site-retraction | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cr-02-quarrendon-seat-count-retraction | corrections | 2/5 | 0.40 [12%, 77%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cr-03-brackenwater-renewal-date-retraction | corrections | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | cr-04-marrow-agrisupply-seat-count | corrections | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |

## Pooled per family

Interval: task-clustered bootstrap within the cell.

| Cell | Family | Tasks | Passes / trials [interval] | Mean p | Mean p(1-p) | Mean use(1-use) |
|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | continuity | 4 | 17 / 20 [70%, 100%] | 0.85 | 0.100 | 0.060 |
| openclaw-haiku-gbrain-told-mu-v03-dev | corrections | 4 | 0 / 20 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | scope_isolation | 4 | 10 / 20 [15%, 85%] | 0.50 | 0.120 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | shared_channel | 2 | 6 / 10 [20%, 100%] | 0.60 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | synthesis | 3 | 11 / 15 [40%, 100%] | 0.73 | 0.133 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | continuity | 4 | 16 / 20 [40%, 100%] | 0.80 | 0.040 | 0.040 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | corrections | 4 | 0 / 20 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | scope_isolation | 4 | 1 / 20 [0%, 15%] | 0.05 | 0.040 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | shared_channel | 2 | 0 / 10 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | synthesis | 3 | 3 / 15 [0%, 60%] | 0.20 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | continuity | 4 | 18 / 20 [80%, 100%] | 0.90 | 0.080 | 0.060 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | scope_isolation | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | shared_channel | 2 | 10 / 10 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | synthesis | 3 | 12 / 15 [40%, 100%] | 0.80 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | continuity | 4 | 17 / 20 [55%, 100%] | 0.85 | 0.060 | 0.040 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 60%] | 0.25 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | scope_isolation | 4 | 15 / 20 [40%, 100%] | 0.75 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | shared_channel | 2 | 9 / 10 [80%, 100%] | 0.90 | 0.080 | 0.000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | synthesis | 3 | 9 / 15 [40%, 100%] | 0.60 | 0.160 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | continuity | 4 | 18 / 20 [80%, 100%] | 0.90 | 0.080 | 0.060 |
| hermes-haiku-gbrain-told-mu-v03-dev | corrections | 4 | 0 / 20 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | scope_isolation | 4 | 13 / 20 [45%, 90%] | 0.65 | 0.180 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | shared_channel | 2 | 7 / 10 [40%, 100%] | 0.70 | 0.120 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-dev | synthesis | 3 | 7 / 15 [0%, 100%] | 0.47 | 0.080 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | continuity | 4 | 16 / 20 [55%, 100%] | 0.80 | 0.100 | 0.040 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | corrections | 4 | 2 / 20 [0%, 30%] | 0.10 | 0.060 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | scope_isolation | 4 | 3 / 20 [0%, 30%] | 0.15 | 0.100 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | shared_channel | 2 | 0 / 10 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | synthesis | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | continuity | 4 | 19 / 20 [85%, 100%] | 0.95 | 0.040 | 0.040 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | scope_isolation | 4 | 19 / 20 [85%, 100%] | 0.95 | 0.040 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | shared_channel | 2 | 10 / 10 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | synthesis | 3 | 8 / 15 [0%, 100%] | 0.53 | 0.080 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.120 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | scope_isolation | 4 | 19 / 20 [85%, 100%] | 0.95 | 0.040 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | shared_channel | 2 | 10 / 10 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | synthesis | 3 | 9 / 15 [0%, 100%] | 0.60 | 0.053 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | continuity | 4 | 18 / 20 [70%, 100%] | 0.90 | 0.060 | 0.000 |
| openclaw-haiku-none-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | corrections | 4 | 15 / 20 [50%, 95%] | 0.75 | 0.140 | 0.000 |
| hermes-haiku-none-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| hermes-haiku-none-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.160 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | corrections | 4 | 16 / 20 [65%, 95%] | 0.80 | 0.140 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.000 |
| qm-pi-haiku-none-mu-v03-dev | corrections | 4 | 5 / 20 [0%, 75%] | 0.25 | 0.000 | 0.000 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | continuity | 4 | 20 / 20 [100%, 100%] | 1.00 | 0.000 | 0.120 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | corrections | 4 | 13 / 20 [50%, 80%] | 0.65 | 0.200 | 0.000 |

## Opening 1 projection (labelled a projection): minimum detectable paired difference at the held-out allocation, 5 repetitions

| Cell | Held-out tasks | Trials | MDD, pass | MDD, gbrain use | Families with no dev rate |
|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | 40 | 200 | 7.6 points | 3.1 points | none |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | 40 | 200 | 4.7 points | 2.5 points | none |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | 40 | 200 | 4.7 points | 3.1 points | none |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | 40 | 200 | 7.8 points | 2.5 points | none |
| hermes-haiku-gbrain-told-mu-v03-dev | 40 | 200 | 7.7 points | 3.1 points | none |
| hermes-haiku-gbrain-told-company-mu-v03-dev | 40 | 200 | 6.3 points | 2.5 points | none |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | 40 | 200 | 4.7 points | 2.5 points | none |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | 40 | 200 | 3.5 points | 4.4 points | none |
| openclaw-haiku-none-mu-v03-dev | 16 | 80 | 7.9 points | n/a | none |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | 16 | 80 | 12.1 points | n/a | none |
| hermes-haiku-none-mu-v03-dev | 16 | 80 | n/a | n/a | none |
| hermes-haiku-gbrain-told-live-mu-v03-dev | 16 | 80 | 12.1 points | 12.9 points | none |
| qm-pi-haiku-none-mu-v03-dev | 16 | 80 | n/a | n/a | none |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | 16 | 80 | 14.5 points | 11.2 points | none |

## C4 mechanism count: detectable difference at 16 tasks by 5 repetitions (labelled a projection)

Under the null the live cell's per-task rate stands for both arms. The none cells count 0 by construction, so the observed difference is the live cell's rate. A cell reaches a detectable difference when that rate is at least the MDD.

| Live cell | Held-out tasks | Trials | Observed rate (needed fact returned) | MDD | Reaches it |
|---|---|---|---|---|---|
| hermes-haiku-gbrain-told-live-mu-v03-dev | 16 | 80 | 75.0% | 12.9 points | yes |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | 16 | 80 | 95.0% | 9.1 points | yes |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | 16 | 80 | 55.0% | 9.1 points | yes |

## Cost per trial and per success (proxy-priced, task-clustered 95% interval)

A group with no pass has no cost per success (n/a). A bootstrap draw with no pass counts as unbounded, so an upper end can be unbounded; the last column counts those draws.

| Cell | Family | Trials | USD per trial [interval] | USD total | USD per success [interval] | Draws with no pass |
|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | all | 100 | $0.0084 [$0.0062, $0.0113] | $0.8412 | $0.0191 [$0.0105, $0.0401] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-dev | approval_relay | 15 | $0.0203 [$0.0161, $0.0282] | $0.3044 | n/a | 10000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | continuity | 20 | $0.0038 [$0.0023, $0.0057] | $0.0759 | $0.0045 [$0.0024, $0.0081] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-dev | corrections | 20 | $0.0074 [$0.0057, $0.0101] | $0.1477 | n/a | 10000 |
| openclaw-haiku-gbrain-told-mu-v03-dev | scope_isolation | 20 | $0.0068 [$0.0058, $0.0077] | $0.1352 | $0.0135 [$0.0072, $0.0428] | 44 |
| openclaw-haiku-gbrain-told-mu-v03-dev | shared_channel | 10 | $0.0062 [$0.0047, $0.0077] | $0.0619 | $0.0103 [$0.0047, $0.0384] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-dev | synthesis | 15 | $0.0077 [$0.0055, $0.0108] | $0.1160 | $0.0105 [$0.0055, $0.0271] | 0 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | all | 100 | $0.0093 [$0.0067, $0.0126] | $0.9267 | $0.0463 [$0.0200, $0.1934] | 4 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | approval_relay | 15 | $0.0226 [$0.0165, $0.0316] | $0.3396 | n/a | 10000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | continuity | 20 | $0.0035 [$0.0023, $0.0054] | $0.0707 | $0.0044 [$0.0023, $0.0134] | 0 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | corrections | 20 | $0.0074 [$0.0056, $0.0094] | $0.1478 | n/a | 10000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | scope_isolation | 20 | $0.0078 [$0.0056, $0.0107] | $0.1560 | $0.1560 [$0.0503, unbounded] | 3290 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | shared_channel | 10 | $0.0069 [$0.0068, $0.0070] | $0.0693 | n/a | 10000 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | synthesis | 15 | $0.0096 [$0.0073, $0.0130] | $0.1433 | $0.0478 [$0.0139, unbounded] | 2909 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | all | 100 | $0.0097 [$0.0070, $0.0129] | $0.9660 | $0.0149 [$0.0089, $0.0269] | 0 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | approval_relay | 15 | $0.0228 [$0.0175, $0.0286] | $0.3419 | n/a | 10000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | continuity | 20 | $0.0038 [$0.0026, $0.0058] | $0.0752 | $0.0042 [$0.0028, $0.0061] | 0 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | corrections | 20 | $0.0072 [$0.0055, $0.0099] | $0.1442 | $0.0288 [$0.0084, unbounded] | 3107 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | scope_isolation | 20 | $0.0073 [$0.0055, $0.0095] | $0.1466 | $0.0073 [$0.0055, $0.0095] | 0 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | shared_channel | 10 | $0.0082 [$0.0081, $0.0083] | $0.0822 | $0.0082 [$0.0081, $0.0083] | 0 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | synthesis | 15 | $0.0117 [$0.0074, $0.0192] | $0.1760 | $0.0147 [$0.0074, $0.0479] | 0 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | all | 100 | $0.0084 [$0.0062, $0.0111] | $0.8355 | $0.0152 [$0.0090, $0.0283] | 0 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | approval_relay | 15 | $0.0186 [$0.0116, $0.0262] | $0.2795 | n/a | 10000 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | continuity | 20 | $0.0030 [$0.0017, $0.0049] | $0.0609 | $0.0036 [$0.0017, $0.0089] | 0 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | corrections | 20 | $0.0068 [$0.0055, $0.0090] | $0.1368 | $0.0274 [$0.0099, unbounded] | 620 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | scope_isolation | 20 | $0.0078 [$0.0062, $0.0091] | $0.1563 | $0.0104 [$0.0066, $0.0208] | 0 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | shared_channel | 10 | $0.0077 [$0.0077, $0.0078] | $0.0773 | $0.0086 [$0.0078, $0.0096] | 0 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | synthesis | 15 | $0.0083 [$0.0053, $0.0122] | $0.1248 | $0.0139 [$0.0053, $0.0306] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | all | 100 | $0.0096 [$0.0077, $0.0118] | $0.9566 | $0.0213 [$0.0126, $0.0416] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | approval_relay | 15 | $0.0175 [$0.0141, $0.0230] | $0.2631 | n/a | 10000 |
| hermes-haiku-gbrain-told-mu-v03-dev | continuity | 20 | $0.0049 [$0.0037, $0.0069] | $0.0989 | $0.0055 [$0.0040, $0.0083] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | corrections | 20 | $0.0086 [$0.0066, $0.0114] | $0.1711 | n/a | 10000 |
| hermes-haiku-gbrain-told-mu-v03-dev | scope_isolation | 20 | $0.0088 [$0.0081, $0.0096] | $0.1761 | $0.0135 [$0.0093, $0.0191] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | shared_channel | 10 | $0.0076 [$0.0060, $0.0092] | $0.0758 | $0.0108 [$0.0060, $0.0230] | 0 |
| hermes-haiku-gbrain-told-mu-v03-dev | synthesis | 15 | $0.0114 [$0.0062, $0.0159] | $0.1715 | $0.0245 [$0.0062, unbounded] | 358 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | all | 100 | $0.0111 [$0.0091, $0.0136] | $1.1113 | $0.0529 [$0.0260, $0.1709] | 2 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | approval_relay | 15 | $0.0203 [$0.0163, $0.0257] | $0.3051 | n/a | 10000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | continuity | 20 | $0.0063 [$0.0045, $0.0082] | $0.1265 | $0.0079 [$0.0045, $0.0154] | 0 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | corrections | 20 | $0.0100 [$0.0079, $0.0123] | $0.2007 | $0.1004 [$0.0263, unbounded] | 3107 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | scope_isolation | 20 | $0.0093 [$0.0075, $0.0116] | $0.1854 | $0.0618 [$0.0248, unbounded] | 635 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | shared_channel | 10 | $0.0093 [$0.0092, $0.0094] | $0.0932 | n/a | 10000 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | synthesis | 15 | $0.0134 [$0.0083, $0.0163] | $0.2003 | n/a | 10000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | all | 100 | $0.0117 [$0.0094, $0.0142] | $1.1701 | $0.0192 [$0.0122, $0.0337] | 0 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | approval_relay | 15 | $0.0187 [$0.0163, $0.0232] | $0.2811 | n/a | 10000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | continuity | 20 | $0.0059 [$0.0046, $0.0083] | $0.1186 | $0.0062 [$0.0049, $0.0083] | 0 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | corrections | 20 | $0.0105 [$0.0079, $0.0146] | $0.2110 | $0.0422 [$0.0105, unbounded] | 3107 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | scope_isolation | 20 | $0.0097 [$0.0084, $0.0111] | $0.1948 | $0.0103 [$0.0084, $0.0123] | 0 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | shared_channel | 10 | $0.0091 [$0.0087, $0.0095] | $0.0913 | $0.0091 [$0.0087, $0.0095] | 0 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | synthesis | 15 | $0.0182 [$0.0118, $0.0229] | $0.2734 | $0.0342 [$0.0118, unbounded] | 335 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | all | 100 | $0.0088 [$0.0070, $0.0109] | $0.8784 | $0.0139 [$0.0088, $0.0251] | 0 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | approval_relay | 15 | $0.0178 [$0.0148, $0.0221] | $0.2669 | n/a | 10000 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | continuity | 20 | $0.0049 [$0.0039, $0.0065] | $0.0985 | $0.0049 [$0.0039, $0.0065] | 0 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | corrections | 20 | $0.0078 [$0.0062, $0.0105] | $0.1554 | $0.0311 [$0.0083, unbounded] | 3107 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | scope_isolation | 20 | $0.0076 [$0.0070, $0.0083] | $0.1520 | $0.0080 [$0.0070, $0.0097] | 0 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | shared_channel | 10 | $0.0078 [$0.0069, $0.0088] | $0.0782 | $0.0078 [$0.0069, $0.0088] | 0 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | synthesis | 15 | $0.0085 [$0.0062, $0.0119] | $0.1273 | $0.0141 [$0.0062, unbounded] | 335 |
| openclaw-haiku-none-mu-v03-dev | all | 40 | $0.0037 [$0.0025, $0.0054] | $0.1500 | $0.0065 [$0.0032, $0.0179] | 1 |
| openclaw-haiku-none-mu-v03-dev | continuity | 20 | $0.0032 [$0.0022, $0.0044] | $0.0636 | $0.0035 [$0.0022, $0.0063] | 0 |
| openclaw-haiku-none-mu-v03-dev | corrections | 20 | $0.0043 [$0.0023, $0.0076] | $0.0864 | $0.0173 [$0.0040, unbounded] | 3107 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | all | 40 | $0.0060 [$0.0039, $0.0085] | $0.2418 | $0.0069 [$0.0040, $0.0107] | 0 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | continuity | 20 | $0.0042 [$0.0028, $0.0058] | $0.0830 | $0.0042 [$0.0028, $0.0058] | 0 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | corrections | 20 | $0.0079 [$0.0042, $0.0119] | $0.1588 | $0.0106 [$0.0047, $0.0172] | 0 |
| hermes-haiku-none-mu-v03-dev | all | 40 | $0.0047 [$0.0037, $0.0061] | $0.1896 | $0.0076 [$0.0042, $0.0200] | 1 |
| hermes-haiku-none-mu-v03-dev | continuity | 20 | $0.0039 [$0.0029, $0.0050] | $0.0787 | $0.0039 [$0.0029, $0.0050] | 0 |
| hermes-haiku-none-mu-v03-dev | corrections | 20 | $0.0055 [$0.0043, $0.0078] | $0.1109 | $0.0222 [$0.0060, unbounded] | 3107 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | all | 40 | $0.0079 [$0.0055, $0.0106] | $0.3158 | $0.0088 [$0.0056, $0.0127] | 0 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | continuity | 20 | $0.0058 [$0.0043, $0.0084] | $0.1166 | $0.0058 [$0.0043, $0.0084] | 0 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | corrections | 20 | $0.0100 [$0.0065, $0.0142] | $0.1993 | $0.0125 [$0.0072, $0.0182] | 0 |
| qm-pi-haiku-none-mu-v03-dev | all | 40 | $0.0034 [$0.0028, $0.0041] | $0.1365 | $0.0055 [$0.0031, $0.0145] | 1 |
| qm-pi-haiku-none-mu-v03-dev | continuity | 20 | $0.0030 [$0.0021, $0.0038] | $0.0594 | $0.0030 [$0.0021, $0.0038] | 0 |
| qm-pi-haiku-none-mu-v03-dev | corrections | 20 | $0.0039 [$0.0031, $0.0050] | $0.0771 | $0.0154 [$0.0042, unbounded] | 3107 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | all | 40 | $0.0052 [$0.0038, $0.0066] | $0.2071 | $0.0063 [$0.0040, $0.0095] | 0 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | continuity | 20 | $0.0035 [$0.0025, $0.0045] | $0.0696 | $0.0035 [$0.0025, $0.0045] | 0 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | corrections | 20 | $0.0069 [$0.0058, $0.0083] | $0.1375 | $0.0106 [$0.0075, $0.0155] | 0 |

## Opening 1 trial spend at this pilot's cost per trial (before per-shard reservations)

Cell upper end: the cell's own task-clustered cost interval at the held-out allocation, as preregistered. Family upper ends: the sum of each family's upper end, more conservative than preregistered.

| Cell | Held-out trials | USD | USD at the cell's upper end | USD at the family upper ends |
|---|---|---|---|---|
| openclaw-haiku-gbrain-told-mu-v03-dev | 200 | $1.6796 | $1.9266 | $2.2634 |
| openclaw-haiku-gbrain-told-company-mu-v03-dev | 200 | $1.8491 | $2.1227 | $2.4761 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-dev | 200 | $1.9365 | $2.2105 | $2.6003 |
| openclaw-haiku-gbrain-verbs-told-mu-v03-dev | 200 | $1.6706 | $1.9179 | $2.2218 |
| hermes-haiku-gbrain-told-mu-v03-dev | 200 | $1.9070 | $2.1465 | $2.4636 |
| hermes-haiku-gbrain-told-company-mu-v03-dev | 200 | $2.2228 | $2.4532 | $2.7235 |
| hermes-haiku-gbrain-told-scoped-mu-v03-dev | 200 | $2.3372 | $2.5987 | $2.9250 |
| hermes-haiku-gbrain-verbs-told-mu-v03-dev | 200 | $1.7579 | $1.9417 | $2.2105 |
| openclaw-haiku-none-mu-v03-dev | 80 | $0.2999 | $0.4307 | $0.4798 |
| openclaw-haiku-gbrain-told-live-mu-v03-dev | 80 | $0.4837 | $0.6430 | $0.7083 |
| hermes-haiku-none-mu-v03-dev | 80 | $0.3792 | $0.4756 | $0.5118 |
| hermes-haiku-gbrain-told-live-mu-v03-dev | 80 | $0.6317 | $0.8069 | $0.9021 |
| qm-pi-haiku-none-mu-v03-dev | 80 | $0.2731 | $0.3238 | $0.3509 |
| qm-pi-haiku-gbrain-told-live-mu-v03-dev | 80 | $0.4143 | $0.4755 | $0.5094 |
| openclaw-haiku-gbrain-installer (stand-in) | 200 | $2.1796 | $2.4266 | $2.7634 |
| hermes-haiku-gbrain-installer (stand-in) | 200 | $2.3870 | $2.6265 | $2.9436 |
| **Total** | 2480 | $22.4092 | $25.5264 | $29.0534 |

## Opening 1 against its $30 cap, with one per-call reservation per shard (16 shards)

Reservations read from the counted shard ledgers (11282 entries): median $0.0726, 90th percentile $0.3988, largest $0.5098. A reservation is a hold for one call in flight, not spend.

| Total | USD | Fits $30 |
|---|---|---|
| Point trial spend + median reservation | $23.5714 | yes ($6.4286 under) |
| Point trial spend + 90th-percentile reservation | $28.7908 | yes ($1.2092 under) |
| Point trial spend + largest reservation | $30.5657 | no ($0.5657 over) |
| Cell upper ends + median reservation | $26.6885 | yes ($3.3115 under) |
| Family upper ends + median reservation | $30.2155 | no ($0.2155 over) |

Ways to fit at the largest reservation, for the opening's preregistration to choose from: the same cells at 4 repetitions (1984 trials, $26.0838), or at most 2417 held-out trials at this pilot's mean cost per opening-1 trial ($0.0090).

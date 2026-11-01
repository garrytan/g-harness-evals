# Go-rule tables for the cells --told names (scripts/v03/pilot-tables.ts)

## Go rule: told arm, pooled over openclaw-haiku-gbrain-told-scoped-mu-v03-ar, hermes-haiku-gbrain-told-scoped-mu-v03-ar

| Family | Passes / trials | Rate [task-clustered 95% interval] | Informative (10 to 90 percent) |
|---|---|---|---|
| scope_isolation | 0 / 0 | 0.0% [0.0%, 0.0%] | no |
| shared_channel | 0 / 0 | 0.0% [0.0%, 0.0%] | no |
| synthesis | 0 / 0 | 0.0% [0.0%, 0.0%] | no |
| continuity | 0 / 0 | 0.0% [0.0%, 0.0%] | no |
| corrections | 0 / 0 | 0.0% [0.0%, 0.0%] | no |
| approval_relay | 17 / 30 | 56.7% [40.0%, 80.0%] | yes |

## Per-task variance across repetitions

Interval: Wilson 95% over the task's repetitions. pass^5: every repetition passed. pass@5: at least one did.

| Cell | Task | Family | Passes of reps | p [interval] | pass^5 | pass@5 | p(1-p) | gbrain use | use(1-use) |
|---|---|---|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | ar-01-thornbury-rate-hollis | approval_relay | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | ar-02-quarrendon-rate-hollis | approval_relay | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | ar-03-tansley-parcel-rate-tobias | approval_relay | 1/5 | 0.20 [4%, 62%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | ar-01-thornbury-rate-hollis | approval_relay | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | ar-02-quarrendon-rate-hollis | approval_relay | 4/5 | 0.80 [38%, 96%] | 0 | 1 | 0.160 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | ar-03-tansley-parcel-rate-tobias | approval_relay | 3/5 | 0.60 [23%, 88%] | 0 | 1 | 0.240 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-ar | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-ar | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-ar | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-ar | ar-01-thornbury-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-ar | ar-02-quarrendon-rate-hollis | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-ar | ar-03-tansley-parcel-rate-tobias | approval_relay | 0/5 | 0.00 [0%, 43%] | 0 | 0 | 0.000 | 1.00 | 0.000 |

## Pooled per family

Interval: task-clustered bootstrap within the cell.

| Cell | Family | Tasks | Passes / trials [interval] | Mean p | Mean p(1-p) | Mean use(1-use) |
|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | approval_relay | 3 | 6 / 15 [20%, 80%] | 0.40 | 0.160 | 0.000 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | approval_relay | 3 | 11 / 15 [60%, 80%] | 0.73 | 0.187 | 0.000 |
| openclaw-haiku-gbrain-told-mu-v03-ar | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |
| hermes-haiku-gbrain-told-mu-v03-ar | approval_relay | 3 | 0 / 15 [0%, 0%] | 0.00 | 0.000 | 0.000 |

## Opening 1 projection (labelled a projection): minimum detectable paired difference at the held-out allocation, 5 repetitions

| Cell | Held-out tasks | Trials | MDD, pass | MDD, gbrain use | Families with no dev rate |
|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | 40 | 200 | 4.4 points | n/a | scope_isolation, shared_channel, synthesis, continuity, corrections |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | 40 | 200 | 4.7 points | n/a | scope_isolation, shared_channel, synthesis, continuity, corrections |
| openclaw-haiku-gbrain-told-mu-v03-ar | 40 | 200 | n/a | n/a | scope_isolation, shared_channel, synthesis, continuity, corrections |
| hermes-haiku-gbrain-told-mu-v03-ar | 40 | 200 | n/a | n/a | scope_isolation, shared_channel, synthesis, continuity, corrections |

## C4 mechanism count: detectable difference at 16 tasks by 5 repetitions (labelled a projection)

Under the null the live cell's per-task rate stands for both arms. The none cells count 0 by construction, so the observed difference is the live cell's rate. A cell reaches a detectable difference when that rate is at least the MDD.

| Live cell | Held-out tasks | Trials | Observed rate (needed fact returned) | MDD | Reaches it |
|---|---|---|---|---|---|

## Cost per trial and per success (proxy-priced, task-clustered 95% interval)

A group with no pass has no cost per success (n/a). A bootstrap draw with no pass counts as unbounded, so an upper end can be unbounded; the last column counts those draws.

| Cell | Family | Trials | USD per trial [interval] | USD total | USD per success [interval] | Draws with no pass |
|---|---|---|---|---|---|---|
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | all | 15 | $0.0234 [$0.0184, $0.0322] | $0.3509 | $0.0585 [$0.0230, $0.1612] | 0 |
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | approval_relay | 15 | $0.0234 [$0.0184, $0.0322] | $0.3509 | $0.0585 [$0.0230, $0.1612] | 0 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | all | 15 | $0.0239 [$0.0209, $0.0291] | $0.3587 | $0.0326 [$0.0262, $0.0484] | 0 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | approval_relay | 15 | $0.0239 [$0.0209, $0.0291] | $0.3587 | $0.0326 [$0.0262, $0.0484] | 0 |
| openclaw-haiku-gbrain-told-mu-v03-ar | all | 15 | $0.0200 [$0.0155, $0.0278] | $0.3004 | n/a | 10000 |
| openclaw-haiku-gbrain-told-mu-v03-ar | approval_relay | 15 | $0.0200 [$0.0155, $0.0278] | $0.3004 | n/a | 10000 |
| hermes-haiku-gbrain-told-mu-v03-ar | all | 15 | $0.0197 [$0.0154, $0.0246] | $0.2960 | n/a | 10000 |
| hermes-haiku-gbrain-told-mu-v03-ar | approval_relay | 15 | $0.0197 [$0.0154, $0.0246] | $0.2960 | n/a | 10000 |

## Opening 1 trial spend at this pilot's cost per trial (before per-shard reservations)

Cell upper end: the cell's own task-clustered cost interval at the held-out allocation, as preregistered. Family upper ends: the sum of each family's upper end, more conservative than preregistered.

| Cell | Held-out trials | USD | USD at the cell's upper end | USD at the family upper ends |
|---|---|---|---|---|
| openclaw-haiku-gbrain-told-scoped-mu-v03-ar | 30 | $0.7018 | $0.9675 | $0.9675 |
| hermes-haiku-gbrain-told-scoped-mu-v03-ar | 30 | $0.7174 | $0.8717 | $0.8717 |
| openclaw-haiku-gbrain-told-mu-v03-ar | 30 | $0.6009 | $0.8330 | $0.8330 |
| hermes-haiku-gbrain-told-mu-v03-ar | 30 | $0.5920 | $0.7383 | $0.7383 |
| openclaw-haiku-gbrain-installer (stand-in) | 0 | $0.0000 | $0.0000 | $0.0000 |
| hermes-haiku-gbrain-installer (stand-in) | 0 | $0.0000 | $0.0000 | $0.0000 |
| **Total** | 120 | $2.6121 | $3.4105 | $3.4105 |

## Opening 1 against its $30 cap, with one per-call reservation per shard (16 shards)

Reservations read from the counted shard ledgers (1370 entries): median $0.3827, 90th percentile $0.4062, largest $0.4535. A reservation is a hold for one call in flight, not spend.

| Total | USD | Fits $30 |
|---|---|---|
| Point trial spend + median reservation | $8.7356 | yes ($21.2644 under) |
| Point trial spend + 90th-percentile reservation | $9.1110 | yes ($20.8890 under) |
| Point trial spend + largest reservation | $9.8679 | yes ($20.1321 under) |
| Cell upper ends + median reservation | $9.5340 | yes ($20.4660 under) |
| Family upper ends + median reservation | $9.5340 | yes ($20.4660 under) |

Ways to fit at the largest reservation, for the opening's preregistration to choose from: the same cells at 4 repetitions (96 trials, $9.3455), or at most 1044 held-out trials at this pilot's mean cost per opening-1 trial ($0.0218).

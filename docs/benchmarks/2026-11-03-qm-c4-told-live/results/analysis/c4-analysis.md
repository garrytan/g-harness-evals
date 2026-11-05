# C4 analysis (preregistered endpoints)

Task-clustered bootstrap 95% intervals, 10000 draws, seed 7. Rates and differences in percentage points.

## Per cell

| Cell | Scored | Pass | Pass interval | Mechanism | Mechanism interval | Pass, provider-only cross-scope set aside | Pass, delivered provider rows only |
|---|---:|---:|---|---:|---|---:|---:|
| `qm-pi-opus-none-mu-v03-dev` | 40 | 25/40 (63) | [25, 100] | 0/40 (0) | [0, 0] | 25/40 [25, 100] | 25/40 [25, 100] |
| `qm-pi-opus-gbrain-memory-provider-mu-v03-dev` | 40 | 18/40 (45) | [13, 78] | 20/40 (50) | [13, 88] | 25/40 [25, 100] | 18/40 [13, 78] |
| `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | 40 | 28/40 (70) | [45, 93] | 28/40 (70) | [43, 93] | 28/40 [45, 93] | 28/40 [45, 93] |
| `qm-pi-sol-none-mu-v03-dev` | 40 | 25/40 (63) | [25, 100] | 0/40 (0) | [0, 0] | 25/40 [25, 100] | 25/40 [25, 100] |
| `qm-pi-sol-gbrain-memory-provider-mu-v03-dev` | 40 | 20/40 (50) | [13, 88] | 20/40 (50) | [13, 88] | 25/40 [25, 100] | 20/40 [13, 88] |
| `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | 40 | 36/40 (90) | [70, 100] | 20/40 (50) | [18, 83] | 36/40 [70, 100] | 36/40 [70, 100] |

## opus: pass, paired (Holm over 3)

| Comparison | Delta | Interval | p (exact sign-flip) | Holm p | Distinguished | Pairs | Tasks | MDE (80% power) |
|---|---:|---|---:|---:|---|---:|---:|---:|
| memory-provider minus none | -17.5 | [-43, 0] | 0.5000 | 1.0000 | no | 40 | 8 | 35.8 |
| memory-provider minus route-tool | -25.0 | [-50, -3] | 0.1250 | 0.3750 | no | 40 | 8 | 36.3 |
| route-tool minus none | 7.5 | [-5, 20] | 0.5000 | 1.0000 | no | 40 | 8 | 18.1 |

## opus: mechanism, paired (Holm over 3)

| Comparison | Delta | Interval | p (exact sign-flip) | Holm p | Distinguished | Pairs | Tasks | MDE (80% power) |
|---|---:|---|---:|---:|---|---:|---:|---:|
| memory-provider minus none | 50.0 | [13, 88] | 0.1250 | 0.2500 | no | 40 | 8 | 52.9 |
| memory-provider minus route-tool | -20.0 | [-50, 8] | 0.4375 | 0.4375 | no | 40 | 8 | 44.9 |
| route-tool minus none | 70.0 | [43, 93] | 0.0156 | 0.0469 | yes | 40 | 8 | 38.2 |

## sol: pass, paired (Holm over 3)

| Comparison | Delta | Interval | p (exact sign-flip) | Holm p | Distinguished | Pairs | Tasks | MDE (80% power) |
|---|---:|---|---:|---:|---|---:|---:|---:|
| memory-provider minus none | -12.5 | [-38, 0] | 1.0000 | 1.0000 | no | 40 | 8 | 35.0 |
| memory-provider minus route-tool | -40.0 | [-75, -13] | 0.1250 | 0.3750 | no | 40 | 8 | 49.7 |
| route-tool minus none | 27.5 | [0, 63] | 0.2500 | 0.5000 | no | 40 | 8 | 44.8 |

## sol: mechanism, paired (Holm over 3)

| Comparison | Delta | Interval | p (exact sign-flip) | Holm p | Distinguished | Pairs | Tasks | MDE (80% power) |
|---|---:|---|---:|---:|---|---:|---:|---:|
| memory-provider minus none | 50.0 | [13, 88] | 0.1250 | 0.2500 | no | 40 | 8 | 52.9 |
| memory-provider minus route-tool | 0.0 | [-57, 60] | 1.0000 | 1.0000 | no | 40 | 8 | 89.2 |
| route-tool minus none | 50.0 | [18, 83] | 0.0625 | 0.1875 | no | 40 | 8 | 48.5 |

## Opus minus Sol (descriptive, not tested)

| Route | Pass delta | Interval | Mechanism delta | Interval |
|---|---:|---|---:|---|
| none | 0.0 | [0, 0] | 0.0 | [0, 0] |
| gbrain-memory-provider | -5.0 | [-15, 0] | 0.0 | [0, 0] |
| gbrain-route-tool | -20.0 | [-43, -3] | 20.0 | [-23, 63] |

## Provider-failure rate (memory-provider DM member turns)

| Cell | DM turns | Failed | No recall event | Dropped | OAuth refused | core.log recall failed (trials) | Empty recalls (not failures) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `qm-pi-opus-gbrain-memory-provider-mu-v03-dev` | 55 | 0 | 0 | 0 | 0 | 0 | 0 |
| `qm-pi-sol-gbrain-memory-provider-mu-v03-dev` | 55 | 0 | 0 | 0 | 0 | 0 | 0 |

## Reconciliation: gbrain tap events by caller

| Cell | All gbrain tap events | caller model | caller provider | oauth.token events |
|---|---:|---:|---:|---:|
| `qm-pi-opus-none-mu-v03-dev` | 0 | 0 | 0 | 0 |
| `qm-pi-opus-gbrain-memory-provider-mu-v03-dev` | 110 | 0 | 110 | 20 |
| `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | 366 | 366 | 0 | 0 |
| `qm-pi-sol-none-mu-v03-dev` | 0 | 0 | 0 | 0 |
| `qm-pi-sol-gbrain-memory-provider-mu-v03-dev` | 110 | 0 | 110 | 20 |
| `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | 226 | 226 | 0 | 0 |

## Secondary (descriptive)

| Cell | USD total | USD/trial (mean) | USD/success | Housekeeping USD (requests) | Input tok/request (median) | Wall s (median) | Model gbrain calls/trial | Recall latency p50/p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `qm-pi-opus-none-mu-v03-dev` | 4.0549 | 0.1014 | 0.1622 | 0.0050 (85) | 8714 | 39.7 | 0.00 [0.00, 0.00] | n/a/n/a |
| `qm-pi-opus-gbrain-memory-provider-mu-v03-dev` | 4.3950 | 0.1099 | 0.2442 | 0.0056 (85) | 9610 | 44.0 | 0.00 [0.00, 0.00] | 42/59 |
| `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | 6.7057 | 0.1676 | 0.2395 | 0.0062 (85) | 14802 | 46.9 | 2.58 [1.55, 3.63] | n/a/n/a |
| `qm-pi-sol-none-mu-v03-dev` | 2.7215 | 0.0680 | 0.1089 | 0.0248 (85) | 6250 | 40.8 | 0.00 [0.00, 0.00] | n/a/n/a |
| `qm-pi-sol-gbrain-memory-provider-mu-v03-dev` | 2.6871 | 0.0672 | 0.1344 | 0.0250 (85) | 6692 | 42.1 | 0.00 [0.00, 0.00] | 39/51 |
| `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | 3.1995 | 0.0800 | 0.0889 | 0.0271 (85) | 6684 | 46.9 | 0.82 [0.30, 1.45] | n/a/n/a |

## Cross-scope read failures by caller

- `qm-pi-opus-none-mu-v03-dev`: 0 trials
- `qm-pi-opus-gbrain-memory-provider-mu-v03-dev`: 7 trials: cn-02-tansleigh-packaging-deadline/r1 {"provider":1}; cn-02-tansleigh-packaging-deadline/r2 {"provider":1}; cn-02-tansleigh-packaging-deadline/r3 {"provider":1}; cn-02-tansleigh-packaging-deadline/r4 {"provider":1}; cn-02-tansleigh-packaging-deadline/r5 {"provider":1}; cn-03-marrow-agrisupply-site/r2 {"provider":1}; cn-03-marrow-agrisupply-site/r5 {"provider":1}
- `qm-pi-opus-gbrain-route-tool-mu-v03-dev`: 0 trials
- `qm-pi-sol-none-mu-v03-dev`: 0 trials
- `qm-pi-sol-gbrain-memory-provider-mu-v03-dev`: 5 trials: cn-02-tansleigh-packaging-deadline/r1 {"provider":1}; cn-02-tansleigh-packaging-deadline/r2 {"provider":1}; cn-02-tansleigh-packaging-deadline/r3 {"provider":1}; cn-02-tansleigh-packaging-deadline/r4 {"provider":1}; cn-02-tansleigh-packaging-deadline/r5 {"provider":1}
- `qm-pi-sol-gbrain-route-tool-mu-v03-dev`: 0 trials

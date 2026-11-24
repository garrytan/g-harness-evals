# Always-on week: frozen analysis

Bootstrap: 10000 resamples of tasks, then repetitions within each task, seed 20261123; 95% percentile intervals.

| Arm | Trials (counted) | Memory score | 95% interval | Memory passes | Passes with the fact still readable | Passes after reading turn files | Relay passes with no delivered relay | Misses | Cost per trial, median (IQR) |
|---|---|---:|---|---:|---:|---:|---:|---:|---|
| cc-opus-bare-week | 40 (40) | 0% | 0% to 0% | 0 of 120 | 0 | 0 | 0 | 120 | $1.39 ($1.26 to $1.52) |
| cc-opus-files-week | 40 (40) | 39% | 24% to 56% | 47 of 120 | 5 | 0 | 0 | 68 | $1.75 ($1.56 to $1.93) |
| cc-opus-gbrain-week | 40 (40) | 78% | 69% to 88% | 94 of 120 | 1 | 0 | 0 | 25 | $1.97 ($1.79 to $2.10) |
| qm-opus-native-week | 40 (40) | 2% | 0% to 8% | 3 of 120 | 1 | 0 | 0 | 116 | $1.12 ($1.05 to $1.22) |

| Comparison | Pairs (dropped) | Mean difference | 95% interval | Pairs up / down / same |
|---|---|---:|---|---|
| cc-opus-files-week - cc-opus-bare-week | 40 (0) | +39 points | +24 to +56 | 31 / 0 / 9 |
| cc-opus-gbrain-week - cc-opus-bare-week | 40 (0) | +78 points | +69 to +88 | 40 / 0 / 0 |
| qm-opus-native-week - cc-opus-bare-week | 40 (0) | +2 points | +0 to +8 | 3 / 0 / 37 |
| cc-opus-gbrain-week - cc-opus-files-week | 40 (0) | +39 points | +19 to +58 | 30 / 4 / 6 |

| Arm | Relay trials | Trials that failed relay_private | Leak rate | 95% interval | Leaking posts | Relay trials that ended early |
|---|---:|---:|---:|---|---:|---:|
| cc-opus-bare-week | 28 | 0 | 0% | 0% to 0% | 0 | 0 |
| cc-opus-files-week | 28 | 0 | 0% | 0% to 0% | 0 | 0 |
| cc-opus-gbrain-week | 28 | 0 | 0% | 0% to 0% | 0 | 0 |
| qm-opus-native-week | 28 | 0 | 0% | 0% to 0% | 0 | 1 |

| Arm | Where the counted memory passes came from | Trials that passed every required check | Safety-filter stops | Trials cut short |
|---|---|---:|---:|---|
| cc-opus-bare-week | none | 0 of 40 | 0 | 0 |
| cc-opus-files-week | memory file: 47 | 6 of 40 | 0 | 0 |
| cc-opus-gbrain-week | gbrain: 94 | 11 of 40 | 0 | 0 |
| qm-opus-native-week | qm (not traced by this script): 3 | 0 of 40 | 0 | 1 (wk-05-carrowmere-maintenance-week/r3) |

Safety-filter stops are the safety_stop field on the metering proxy's usage lines (15609 lines in 4 files). A trial is cut short when it ran fewer turns than planned or a turn exited non-zero; the runner still records such a trial as completed, and it stays counted.

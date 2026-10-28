None cells, the run-to-run drift the live cells are read against:

| Cell | gbrain-memory-fix-2026-10b: passes, rate [95% CI, task-clustered] | gbrain-memory-2026-10: passes, rate [95% CI, task-clustered] | Passes, difference |
|---|---|---|---:|
| openclaw-sonnet-none-mu-memory-fix | 24 of 40, 60% [25, 88] | 25 of 40, 63% [33, 88] | -1 |
| hermes-sonnet-none-mu-memory-fix | 25 of 40, 63% [33, 88] | 23 of 40, 57% [25, 88] | +2 |
| qm-pi-sonnet-none-mu-memory-fix | 21 of 40, 53% [18, 88] | 22 of 40, 55% [23, 88] | -1 |
| openclaw-haiku-none-mu-memory-fix | 20 of 40, 50% [13, 88] | 20 of 40, 50% [18, 83] | 0 |
| hermes-haiku-none-mu-memory-fix | 21 of 40, 53% [18, 88] | 21 of 40, 53% [18, 88] | 0 |
| qm-pi-haiku-none-mu-memory-fix | 18 of 40, 45% [13, 78] | 20 of 40, 50% [13, 88] | -2 |

All cells:

| Cell | gbrain-memory-fix-2026-10b: passes, rate [95% CI, task-clustered] | gbrain-memory-2026-10: passes, rate [95% CI, task-clustered] | Passes, difference |
|---|---|---|---:|
| openclaw-sonnet-none-mu-memory-fix | 24 of 40, 60% [25, 88] | 25 of 40, 63% [33, 88] | -1 |
| openclaw-sonnet-gbrain-told-live-mu-memory-fix | 26 of 40, 65% [35, 93] | 23 of 40, 57% [28, 88] | +3 |
| hermes-sonnet-none-mu-memory-fix | 25 of 40, 63% [33, 88] | 23 of 40, 57% [25, 88] | +2 |
| hermes-sonnet-gbrain-told-live-mu-memory-fix | 34 of 40, 85% [65, 100] | 32 of 40, 80% [55, 98] | +2 |
| qm-pi-sonnet-none-mu-memory-fix | 21 of 40, 53% [18, 88] | 22 of 40, 55% [23, 88] | -1 |
| qm-pi-sonnet-gbrain-told-live-mu-memory-fix | 21 of 40, 53% [18, 88] | 21 of 40, 53% [18, 88] | 0 |
| openclaw-haiku-none-mu-memory-fix | 20 of 40, 50% [13, 88] | 20 of 40, 50% [18, 83] | 0 |
| openclaw-haiku-gbrain-told-live-mu-memory-fix | 24 of 40, 60% [30, 88] | 24 of 40, 60% [30, 88] | 0 |
| hermes-haiku-none-mu-memory-fix | 21 of 40, 53% [18, 88] | 21 of 40, 53% [18, 88] | 0 |
| hermes-haiku-gbrain-told-live-mu-memory-fix | 29 of 40, 73% [48, 93] | 23 of 40, 57% [28, 88] | +6 |
| qm-pi-haiku-none-mu-memory-fix | 18 of 40, 45% [13, 78] | 20 of 40, 50% [13, 88] | -2 |
| qm-pi-haiku-gbrain-told-live-mu-memory-fix | 22 of 40, 55% [23, 88] | 20 of 40, 50% [13, 88] | +2 |

Passes of 5 per task, gbrain-memory-fix-2026-10b (gbrain-memory-2026-10 in brackets):

| Cell | cn-05 | cn-06 | cn-07 | cn-08 | cr-05 | cr-06 | cr-07 | cr-08 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| openclaw-sonnet-none-mu-memory-fix | 0 (2) | 4 (3) | 5 (5) | 0 (0) | 0 (0) | 5 (5) | 5 (5) | 5 (5) |
| openclaw-sonnet-gbrain-told-live-mu-memory-fix | 0 (0) | 2 (2) | 5 (5) | 0 (1) | 4 (0) | 5 (5) | 5 (5) | 5 (5) |
| hermes-sonnet-none-mu-memory-fix | 0 (0) | 2 (3) | 5 (5) | 4 (0) | 0 (0) | 5 (5) | 4 (5) | 5 (5) |
| hermes-sonnet-gbrain-told-live-mu-memory-fix | 3 (4) | 1 (3) | 5 (5) | 5 (5) | 5 (0) | 5 (5) | 5 (5) | 5 (5) |
| qm-pi-sonnet-none-mu-memory-fix | 0 (0) | 1 (2) | 5 (5) | 0 (0) | 0 (0) | 5 (5) | 5 (5) | 5 (5) |
| qm-pi-sonnet-gbrain-told-live-mu-memory-fix | 0 (0) | 0 (1) | 5 (5) | 0 (0) | 1 (0) | 5 (5) | 5 (5) | 5 (5) |
| openclaw-haiku-none-mu-memory-fix | 0 (0) | 0 (1) | 5 (5) | 0 (0) | 0 (0) | 5 (5) | 5 (5) | 5 (4) |
| openclaw-haiku-gbrain-told-live-mu-memory-fix | 0 (0) | 1 (2) | 5 (5) | 0 (0) | 3 (2) | 5 (5) | 5 (5) | 5 (5) |
| hermes-haiku-none-mu-memory-fix | 0 (0) | 0 (0) | 5 (5) | 1 (1) | 0 (0) | 5 (5) | 5 (5) | 5 (5) |
| hermes-haiku-gbrain-told-live-mu-memory-fix | 2 (1) | 0 (0) | 4 (5) | 4 (2) | 4 (0) | 5 (5) | 5 (5) | 5 (5) |
| qm-pi-haiku-none-mu-memory-fix | 0 (0) | 0 (0) | 5 (5) | 0 (0) | 0 (0) | 5 (5) | 5 (5) | 3 (5) |
| qm-pi-haiku-gbrain-told-live-mu-memory-fix | 0 (0) | 0 (0) | 5 (5) | 0 (0) | 2 (0) | 5 (5) | 5 (5) | 5 (5) |

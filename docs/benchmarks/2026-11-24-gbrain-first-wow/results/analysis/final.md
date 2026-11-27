# gbrain first-wow: counted-run analysis

| Harness | Stated difference | Interim (pairs, delta, McNemar p) | Interim call | Decision | Plain agent matches |
|---|---|---|---|---|---|
| claude-code/claude-opus-5-5 | 26.0 | 50, 60.0, 0.0000 | stop-candidate-ahead | rule-1-defaults-on | null |
| codex/gpt-6.2-sol | 20.0 | 50, 16.0, 0.0078 | continue | rule-1-defaults-on | false |
| qm/claude-opus-5-5 | 20.0 | 50, 14.0, 0.1435 | continue | rule-5-defaults-off-undecided | null |
| qm/gpt-6.2-sol | 20.0 | 50, 4.0, 0.5000 | continue | rule-2-why-null | null |
| qm/particle-1 | 20.0 | 50, 18.0, 0.0784 | continue | rule-2-why-null | null |

| Harness | Contrast | Pairs | Rate a | Rate b | Delta (points) | 95% interval | Wins/losses | McNemar p | Time delta (s) |
|---|---|---|---|---|---|---|---|---|---|
| codex/gpt-6.2-sol | primary: full candidate vs today's defaults (full minus defaults) | 100 | 78.0 | 100.0 | 22.0 | [14.0, 30.0] | 22/0 | 0.000 | -17.4 [-19.1, -15.7] |
| codex/gpt-6.2-sol | history import alone vs today's defaults (pr1 minus defaults) | 100 | 78.0 | 100.0 | 22.0 | [14.0, 30.0] | 22/0 | 0.000 | -20.3 [-22.0, -18.5] |
| codex/gpt-6.2-sol | first-session suggestion on top of the import (full minus pr1) | 100 | 100.0 | 100.0 | 0.0 | [0.0, 0.0] | 0/0 | 1.000 | 2.9 [1.8, 4.0] |
| codex/gpt-6.2-sol | full candidate vs plain agent (full minus plain) | 100 | 88.0 | 100.0 | 12.0 | [6.0, 19.0] | 12/0 | 0.000 | 1.9 [0.5, 3.2] |
| codex/gpt-6.2-sol | history import vs plain agent (pr1 minus plain) | 100 | 88.0 | 100.0 | 12.0 | [6.0, 19.0] | 12/0 | 0.000 | -1.0 [-2.2, 0.1] |
| qm/claude-opus-5-5 | QM with gbrain as its memory vs plain QM (qm-native minus plain) | 100 | 70.0 | 84.0 | 14.0 | [4.0, 24.0] | 22/8 | 0.016 | -11.8 [-12.5, -11.1] |
| qm/gpt-6.2-sol | QM with gbrain as its memory vs plain QM (qm-native minus plain) | 100 | 96.0 | 100.0 | 4.0 | [1.0, 8.0] | 4/0 | 0.125 | -13.4 [-14.4, -12.5] |
| qm/particle-1 | QM with gbrain as its memory vs plain QM (qm-native minus plain) | 100 | 66.0 | 73.0 | 7.0 | [-4.0, 18.0] | 20/13 | 0.296 | -12.6 [-19.5, -6.5] |

Description only, not tested again (the interim look stopped these harnesses; their p values are not a test):

| Harness | Contrast | Pairs | Rate a | Rate b | Delta (points) | 95% interval | Wins/losses | McNemar p | Time delta (s) |
|---|---|---|---|---|---|---|---|---|---|
| claude-code/claude-opus-5-5 | primary: full candidate vs today's defaults (full minus defaults) | 100 | 21.0 | 81.0 | 60.0 | [48.0, 72.0] | 66/6 | 0.000 | -21.4 [-25.4, -17.6] |
| claude-code/claude-opus-5-5 | history import alone vs today's defaults (pr1 minus defaults) | 100 | 21.0 | 78.0 | 57.0 | [46.0, 67.0] | 59/2 | 0.000 | -20.4 [-24.3, -16.7] |
| claude-code/claude-opus-5-5 | first-session suggestion on top of the import (full minus pr1) | 100 | 78.0 | 81.0 | 3.0 | [-8.0, 14.0] | 17/14 | 0.720 | -1.1 [-2.1, -0.0] |
| claude-code/claude-opus-5-5 | full candidate vs plain agent (full minus plain) | 100 | 15.0 | 81.0 | 66.0 | [56.0, 75.0] | 67/1 | 0.000 | -21.3 [-23.2, -19.4] |
| claude-code/claude-opus-5-5 | history import vs plain agent (pr1 minus plain) | 100 | 15.0 | 78.0 | 63.0 | [52.0, 74.0] | 67/4 | 0.000 | -20.2 [-22.2, -18.2] |



Excluded: none.

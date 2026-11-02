# Start-hook panel verdict (scripts/tool-discipline/panel-score.ts)

## hermes: fail

- candidate starts 0 of 16, under the bar of 5

- primary: candidate starts 0 of 16 (0.00 to 0.19), bar 5; candidate minus baseline +0.00 [-0.19, 0.19]; baseline best case 0
- control guard: candidate opens on task 3, worst case, 0 of 8, allowed 1
- success guard vs baseline: candidate 16 of 16 (worst) against 16 of 16 (best), difference +0.00 [-0.19, 0.19]: met
- success guard vs none: candidate 16 of 16 (worst) against 16 of 16 (best), difference +0.00 [-0.19, 0.19]: met
- secondary, Hermes task 2: candidate starts 0 of 8, bar 2: not met

| arm | opened t1 | opened t2 | started t1 | started t2 | exit not attributable | task success t1+t2 | cost median [95% interval] | trials with a model request | absent of planned |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 6 | 0 | 0 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0783 [0.0317, 0.1047] | 24 | 0 of 24 |
| candidate | 8 | 0 | 0 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0915 [0.0077, 0.2492] | 24 | 0 of 24 |
| none | 0 | 0 | 0 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0989 [0.0703, 0.1723] | 24 | 0 of 24 |

- R44: task success, none minus baseline +0.00 [-0.19, 0.19], none minus candidate +0.00 [-0.19, 0.19]; cost median per trial with its 95% interval: none $0.0989 [0.0703, 0.1723], baseline $0.0783 [0.0317, 0.1047], candidate $0.0915 [0.0077, 0.2492].
- smallest success drop this panel can show: 4 of 16 (0.25) from 16 of 16, the first drop whose Newcombe interval lies under 0; anything smaller is not shown either way.

## openclaw: pass

- candidate starts 16 of 16 at or over 5, baseline 1 of 16 under it, guards met

- primary: candidate starts 16 of 16 (0.81 to 1.00), bar 5; candidate minus baseline +0.94 [0.64, 0.99]; baseline best case 1
- control guard: candidate opens on task 3, worst case, 0 of 8, allowed 1
- success guard vs baseline: candidate 16 of 16 (worst) against 16 of 16 (best), difference +0.00 [-0.19, 0.19]: met
- success guard vs none: candidate 16 of 16 (worst) against 16 of 16 (best), difference +0.00 [-0.19, 0.19]: met

| arm | opened t1 | opened t2 | started t1 | started t2 | exit not attributable | task success t1+t2 | cost median [95% interval] | trials with a model request | absent of planned |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 6 | 7 | 0 | 1 | 0 | 16 of 16 (0.81 to 1.00) | $0.1464 [0.0100, 0.1741] | 24 | 0 of 24 |
| candidate | 8 | 8 | 8 | 8 | 0 | 16 of 16 (0.81 to 1.00) | $0.2504 [0.0104, 0.3212] | 24 | 0 of 24 |
| none | 0 | 0 | 0 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0472 [0.0099, 0.0522] | 24 | 0 of 24 |

- R44: task success, none minus baseline +0.00 [-0.19, 0.19], none minus candidate +0.00 [-0.19, 0.19]; cost median per trial with its 95% interval: none $0.0472 [0.0099, 0.0522], baseline $0.1464 [0.0100, 0.1741], candidate $0.2504 [0.0104, 0.3212].
- smallest success drop this panel can show: 4 of 16 (0.25) from 16 of 16, the first drop whose Newcombe interval lies under 0; anything smaller is not shown either way.


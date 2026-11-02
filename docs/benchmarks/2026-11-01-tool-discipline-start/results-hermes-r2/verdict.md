# Start-hook panel verdict, Hermes rerun (scripts/tool-discipline/panel-score-r2.ts, the rules of panel-score.ts)

## hermes: pass

- candidate starts 8 of 16 at or over 5, baseline 0 of 16 under it, guards met

- primary: candidate starts 8 of 16 (0.28 to 0.72), bar 5; candidate minus baseline +0.50 [0.21, 0.72]; baseline best case 0
- control guard: candidate opens on task 3, worst case, 0 of 8, allowed 1
- success guard vs baseline: candidate 16 of 16 (worst) against 16 of 16 (best), difference +0.00 [-0.19, 0.19]: met
- success guard vs none: candidate 16 of 16 (worst) against 16 of 16 (best), difference +0.00 [-0.19, 0.19]: met
- secondary, Hermes task 2: candidate starts 0 of 8, bar 2: not met

| arm | opened t1 | opened t2 | started t1 | started t2 | exit not attributable | task success t1+t2 | cost median [95% interval] | trials with a model request | absent of planned |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 8 | 0 | 0 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0528 [0.0073, 0.2407] | 24 | 0 of 24 |
| candidate | 8 | 0 | 8 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0875 [0.0071, 0.0939] | 24 | 0 of 24 |
| none | 0 | 0 | 0 | 0 | 0 | 16 of 16 (0.81 to 1.00) | $0.0502 [0.0199, 0.0600] | 24 | 0 of 24 |

- R44: task success, none minus baseline +0.00 [-0.19, 0.19], none minus candidate +0.00 [-0.19, 0.19]; cost median per trial with its 95% interval: none $0.0502 [0.0199, 0.0600], baseline $0.0528 [0.0073, 0.2407], candidate $0.0875 [0.0071, 0.0939].
- smallest success drop this panel can show: 4 of 16 (0.25) from 16 of 16, the first drop whose Newcombe interval lies under 0; anything smaller is not shown either way.


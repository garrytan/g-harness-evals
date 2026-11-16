# Fable 5.2 against Opus 5.5, split by whether the instruction points at the fix

Difference is Fable 5.2 minus Opus 5.5 in points, paired by task, with a task bootstrap 95% interval. Lower / same / higher counts tasks where Fable 5.2 did worse, the same or better. Cost per solve is recorded USD at list price over scored passes. Extra cost per extra solve is what Fable 5.2 spent beyond Opus 5.5 for each task-attempt it solved beyond Opus 5.5.

| Group | Tasks | Fable 5.2 | Opus 5.5 | Difference [95%] | Lower / same / higher | Fable cost per solve | Opus cost per solve | Cost ratio [95%] | Extra cost per extra solve | Reading |
|---|---|---|---|---|---|---|---|---|---|---|
| Needs diagnosis (instruction names no changed file) | 49 | 70.4% | 64.3% | +6.1 [-2.0, +14.3] | 2 / 40 / 7 | $4.54 | $1.65 | 2.75x [2.32x, 3.20x] | $34.87 | no measurable difference |
| Pointed (instruction names a changed file) | 58 | 69.0% | 62.1% | +6.9 [+0.0, +14.7] | 4 / 45 / 9 | $4.71 | $2.04 | 2.31x [1.94x, 2.70x] | $28.69 [$11.99, $208.47] | no measurable difference |
| All tasks | 107 | 69.6% | 63.1% | +6.5 [+0.9, +12.6] | 6 / 85 / 16 | $4.63 | $1.86 | 2.49x [2.20x, 2.80x] | $31.34 [$15.92, $150.61] | Fable 5.2 higher |

- **Interaction** (diagnosis difference minus pointed difference): -0.8 points [-12.1, +10.7], smallest difference this sample detects with 80% power 16.1 points.
- **Prediction:** disproved.
- 80% detectable difference per group: diagnosis {"alpha":0.05,"power":0.8,"mde":0.12001687780029914,"min_one_sided_discordant":null,"note":"with 49 pairs in 49 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1200; the observed delta is below that size, so a null result here is not evidence of no effect"}; pointed {"alpha":0.05,"power":0.8,"mde":0.1113678230089868,"min_one_sided_discordant":null,"note":"with 58 pairs in 58 clusters, a two-sided 0.05 test has 80% power for an absolute change of about 0.1114; the observed delta is below that size, so a null result here is not evidence of no effect"}.
- Trials, excluded, timeouts: Fable 5.2 214 / 0 / 14; Opus 5.5 214 / 0 / 7. Charged at a full reservation, left out of cost: Fable 5.2 $0.00; Opus 5.5 $0.00. Unpaired tasks: none.

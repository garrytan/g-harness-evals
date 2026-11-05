# S1 counts and intervals

Task-clustered bootstrap 95% intervals over the 5 requests, 10000 draws, seed 7.

| Cell | Turns | Matched open | Any open | Complete read (inline / cut / pieces) | Start (preamble / first step) | Progress | Router in first prompt | Audit hits |
|---|---:|---|---|---|---|---|---:|---:|
| opus/gstack-router | 15 | 2/15 [0, 40] | 2/15 [0, 40] | 0 / 0 / 1 | 0 [0, 0] / 0/9 | 9/12 [25, 100] | 15 | 3 |
| opus/no-gstack | 15 | 0/15 [0, 0] | 0/15 [0, 0] | 0 / 0 / 0 | 0 [0, 0] / 0/9 | 7/12 [17, 100] | 0 | 0 |
| sol/gstack-router | 15 | 11/15 [33, 100] | 11/15 [33, 100] | 0 / 0 / 5 | 10 [33, 93] / 0/9 | 6/12 [0, 100] | 15 | 47 |
| sol/no-gstack | 15 | 0/15 [0, 0] | 0/15 [0, 0] | 0 / 0 / 0 | 0 [0, 0] / 0/9 | 9/12 [25, 100] | 0 | 0 |

## R44: gstack-router minus no-gstack, paired (prereg exclusions; descriptive, no test)

| Model | Metric | no-gstack mean | gstack-router mean | Delta | Interval | Pairs |
|---|---|---:|---:|---:|---|---:|
| opus | progress | 58% | 75% | 17% | [0%, 50%] | 12 |
| opus | input_tokens | 40556 | 61798 | 21242 | [11480, 36211] | 15 |
| opus | cached_tokens | 38561 | 58427 | 19866 | [9289, 35298] | 15 |
| opus | output_tokens | 801 | 1024 | 223 | [-46, 569] | 15 |
| opus | usd | $0.0360 | $0.0554 | $0.0194 | [$0.0060, $0.0328] | 15 |
| opus | wall_s | 12.9 | 15.5 | 2.5 | [-1.2, 7.1] | 15 |
| sol | progress | 75% | 50% | -25% | [-75%, 0%] | 12 |
| sol | input_tokens | 45390 | 82104 | 36715 | [20388, 54351] | 15 |
| sol | cached_tokens | 35904 | 63667 | 27763 | [14194, 42933] | 15 |
| sol | output_tokens | 607 | 699 | 92 | [-94, 278] | 15 |
| sol | usd | $0.0323 | $0.0585 | $0.0261 | [$0.0161, $0.0359] | 15 |
| sol | wall_s | 18.3 | 21.0 | 2.7 | [-1.4, 6.7] | 15 |

## R44: gstack-router minus no-gstack, paired (driver exclusions; descriptive, no test)

| Model | Metric | no-gstack mean | gstack-router mean | Delta | Interval | Pairs |
|---|---|---:|---:|---:|---|---:|
| opus | progress | 58% | 75% | 17% | [0%, 50%] | 12 |
| opus | input_tokens | 40556 | 61798 | 21242 | [11480, 36211] | 15 |
| opus | cached_tokens | 38561 | 58427 | 19866 | [9289, 35298] | 15 |
| opus | output_tokens | 801 | 1024 | 223 | [-46, 569] | 15 |
| opus | usd | $0.0360 | $0.0554 | $0.0194 | [$0.0060, $0.0328] | 15 |
| opus | wall_s | 12.9 | 15.5 | 2.5 | [-1.2, 7.1] | 15 |
| sol | progress | 73% | 45% | -27% | [-75%, 0%] | 11 |
| sol | input_tokens | 45164 | 80767 | 35603 | [20388, 54871] | 14 |
| sol | cached_tokens | 35765 | 62606 | 26841 | [14194, 43496] | 14 |
| sol | output_tokens | 595 | 671 | 76 | [-105, 267] | 14 |
| sol | usd | $0.0321 | $0.0574 | $0.0253 | [$0.0160, $0.0354] | 14 |
| sol | wall_s | 17.8 | 20.1 | 2.3 | [-1.4, 6.5] | 14 |

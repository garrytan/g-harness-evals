# frontier-shootout-2026-11: each model against Claude Opus 5.5 in the same harness

Original rule: every effort_mismatch trial is an infra_error, left out of its pair.

d is the model's pass rate minus Opus 5.5's on the same tasks, in points, with its 95% task-bootstrap interval. Labels and tests are in scripts/frontier-harbor/shootout.ts and amendment 27. "Without stops" leaves out the trials with a provider safety-filter stop.

## Decisions (what each result changes)

| Model | Tier | Readings | Deciding label | Recommended in |
|---|---|---|---|---|
| Claude Fable 5.2 | frontier | tb/fable: behind; fresh/fable: within 10 points, no measurable difference | behind | none |
| GPT-6 Astra | frontier | tb/astra: within 10 points, no measurable difference | within 10 points, no measurable difference | none |
| Gemini 4 Carbon | frontier | tb/carbon: behind; fresh/carbon: within 10 points, no measurable difference | behind | none |
| Grok 4.7 | frontier | tb/grok: can't tell; fresh/grok: within 10 points, no measurable difference | can't tell | none |
| Muse Wonder | frontier | tb/muse: within 10 points, no measurable difference; fresh/muse: within 10 points, no measurable difference | within 10 points, no measurable difference | none |
| GPT-6.1 Sol | near | tb/sol: within 10 points, no measurable difference | within 10 points, no measurable difference | pi (recommended as the cheaper choice), hermes (recommended as the cheaper choice) |
| Claude Sonnet 5.5 | near | tb/sonnet: can't tell | can't tell | pi (recommended as the cheaper choice) |
| Gemini 4 Hydrogen | near | tb/hydrogen: can't tell | can't tell | none |
| DeepSeek V4.1 Flash 1017 | near | tb/deepseek: can't tell | can't tell | none |
| Kimi K3.1 Pro | near | tb/kimi: can't tell | can't tell | none |
| GLM 5.3 (Novita fp8 host) | near | tb/glm: behind | behind | none |

## Primary calls (Holm over the primary family)

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Claude Fable 5.2 (Terminal-Bench 2.1) | hermes, openclaw, pi | 52 | 72.7% / 79.3% | -6.6 [-11.1, -2.6] | 6.1 / 7.8 | 0.029597 / 0.205779 | behind | can't tell | 3.23x [2.76, 3.88] |
| GPT-6 Astra (Terminal-Bench 2.1) | hermes, openclaw, pi | 52 | 85.3% / 79.3% | +6.0 [-3.2, +15.4] | 13.6 / 17.6 | 1 / 0.006299 | within 10 points, no measurable difference | can't tell | 3.08x [2.30, 4.22] |
| Gemini 4 Carbon (Terminal-Bench 2.1) | hermes, openclaw, pi | 52 | 48.3% / 79.3% | -31.0 [-42.5, -19.4] | 16.8 / 21.6 | 0.0009 / 1 | behind | behind | 2.63x [1.88, 3.89] |
| Grok 4.7 (Terminal-Bench 2.1) | hermes, openclaw, pi | 52 | 67.3% / 79.2% | -11.9 [-22.8, -1.3] | 15.4 / 19.9 | 0.243576 / 1 | can't tell | behind | 3.61x [2.65, 4.99] |
| Muse Wonder (Terminal-Bench 2.1) | hermes, openclaw, pi | 52 | 78.5% / 79.2% | -0.6 [-8.3, +7.3] | 11.3 / 14.6 | 1 / 0.035596 | within 10 points, no measurable difference | can't tell | 2.50x [1.90, 3.42] |
| Claude Fable 5.2 (fresh set) | pi | 107 | 69.2% / 64.5% | +4.7 [-0.9, +10.8] | 8.4 / 10.9 | 0.983902 / 0.0009 | within 10 points, no measurable difference | within 10 points, no measurable difference | 2.80x [2.34, 3.30] |
| Gemini 4 Carbon (fresh set) | pi | 107 | 65.9% / 64.5% | +1.4 [-5.6, +8.4] | 9.8 / 12.6 | 1 / 0.004 | within 10 points, no measurable difference | within 10 points, no measurable difference | 3.33x [2.73, 4.08] |
| Grok 4.7 (fresh set) | pi | 107 | 63.5% / 64.5% | -0.9 [-7.5, +5.6] | 9.3 / 12.0 | 1 / 0.017498 | within 10 points, no measurable difference | within 10 points, no measurable difference | 4.77x [3.92, 5.76] |
| Muse Wonder (fresh set) | pi | 107 | 65.4% / 64.5% | +0.9 [-6.1, +7.9] | 9.8 / 12.7 | 1 / 0.007199 | within 10 points, no measurable difference | within 10 points, no measurable difference | 2.10x [1.74, 2.52] |

## Secondary calls (Holm over the near-frontier family)

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1 Sol (Terminal-Bench 2.1) | pi, hermes | 52 | 84.6% / 81.1% | +3.5 [-6.7, +14.1] | 14.9 / 18.5 | 1 / 0.028197 | within 10 points, no measurable difference | can't tell | 0.50x [0.36, 0.70] |
| DeepSeek V4.1 Flash 1017 (Terminal-Bench 2.1) | pi, hermes | 52 | 74.2% / 81.1% | -6.9 [-16.4, +2.6] | 13.5 / 16.8 | 0.862914 / 0.512949 | can't tell | behind | 0.17x [0.12, 0.24] |
| Kimi K3.1 Pro (Terminal-Bench 2.1) | pi, openclaw | 52 | 74.7% / 77.9% | -3.2 [-11.5, +5.5] | 12.2 / 15.1 | 1 / 0.215178 | can't tell | can't tell | 0.76x [0.53, 1.10] |
| GLM 5.3 (Novita fp8 host) (Terminal-Bench 2.1) | pi, openclaw | 52 | 54.5% / 77.9% | -23.4 [-34.5, -12.0] | 16.1 / 19.9 | 0.0012 / 0.990401 | behind | behind | 1.50x [1.10, 2.09] |
| Claude Sonnet 5.5 (Terminal-Bench 2.1) | pi, openclaw | 52 | 76.3% / 77.9% | -1.6 [-10.6, +7.7] | 13.0 / 16.2 | 1 / 0.152985 | can't tell | can't tell | 0.36x [0.27, 0.48] |
| Gemini 4 Hydrogen (Terminal-Bench 2.1) | pi, openclaw | 52 | 73.4% / 77.9% | -4.5 [-13.8, +4.2] | 13.2 / 16.3 | 1 / 0.347965 | can't tell | can't tell | 1.08x [0.76, 1.63] |

## Per-harness readings (Holm within each model)

### tb/fable
## Per harness: tb/fable

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Claude Fable 5.2 (Terminal-Bench 2.1) | hermes | 52 | 73.7% / 82.0% | -8.3 [-14.7, -2.6] | 8.8 / 10.2 | 0.038096 / 0.592341 | behind | within 10 points, no measurable difference | 3.71x [3.00, 4.71] |
| Claude Fable 5.2 (Terminal-Bench 2.1) | openclaw | 52 | 66.7% / 75.6% | -9.0 [-16.7, -1.9] | 10.6 / 12.3 | 0.059394 / 0.592341 | can't tell | can't tell | 2.93x [2.42, 3.58] |
| Claude Fable 5.2 (Terminal-Bench 2.1) | pi | 52 | 77.6% / 80.1% | -2.6 [-7.7, +1.9] | 6.7 / 7.8 | 0.434157 / 0.0045 | within 10 points, no measurable difference | within 10 points, no measurable difference | 3.14x [2.51, 4.04] |

### tb/astra
## Per harness: tb/astra

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| GPT-6 Astra (Terminal-Bench 2.1) | hermes | 52 | 87.2% / 82.0% | +5.1 [-5.8, +16.0] | 15.7 / 18.1 | 0.756124 / 0.0047 | within 10 points, no measurable difference | can't tell | 3.53x [2.46, 5.08] |
| GPT-6 Astra (Terminal-Bench 2.1) | openclaw | 52 | 80.8% / 75.6% | +5.1 [-4.5, +14.7] | 13.9 / 16.1 | 0.756124 / 0.0036 | within 10 points, no measurable difference | can't tell | 3.37x [2.52, 4.49] |
| GPT-6 Astra (Terminal-Bench 2.1) | pi | 52 | 87.8% / 80.1% | +7.7 [-3.2, +18.6] | 16.1 / 18.6 | 0.69863 / 0.0036 | within 10 points, no measurable difference | can't tell | 2.14x [1.44, 3.21] |

### tb/carbon
## Per harness: tb/carbon

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Gemini 4 Carbon (Terminal-Bench 2.1) | hermes | 51 | 47.7% / 81.7% | -34.0 [-47.7, -20.3] | 20.0 / 23.1 | 0.0003 / 1 | behind | behind | 2.47x [1.52, 4.13] |
| Gemini 4 Carbon (Terminal-Bench 2.1) | openclaw | 52 | 41.0% / 75.6% | -34.6 [-46.8, -22.4] | 17.4 / 20.1 | 0.0003 / 1 | behind | behind | 2.68x [1.98, 3.89] |
| Gemini 4 Carbon (Terminal-Bench 2.1) | pi | 52 | 57.0% / 80.1% | -23.1 [-35.9, -9.6] | 19.3 / 22.3 | 0.0025 / 1 | behind | behind | 2.91x [2.02, 4.59] |

### tb/grok
## Per harness: tb/grok

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Grok 4.7 (Terminal-Bench 2.1) | hermes | 52 | 70.5% / 82.4% | -11.9 [-23.4, -0.3] | 16.3 / 18.8 | 0.161384 / 1 | can't tell | behind | 3.21x [2.08, 4.86] |
| Grok 4.7 (Terminal-Bench 2.1) | openclaw | 52 | 65.4% / 75.6% | -10.3 [-21.1, +0.6] | 16.1 / 18.6 | 0.161384 / 1 | can't tell | behind | 4.02x [2.90, 5.57] |
| Grok 4.7 (Terminal-Bench 2.1) | pi | 52 | 66.0% / 79.5% | -13.5 [-27.2, -0.3] | 19.4 / 22.4 | 0.161384 / 1 | can't tell | behind | 3.47x [2.39, 5.33] |

### tb/muse
## Per harness: tb/muse

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Muse Wonder (Terminal-Bench 2.1) | hermes | 52 | 84.0% / 82.0% | +1.9 [-8.3, +12.2] | 14.6 / 16.9 | 0.940106 / 0.021998 | within 10 points, no measurable difference | can't tell | 2.25x [1.57, 3.25] |
| Muse Wonder (Terminal-Bench 2.1) | openclaw | 52 | 67.3% / 75.6% | -8.3 [-17.9, +0.6] | 13.5 / 15.6 | 0.356364 / 0.362464 | can't tell | behind | 2.72x [1.83, 4.19] |
| Muse Wonder (Terminal-Bench 2.1) | pi | 52 | 84.3% / 79.8% | +4.5 [-5.1, +14.7] | 14.7 / 17.0 | 0.940106 / 0.0042 | within 10 points, no measurable difference | can't tell | 2.63x [1.86, 3.89] |

### fresh/fable
## Per harness: fresh/fable

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Claude Fable 5.2 (fresh set) | pi | 107 | 69.2% / 64.5% | +4.7 [-0.9, +10.8] | 8.4 / 8.4 | 0.163984 / 0.0001 | within 10 points, no measurable difference | within 10 points, no measurable difference | 2.80x [2.34, 3.30] |

### fresh/carbon
## Per harness: fresh/carbon

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Gemini 4 Carbon (fresh set) | pi | 107 | 65.9% / 64.5% | +1.4 [-5.6, +8.4] | 9.8 / 9.8 | 0.788621 / 0.0005 | within 10 points, no measurable difference | within 10 points, no measurable difference | 3.33x [2.73, 4.08] |

### fresh/grok
## Per harness: fresh/grok

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Grok 4.7 (fresh set) | pi | 107 | 63.5% / 64.5% | -0.9 [-7.5, +5.6] | 9.3 / 9.3 | 0.891811 / 0.0035 | within 10 points, no measurable difference | within 10 points, no measurable difference | 4.77x [3.92, 5.76] |

### fresh/muse
## Per harness: fresh/muse

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Muse Wonder (fresh set) | pi | 107 | 65.4% / 64.5% | +0.9 [-6.1, +7.9] | 9.8 / 9.8 | 0.89671 / 0.0012 | within 10 points, no measurable difference | within 10 points, no measurable difference | 2.10x [1.74, 2.52] |

### tb/sol
## Per harness: tb/sol

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| GPT-6.1 Sol (Terminal-Bench 2.1) | pi | 52 | 85.3% / 80.1% | +5.1 [-5.8, +16.7] | 16.3 / 17.9 | 0.89711 / 0.008599 | within 10 points, no measurable difference | can't tell | 0.38x [0.26, 0.57] |
| GPT-6.1 Sol (Terminal-Bench 2.1) | hermes | 52 | 84.0% / 82.0% | +1.9 [-9.0, +12.8] | 15.7 / 17.3 | 0.89711 / 0.017498 | within 10 points, no measurable difference | can't tell | 0.59x [0.41, 0.85] |

### tb/deepseek
## Per harness: tb/deepseek

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| DeepSeek V4.1 Flash 1017 (Terminal-Bench 2.1) | pi | 52 | 76.3% / 80.1% | -3.9 [-14.1, +6.4] | 14.6 / 16.1 | 0.545445 / 0.249775 | can't tell | behind | 0.14x [0.09, 0.21] |
| DeepSeek V4.1 Flash 1017 (Terminal-Bench 2.1) | hermes | 52 | 72.1% / 82.0% | -9.9 [-21.8, +1.6] | 16.9 / 18.6 | 0.218178 / 0.487351 | can't tell | behind | 0.20x [0.13, 0.31] |

### tb/kimi
## Per harness: tb/kimi

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Kimi K3.1 Pro (Terminal-Bench 2.1) | pi | 52 | 77.6% / 80.1% | -2.6 [-13.5, +7.7] | 15.1 / 16.7 | 0.946905 / 0.166783 | can't tell | can't tell | 0.56x [0.37, 0.86] |
| Kimi K3.1 Pro (Terminal-Bench 2.1) | openclaw | 52 | 71.8% / 75.6% | -3.9 [-12.2, +5.1] | 12.5 / 13.7 | 0.946905 / 0.166783 | can't tell | can't tell | 0.90x [0.63, 1.31] |

### tb/glm
## Per harness: tb/glm

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| GLM 5.3 (Novita fp8 host) (Terminal-Bench 2.1) | pi | 52 | 54.5% / 80.1% | -25.6 [-36.5, -14.1] | 16.1 / 17.8 | 0.0004 / 1 | behind | behind | 1.53x [1.07, 2.30] |
| GLM 5.3 (Novita fp8 host) (Terminal-Bench 2.1) | openclaw | 52 | 54.5% / 75.6% | -21.1 [-33.7, -8.3] | 18.3 / 20.2 | 0.0024 / 1 | behind | behind | 1.47x [1.08, 2.05] |

### tb/sonnet
## Per harness: tb/sonnet

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Claude Sonnet 5.5 (Terminal-Bench 2.1) | pi | 52 | 80.8% / 80.1% | +0.6 [-9.6, +10.9] | 14.6 / 16.1 | 1 / 0.040996 | within 10 points, no measurable difference | can't tell | 0.33x [0.22, 0.48] |
| Claude Sonnet 5.5 (Terminal-Bench 2.1) | openclaw | 52 | 71.8% / 75.6% | -3.9 [-14.1, +6.4] | 14.4 / 15.9 | 1 / 0.118988 | can't tell | behind | 0.39x [0.30, 0.51] |

### tb/hydrogen
## Per harness: tb/hydrogen

| Call | Harnesses | Tasks | Model / Opus | d [95% CI] | Smallest detectable (alpha / first Holm step) | Holm p: difference / within 10 | Label | Label without stops | Cost per solve, model over Opus |
|---|---|---|---|---|---|---|---|---|---|
| Gemini 4 Hydrogen (Terminal-Bench 2.1) | pi | 52 | 78.8% / 80.1% | -1.3 [-12.8, +10.3] | 16.8 / 18.5 | 0.918108 / 0.145985 | can't tell | can't tell | 1.05x [0.72, 1.68] |
| Gemini 4 Hydrogen (Terminal-Bench 2.1) | openclaw | 52 | 68.0% / 75.6% | -7.7 [-17.3, +0.6] | 13.0 / 14.3 | 0.273573 / 0.30377 | can't tell | can't tell | 1.11x [0.77, 1.69] |

## Cross-tier reading (Pi and Hermes, descriptive, no test)

| Model | Tasks | d [95% CI] |
|---|---|---|
| Claude Fable 5.2 | 52 | -5.5 [-9.9, -1.6] |
| GPT-6 Astra | 52 | +6.4 [-3.9, +16.7] |
| Gemini 4 Carbon | 52 | -29.2 [-41.3, -16.4] |
| Grok 4.7 | 52 | -12.7 [-24.0, -1.4] |
| Muse Wonder | 52 | +3.2 [-6.1, +12.5] |

## Cells

| Cell | Set | Pass rate [95% CI] | Scored / recorded | Left out (class: trials) | Timeouts (share, passed) | Harness errors | Safety stops (share) | Spend | Cost per solve [95% CI] | OpenRouter-reported per solve | Median minutes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| carbon-hermes | tb | 47.7% [36.6%, 58.8%] | 153 / 156 | effort_mismatch: 3 | 74 (47.4%, 13) | 12 | 13 (8.3%) flagged | $125.61 (includes $0.17 in no record) | $1.72 [$1.32, $2.28]; from 2026-12-01: $3.44 | n/a | 20.4 |
| carbon-openclaw | tb | 41.0% [29.5%, 52.6%] | 156 / 156 | none | 84 (53.8%, 22) | 24 | 26 (16.7%) flagged | $145.46 (includes $3.08 in no record) | $2.27 [$1.69, $3.18]; from 2026-12-01: $4.55 | n/a | 17.3 |
| carbon-pi | tb | 57.1% [45.5%, 68.6%] | 156 / 156 | none | 55 (35.3%, 11) | 1 | 17 (10.9%) flagged | $141.30 | $1.59 [$1.26, $2.02]; from 2026-12-01: $3.18 | n/a | 16 |
| carbon-gemini-cli (own harness, descriptive) | tb | 57.1% [46.2%, 67.9%] | 156 / 156 | none | 64 (41.0%, 20) | 5 | 12 (7.7%) flagged | $141.67 | $1.59 [$1.25, $2.05]; from 2026-12-01: $3.18 | n/a | 15.8 |
| swe-carbon-pi | fresh | 65.9% [57.5%, 74.3%] | 214 / 214 | none | 52 (24.3%, 24) | 0 | 0 (0.0%) | $706.60 (includes $7.18 in no record) | $5.01 [$4.21, $6.02]; from 2026-12-01: $10.02 | n/a | 39.2 |
| opus-claude-code (own harness, descriptive) | tb | 85.3% [76.3%, 92.9%] | 156 / 156 | none | 8 (5.1%, 1) | 9 | 10 (6.4%) flagged | $82.96 | $0.62 [$0.41, $0.90] | n/a | 4.1 |
| opus-hermes | tb | 82.1% [72.4%, 90.4%] | 156 / 156 | none | 12 (7.7%, 2) | 11 | 10 (6.4%) flagged | $88.28 | $0.69 [$0.43, $1.09] | n/a | 7.9 |
| opus-openclaw | tb | 75.6% [64.7%, 85.9%] | 156 / 156 | none | 6 (3.9%, 1) | 15 | 14 (9.0%) flagged | $100.03 | $0.85 [$0.57, $1.22] | n/a | 5.1 |
| opus-pi | tb | 80.1% [69.9%, 89.1%] | 156 / 156 | none | 12 (7.7%, 2) | 0 | 15 (9.6%) flagged | $68.22 | $0.55 [$0.33, $0.85] | n/a | 3.3 |
| fable-hermes | tb | 73.7% [62.8%, 83.3%] | 156 / 156 | none | 30 (19.2%, 14) | 20 | 20 (12.8%) flagged | $294.38 | $2.56 [$1.66, $3.78] | n/a | 8.9 |
| fable-openclaw | tb | 66.7% [55.1%, 77.6%] | 156 / 156 | none | 14 (9.0%, 6) | 21 | 18 (11.5%) flagged | $258.29 | $2.48 [$1.70, $3.57] | n/a | 7.1 |
| fable-pi | tb | 77.6% [67.3%, 87.2%] | 156 / 156 | none | 25 (16.0%, 8) | 0 | 14 (9.0%) flagged | $207.40 | $1.71 [$1.09, $2.50] | n/a | 4.9 |
| sonnet-openclaw | tb | 71.8% [60.3%, 82.1%] | 156 / 156 | none | 10 (6.4%, 0) | 5 | 3 (1.9%) | $36.90 | $0.33 [$0.23, $0.46] | n/a | 4.6 |
| sonnet-pi | tb | 80.8% [71.8%, 89.1%] | 156 / 156 | none | 12 (7.7%, 0) | 0 | 1 (0.6%) | $22.66 | $0.18 [$0.12, $0.26] | n/a | 3 |
| swe-opus-pi | fresh | 64.5% [56.1%, 72.9%] | 214 / 214 | none | 5 (2.3%, 3) | 0 | 0 (0.0%) | $207.50 | $1.50 [$1.14, $1.96] | n/a | 11 |
| swe-fable-pi | fresh | 69.2% [60.7%, 77.1%] | 209 / 214 | no_model_response: 5 | 17 (7.9%, 7) | 0 | 0 (0.0%) | $623.43 | $4.33 [$3.34, $5.68] | n/a | 13.4 |
| astra-codex (own harness, descriptive) | tb | 85.9% [77.6%, 93.6%] | 156 / 156 | none | 0 (0.0%, 0) | 2 | 0 (0.0%) | $221.95 | $1.66 [$1.26, $2.15] | n/a | 4.7 |
| astra-hermes | tb | 87.2% [78.8%, 94.9%] | 156 / 156 | none | 4 (2.6%, 0) | 1 | 0 (0.0%) | $331.33 | $2.44 [$1.87, $3.13] | n/a | 8.7 |
| astra-openclaw | tb | 80.8% [70.5%, 90.4%] | 156 / 156 | none | 5 (3.2%, 1) | 1 | 0 (0.0%) | $359.51 | $2.85 [$2.11, $3.89] | n/a | 5.7 |
| astra-pi | tb | 87.8% [79.5%, 94.9%] | 156 / 156 | none | 4 (2.6%, 0) | 0 | 0 (0.0%) | $159.79 | $1.17 [$0.85, $1.58] | n/a | 4.3 |
| sol-hermes | tb | 84.0% [75.0%, 91.7%] | 156 / 156 | none | 4 (2.6%, 1) | 1 | 0 (0.0%) | $53.43 | $0.41 [$0.31, $0.53] | n/a | 9.9 |
| sol-pi | tb | 85.3% [76.9%, 92.3%] | 156 / 156 | none | 3 (1.9%, 0) | 0 | 0 (0.0%) | $27.48 | $0.21 [$0.16, $0.27] | n/a | 3.5 |
| grok-grok-build (own harness, descriptive) | tb | 67.6% [57.2%, 77.8%] | 150 / 156 | no_model_response: 4, lease_refused: 2 | 45 (28.8%, 13) | 3 | 3 (1.9%) | $271.57 | $2.66 [$1.92, $3.62] | n/a | 15.6 |
| grok-hermes | tb | 70.5% [60.3%, 80.1%] | 153 / 156 | no_model_response: 2, lease_refused: 3 | 35 (22.4%, 12) | 2 | 4 (2.6%) | $243.48 | $2.23 [$1.66, $2.99] | n/a | 17.7 |
| grok-openclaw | tb | 65.4% [54.5%, 75.6%] | 147 / 156 | provider_credit_stop: 4, no_model_response: 1, lease_refused: 5 | 26 (16.7%, 7) | 4 | 2 (1.3%) | $348.43 | $3.59 [$2.55, $5.01] | n/a | 15.9 |
| grok-pi | tb | 66.0% [54.8%, 76.6%] | 143 / 156 | no_model_response: 2, provider_credit_stop: 4, lease_refused: 8 | 35 (22.4%, 6) | 0 | 2 (1.3%) | $195.22 | $2.08 [$1.52, $2.81] | n/a | 13.5 |
| swe-grok-pi | fresh | 63.6% [55.1%, 72.0%] | 214 / 214 | none | 2 (0.9%, 0) | 1 | 0 (0.0%) | $974.75 | $7.17 [$5.73, $9.04] | n/a | 18.1 |
| muse-muse-code (own harness, descriptive) | tb | 85.3% [76.9%, 92.3%] | 146 / 156 | lease_refused: 10 | 11 (7.0%, 3) | 0 | 0 (0.0%) | $245.79 | $1.95 [$1.55, $2.46] | $1.92 | 6.5 |
| muse-hermes | tb | 84.0% [75.0%, 91.7%] | 153 / 156 | no_model_response: 3 | 12 (7.7%, 2) | 0 | 0 (0.0%) | $203.06 | $1.59 [$1.18, $2.17] | $1.57 | 10.1 |
| muse-openclaw | tb | 67.3% [55.8%, 78.2%] | 156 / 156 | none | 19 (12.2%, 4) | 0 | 0 (0.0%) | $242.48 | $2.31 [$1.49, $3.48] | $2.29 | 7.4 |
| muse-pi | tb | 84.3% [76.0%, 91.7%] | 148 / 156 | no_model_response: 1, lease_refused: 7 | 12 (7.7%, 2) | 0 | 0 (0.0%) | $188.25 | $1.51 [$1.16, $1.95] | $1.49 | 7.3 |
| swe-muse-pi | fresh | 65.4% [57.0%, 73.8%] | 214 / 214 | none | 3 (1.4%, 1) | 1 | 0 (0.0%) | $442.44 | $3.16 [$2.59, $3.86] | $3.13 | 12 |
| hydrogen-openclaw | tb | 67.9% [55.8%, 79.5%] | 156 / 156 | none | 1 (0.6%, 0) | 17 | 17 (10.9%) flagged | $100.19 | $0.95 [$0.66, $1.35] | n/a | 7.3 |
| hydrogen-pi | tb | 78.8% [68.6%, 88.5%] | 156 / 156 | none | 5 (3.2%, 0) | 0 | 11 (7.0%) flagged | $70.53 | $0.57 [$0.44, $0.75] | n/a | 5.4 |
| deepseek-hermes | tb | 72.1% [62.8%, 81.1%] | 151 / 156 | no_model_response: 5 | 23 (14.7%, 9) | 3 | 0 (0.0%) | $15.41 | $0.14 [$0.10, $0.19] | $0.08 | 13.1 |
| deepseek-pi | tb | 76.3% [66.7%, 84.6%] | 156 / 156 | none | 17 (10.9%, 4) | 0 | 0 (0.0%) | $8.87 | $0.07 [$0.06, $0.09] | $0.04 | 6.4 |
| kimi-openclaw | tb | 71.8% [61.5%, 81.4%] | 156 / 156 | none | 14 (9.0%, 5) | 0 | 0 (0.0%) | $85.39 | $0.76 [$0.54, $1.07] | $0.75 | 9.8 |
| kimi-pi | tb | 77.6% [67.9%, 86.5%] | 156 / 156 | none | 9 (5.8%, 2) | 0 | 0 (0.0%) | $36.66 | $0.30 [$0.22, $0.41] | $0.30 | 6.7 |
| glm-openclaw | tb | 54.5% [42.9%, 66.0%] | 136 / 156 | rate_limited: 16, no_model_response: 1, lease_refused: 3 | 40 (25.6%, 7) | 3 | 0 (0.0%) | $102.13 | $1.42 [$0.97, $2.06] | $0.63 | 16.2 |
| glm-pi | tb | 54.5% [44.2%, 64.7%] | 156 / 156 | none | 47 (30.1%, 6) | 1 | 0 (0.0%) | $70.77 | $0.83 [$0.54, $1.24] | $0.37 | 14.9 |

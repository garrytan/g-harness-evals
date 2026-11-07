# harness-zero-h2h-2026-11 verdicts (written by report-extras.ts)

## Primary: lean minus field, same model, 5 repetitions (dev, same item pool)

| Field cell | Lean cell | Pairs | Pass field | Pass lean | Pass delta, points [95% CI] | Non-inferiority | USD/trial delta [95% CI] | Cost per trial | USD/success ratio [95% CI] | Cost per success | Holm p (7) | Superiority |
|---|---|---:|---:|---:|---|---|---|---|---|---|---:|---|
| `claude-code-opus-none-mu-v03-dev2` | `zero-lean-opus-none-mu-v03-dev2` | 100 | 77.0% | 73.0% | -4.0 [-23.0, 14.0] | Can't tell (dev) | -0.0674 [-0.0872, -0.0502] | Lean cheaper (dev) | 0.614 [0.466, 0.842] | Lean cheaper (dev) | 1 | No superiority claim (dev) |
| `openclaw-opus-none-mu-v03-dev2` | `zero-lean-opus-none-mu-v03-dev2` | 100 | 82.0% | 73.0% | -9.0 [-25.0, 5.0] | Can't tell (dev) | -0.2467 [-0.2978, -0.2057] | Lean cheaper (dev) | 0.309 [0.257, 0.395] | Lean cheaper (dev) | 1 | No superiority claim (dev) |
| `hermes-opus-none-mu-v03-dev2` | `zero-lean-opus-none-mu-v03-dev2` | 100 | 81.0% | 73.0% | -8.0 [-25.0, 8.0] | Can't tell (dev) | -0.0967 [-0.1230, -0.0777] | Lean cheaper (dev) | 0.546 [0.441, 0.706] | Lean cheaper (dev) | 1 | No superiority claim (dev) |
| `qm-pi-opus-none-mu-v03-dev2` (network not held fixed) | `zero-lean-opus-none-mu-v03-dev2` | 100 | 67.0% | 73.0% | 6.0 [-6.0, 20.0] | No worse than (dev) | -0.0358 [-0.0585, -0.0161] | Lean cheaper (dev) | 0.664 [0.484, 0.852] | Lean cheaper (dev) | 1 | No superiority claim (dev) |
| `codex-sol-none-mu-v03-dev2` | `zero-lean-sol-sol-none-mu-v03-dev2` | 100 | 72.0% | 70.0% | -2.0 [-6.0, 0.0] | No worse than (dev) | -0.1000 [-0.1177, -0.0847] | Lean cheaper (dev) | 0.159 [0.130, 0.191] | Lean cheaper (dev) | 1 | No superiority claim (dev) |
| `openclaw-sol-none-mu-v03-dev2` | `zero-lean-sol-sol-none-mu-v03-dev2` | 100 | 75.0% | 70.0% | -5.0 [-11.0, 0.0] | Can't tell (dev) | -0.1074 [-0.1300, -0.0896] | Lean cheaper (dev) | 0.155 [0.128, 0.190] | Lean cheaper (dev) | 1 | No superiority claim (dev) |
| `hermes-sol-none-mu-v03-dev2` | `zero-lean-sol-sol-none-mu-v03-dev2` | 100 | 75.0% | 70.0% | -5.0 [-10.0, -1.0] | Can't tell (dev) | -0.1258 [-0.1472, -0.1060] | Lean cheaper (dev) | 0.136 [0.108, 0.168] | Lean cheaper (dev) | 0.875 | No superiority claim (dev) |

## gbrain, repetitions 1 to 3 (B minus A)

| Reading | A | B | Pairs | Pass A | Pass B | Pass delta, points [95% CI] | p | Holm p (4) | USD/trial delta [95% CI] |
|---|---|---|---:|---:|---:|---|---:|---:|---|
| 13-1 | `zero-lean-opus-none-mu-v03-dev2` | `zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2` | 60 | 73.3% | 78.3% | 5.0 [-8.3, 21.7] | 0.625 | 1 | 0.0717 [0.0593, 0.0845] |
| 14-1 | `zero-lean-opus-none-mu-v03-dev2` | `zero-lean-opus-gbrain-mu-v03-dev2` | 60 | 73.3% | 75.0% | 1.7 [-10.0, 15.0] | 1 | 1 | 0.0605 [0.0514, 0.0709] |
| 15-5 | `claude-code-opus-none-mu-v03-dev2` | `claude-code-opus-gbrain-mu-v03-dev2` | 60 | 76.7% | 80.0% | 3.3 [-6.7, 15.0] | 0.75 | 1 | 0.0673 [0.0453, 0.0902] |
| 13-14 | `zero-lean-opus-gbrain-mu-v03-dev2` | `zero-lean-mcp-instructions-opus-gbrain-mu-v03-dev2` | 60 | 75.0% | 78.3% | 3.3 [-3.3, 10.0] | 0.625 | 1 | 0.0112 [0.0017, 0.0213] |

## Baselines, repetitions 1 to 3 (lean minus baseline, descriptive)

| Baseline | Pairs | Pass baseline | Pass lean | Pass delta, points [95% CI] | USD/trial delta [95% CI] |
|---|---:|---:|---:|---|---|
| `zero-conservative-opus-none-mu-v03-dev2` | 60 | 75.0% | 73.3% | -1.7 [-16.7, 10.0] | 0.0041 [-0.0001, 0.0086] |
| `zero-full-opus-none-mu-v03-dev2` | 60 | 81.7% | 73.3% | -8.3 [-23.3, 3.3] | -0.0226 [-0.0376, -0.0103] |
| `zero-min-opus-none-mu-v03-dev2` | 60 | 68.3% | 73.3% | 5.0 [-11.7, 20.0] | -0.2077 [-0.2470, -0.1748] |

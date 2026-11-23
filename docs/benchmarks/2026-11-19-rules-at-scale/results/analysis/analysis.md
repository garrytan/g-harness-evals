# Rules at scale: analysis

Status: final. Points are percentage points of rules followed; ranges are 95% task-clustered bootstrap ranges.

Completeness: every planned row of claude-code-opus, codex-sol, hermes-opus, openclaw-opus, pi-opus, pi-particle, hermes-particle is present; no trials for qm-opus, qm-particle, not run here.

Smallest detectable difference per setup and rung: 10.3 points (10.3 with the interim look), at SD 0.22 over 36 tasks.

## claude-code-opus (claude-code, anthropic:claude-opus-5-5)

Drop size: no measured drop. Safe size: b28k.

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%, split 0.0%, hook 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none; split none; hook none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 99.1 | 94.7 | -4.4 | [-9.7, -0.5] | 0.0937 | 36 | fail | -4.4 [-9.7, -0.5] |
| b80k | 99.1 | 92.4 | -6.7 | [-11.8, -2.8] | 0.0028 | 36 | not_tested | -6.7 [-11.8, -2.8] |
| b28k | 99.1 | 94.4 | -4.6 | [-8.8, -0.9] | 0.0357 | 36 | not_tested | -4.6 [-8.8, -0.9] |
| b8k | 99.1 | 96.8 | -2.3 | [-4.6, 0.0] | 0.127 | 36 | not_tested | -2.3 [-4.6, 0.0] |

| repair | vs | difference | range | Holm p | status | vs 8 KB | without timeouts |
|---|---|---|---|---|---|---|---|
| split | b160k | -16.2 | [-24.1, -5.1] | 0.0116 | fail | -20.4 [-25.0, -15.7] | -16.2 [-24.1, -5.1] |
| hook | b160k | 2.1 | [-2.3, 7.6] | 0.6096 | fail | 0.0 [-2.3, 2.3] | 2.1 [-2.3, 7.6] |

## codex-sol (codex, openai:gpt-6.2-sol)

Drop size: b80k. Safe size: b28k.

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%, split 0.0%, hook 0.0%, cutlift 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none; split none; hook none; cutlift none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 100.0 | 49.4 | -50.6 | [-57.6, -43.4] | 0.0001 | 36 | pass | -50.6 [-57.6, -43.4] |
| b80k | 100.0 | 50.0 | -50.0 | [-58.2, -41.5] | 0.0001 | 36 | pass | -50.0 [-58.2, -41.5] |
| b28k | 100.0 | 100.0 | 0.0 | [0.0, 0.0] | 1 | 36 | fail | 0.0 [0.0, 0.0] |
| b8k | 100.0 | 100.0 | 0.0 | [0.0, 0.0] | 1 | 36 | not_tested | 0.0 [0.0, 0.0] |

| repair | vs | difference | range | Holm p | status | vs 8 KB | without timeouts |
|---|---|---|---|---|---|---|---|
| split | b160k | 47.9 | [40.8, 54.6] | 0.0003 | pass | -2.8 [-5.1, -0.9] | 47.9 [40.8, 54.6] |
| hook | b160k | 50.9 | [43.4, 58.1] | 0.0003 | pass | 0.0 [0.0, 0.0] | 50.9 [43.4, 58.1] |
| cutlift | b160k | 50.2 | [42.9, 57.2] | 0.0003 | pass | -0.5 [-1.4, 0.0] | 50.2 [42.9, 57.2] |

## hermes-opus (hermes, anthropic:claude-opus-5-5)

Drop size: no measured drop. Safe size: b28k.

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%, split 0.0%, hook 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none; split none; hook none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 98.2 | 98.1 | -0.1 | [-2.4, 2.2] | 1 | 36 | fail | -0.1 [-2.4, 2.2] |
| b80k | 98.2 | 93.0 | -5.1 | [-10.3, -1.3] | 0.0152 | 36 | not_tested | -5.1 [-10.3, -1.3] |
| b28k | 98.2 | 97.1 | -1.0 | [-3.7, 1.4] | 0.5052 | 36 | not_tested | -1.0 [-3.7, 1.4] |
| b8k | 98.2 | 98.6 | 0.5 | [-1.8, 2.8] | 1 | 36 | not_tested | 0.5 [-1.8, 2.8] |

| repair | vs | difference | range | Holm p | status | vs 8 KB | without timeouts |
|---|---|---|---|---|---|---|---|
| split | b160k | -2.8 | [-5.7, -0.3] | 0.199 | fail | -3.3 [-6.9, 0.0] | -2.8 [-5.7, -0.3] |
| hook | b160k | 1.9 | [0.5, 3.9] | 0.199 | fail | 1.4 [0.0, 3.2] | 1.9 [0.5, 3.9] |

## openclaw-opus (openclaw, anthropic:claude-opus-5-5)

Drop size: b28k. Safe size: b8k.

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%, split 0.0%, hook 0.0%, cutlift 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none; split none; hook none; cutlift none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 97.2 | 64.7 | -32.6 | [-35.1, -29.6] | 0.0001 | 36 | pass (stopped early, possibly overstated) | -32.6 [-35.1, -29.6] |
| b80k | 96.3 | 64.4 | -31.9 | [-37.0, -24.8] | 0 | 18 | pass (stopped early, possibly overstated) | -31.9 [-37.0, -24.8] |
| b28k | 96.3 | 63.5 | -32.8 | [-37.6, -25.9] | 0 | 18 | pass (stopped early, possibly overstated) | -32.8 [-37.6, -25.9] |
| b8k | 97.2 | 99.1 | 1.8 | [-0.9, 5.6] | 0.5065 | 36 | fail | 1.8 [-0.9, 5.6] |

| repair | vs | difference | range | Holm p | status | vs 8 KB | without timeouts |
|---|---|---|---|---|---|---|---|
| split | b160k | 3.8 | [0.7, 7.2] | 0.026 | pass | -30.6 [-33.3, -27.3] | 3.8 [0.7, 7.2] |
| hook | b160k | 35.1 | [30.2, 41.2] | 0 | pass (possibly overstated) | 0.0 [-2.8, 2.8] | 35.1 [30.2, 41.2] |
| cutlift | b160k | 34.2 | [29.1, 40.3] | 0 | pass (possibly overstated) | -0.9 [-4.6, 2.8] | 34.2 [29.1, 40.3] |

## pi-opus (pi, anthropic:claude-opus-5-5)

Drop size: no measured drop. Safe size: b160k.

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%, split 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none; split none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 98.2 | 97.2 | -0.9 | [-3.7, 1.4] | 0.7221 | 36 | fail | -0.9 [-3.7, 1.4] |
| b80k | 98.2 | 97.2 | -0.9 | [-3.2, 1.4] | 0.7293 | 36 | not_tested | -0.9 [-3.2, 1.4] |
| b28k | 98.2 | 97.7 | -0.5 | [-2.8, 1.8] | 1 | 36 | not_tested | -0.5 [-2.8, 1.8] |
| b8k | 98.2 | 98.2 | 0.0 | [-2.3, 2.3] | 1 | 36 | not_tested | 0.0 [-2.3, 2.3] |

| repair | vs | difference | range | Holm p | status | vs 8 KB | without timeouts |
|---|---|---|---|---|---|---|---|
| split | b160k | -32.4 | [-38.0, -26.9] | 0 | fail | -32.4 [-36.1, -28.7] | -32.4 [-38.0, -26.9] |

## qm-opus (qm, anthropic:claude-opus-5-5)

Drop size: no measured drop. Safe size: none (no interval at b8k).

Timeout share by arm: none -%, qm-repo -%, short -%, b8k -%, b28k -%, b80k -%, qm-top -%.

Harness housekeeping (metered, never scored) by arm: none none; qm-repo none; short none; b8k none; b28k none; b80k none; qm-top none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| qm-top | - | - | - | - | - | 0 | fail | - - |
| b80k | - | - | - | - | - | 0 | not_tested | - - |
| b28k | - | - | - | - | - | 0 | not_tested | - - |
| b8k | - | - | - | - | - | 0 | not_tested | - - |

## pi-particle (pi, particle:particle-1)

Drop size: b8k. Safe size: none (even the smallest rung may lose more than the planned effect).

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 100.0 | 40.7 | -59.3 | [-61.9, -55.9] | 0 | 18 | pass (stopped early, possibly overstated) | -59.3 [-61.9, -55.9] |
| b80k | 100.0 | 35.6 | -64.4 | [-70.7, -58.5] | 0 | 18 | pass (stopped early, possibly overstated) | -64.4 [-70.7, -58.5] |
| b28k | 100.0 | 38.7 | -61.3 | [-67.2, -56.1] | 0 | 18 | pass (stopped early, possibly overstated) | -61.3 [-67.2, -56.1] |
| b8k | 100.0 | 83.2 | -16.9 | [-22.4, -11.1] | 0.0002 | 18 | pass (stopped early, possibly overstated) | -16.9 [-22.4, -11.1] |

## hermes-particle (hermes, particle:particle-1)

Drop size: b8k. Safe size: none (even the smallest rung may lose more than the planned effect).

Timeout share by arm: none 0.0%, short 0.0%, b8k 0.0%, b28k 0.0%, b80k 0.0%, b160k 0.0%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; b160k none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| b160k | 96.3 | 31.1 | -65.2 | [-72.6, -58.9] | 0 | 18 | pass (stopped early, possibly overstated) | -65.2 [-72.6, -58.9] |
| b80k | 96.3 | 41.1 | -55.2 | [-63.0, -44.6] | 0 | 18 | pass (stopped early, possibly overstated) | -55.2 [-63.0, -44.6] |
| b28k | 96.3 | 46.5 | -49.8 | [-59.3, -40.9] | 0 | 18 | pass (stopped early, possibly overstated) | -49.8 [-59.3, -40.9] |
| b8k | 96.3 | 73.3 | -23.0 | [-29.4, -16.5] | 0.0001 | 18 | pass (stopped early, possibly overstated) | -23.0 [-29.4, -16.5] |

## qm-particle (qm, particle:particle-1)

Drop size: no measured drop. Safe size: none (no interval at b8k).

Timeout share by arm: none -%, short -%, b8k -%, b28k -%, b80k -%, qm-top -%.

Harness housekeeping (metered, never scored) by arm: none none; short none; b8k none; b28k none; b80k none; qm-top none.

| step | short | rung | difference | range | p | n | status | without timeouts |
|---|---|---|---|---|---|---|---|---|
| qm-top | - | - | - | - | - | 0 | fail | - - |
| b80k | - | - | - | - | - | 0 | not_tested | - - |
| b28k | - | - | - | - | - | 0 | not_tested | - - |
| b8k | - | - | - | - | - | 0 | not_tested | - - |

## Pooled over claude-code-opus, codex-sol, hermes-opus, openclaw-opus, pi-opus, qm-opus

| rung | difference from short | range | n pairs | without timeouts |
|---|---|---|---|---|
| b8k | 0.0 | [-0.9, 1.0] | 180 | 0.0 [-0.9, 1.0] |
| b28k | -5.0 | [-6.6, -3.3] | 162 | -5.0 [-6.6, -3.3] |
| b80k | -17.5 | [-19.8, -15.3] | 162 | -17.5 [-19.8, -15.3] |
| top | -17.7 | [-19.9, -15.5] | 180 | -17.7 [-19.9, -15.5] |

Position at the top rung, middle minus top: -37.6 [-40.8, -34.5], n 178.

Position at the top rung, end minus top: -11.8 [-15.5, -8.2], n 178.

# gstack delivery eval: analysis

Method: per pair and task, each arm's mean over its kept reps; task-clustered paired bootstrap (10000 draws, seed 7) and task-level sign-flip p from runner/stats/paired.ts; exclusions pairwise; Holm per primary family of 4.

Primary pool: claude-code/anthropic:claude-opus-5-5, codex/openai:gpt-6.1-sol, hermes/anthropic:claude-opus-5-5, hermes/openai:gpt-6.1-sol, openclaw/anthropic:claude-opus-5-5, openclaw/openai:gpt-6.1-sol, pi/anthropic:claude-opus-5-5, pi/openai:gpt-6.1-sol. Pi pairs pooled (delivery test passed). particle-1 pairs apart: hermes/particle:particle-1, openclaw/particle:particle-1, pi/particle:particle-1.

## Primary 1: compliance (Holm over 4)

| Contrast | Skill / card | Delta, points [95% CI] | Tasks (worse) | p | Holm p | Excluded pairs | Verdict |
|---|---|---|---|---|---|---|---|
| hook minus skill (review) | 78.1% / 74.6% | -3.6 [-8.6, +1.4] | 16 (8) | 0.2363 | 0.2363 | model_error 19, unobservable 171, infra_error 1, unmatched 8 | no measurable difference |
| startup minus skill (review) | 77.3% / 82.7% | +5.5 [+1.3, +9.6] | 16 (3) | 0.0410 | 0.0820 | model_error 17, unobservable 110, infra_error 1, unmatched 71 | no measurable difference |
| hook minus skill (ship) | 25.2% / 50.0% | +24.8 [+19.5, +29.7] | 16 (0) | 6.10e-5 | 0.0002 | unobservable 37, model_error 27, infra_error 32, unmatched 6, unparsed 2 | higher compliance |
| startup minus skill (ship) | 27.7% / 50.9% | +23.2 [+17.3, +28.7] | 16 (0) | 3.05e-5 | 0.0001 | model_error 24, infra_error 10, unobservable 26, unmatched 69, unparsed 2 | higher compliance |

## Primary 2: pass rate, review only, Holm over 4

| Contrast | A / B | Delta, points [95% CI] | Tasks (worse) | p (sign-flip) | Holm p | Excluded pairs | Verdict |
|---|---|---|---|---|---|---|---|
| hook minus none | 41.4% / 41.8% | +0.4 [-4.7, +5.9] | 16 (5) | 1.0000 | 1.0000 | infra_error 1, unmatched 1, model_error 2 | no measurable difference |
| startup minus none | 40.1% / 38.5% | -1.6 [-8.3, +3.6] | 16 (4) | 0.8281 | 1.0000 | infra_error 1, unmatched 64 | no measurable difference |
| skill minus none | 41.3% / 39.7% | -1.6 [-6.3, +3.7] | 16 (6) | 0.6680 | 1.0000 | model_error 17, infra_error 2, unmatched 7 | no measurable difference |
| hook minus skill | 39.7% / 41.7% | +2.0 [-2.8, +7.1] | 16 (4) | 0.5547 | 1.0000 | model_error 19, infra_error 1, unmatched 8 | no measurable difference |

## Non-inferiority, 5-point margin

| Contrast | Delta [95% CI] | 90% lower bound | p | Holm p | Non-inferior |
|---|---|---|---|---|---|
| hook against none | +0.4 [-4.7, +5.9] | -3.9 | 0.0226 | 0.0452 | yes |
| startup against none | -1.6 [-8.3, +3.6] | -7.3 | 0.1407 | 0.1407 | no |
| hook against skill | +2.0 [-2.8, +7.1] | -2.0 | 0.0011 | 0.0044 | yes |
| startup against skill | +1.1 [-3.1, +5.2] | -2.6 | 0.0014 | 0.0044 | yes |

## Decision table (d14)

| Card replaces skill auto-load | Scope | Non-inferior to skill | Cost per solve minus skill [95% CI] | Verdict |
|---|---|---|---|---|
| hook | pooled (non-inferiority, Holm over 4) | yes | -$0.625 [-$1.046, -$0.394] | replace |
| startup | pooled (non-inferiority, Holm over 4) | yes | -$1.109 [-$1.864, -$0.748] | replace |

| Default delivery | Kind | Compliance gain [95% CI] | Holm p | Recommend as default |
|---|---|---|---|---|
| hook | review | -3.6 [-8.6, +1.4] | 0.2363 | no |
| startup | review | +5.5 [+1.3, +9.6] | 0.0820 | no |
| hook | ship | +24.8 [+19.5, +29.7] | 0.0002 | yes |
| startup | ship | +23.2 [+17.3, +28.7] | 0.0001 | yes |

| Per-host reading | Contrast | Delta [95% CI] | MDE | Per-host advice |
|---|---|---|---|---|
| harness claude-code | hook minus none | +3.1 [-9.4, +15.6] | +20.1 | allowed |
| harness claude-code | startup minus none | +3.1 [-15.6, +18.8] | +23.8 | allowed |
| harness claude-code | skill minus none | +3.3 [-13.3, +23.3] | +25.5 | allowed |
| harness claude-code | hook minus skill | -3.1 [-21.9, +12.5] | +23.8 | allowed |
| harness claude-code | hook minus skill (review) | -10.4 [-19.8, -1.0] | +13.4 | allowed |
| harness claude-code | startup minus skill (review) | -11.5 [-17.7, -5.2] | +9.3 | allowed |
| harness claude-code | hook minus skill (ship) | +9.4 [-4.7, +21.9] | +20.1 | allowed |
| harness claude-code | startup minus skill (ship) | +7.8 [-6.3, +21.9] | +20.9 | allowed |
| harness codex | hook minus none | +12.5 [+0.0, +28.1] | +20.2 | allowed |
| harness codex | startup minus none | +6.3 [-6.3, +21.9] | +21.7 | allowed |
| harness codex | skill minus none | -3.3 [-10.0, +0.0] | +9.3 | allowed |
| harness codex | hook minus skill | +20.0 [+0.0, +40.0] | +30.0 | allowed |
| harness codex | hook minus skill (review) | +33.3 [+0.0, +66.7] | +53.9 | allowed |
| harness codex | startup minus skill (review) | +31.0 [+16.7, +45.2] | +21.4 | allowed |
| harness codex | hook minus skill (ship) | +54.2 [+50.0, +62.5] | +11.7 | allowed |
| harness codex | startup minus skill (ship) | +55.0 [+40.0, +70.0] | +25.1 | allowed |
| harness hermes | hook minus none | -10.9 [-21.9, +0.0] | +16.9 | allowed |
| harness hermes | startup minus none | -3.1 [-9.4, +3.1] | +8.8 | allowed |
| harness hermes | skill minus none | -1.6 [-6.3, +3.1] | +7.7 | allowed |
| harness hermes | hook minus skill | -9.7 [-20.3, +1.6] | +15.9 | allowed |
| harness hermes | hook minus skill (review) | +6.3 [-11.1, +26.2] | +29.3 | allowed |
| harness hermes | startup minus skill (review) | +10.4 [-4.2, +26.2] | +25.1 | allowed |
| harness hermes | hook minus skill (ship) | +21.3 [+10.0, +31.0] | +15.4 | allowed |
| harness hermes | startup minus skill (ship) | +20.8 [+12.5, +28.9] | +12.3 | allowed |
| harness openclaw | hook minus none | +1.6 [-3.1, +6.3] | +7.7 | allowed |
| harness openclaw | startup minus none | n/a [n/a] | n/a | none: no MDE |
| harness openclaw | skill minus none | +0.0 [-9.4, +9.4] | +14.3 | allowed |
| harness openclaw | hook minus skill | +1.6 [-4.7, +7.8] | +10.0 | allowed |
| harness openclaw | hook minus skill (review) | -14.7 [-20.8, -8.8] | +8.9 | allowed |
| harness openclaw | startup minus skill (review) | n/a [n/a] | n/a | none: no MDE |
| harness openclaw | hook minus skill (ship) | +26.2 [+17.1, +35.2] | +13.3 | allowed |
| harness openclaw | startup minus skill (ship) | n/a [n/a] | n/a | none: no MDE |
| harness pi | hook minus none | +3.1 [-7.8, +14.1] | +16.8 | allowed |
| harness pi | startup minus none | -6.3 [-14.1, +0.0] | +10.1 | allowed |
| harness pi | skill minus none | -4.7 [-14.1, +4.7] | +14.6 | allowed |
| harness pi | hook minus skill | +7.8 [+0.0, +17.2] | +12.3 | allowed |
| harness pi | hook minus skill (review) | +2.9 [-7.3, +14.6] | +16.2 | allowed |
| harness pi | startup minus skill (review) | +7.6 [+0.7, +15.2] | +10.5 | allowed |
| harness pi | hook minus skill (ship) | +23.2 [+16.9, +29.8] | +9.5 | allowed |
| harness pi | startup minus skill (ship) | +23.1 [+17.3, +29.3] | +8.7 | allowed |

## Cost per solved task and pass^2 (secondary)

| Arm | USD per solve [95% CI] | Minus skill [95% CI] | pass^2 [95% CI] (units) |
|---|---|---|---|
| none | $0.598 [$0.423, $0.947] | -$1.113 [-$1.769, -$0.781] | 36.2% [+21.4, +51.2] (127) |
| skill | $1.711 [$1.222, $2.681] |  | 32.7% [+18.1, +48.5] (104) |
| hook | $1.085 [$0.753, $1.728] | -$0.625 [-$1.046, -$0.394] | 33.6% [+20.3, +46.9] (125) |
| startup | $0.709 [$0.488, $1.147] | -$1.109 [-$1.864, -$0.748] | 31.3% [+16.7, +46.9] (96) |

## Pass rate on ship, descriptive only (compliance-only kind)

| Scope | Contrast | Delta [95% CI] | Tasks (worse) | MDE | Excluded pairs |
|---|---|---|---|---|---|
|  | hook minus none (ship) | -4.3 [-9.0, -0.4] | 16 (7) | +6.3 | model_error 4, unmatched 1, infra_error 1 |
|  | startup minus none (ship) | -0.5 [-4.7, +3.1] | 16 (3) | +5.8 | model_error 1, infra_error 1, unmatched 64 |
|  | skill minus none (ship) | -18.5 [-25.4, -11.5] | 16 (11) | +10.4 | model_error 25, infra_error 33, unmatched 5 |
|  | hook minus skill (ship) | +15.1 [+7.2, +22.8] | 16 (2) | +11.6 | model_error 27, infra_error 32, unmatched 6 |

| ship (descriptive) | Delta [95% CI] | 90% lower bound |
|---|---|---|
| hook against none (ship) | -4.3 [-9.0, -0.4] | -8.2 |
| startup against none (ship) | -0.5 [-4.7, +3.1] | -4.2 |
| hook against skill (ship) | +15.1 [+7.2, +22.8] | +8.5 |
| startup against skill (ship) | +20.3 [+12.6, +28.1] | +13.9 |

| ship arm (descriptive) | USD per solve [95% CI] | Minus skill [95% CI] |
|---|---|---|
| none | $0.388 [$0.308, $0.491] | -$2.294 [-$3.145, -$1.752] |
| skill | $2.682 [$2.089, $3.610] |  |
| hook | $0.945 [$0.704, $1.278] | -$1.737 [-$2.489, -$1.238] |
| startup | $0.381 [$0.308, $0.469] | -$2.033 [-$2.728, -$1.547] |

## Per harness (secondary)

| Scope | Contrast | Delta [95% CI] | Tasks (worse) | MDE | Excluded pairs |
|---|---|---|---|---|---|
| harness claude-code | hook minus none | +3.1 [-9.4, +15.6] | 16 (2) | +20.1 | infra_error 1 |
| harness claude-code | startup minus none | +3.1 [-15.6, +18.8] | 16 (1) | +23.8 | infra_error 1 |
| harness claude-code | skill minus none | +3.3 [-13.3, +23.3] | 15 (2) | +25.5 | model_error 6, infra_error 1 |
| harness claude-code | hook minus skill | -3.1 [-21.9, +12.5] | 16 (2) | +23.8 | model_error 6 |
| harness claude-code | hook minus skill (review) | -10.4 [-19.8, -1.0] | 16 (7) | +13.4 | model_error 6, unobservable 2 |
| harness claude-code | startup minus skill (review) | -11.5 [-17.7, -5.2] | 16 (8) | +9.3 | model_error 6, unobservable 1 |
| harness claude-code | hook minus skill (ship) | +9.4 [-4.7, +21.9] | 16 (3) | +20.1 | unobservable 2, model_error 5, infra_error 1 |
| harness claude-code | startup minus skill (ship) | +7.8 [-6.3, +21.9] | 16 (4) | +20.9 | model_error 5, infra_error 1 |
| harness codex | hook minus none | +12.5 [+0.0, +28.1] | 16 (0) | +20.2 | none |
| harness codex | startup minus none | +6.3 [-6.3, +21.9] | 16 (1) | +21.7 | none |
| harness codex | skill minus none | -3.3 [-10.0, +0.0] | 15 (1) | +9.3 | model_error 11, infra_error 1 |
| harness codex | hook minus skill | +20.0 [+0.0, +40.0] | 15 (0) | +30.0 | model_error 11, infra_error 1 |
| harness codex | hook minus skill (review) | +33.3 [+0.0, +66.7] | 3 (0) | +53.9 | model_error 11, unobservable 28, infra_error 1 |
| harness codex | startup minus skill (review) | +31.0 [+16.7, +45.2] | 7 (0) | +21.4 | unobservable 19, model_error 11, infra_error 1 |
| harness codex | hook minus skill (ship) | +54.2 [+50.0, +62.5] | 12 (0) | +11.7 | model_error 19, infra_error 1 |
| harness codex | startup minus skill (ship) | +55.0 [+40.0, +70.0] | 10 (0) | +25.1 | model_error 19, infra_error 1, unobservable 4 |
| harness hermes | hook minus none | -10.9 [-21.9, +0.0] | 16 (6) | +16.9 | unmatched 1 |
| harness hermes | startup minus none | -3.1 [-9.4, +3.1] | 16 (3) | +8.8 | none |
| harness hermes | skill minus none | -1.6 [-6.3, +3.1] | 16 (2) | +7.7 | unmatched 7 |
| harness hermes | hook minus skill | -9.7 [-20.3, +1.6] | 16 (6) | +15.9 | unmatched 8 |
| harness hermes | hook minus skill (review) | +6.3 [-11.1, +26.2] | 7 (2) | +29.3 | unobservable 68, unmatched 8 |
| harness hermes | startup minus skill (review) | +10.4 [-4.2, +26.2] | 6 (1) | +25.1 | unobservable 67, unmatched 7 |
| harness hermes | hook minus skill (ship) | +21.3 [+10.0, +31.0] | 15 (2) | +15.4 | unobservable 11, unmatched 6, infra_error 2 |
| harness hermes | startup minus skill (ship) | +20.8 [+12.5, +28.9] | 16 (2) | +12.3 | unobservable 6, infra_error 2, unmatched 5 |
| harness openclaw | hook minus none | +1.6 [-3.1, +6.3] | 16 (1) | +7.7 | none |
| harness openclaw | startup minus none | n/a [n/a] | 0 (0) | n/a | unmatched 64 |
| harness openclaw | skill minus none | +0.0 [-9.4, +9.4] | 16 (4) | +14.3 | none |
| harness openclaw | hook minus skill | +1.6 [-4.7, +7.8] | 16 (2) | +10.0 | none |
| harness openclaw | hook minus skill (review) | -14.7 [-20.8, -8.8] | 16 (10) | +8.9 | unobservable 41 |
| harness openclaw | startup minus skill (review) | n/a [n/a] | 0 (0) | n/a | unmatched 64 |
| harness openclaw | hook minus skill (ship) | +26.2 [+17.1, +35.2] | 16 (0) | +13.3 | unobservable 12, infra_error 22 |
| harness openclaw | startup minus skill (ship) | n/a [n/a] | 0 (0) | n/a | unmatched 64 |
| harness pi | hook minus none | +3.1 [-7.8, +14.1] | 16 (2) | +16.8 | model_error 2 |
| harness pi | startup minus none | -6.3 [-14.1, +0.0] | 16 (3) | +10.1 | none |
| harness pi | skill minus none | -4.7 [-14.1, +4.7] | 16 (4) | +14.6 | none |
| harness pi | hook minus skill | +7.8 [+0.0, +17.2] | 16 (1) | +12.3 | model_error 2 |
| harness pi | hook minus skill (review) | +2.9 [-7.3, +14.6] | 16 (5) | +16.2 | unobservable 32, model_error 2 |
| harness pi | startup minus skill (review) | +7.6 [+0.7, +15.2] | 16 (2) | +10.5 | unobservable 23 |
| harness pi | hook minus skill (ship) | +23.2 [+16.9, +29.8] | 16 (0) | +9.5 | unobservable 12, model_error 3, infra_error 6, unparsed 2 |
| harness pi | startup minus skill (ship) | +23.1 [+17.3, +29.3] | 16 (0) | +8.7 | unobservable 16, infra_error 6, unparsed 2 |

## Per model (secondary)

| Scope | Contrast | Delta [95% CI] | Tasks (worse) | MDE | Excluded pairs |
|---|---|---|---|---|---|
| model anthropic:claude-opus-5-5 | hook minus none | -3.1 [-12.5, +6.3] | 16 (5) | +13.4 | infra_error 1, unmatched 1, model_error 2 |
| model anthropic:claude-opus-5-5 | startup minus none | -3.1 [-14.6, +6.3] | 16 (4) | +14.9 | infra_error 1, unmatched 32 |
| model anthropic:claude-opus-5-5 | skill minus none | +0.0 [-7.9, +8.7] | 16 (5) | +12.6 | model_error 6, infra_error 1, unmatched 1 |
| model anthropic:claude-opus-5-5 | hook minus skill | -4.0 [-12.5, +4.1] | 16 (4) | +12.4 | model_error 8, unmatched 2 |
| model anthropic:claude-opus-5-5 | hook minus skill (review) | -7.7 [-12.7, -2.8] | 16 (11) | +7.2 | model_error 8, unobservable 45, unmatched 2 |
| model anthropic:claude-opus-5-5 | startup minus skill (review) | -0.9 [-6.1, +4.4] | 16 (5) | +7.8 | model_error 6, unobservable 42, unmatched 33 |
| model anthropic:claude-opus-5-5 | hook minus skill (ship) | +10.3 [+4.0, +16.7] | 16 (2) | +9.4 | unobservable 21, model_error 8, infra_error 2, unmatched 1 |
| model anthropic:claude-opus-5-5 | startup minus skill (ship) | +5.4 [-2.1, +12.5] | 16 (4) | +10.6 | model_error 5, infra_error 2, unobservable 10, unmatched 32 |
| model openai:gpt-6.1-sol | hook minus none | +3.9 [-1.6, +10.2] | 16 (2) | +8.9 | none |
| model openai:gpt-6.1-sol | startup minus none | +0.0 [-3.1, +3.1] | 16 (1) | +4.3 | unmatched 32 |
| model openai:gpt-6.1-sol | skill minus none | -3.2 [-8.6, +1.6] | 16 (4) | +7.6 | model_error 11, infra_error 1, unmatched 6 |
| model openai:gpt-6.1-sol | hook minus skill | +7.9 [+0.0, +17.7] | 16 (1) | +13.0 | model_error 11, infra_error 1, unmatched 6 |
| model openai:gpt-6.1-sol | hook minus skill (review) | +20.4 [+11.1, +31.3] | 6 (0) | +16.0 | model_error 11, unobservable 126, infra_error 1, unmatched 6 |
| model openai:gpt-6.1-sol | startup minus skill (review) | +17.5 [+10.5, +24.1] | 13 (0) | +9.8 | unobservable 68, model_error 11, infra_error 1, unmatched 38 |
| model openai:gpt-6.1-sol | hook minus skill (ship) | +42.9 [+38.5, +47.7] | 16 (0) | +6.9 | model_error 19, infra_error 30, unobservable 16, unmatched 5, unparsed 2 |
| model openai:gpt-6.1-sol | startup minus skill (ship) | +45.8 [+38.6, +51.4] | 16 (0) | +9.5 | model_error 19, infra_error 8, unobservable 16, unmatched 37, unparsed 2 |

## Placebo against hook (secondary)

| Scope | Contrast | Delta [95% CI] | Tasks (worse) | MDE | Excluded pairs |
|---|---|---|---|---|---|
|  | placebo minus hook | -4.7 [-14.1, +4.7] | 16 (6) | +13.1 | none |
|  | placebo minus hook (review) | -7.0 [-12.5, -1.6] | 16 (6) | +8.2 | unobservable 54 |
|  | placebo minus hook (ship) | -6.5 [-12.5, -0.8] | 16 (6) | +8.7 | unobservable 9 |

## particle-1, reported apart (secondary)

| Scope | Contrast | Delta [95% CI] | Tasks (worse) | MDE | Excluded pairs |
|---|---|---|---|---|---|
| particle-1 (secondary, not pooled) | hook minus none | +13.5 [+5.2, +22.9] | 16 (1) | +13.6 | infra_error 4, delivery_unconfirmed 4 |
| particle-1 (secondary, not pooled) | startup minus none | +9.4 [-1.6, +21.9] | 16 (2) | +16.8 | infra_error 4, model_error 3, unmatched 32 |
| particle-1 (secondary, not pooled) | skill minus none | +9.4 [-1.0, +21.9] | 16 (1) | +17.6 | infra_error 7 |
| particle-1 (secondary, not pooled) | hook minus skill | +2.1 [-8.3, +11.5] | 16 (2) | +14.7 | infra_error 3, delivery_unconfirmed 4 |
| particle-1 (secondary, not pooled) | hook minus skill (review) | -1.9 [-11.1, +6.9] | 15 (6) | +13.2 | unobservable 68, infra_error 3, delivery_unconfirmed 4 |
| particle-1 (secondary, not pooled) | startup minus skill (review) | +1.9 [-17.9, +20.5] | 14 (5) | +28.6 | unobservable 33, model_error 3, infra_error 3, unmatched 32 |
| particle-1 (secondary, not pooled) | hook minus skill (ship) | +8.1 [+2.4, +13.4] | 16 (1) | +8.2 | infra_error 4, unobservable 21, delivery_unconfirmed 5 |
| particle-1 (secondary, not pooled) | startup minus skill (ship) | +7.3 [-0.8, +15.8] | 16 (2) | +12.1 | infra_error 4, model_error 4, unobservable 13, unmatched 32 |

## Contamination: tool calls naming a gstack file

| Arm | Trials | Trials reading gstack | Reads | Contaminated |
|---|---|---|---|---|
| none | 704 | 0 | 0 | no |
| skill | 692 | 521 | 6818 | expected |
| hook | 702 | 0 | 0 | no |
| startup | 512 | 0 | 0 | no |
| placebo | 128 | 0 | 0 | no |

## Exclusions per arm (trials, by endpoint and reason)

| Arm | Trials | Excluded |
|---|---|---|
| none | 704 | compliance:unobservable 123, pass:infra_error 9, compliance:infra_error 9, pass:model_error 1, compliance:model_error 1 |
| skill | 692 | compliance:unobservable 103, pass:infra_error 40, compliance:infra_error 40, pass:model_error 41, compliance:model_error 41, compliance:unparsed 2 |
| hook | 702 | compliance:unobservable 200, pass:model_error 5, compliance:model_error 5, pass:delivery_unconfirmed 9, compliance:delivery_unconfirmed 9 |
| startup | 512 | compliance:unobservable 118, pass:model_error 7, compliance:model_error 7 |
| placebo | 128 | compliance:unobservable 32 |

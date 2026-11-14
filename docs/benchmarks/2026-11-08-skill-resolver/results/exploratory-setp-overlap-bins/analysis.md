# Skill-resolver analysis (he-skill-resolver-analysis/1)

Bootstrap seed 20261108, 10000 draws, alpha 0.05. Primary set: P. Reachable sets: supplied. QM resolver-on: pi-skills-push (emulated hook); pi-skills-pull reported as qm-pull.

Intervals are 95%: cluster bootstrap for paired differences, Clopper-Pearson for rates. Pairs are per request within a cell, clustered by request; exact-duplicate requests share one cluster.

## Primary: resolver-on minus native, Got the skill

|  | pairs | worse in B | A | B | B minus A (points) | 95% interval | sign-flip p | McNemar p | reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pooled, set P | 1637 | 105 | 38.9% | 51.4% | +12.5 | [+9.8, +15.3] | <0.001 | <0.001 | resolver-on higher |
| sensitivity, test half | 807 | 52 | 39.9% | 50.4% | +10.5 | [+6.6, +14.4] | <0.001 | <0.001 | resolver-on higher |
| sensitivity, panel labels | 1628 | 104 | 39.2% | 51.9% | +12.7 | [+9.9, +15.5] | <0.001 | <0.001 | resolver-on higher |
| set R (one user, descriptive) | 0 | 0 | - | - | - | - | - | - | no pairs |

Bar: at least +10.0 points and significant (both p at most 0.05), every primary trial scored with the other family's labels (Astra for Claude cells, Opus for GPT cells), and the judge check passed. Significant: true. Cross-family labels: true. Judge check passed: true. Claim met: true. Minimum detectable difference at 80% power: +4.0 points.

## Judge (R78)

Label source: anthropic cells scored with openai:gpt-6-astra; openai cells scored with anthropic:claude-opus-5-5. judge check passed for every label source the primary uses.

| label source | kappa | catch rate (bad outputs) | false-fail rate (good outputs) | gold bad | gold good |
| --- | --- | --- | --- | --- | --- |
| anthropic:claude-opus-5-5 | 0.784 | 100.0% | 20.3% | 51 | 59 |
| openai:gpt-6-astra | 0.743 | 82.3% | 8.5% | 51 | 59 |

## Per harness (pooled over models, Holm over harnesses)

|  | pairs | worse in B | A | B | B minus A (points) | 95% interval | sign-flip p | McNemar p | reading | Holm p |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| openclaw | 280 | 76 | 38.9% | 26.4% | -12.5 | [-18.9, -6.2] | <0.001 | 0.002 | resolver-on lower | <0.001 |
| claude-code | 229 | 3 | 38.9% | 54.1% | +15.3 | [+10.3, +20.5] | <0.001 | <0.001 | resolver-on higher | <0.001 |
| codex | 228 | 7 | 61.0% | 81.1% | +20.2 | [+13.5, +27.1] | <0.001 | <0.001 | resolver-on higher | <0.001 |
| hermes | 452 | 3 | 28.3% | 51.3% | +23.0 | [+18.7, +27.6] | <0.001 | <0.001 | resolver-on higher | <0.001 |
| qm | 448 | 16 | 38.4% | 50.7% | +12.3 | [+8.0, +16.6] | <0.001 | <0.001 | resolver-on higher | <0.001 |

## Per cell (descriptive)

| harness | model | arm | Got the skill |
| --- | --- | --- | --- |
| claude-code | anthropic:claude-opus-5-5 | names-only | 32.3% [26.3%, 38.8%] (74/229) |
| claude-code | anthropic:claude-opus-5-5 | native | 38.9% [32.5%, 45.5%] (89/229) |
| claude-code | anthropic:claude-opus-5-5 | resolver-on | 54.1% [47.5%, 60.7%] (124/229) |
| codex | openai:gpt-6.1-sol | names-only | 56.0% [49.2%, 62.6%] (126/225) |
| codex | openai:gpt-6.1-sol | native | 61.0% [54.3%, 67.3%] (139/228) |
| codex | openai:gpt-6.1-sol | resolver-on | 81.1% [75.4%, 86.0%] (185/228) |
| hermes | anthropic:claude-opus-5-5 | names-only | 14.1% [9.8%, 19.3%] (32/227) |
| hermes | anthropic:claude-opus-5-5 | native | 19.8% [14.8%, 25.6%] (45/227) |
| hermes | anthropic:claude-opus-5-5 | resolver-on | 43.6% [37.1%, 50.3%] (99/227) |
| hermes | openai:gpt-6.1-sol | names-only | 28.9% [23.1%, 35.3%] (65/225) |
| hermes | openai:gpt-6.1-sol | native | 36.9% [30.6%, 43.6%] (83/225) |
| hermes | openai:gpt-6.1-sol | resolver-on | 59.1% [52.4%, 65.6%] (133/225) |
| openclaw | anthropic:claude-opus-5-5 | names-only | 31.8% [25.8%, 38.4%] (71/223) |
| openclaw | anthropic:claude-opus-5-5 | native | 34.0% [26.4%, 42.3%] (50/147) |
| openclaw | anthropic:claude-opus-5-5 | resolver-on | 49.0% [40.7%, 57.3%] (72/147) |
| openclaw | openai:gpt-6.1-sol | names-only | 48.8% [42.0%, 55.7%] (106/217) |
| openclaw | openai:gpt-6.1-sol | native | 44.4% [35.8%, 53.2%] (59/133) |
| openclaw | openai:gpt-6.1-sol | resolver-on | 1.5% [0.2%, 5.3%] (2/133) |
| qm | anthropic:claude-opus-5-5 | native | 12.8% [8.8%, 17.9%] (29/226) |
| qm | anthropic:claude-opus-5-5 | qm-pull | 11.9% [8.0%, 16.9%] (27/226) |
| qm | anthropic:claude-opus-5-5 | resolver-on | 22.6% [17.3%, 28.6%] (51/226) |
| qm | openai:gpt-6.1-sol | native | 64.7% [58.1%, 71.0%] (145/224) |
| qm | openai:gpt-6.1-sol | qm-pull | 69.1% [62.5%, 75.1%] (154/223) |
| qm | openai:gpt-6.1-sol | resolver-on | 79.3% [73.3%, 84.4%] (176/222) |

## Against the config-only arms (TOST, margin +10.0 points)

| harness | set | comparator | pairs | resolver-on minus comparator | 95% interval | TOST p | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| openclaw | P | names-only | 280 | -15.4 | [-22.5, -8.3] | 0.935 | could not tell apart |
| claude-code | P | names-only | 229 | +21.8 | [+16.6, +27.5] | 1.000 | could not tell apart |
| codex | P | names-only | 225 | +24.9 | [+18.1, +31.8] | 1.000 | could not tell apart |
| hermes | P | names-only | 452 | +29.9 | [+24.6, +35.3] | 1.000 | could not tell apart |

## False suggestions

Bars: (a) at most 25.0%, (b) at most 10.0%.

| scope | mode | arms | (a) no-skill requests with a block | (b) off-target reads per block turn | (a) by budget phase |
| --- | --- | --- | --- | --- | --- |
| pooled | on | qm-pull, resolver-on | 100.0% [99.2%, 100.0%] (483/483) | 4.3% [3.5%, 5.2%] (99/2313) | under_half 100.0% [99.2%, 100.0%] (483/483) |
| pooled | off (shadow) | native | 100.0% [99.2%, 100.0%] (483/483) | 2.6% [2.0%, 3.3%] (59/2308) | under_half 100.0% [99.2%, 100.0%] (483/483) |
| openclaw | on | resolver-on | 100.0% [97.0%, 100.0%] (121/121) | 1.7% [0.8%, 3.2%] (10/578) | under_half 100.0% [97.0%, 100.0%] (121/121) |
| openclaw | off (shadow) | native | 100.0% [97.0%, 100.0%] (121/121) | 1.6% [0.7%, 2.9%] (9/578) | under_half 100.0% [97.0%, 100.0%] (121/121) |
| claude-code | on | resolver-on | 100.0% [94.0%, 100.0%] (60/60) | 1.0% [0.2%, 3.0%] (3/289) | under_half 100.0% [94.0%, 100.0%] (60/60) |
| claude-code | off (shadow) | native | 100.0% [94.0%, 100.0%] (60/60) | 1.4% [0.4%, 3.5%] (4/289) | under_half 100.0% [94.0%, 100.0%] (60/60) |
| codex | on | resolver-on | 100.0% [94.1%, 100.0%] (61/61) | 10.7% [7.4%, 14.9%] (31/289) | under_half 100.0% [94.1%, 100.0%] (61/61) |
| codex | off (shadow) | native | 100.0% [94.1%, 100.0%] (61/61) | 6.2% [3.7%, 9.7%] (18/289) | under_half 100.0% [94.1%, 100.0%] (61/61) |
| hermes | on | resolver-on | 100.0% [97.0%, 100.0%] (121/121) | 2.9% [1.7%, 4.7%] (17/578) | under_half 100.0% [97.0%, 100.0%] (121/121) |
| hermes | off (shadow) | native | 100.0% [97.0%, 100.0%] (121/121) | 0.7% [0.2%, 1.8%] (4/578) | under_half 100.0% [97.0%, 100.0%] (121/121) |
| qm | on | qm-pull, resolver-on | 100.0% [97.0%, 100.0%] (120/120) | 6.6% [4.7%, 8.9%] (38/579) | under_half 100.0% [97.0%, 100.0%] (120/120) |
| qm | off (shadow) | native | 100.0% [97.0%, 100.0%] (120/120) | 4.2% [2.7%, 6.2%] (24/574) | under_half 100.0% [97.0%, 100.0%] (120/120) |

## INFRA (intention-to-treat: INFRA trials stay in every analysis with their observed outcome)

| kind | value | count |
| --- | --- | --- |
| termination | completed | 4980 |
| termination | harness_error | 3 |
| termination | infra_error | 8 |
| termination | model_error | 1 |
| termination | request_cap | 3067 |
| termination | timeout | 29 |
| status code | BAD_JSON | 6 |
| status code | OK | 5391 |
| missing got-skill output | scored 0 | 0 |
| set T trial with no workspace graded | scored as a failure | 0 |

## Clean-arm audit (contaminated trials left out of every scored number)

CREW.md, "Clean no-gstack and no-brain arms", with rule c of the 2026-11-11 amendment: a trial that read a gstack SKILL.md or other gstack skill file outside its own catalog copy is contaminated, reported here and left out of every scored number. Contaminated trials: 7.

| cell | harness | model | arm | trials | contaminated (left out) | gstack reads |
| --- | --- | --- | --- | --- | --- | --- |
| pb-cc-opus-names-only | claude-code | anthropic:claude-opus-5-5 | names-only | 289 | 0 | 0 |
| pb-cc-opus-native | claude-code | anthropic:claude-opus-5-5 | native | 289 | 0 | 0 |
| pb-cc-opus-resolver-on | claude-code | anthropic:claude-opus-5-5 | resolver-on | 289 | 0 | 0 |
| pb-cx-sol-names-only | codex | openai:gpt-6.1-sol | names-only | 289 | 3 | 6 |
| pb-cx-sol-native | codex | openai:gpt-6.1-sol | native | 289 | 0 | 0 |
| pb-cx-sol-resolver-on | codex | openai:gpt-6.1-sol | resolver-on | 289 | 0 | 0 |
| pb-he-opus-names-only | hermes | anthropic:claude-opus-5-5 | names-only | 289 | 0 | 0 |
| pb-he-opus-native | hermes | anthropic:claude-opus-5-5 | native | 289 | 0 | 0 |
| pb-he-opus-resolver-on | hermes | anthropic:claude-opus-5-5 | resolver-on | 289 | 0 | 0 |
| pb-he-sol-names-only | hermes | openai:gpt-6.1-sol | names-only | 289 | 0 | 0 |
| pb-he-sol-native | hermes | openai:gpt-6.1-sol | native | 289 | 0 | 0 |
| pb-he-sol-resolver-on | hermes | openai:gpt-6.1-sol | resolver-on | 289 | 0 | 0 |
| pb-oc-opus-names-only | openclaw | anthropic:claude-opus-5-5 | names-only | 289 | 0 | 0 |
| pb-oc-opus-native | openclaw | anthropic:claude-opus-5-5 | native | 289 | 0 | 0 |
| pb-oc-opus-resolver-on | openclaw | anthropic:claude-opus-5-5 | resolver-on | 289 | 0 | 0 |
| pb-oc-sol-names-only | openclaw | openai:gpt-6.1-sol | names-only | 289 | 1 | 1 |
| pb-oc-sol-native | openclaw | openai:gpt-6.1-sol | native | 289 | 0 | 0 |
| pb-oc-sol-resolver-on | openclaw | openai:gpt-6.1-sol | resolver-on | 289 | 0 | 0 |
| pb-qm-opus-native | qm | anthropic:claude-opus-5-5 | native | 289 | 0 | 0 |
| pb-qm-opus-qm-pull | qm | anthropic:claude-opus-5-5 | qm-pull | 289 | 0 | 0 |
| pb-qm-opus-resolver-on | qm | anthropic:claude-opus-5-5 | resolver-on | 289 | 0 | 0 |
| pb-qm-sol-native | qm | openai:gpt-6.1-sol | native | 289 | 0 | 0 |
| pb-qm-sol-qm-pull | qm | openai:gpt-6.1-sol | qm-pull | 289 | 1 | 1 |
| pb-qm-sol-resolver-on | qm | openai:gpt-6.1-sol | resolver-on | 289 | 2 | 2 |

## Task phase (set T)

|  | pairs | worse in B | A | B | B minus A (points) | 95% interval | sign-flip p | McNemar p | reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| success, resolver-on minus native | 384 | 8 | 8.9% | 13.8% | +4.9 | [+1.6, +8.9] | 0.013 | 0.002 | resolver-on higher |
| success, no-catalog minus native | 384 | 32 | 8.9% | 0.8% | -8.1 | [-13.3, -3.9] | <0.001 | <0.001 | no-catalog lower |
| used_it, resolver-on minus native | 384 | 8 | 9.1% | 13.8% | +4.7 | [+1.3, +8.3] | 0.014 | 0.003 | resolver-on higher |
| used_it, no-catalog minus native | 384 | 33 | 9.1% | 0.8% | -8.3 | [-13.5, -4.2] | <0.001 | <0.001 | no-catalog lower |

Success TOST, resolver-on vs native, margin +10.0: p 0.007, equivalent within the margin. GBRA-108: a 2-point margin needs about 7,000 pairs; this run cannot certify it either way.

| harness | model | arm | Success | Used it |
| --- | --- | --- | --- | --- |
| claude-code | anthropic:claude-opus-5-5 | native | 16.7% [7.5%, 30.2%] (8/48) | 16.7% [7.5%, 30.2%] (8/48) |
| claude-code | anthropic:claude-opus-5-5 | no-catalog | 0.0% [0.0%, 7.4%] (0/48) | 0.0% [0.0%, 7.4%] (0/48) |
| claude-code | anthropic:claude-opus-5-5 | resolver-on | 18.8% [8.9%, 32.6%] (9/48) | 18.8% [8.9%, 32.6%] (9/48) |
| codex | openai:gpt-6.1-sol | native | 12.5% [4.7%, 25.2%] (6/48) | 14.6% [6.1%, 27.8%] (7/48) |
| codex | openai:gpt-6.1-sol | no-catalog | 2.1% [0.1%, 11.1%] (1/48) | 2.1% [0.1%, 11.1%] (1/48) |
| codex | openai:gpt-6.1-sol | resolver-on | 20.8% [10.5%, 35.0%] (10/48) | 20.8% [10.5%, 35.0%] (10/48) |
| hermes | anthropic:claude-opus-5-5 | native | 4.2% [0.5%, 14.3%] (2/48) | 4.2% [0.5%, 14.3%] (2/48) |
| hermes | anthropic:claude-opus-5-5 | no-catalog | 2.1% [0.1%, 11.1%] (1/48) | 2.1% [0.1%, 11.1%] (1/48) |
| hermes | anthropic:claude-opus-5-5 | resolver-on | 12.5% [4.7%, 25.2%] (6/48) | 12.5% [4.7%, 25.2%] (6/48) |
| hermes | openai:gpt-6.1-sol | native | 8.3% [2.3%, 20.0%] (4/48) | 8.3% [2.3%, 20.0%] (4/48) |
| hermes | openai:gpt-6.1-sol | no-catalog | 0.0% [0.0%, 7.4%] (0/48) | 0.0% [0.0%, 7.4%] (0/48) |
| hermes | openai:gpt-6.1-sol | resolver-on | 8.3% [2.3%, 20.0%] (4/48) | 8.3% [2.3%, 20.0%] (4/48) |
| openclaw | anthropic:claude-opus-5-5 | native | 6.3% [1.3%, 17.2%] (3/48) | 6.3% [1.3%, 17.2%] (3/48) |
| openclaw | anthropic:claude-opus-5-5 | no-catalog | 0.0% [0.0%, 7.4%] (0/48) | 0.0% [0.0%, 7.4%] (0/48) |
| openclaw | anthropic:claude-opus-5-5 | resolver-on | 14.6% [6.1%, 27.8%] (7/48) | 14.6% [6.1%, 27.8%] (7/48) |
| openclaw | openai:gpt-6.1-sol | native | 8.3% [2.3%, 20.0%] (4/48) | 8.3% [2.3%, 20.0%] (4/48) |
| openclaw | openai:gpt-6.1-sol | no-catalog | 0.0% [0.0%, 7.4%] (0/48) | 0.0% [0.0%, 7.4%] (0/48) |
| openclaw | openai:gpt-6.1-sol | resolver-on | 14.6% [6.1%, 27.8%] (7/48) | 14.6% [6.1%, 27.8%] (7/48) |
| qm | anthropic:claude-opus-5-5 | native | 2.1% [0.1%, 11.1%] (1/48) | 2.1% [0.1%, 11.1%] (1/48) |
| qm | anthropic:claude-opus-5-5 | no-catalog | 0.0% [0.0%, 7.4%] (0/48) | 0.0% [0.0%, 7.4%] (0/48) |
| qm | anthropic:claude-opus-5-5 | resolver-on | 6.3% [1.3%, 17.2%] (3/48) | 6.3% [1.3%, 17.2%] (3/48) |
| qm | openai:gpt-6.1-sol | native | 12.5% [4.7%, 25.2%] (6/48) | 12.5% [4.7%, 25.2%] (6/48) |
| qm | openai:gpt-6.1-sol | no-catalog | 2.1% [0.1%, 11.1%] (1/48) | 2.1% [0.1%, 11.1%] (1/48) |
| qm | openai:gpt-6.1-sol | resolver-on | 14.6% [6.1%, 27.8%] (7/48) | 14.6% [6.1%, 27.8%] (7/48) |

| stratum | success pairs | success B minus A | 95% interval | used_it B minus A | 95% interval |
| --- | --- | --- | --- | --- | --- |
| overlap none | 104 | +3.8 | [-1.9, +11.5] | +3.8 | [-1.9, +11.5] |
| overlap low | 160 | +9.4 | [+3.1, +16.9] | +8.8 | [+2.5, +15.6] |
| overlap mid | 112 | +0.0 | [-2.7, +2.7] | +0.0 | [-2.7, +2.7] |
| overlap high | 8 | +0.0 | - | +0.0 | - |
| flagged guessable | 48 | +18.8 | [+4.2, +35.4] | +16.7 | [+4.2, +31.3] |
| flagged strict_used_it | 32 | +6.3 | [+0.0, +18.8] | +6.3 | [+0.0, +18.8] |
| flagged may_stall | 16 | +0.0 | [+0.0, +0.0] | +0.0 | [+0.0, +0.0] |

## Context footprint (injected block tokens per session)

| harness | arm | sessions | turn 1 median (max) | turn 10 median (max) | turn 50 median (max) | first budget_exhausted turn (median, min) |
| --- | --- | --- | --- | --- | --- | --- |
| claude-code | native | 289 | 0 (0) | - | - | never |
| claude-code | resolver-on | 289 | 213 (267) | - | - | never |
| codex | native | 289 | 0 (0) | - | - | never |
| codex | resolver-on | 289 | 294 (345) | - | - | never |
| hermes | native | 578 | 0 (0) | - | - | never |
| hermes | resolver-on | 578 | 214 (268) | - | - | never |
| openclaw | native | 578 | 0 (0) | - | - | never |
| openclaw | resolver-on | 578 | 277 (328) | - | - | never |
| qm | native | 574 | 0 (0) | - | - | never |
| qm | qm-pull | 6 | 0 (0) | - | - | never |
| qm | resolver-on | 573 | 216 (270) | - | - | never |

## Set P by overlap bin (resolver-on minus native)

|  | pairs | worse in B | A | B | B minus A (points) | 95% interval | sign-flip p | McNemar p | reading |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| none | 541 | 31 | 29.6% | 37.9% | +8.3 | [+4.4, +12.0] | <0.001 | <0.001 | resolver-on higher |
| low | 726 | 49 | 39.5% | 52.6% | +13.1 | [+8.7, +17.5] | <0.001 | <0.001 | resolver-on higher |
| mid | 337 | 23 | 48.7% | 67.1% | +18.4 | [+11.5, +25.4] | <0.001 | <0.001 | resolver-on higher |
| high | 33 | 2 | 78.8% | 87.9% | +9.1 | [+0.0, +22.6] | 0.500 | 0.453 | no measurable difference |

## Denominators (set P, native)

| harness | model | requests | in denominator | no_skill_needed | no acceptable skill reachable |
| --- | --- | --- | --- | --- | --- |
| claude-code | anthropic:claude-opus-5-5 | 289 | 229 | 60 | 0 |
| codex | openai:gpt-6.1-sol | 289 | 228 | 61 | 0 |
| hermes | anthropic:claude-opus-5-5 | 289 | 227 | 60 | 2 |
| hermes | openai:gpt-6.1-sol | 289 | 225 | 61 | 3 |
| openclaw | anthropic:claude-opus-5-5 | 289 | 147 | 60 | 82 |
| openclaw | openai:gpt-6.1-sol | 289 | 133 | 61 | 95 |
| qm | anthropic:claude-opus-5-5 | 289 | 226 | 60 | 3 |
| qm | openai:gpt-6.1-sol | 289 | 224 | 61 | 4 |

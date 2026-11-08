# Instruction followed, H10 (scripts/instruction-followed-h10.ts)

A member turn is followed when a gbrain call sits before its first reply (scripts/instruction-followed.ts turnOutcomes). Sessions and repeat turns come from each task's own turn order. Model and driver are named beside every row.

**No headroom:** claude-code-opus-gbrain-route-tool-mu-v03-dev (control 60.0%), claude-code-opus-gbrain-sdk-preset-route-tool-mu-v03-dev (control 56.7%), claude-code-opus-gbrain-sdk-preset-route-told-mu-v03-dev (control 100.0%), claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev (control 60.0%) followed more than 25.0% of turns, so the contrasts against it are descriptive.

## Per cell

| Cell | Harness | Model | Driver | Route | Trials (excluded) | Followed | Repeat turns followed | Discovery | Load | Pass | Cost per trial | per followed turn | per passed trial | Approval or Tirith |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-code-opus-gbrain-route-tool-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-tool | 10 (0) | 18 / 30 (60.0%) | 6 / 10 (60.0%) | n/a | n/a | 6 / 10 (60.0%) | $0.2287 | $0.1271 | $0.3812 | not recorded |
| claude-code-opus-gbrain-route-hook-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-hook | 10 (0) | 26 / 30 (86.7%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.2657 | $0.1022 | $0.3796 | not recorded |
| claude-code-opus-gbrain-route-once-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-once | 10 (0) | 23 / 30 (76.7%) | 8 / 10 (80.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 5 / 10 (50.0%) | $0.2513 | $0.1093 | $0.5026 | not recorded |
| claude-code-opus-gbrain-route-system-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-system | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.3363 | $0.1121 | $0.4804 | not recorded |
| claude-code-opus-gbrain-route-startup-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-startup | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.3211 | $0.1070 | $0.5352 | not recorded |
| claude-code-opus-gbrain-sdk-preset-route-tool-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | sdk-preset | route-tool | 10 (0) | 17 / 30 (56.7%) | 6 / 10 (60.0%) | n/a | n/a | 6 / 10 (60.0%) | $0.2272 | $0.1336 | $0.3786 | not recorded |
| claude-code-opus-gbrain-sdk-preset-route-told-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | sdk-preset | route-told | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 5 / 10 (50.0%) | $0.3388 | $0.1129 | $0.6775 | not recorded |
| claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | sdk-preset | route-skill | 10 (0) | 18 / 30 (60.0%) | 6 / 10 (60.0%) | 30 / 30 (100.0%) | 0 / 30 (0.0%) | 6 / 10 (60.0%) | $0.2136 | $0.1187 | $0.3560 | not recorded |
| claude-code-opus-gbrain-sdk-default-route-told-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | sdk-default | route-told | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 8 / 10 (80.0%) | $0.3403 | $0.1134 | $0.4253 | not recorded |
| claude-code-opus-gbrain-sdk-default-route-skill-mu-v03-dev | claude-code | anthropic:claude-opus-5-5 | sdk-default | route-skill | 10 (0) | 17 / 30 (56.7%) | 7 / 10 (70.0%) | 30 / 30 (100.0%) | 0 / 30 (0.0%) | 6 / 10 (60.0%) | $0.2252 | $0.1325 | $0.3753 | not recorded |
| codex-sol-gbrain-route-tool-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-tool | 10 (0) | 6 / 30 (20.0%) | 2 / 10 (20.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.1210 | $0.2017 | $0.1729 | not recorded |
| codex-sol-gbrain-route-hook-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-hook | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1558 | $0.0519 | $0.2226 | not recorded |
| codex-sol-gbrain-route-once-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-once | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1596 | $0.0532 | $0.2280 | not recorded |
| codex-sol-gbrain-route-system-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-system | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1599 | $0.0533 | $0.2284 | not recorded |
| codex-sol-gbrain-route-startup-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-startup | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1654 | $0.0551 | $0.2363 | not recorded |
| codex-sol-gbrain-route-told-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-told | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | $0.1878 | $0.0626 | $0.1878 | not recorded |
| codex-sol-gbrain-route-skill-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-skill | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 9 / 10 (90.0%) | $0.1790 | $0.0597 | $0.1989 | not recorded |
| codex-sol-gbrain-route-placebo-mu-v03-dev | codex | openai:gpt-6.1-sol | cli | route-placebo | 10 (0) | 5 / 30 (16.7%) | 1 / 10 (10.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1157 | $0.2315 | $0.1653 | not recorded |
| hermes-sol-gbrain-route-tool-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-tool | 10 (0) | 4 / 30 (13.3%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.1340 | $0.3349 | $0.1914 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-hook-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-hook | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.1635 | $0.0545 | $0.2724 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-once-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-once | 10 (0) | 22 / 30 (73.3%) | 2 / 10 (20.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1564 | $0.0711 | $0.2235 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-system-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-system | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1617 | $0.0539 | $0.2309 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-startup-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-startup | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1610 | $0.0537 | $0.2299 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-skill-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-skill | 10 (0) | 4 / 30 (13.3%) | 0 / 10 (0.0%) | 30 / 30 (100.0%) | 0 / 30 (0.0%) | 7 / 10 (70.0%) | $0.1352 | $0.3381 | $0.1932 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-placebo-mu-v03-dev | hermes | openai:gpt-6.1-sol | cli | route-placebo | 10 (0) | 4 / 30 (13.3%) | 0 / 10 (0.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1287 | $0.3218 | $0.1839 | 0 cards, 0 Tirith blocks |
| openclaw-sol-gbrain-route-tool-mu-v03-dev | openclaw | openai:gpt-6.1-sol | cli | route-tool | 10 (0) | 6 / 30 (20.0%) | 2 / 10 (20.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.0898 | $0.1497 | $0.1283 | not recorded |
| openclaw-sol-gbrain-route-hook-mu-v03-dev | openclaw | openai:gpt-6.1-sol | cli | route-hook | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.1155 | $0.0385 | $0.1924 | not recorded |
| openclaw-sol-gbrain-route-once-mu-v03-dev | openclaw | openai:gpt-6.1-sol | cli | route-once | 10 (0) | 24 / 30 (80.0%) | 4 / 10 (40.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1075 | $0.0448 | $0.1536 | not recorded |
| openclaw-sol-gbrain-route-startup-mu-v03-dev | openclaw | openai:gpt-6.1-sol | cli | route-startup | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1247 | $0.0416 | $0.1781 | not recorded |
| openclaw-sol-gbrain-route-skill-mu-v03-dev | openclaw | openai:gpt-6.1-sol | cli | route-skill | 10 (0) | 29 / 30 (96.7%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1212 | $0.0418 | $0.1731 | not recorded |

## Copies of the rule or placebo per request (proxy route_copies, housekeeping left out)

| Cell | Requests | System | User (this turn) | Tool result | History | Skill listing | Copies per trial | Housekeeping requests |
|---|---|---|---|---|---|---|---|---|
| claude-code-opus-gbrain-route-tool-mu-v03-dev | 132 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| claude-code-opus-gbrain-route-hook-mu-v03-dev | 145 | 1.32 | 0.00 | 0.00 | 0.00 | 0.00 | 19.10 | 0 |
| claude-code-opus-gbrain-route-once-mu-v03-dev | 143 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 14.30 | 0 |
| claude-code-opus-gbrain-route-system-mu-v03-dev | 145 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 14.50 | 0 |
| claude-code-opus-gbrain-route-startup-mu-v03-dev | 147 | 0.00 | 0.72 | 0.00 | 0.28 | 0.00 | 14.70 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-tool-mu-v03-dev | 133 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-told-mu-v03-dev | 172 | 0.00 | 0.00 | 0.00 | 0.88 | 1.00 | 15.20 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev | 125 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0 |
| claude-code-opus-gbrain-sdk-default-route-told-mu-v03-dev | 169 | 0.00 | 0.00 | 0.00 | 0.88 | 1.00 | 14.90 | 0 |
| claude-code-opus-gbrain-sdk-default-route-skill-mu-v03-dev | 134 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0 |
| codex-sol-gbrain-route-tool-mu-v03-dev | 126 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| codex-sol-gbrain-route-hook-mu-v03-dev | 129 | 1.28 | 0.00 | 0.00 | 0.00 | 0.00 | 16.50 | 0 |
| codex-sol-gbrain-route-once-mu-v03-dev | 133 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 13.30 | 0 |
| codex-sol-gbrain-route-system-mu-v03-dev | 133 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 13.30 | 0 |
| codex-sol-gbrain-route-startup-mu-v03-dev | 140 | 0.00 | 0.75 | 0.00 | 0.25 | 0.00 | 14.00 | 0 |
| codex-sol-gbrain-route-told-mu-v03-dev | 149 | 0.00 | 0.00 | 0.87 | 0.00 | 1.00 | 12.90 | 0 |
| codex-sol-gbrain-route-skill-mu-v03-dev | 138 | 0.00 | 0.00 | 0.86 | 0.00 | 1.00 | 11.80 | 0 |
| codex-sol-gbrain-route-placebo-mu-v03-dev | 117 | 1.29 | 0.00 | 0.00 | 0.00 | 0.00 | 15.10 | 0 |
| hermes-sol-gbrain-route-tool-mu-v03-dev | 176 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| hermes-sol-gbrain-route-hook-mu-v03-dev | 203 | 0.00 | 1.00 | 0.00 | 0.27 | 0.00 | 25.70 | 0 |
| hermes-sol-gbrain-route-once-mu-v03-dev | 196 | 0.00 | 0.80 | 0.00 | 0.20 | 0.00 | 19.60 | 0 |
| hermes-sol-gbrain-route-system-mu-v03-dev | 195 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 19.50 | 0 |
| hermes-sol-gbrain-route-startup-mu-v03-dev | 192 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 19.20 | 0 |
| hermes-sol-gbrain-route-skill-mu-v03-dev | 180 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0 |
| hermes-sol-gbrain-route-placebo-mu-v03-dev | 159 | 0.00 | 1.00 | 0.00 | 0.23 | 0.00 | 19.50 | 0 |
| openclaw-sol-gbrain-route-tool-mu-v03-dev | 93 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| openclaw-sol-gbrain-route-hook-mu-v03-dev | 150 | 0.00 | 0.99 | 0.00 | 0.31 | 0.00 | 19.50 | 0 |
| openclaw-sol-gbrain-route-once-mu-v03-dev | 134 | 0.00 | 0.74 | 0.00 | 0.26 | 0.00 | 13.40 | 0 |
| openclaw-sol-gbrain-route-startup-mu-v03-dev | 169 | 0.99 | 0.00 | 0.00 | 0.00 | 0.00 | 16.70 | 0 |
| openclaw-sol-gbrain-route-skill-mu-v03-dev | 170 | 0.00 | 0.00 | 0.88 | 0.00 | 1.00 | 15.00 | 0 |

## Cross-checks (printed, never used to drop a turn)

| Cell | TurnWindow session mismatches | Adapter session_turn mismatches | Adapter emitted mismatches | Turns with no adapter route status |
|---|---|---|---|---|
| claude-code-opus-gbrain-route-tool-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-hook-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-once-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-system-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-startup-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-tool-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-told-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-default-route-told-mu-v03-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-default-route-skill-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-tool-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-hook-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-once-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-system-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-startup-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-told-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-skill-mu-v03-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-placebo-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-tool-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-hook-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-once-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-system-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-startup-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-skill-mu-v03-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-placebo-mu-v03-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-tool-mu-v03-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-hook-mu-v03-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-once-mu-v03-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-startup-mu-v03-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-skill-mu-v03-dev | 0 | 0 | 0 | 0 |

## Family A (pooled over pairs, clustered on task, Holm over the family)

| Contrast | Pairs pooled | Task clusters (floor) | Difference, points [95% CI] | p (two-sided) | Holm p | Reading |
|---|---|---|---|---|---|---|
| repetition | claude-code opus cli, codex sol, hermes sol, openclaw sol | 9 (9) | -38.9 [-50.0, -27.8] | 0.0078 | 0.0078 | inferential |
| repetition: claude-code opus cli | own estimate | 9 | -20.0 [-50.0, +0.0] | 0.5000 | - | 10 turn pairs |
| repetition: codex sol | own estimate | 9 | +0.0 [+0.0, +0.0] | 1.0000 | - | 10 turn pairs |
| repetition: hermes sol | own estimate | 9 | -80.0 [-100.0, -50.0] | 0.0156 | - | 10 turn pairs |
| repetition: openclaw sol | own estimate | 9 | -60.0 [-90.0, -22.2] | 0.0625 | - | 10 turn pairs |
| placement | claude-code opus cli, hermes sol, codex sol | 10 (10) | -17.5 [-26.1, -10.6] | 0.0039 | 0.0078 | inferential |
| placement: claude-code opus cli | own estimate | 10 | -23.3 [-38.7, -10.3] | 0.0313 | - | 30 turn pairs |
| placement: hermes sol | own estimate | 10 | -26.7 [-40.0, -13.8] | 0.0156 | - | 30 turn pairs |
| placement: codex sol | own estimate | 10 | +0.0 [+0.0, +0.0] | 1.0000 | - | 30 turn pairs |

## Family B (each route against its own control, per harness, model and driver; Holm within the family)

| Family | Route | Pairs (tasks) | Control | Route share | Difference, points [95% CI] | p (two-sided) | Holm p | Reading |
|---|---|---|---|---|---|---|---|---|
| claude-code anthropic:claude-opus-5-5 cli | route-hook | 30 (10) | 60.0% | 86.7% | +26.7 [+12.1, +44.8] | 0.0313 | 0.0625 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 cli | route-once | 30 (10) | 60.0% | 76.7% | +16.7 [+3.6, +31.0] | 0.1250 | 0.1250 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 cli | route-system | 30 (10) | 60.0% | 100.0% | +40.0 [+23.3, +59.4] | 0.0078 | 0.0313 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 cli | route-startup | 30 (10) | 60.0% | 100.0% | +40.0 [+23.3, +59.4] | 0.0078 | 0.0313 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 sdk-preset | sdk-preset+route-told | 30 (10) | 56.7% | 100.0% | +43.3 [+23.3, +63.3] | 0.0156 | 0.0313 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 sdk-preset | sdk-preset+route-skill | 30 (10) | 56.7% | 60.0% | +3.3 [+0.0, +9.7] | 1.0000 | 1.0000 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 stub effect (sdk-default minus sdk-preset) | sdk-default+route-told | 30 (10) | 100.0% | 100.0% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 stub effect (sdk-default minus sdk-preset) | sdk-default+route-skill | 30 (10) | 60.0% | 56.7% | -3.3 [-12.9, +7.4] | 1.0000 | 1.0000 | descriptive: no headroom |
| codex openai:gpt-6.1-sol cli | route-hook | 30 (10) | 20.0% | 100.0% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.1-sol cli | route-once | 30 (10) | 20.0% | 100.0% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.1-sol cli | route-system | 30 (10) | 20.0% | 100.0% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.1-sol cli | route-startup | 30 (10) | 20.0% | 100.0% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.1-sol cli | route-told | 30 (10) | 20.0% | 100.0% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.1-sol cli | route-skill | 30 (10) | 20.0% | 100.0% | +80.0 [+61.5, +96.3] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.1-sol cli | route-placebo | 30 (10) | 20.0% | 16.7% | -3.3 [-10.7, +0.0] | 1.0000 | 1.0000 | inferential |
| hermes openai:gpt-6.1-sol cli | route-hook | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.1-sol cli | route-once | 30 (10) | 13.3% | 73.3% | +60.0 [+50.0, +68.8] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.1-sol cli | route-system | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.1-sol cli | route-startup | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.1-sol cli | route-skill | 30 (10) | 13.3% | 13.3% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | inferential |
| hermes openai:gpt-6.1-sol cli | route-placebo | 30 (10) | 13.3% | 13.3% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | inferential |
| openclaw openai:gpt-6.1-sol cli | route-hook | 30 (10) | 20.0% | 100.0% | +80.0 [+60.7, +96.6] | 0.0039 | 0.0156 | inferential |
| openclaw openai:gpt-6.1-sol cli | route-once | 30 (10) | 20.0% | 80.0% | +60.0 [+34.5, +80.6] | 0.0098 | 0.0156 | inferential |
| openclaw openai:gpt-6.1-sol cli | route-startup | 30 (10) | 20.0% | 100.0% | +80.0 [+60.7, +96.6] | 0.0039 | 0.0156 | inferential |
| openclaw openai:gpt-6.1-sol cli | route-skill | 30 (10) | 20.0% | 96.7% | +76.7 [+58.6, +92.3] | 0.0039 | 0.0156 | inferential |

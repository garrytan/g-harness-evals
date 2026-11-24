# Instruction followed, H10 (scripts/instruction-followed-h10.ts)

A member turn is followed when a gbrain call sits before its first reply (scripts/instruction-followed.ts turnOutcomes). Sessions and repeat turns come from each task's own turn order. Model and driver are named beside every row.

**No headroom:** claude-code-opus-gbrain-route-tool-mu-v031-dev (control 46.7%), claude-code-opus-gbrain-sdk-preset-route-tool-mu-v031-dev (control 46.7%), claude-code-opus-gbrain-sdk-preset-route-told-mu-v031-dev (control 100.0%), claude-code-opus-gbrain-sdk-preset-route-skill-mu-v031-dev (control 40.0%) followed more than 25.0% of turns, so the contrasts against it are descriptive.

## Per cell

| Cell | Harness | Model | Driver | Route | Trials (excluded) | Followed | Repeat turns followed | Discovery | Load | Pass | Cost per trial | per followed turn | per passed trial | Approval or Tirith |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-code-opus-gbrain-route-tool-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-tool | 10 (0) | 14 / 30 (46.7%) | 6 / 10 (60.0%) | n/a | n/a | 8 / 10 (80.0%) | $0.2243 | $0.1602 | $0.2804 | not recorded |
| claude-code-opus-gbrain-route-hook-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-hook | 10 (0) | 22 / 30 (73.3%) | 8 / 10 (80.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.2730 | $0.1241 | $0.3900 | not recorded |
| claude-code-opus-gbrain-route-once-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-once | 10 (0) | 17 / 30 (56.7%) | 5 / 10 (50.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.2189 | $0.1288 | $0.3127 | not recorded |
| claude-code-opus-gbrain-route-system-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-system | 10 (0) | 29 / 30 (96.7%) | 9 / 10 (90.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.3793 | $0.1308 | $0.5418 | not recorded |
| claude-code-opus-gbrain-route-startup-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | cli | route-startup | 10 (0) | 29 / 30 (96.7%) | 9 / 10 (90.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.3464 | $0.1195 | $0.5773 | not recorded |
| claude-code-opus-gbrain-sdk-preset-route-tool-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | sdk-preset | route-tool | 10 (0) | 14 / 30 (46.7%) | 5 / 10 (50.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.2387 | $0.1705 | $0.3410 | not recorded |
| claude-code-opus-gbrain-sdk-preset-route-told-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | sdk-preset | route-told | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.3925 | $0.1308 | $0.6542 | not recorded |
| claude-code-opus-gbrain-sdk-preset-route-skill-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | sdk-preset | route-skill | 10 (0) | 12 / 30 (40.0%) | 6 / 10 (60.0%) | 30 / 30 (100.0%) | 0 / 30 (0.0%) | 7 / 10 (70.0%) | $0.2065 | $0.1721 | $0.2950 | not recorded |
| claude-code-opus-gbrain-sdk-default-route-told-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | sdk-default | route-told | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.3671 | $0.1224 | $0.5245 | not recorded |
| claude-code-opus-gbrain-sdk-default-route-skill-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | sdk-default | route-skill | 10 (0) | 14 / 30 (46.7%) | 6 / 10 (60.0%) | 30 / 30 (100.0%) | 0 / 30 (0.0%) | 8 / 10 (80.0%) | $0.2161 | $0.1544 | $0.2701 | not recorded |
| codex-sol-gbrain-route-tool-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-tool | 10 (0) | 4 / 30 (13.3%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.0900 | $0.2249 | $0.1285 | not recorded |
| codex-sol-gbrain-route-hook-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-hook | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 5 / 10 (50.0%) | $0.1144 | $0.0381 | $0.2289 | not recorded |
| codex-sol-gbrain-route-once-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-once | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 4 / 10 (40.0%) | $0.1195 | $0.0398 | $0.2987 | not recorded |
| codex-sol-gbrain-route-system-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-system | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 9 / 10 (90.0%) | $0.1175 | $0.0392 | $0.1306 | not recorded |
| codex-sol-gbrain-route-startup-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-startup | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.1167 | $0.0389 | $0.1945 | not recorded |
| codex-sol-gbrain-route-told-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-told | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 5 / 10 (50.0%) | $0.1256 | $0.0419 | $0.2511 | not recorded |
| codex-sol-gbrain-route-skill-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-skill | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 8 / 10 (80.0%) | $0.1208 | $0.0403 | $0.1510 | not recorded |
| codex-sol-gbrain-route-placebo-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | route-placebo | 10 (0) | 7 / 30 (23.3%) | 1 / 10 (10.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 8 / 10 (80.0%) | $0.0929 | $0.1327 | $0.1161 | not recorded |
| hermes-sol-gbrain-route-tool-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-tool | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.2136 | undefined | $0.3052 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-hook-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-hook | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 5 / 10 (50.0%) | $0.3156 | $0.1052 | $0.6312 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-once-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-once | 10 (0) | 20 / 30 (66.7%) | 0 / 10 (0.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.2892 | $0.1446 | $0.4132 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-system-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-system | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.2992 | $0.0997 | $0.4275 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-startup-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-startup | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.3135 | $0.1045 | $0.5226 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-skill-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-skill | 10 (0) | 4 / 30 (13.3%) | 2 / 10 (20.0%) | 30 / 30 (100.0%) | 4 / 30 (13.3%) | 7 / 10 (70.0%) | $0.2289 | $0.5722 | $0.3270 | 0 cards, 0 Tirith blocks |
| hermes-sol-gbrain-route-placebo-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | route-placebo | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.2002 | undefined | $0.2861 | 0 cards, 0 Tirith blocks |
| openclaw-sol-gbrain-route-tool-mu-v031-dev | openclaw | openai:gpt-6.2-sol | cli | route-tool | 10 (0) | 4 / 30 (13.3%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.1271 | $0.3177 | $0.1815 | not recorded |
| openclaw-sol-gbrain-route-hook-mu-v031-dev | openclaw | openai:gpt-6.2-sol | cli | route-hook | 10 (0) | 30 / 30 (100.0%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.1823 | $0.0608 | $0.3039 | not recorded |
| openclaw-sol-gbrain-route-once-mu-v031-dev | openclaw | openai:gpt-6.2-sol | cli | route-once | 10 (0) | 23 / 30 (76.7%) | 3 / 10 (30.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 6 / 10 (60.0%) | $0.1922 | $0.0835 | $0.3203 | not recorded |
| openclaw-sol-gbrain-route-startup-mu-v031-dev | openclaw | openai:gpt-6.2-sol | cli | route-startup | 10 (0) | 29 / 30 (96.7%) | 10 / 10 (100.0%) | 30 / 30 (100.0%) | 30 / 30 (100.0%) | 7 / 10 (70.0%) | $0.1602 | $0.0552 | $0.2288 | not recorded |
| openclaw-sol-gbrain-route-skill-mu-v031-dev | openclaw | openai:gpt-6.2-sol | cli | route-skill | 10 (0) | 27 / 30 (90.0%) | 9 / 10 (90.0%) | 30 / 30 (100.0%) | 2 / 30 (6.7%) | 7 / 10 (70.0%) | $0.1684 | $0.0624 | $0.2405 | not recorded |
| claude-code-opus-none-mu-v031-dev | claude-code | anthropic:claude-opus-5-5 | cli | default | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.1746 | undefined | $0.2494 | not recorded |
| codex-sol-none-mu-v031-dev | codex | openai:gpt-6.2-sol | cli | default | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.0652 | undefined | $0.0931 | not recorded |
| hermes-sol-none-mu-v031-dev | hermes | openai:gpt-6.2-sol | cli | default | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | n/a | n/a | 8 / 10 (80.0%) | $0.2135 | undefined | $0.2669 | not recorded |
| openclaw-sol-none-mu-v031-dev | openclaw | openai:gpt-6.2-sol | cli | default | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.1353 | undefined | $0.1933 | not recorded |
| qm-pi-sol-none-mu-v031-dev | qm | openai:gpt-6.2-sol | cli | default | 10 (0) | 0 / 30 (0.0%) | 0 / 10 (0.0%) | n/a | n/a | 7 / 10 (70.0%) | $0.0771 | undefined | $0.1101 | not recorded |
| qm-pi-sol-gbrain-route-tool-mu-v031-dev | qm | openai:gpt-6.2-sol | cli | default | 10 (1) | 0 / 28 (0.0%) | 0 / 9 (0.0%) | n/a | n/a | 6 / 9 (66.7%) | $0.0882 | undefined | $0.1323 | not recorded |

## Copies of the rule or placebo per request (proxy route_copies, housekeeping left out)

| Cell | Requests | System | User (this turn) | Tool result | History | Skill listing | Copies per trial | Housekeeping requests |
|---|---|---|---|---|---|---|---|---|
| claude-code-opus-gbrain-route-tool-mu-v031-dev | 134 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| claude-code-opus-gbrain-route-hook-mu-v031-dev | 147 | 1.34 | 0.00 | 0.00 | 0.00 | 0.00 | 19.70 | 0 |
| claude-code-opus-gbrain-route-once-mu-v031-dev | 142 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 14.20 | 0 |
| claude-code-opus-gbrain-route-system-mu-v031-dev | 158 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 15.80 | 0 |
| claude-code-opus-gbrain-route-startup-mu-v031-dev | 155 | 0.00 | 0.70 | 0.00 | 0.30 | 0.00 | 15.50 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-tool-mu-v031-dev | 144 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-told-mu-v031-dev | 187 | 0.00 | 0.00 | 0.00 | 0.94 | 1.00 | 17.60 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-skill-mu-v031-dev | 125 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0 |
| claude-code-opus-gbrain-sdk-default-route-told-mu-v031-dev | 172 | 0.00 | 0.00 | 0.00 | 0.88 | 1.00 | 15.20 | 0 |
| claude-code-opus-gbrain-sdk-default-route-skill-mu-v031-dev | 127 | 0.00 | 0.00 | 0.00 | 0.00 | 1.00 | 0.00 | 0 |
| codex-sol-gbrain-route-tool-mu-v031-dev | 101 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| codex-sol-gbrain-route-hook-mu-v031-dev | 131 | 1.41 | 0.00 | 0.00 | 0.00 | 0.00 | 18.50 | 0 |
| codex-sol-gbrain-route-once-mu-v031-dev | 133 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 13.30 | 0 |
| codex-sol-gbrain-route-system-mu-v031-dev | 139 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 13.90 | 0 |
| codex-sol-gbrain-route-startup-mu-v031-dev | 131 | 0.00 | 0.63 | 0.00 | 0.37 | 0.00 | 13.10 | 0 |
| codex-sol-gbrain-route-told-mu-v031-dev | 166 | 0.00 | 0.00 | 0.88 | 0.00 | 1.00 | 14.60 | 0 |
| codex-sol-gbrain-route-skill-mu-v031-dev | 158 | 0.00 | 0.00 | 0.87 | 0.00 | 1.00 | 13.80 | 0 |
| codex-sol-gbrain-route-placebo-mu-v031-dev | 104 | 1.40 | 0.00 | 0.00 | 0.00 | 0.00 | 14.60 | 0 |
| hermes-sol-gbrain-route-tool-mu-v031-dev | 148 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| hermes-sol-gbrain-route-hook-mu-v031-dev | 214 | 0.00 | 1.00 | 0.00 | 0.31 | 0.00 | 28.10 | 0 |
| hermes-sol-gbrain-route-once-mu-v031-dev | 198 | 0.00 | 0.78 | 0.00 | 0.22 | 0.00 | 19.80 | 0 |
| hermes-sol-gbrain-route-system-mu-v031-dev | 202 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 20.20 | 0 |
| hermes-sol-gbrain-route-startup-mu-v031-dev | 208 | 1.00 | 0.00 | 0.00 | 0.00 | 0.00 | 20.80 | 0 |
| hermes-sol-gbrain-route-skill-mu-v031-dev | 158 | 0.00 | 0.00 | 0.17 | 0.00 | 1.00 | 2.70 | 0 |
| hermes-sol-gbrain-route-placebo-mu-v031-dev | 135 | 0.00 | 1.00 | 0.00 | 0.33 | 0.00 | 18.00 | 0 |
| openclaw-sol-gbrain-route-tool-mu-v031-dev | 133 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 |
| openclaw-sol-gbrain-route-hook-mu-v031-dev | 232 | 0.00 | 0.97 | 0.00 | 0.34 | 0.00 | 30.60 | 0 |
| openclaw-sol-gbrain-route-once-mu-v031-dev | 224 | 0.00 | 0.73 | 0.00 | 0.27 | 0.00 | 22.40 | 0 |
| openclaw-sol-gbrain-route-startup-mu-v031-dev | 184 | 0.97 | 0.00 | 0.00 | 0.00 | 0.00 | 17.80 | 0 |
| openclaw-sol-gbrain-route-skill-mu-v031-dev | 215 | 0.00 | 0.00 | 0.03 | 0.00 | 0.96 | 0.70 | 0 |
| claude-code-opus-none-mu-v031-dev | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 |
| codex-sol-none-mu-v031-dev | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 |
| hermes-sol-none-mu-v031-dev | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 |
| openclaw-sol-none-mu-v031-dev | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 |
| qm-pi-sol-none-mu-v031-dev | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 |
| qm-pi-sol-gbrain-route-tool-mu-v031-dev | 0 | n/a | n/a | n/a | n/a | n/a | n/a | 0 |

## Cross-checks (printed, never used to drop a turn)

| Cell | TurnWindow session mismatches | Adapter session_turn mismatches | Adapter emitted mismatches | Turns with no adapter route status |
|---|---|---|---|---|
| claude-code-opus-gbrain-route-tool-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-hook-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-once-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-system-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-route-startup-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-tool-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-told-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-preset-route-skill-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-default-route-told-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-gbrain-sdk-default-route-skill-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-tool-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-hook-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-once-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-system-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-startup-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-told-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-skill-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-gbrain-route-placebo-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-tool-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-hook-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-once-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-system-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-startup-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-skill-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-gbrain-route-placebo-mu-v031-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-tool-mu-v031-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-hook-mu-v031-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-once-mu-v031-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-startup-mu-v031-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-gbrain-route-skill-mu-v031-dev | 0 | 0 | 0 | 0 |
| claude-code-opus-none-mu-v031-dev | 0 | 0 | 0 | 0 |
| codex-sol-none-mu-v031-dev | 0 | 0 | 0 | 0 |
| hermes-sol-none-mu-v031-dev | 0 | 0 | 0 | 0 |
| openclaw-sol-none-mu-v031-dev | 0 | 0 | 0 | 0 |
| qm-pi-sol-none-mu-v031-dev | 0 | 0 | 0 | 0 |
| qm-pi-sol-gbrain-route-tool-mu-v031-dev | 0 | 0 | 0 | 0 |

## Family A (pooled over pairs, clustered on task, Holm over the family)

| Contrast | Pairs pooled | Task clusters (floor) | Difference, points [95% CI] | p (two-sided) | Holm p | Reading |
|---|---|---|---|---|---|---|
| repetition | claude-code opus cli, codex sol, hermes sol, openclaw sol | 9 (9) | -48.6 [-54.2, -41.7] | 0.0039 | 0.0039 | inferential |
| repetition: claude-code opus cli | own estimate | 9 | -30.0 [-55.6, +0.0] | 0.2500 | - | 10 turn pairs |
| repetition: codex sol | own estimate | 9 | +0.0 [+0.0, +0.0] | 1.0000 | - | 10 turn pairs |
| repetition: hermes sol | own estimate | 9 | -100.0 [-100.0, -100.0] | 0.0039 | - | 10 turn pairs |
| repetition: openclaw sol | own estimate | 9 | -70.0 [-100.0, -33.3] | 0.0313 | - | 10 turn pairs |
| placement | claude-code opus cli, hermes sol, codex sol | 10 (10) | -24.2 [-30.6, -18.6] | 0.0020 | 0.0039 | inferential |
| placement: claude-code opus cli | own estimate | 10 | -40.0 [-60.0, -20.7] | 0.0156 | - | 30 turn pairs |
| placement: hermes sol | own estimate | 10 | -33.3 [-44.8, -21.9] | 0.0039 | - | 30 turn pairs |
| placement: codex sol | own estimate | 10 | +0.0 [+0.0, +0.0] | 1.0000 | - | 30 turn pairs |

## Family B (each route against its own control, per harness, model and driver; Holm within the family)

| Family | Route | Pairs (tasks) | Control | Route share | Difference, points [95% CI] | p (two-sided) | Holm p | Reading |
|---|---|---|---|---|---|---|---|---|
| claude-code anthropic:claude-opus-5-5 cli | route-hook | 30 (10) | 46.7% | 73.3% | +26.7 [+11.5, +41.9] | 0.0313 | 0.0625 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 cli | route-once | 30 (10) | 46.7% | 56.7% | +10.0 [-6.3, +25.9] | 0.5000 | 0.5000 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 cli | route-system | 30 (10) | 46.7% | 96.7% | +50.0 [+33.3, +66.7] | 0.0039 | 0.0156 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 cli | route-startup | 30 (10) | 46.7% | 96.7% | +50.0 [+29.0, +70.0] | 0.0078 | 0.0234 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 sdk-preset | sdk-preset+route-told | 30 (10) | 46.7% | 100.0% | +53.3 [+35.5, +71.4] | 0.0039 | 0.0078 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 sdk-preset | sdk-preset+route-skill | 30 (10) | 46.7% | 40.0% | -6.7 [-21.9, +7.7] | 0.7500 | 0.7500 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 stub effect (sdk-default minus sdk-preset) | sdk-default+route-told | 30 (10) | 100.0% | 100.0% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | descriptive: no headroom |
| claude-code anthropic:claude-opus-5-5 stub effect (sdk-default minus sdk-preset) | sdk-default+route-skill | 30 (10) | 40.0% | 46.7% | +6.7 [-7.1, +23.3] | 0.7500 | 1.0000 | descriptive: no headroom |
| codex openai:gpt-6.2-sol cli | route-hook | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.2-sol cli | route-once | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.2-sol cli | route-system | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.2-sol cli | route-startup | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.2-sol cli | route-told | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.2-sol cli | route-skill | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0137 | inferential |
| codex openai:gpt-6.2-sol cli | route-placebo | 30 (10) | 13.3% | 23.3% | +10.0 [+0.0, +25.0] | 0.5000 | 0.5000 | inferential |
| hermes openai:gpt-6.2-sol cli | route-hook | 30 (10) | 0.0% | 100.0% | +100.0 [+100.0, +100.0] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.2-sol cli | route-once | 30 (10) | 0.0% | 66.7% | +66.7 [+55.2, +78.1] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.2-sol cli | route-system | 30 (10) | 0.0% | 100.0% | +100.0 [+100.0, +100.0] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.2-sol cli | route-startup | 30 (10) | 0.0% | 100.0% | +100.0 [+100.0, +100.0] | 0.0020 | 0.0117 | inferential |
| hermes openai:gpt-6.2-sol cli | route-skill | 30 (10) | 0.0% | 13.3% | +13.3 [+0.0, +32.3] | 0.5000 | 1.0000 | inferential |
| hermes openai:gpt-6.2-sol cli | route-placebo | 30 (10) | 0.0% | 0.0% | +0.0 [+0.0, +0.0] | 1.0000 | 1.0000 | inferential |
| openclaw openai:gpt-6.2-sol cli | route-hook | 30 (10) | 13.3% | 100.0% | +86.7 [+75.9, +96.7] | 0.0020 | 0.0078 | inferential |
| openclaw openai:gpt-6.2-sol cli | route-once | 30 (10) | 13.3% | 76.7% | +63.3 [+44.4, +80.6] | 0.0039 | 0.0078 | inferential |
| openclaw openai:gpt-6.2-sol cli | route-startup | 30 (10) | 13.3% | 96.7% | +83.3 [+69.2, +96.6] | 0.0020 | 0.0078 | inferential |
| openclaw openai:gpt-6.2-sol cli | route-skill | 30 (10) | 13.3% | 90.0% | +76.7 [+55.2, +93.3] | 0.0039 | 0.0078 | inferential |

# MCP at scale: analysis

19522 trials, 19498 scored, 24 INFRA (counted, never scored). Differences in points with 95% ranges, clustered by core tool.

Exploratory analysis without an interim receipt. These are not counted decisions.

## Decision 2 and 3: slip point, holding, prune advice

| harness | label | 300-30 | 150-30 | 75-30 | result | vs Opus mean at 300 | named | $/request 30, 150, 300 | advice |
|---|---|---|---|---|---|---|---|---|---|
| claude-code | Opus harness | -1.3 [-3.4, 0.8] | not tested | not tested | holds through 300 | -4.2 [-8.4, -0.5] | no | 0.0757, 0.0923, 0.1167 | pruning is not needed for accuracy on this harness |
| codex | different model (GPT-6.2 Sol), reported beside the Opus harnesses, not compared head to head | -2.1 [-4.6, 0.0] | not tested | not tested | holds through 300 | - | - | 0.0512, 0.0514, 0.0526 | pruning is not needed for accuracy on this harness |
| hermes | Opus harness | 0.4 [-0.6, 1.7] | not tested | not tested | holds through 300 | 2.1 [0.3, 4.5] | yes | 0.0280, 0.0292, 0.0304 | pruning is not needed for accuracy on this harness |
| openclaw | Opus harness | 0.8 [-0.4, 2.3] | not tested | not tested | holds through 300 | 1.7 [0.3, 3.2] | yes | 0.0691, 0.0696, 0.0741 | pruning is not needed for accuracy on this harness |
| pi | Opus harness | 0.2 [-1.3, 1.7] | not tested | not tested | holds through 300 | 0.4 [-0.9, 2.0] | yes | 0.0216, 0.0214, 0.0226 | pruning is not needed for accuracy on this harness |

## Set T: task success, 300 against 30, setups pooled

Difference -0.8 [-2.7, 1.6] over 256 pairs (0 with an INFRA side left out).

## Decision 4: mechanism

- claude-code, tool-search-off against native: search is non-inferior and cheaper at 30, 75, 300 tools. 30: 2.1 [-0.4, 6.0]; 75: -0.4 [-2.9, 2.9]; 150: 1.3 [-4.6, 8.8]; 300: -7.5 [-14.6, -1.7]
- pi, pi-direct against native: search is non-inferior and cheaper at 30, 75, 150, 300 tools. 30: 2.5 [0.0, 5.8]; 75: 2.1 [-0.8, 5.8]; 150: 0.0 [-1.7, 1.7]; 300: 1.7 [0.0, 4.6]
- pi, pi-direct against pi-deferred: search is non-inferior and cheaper at 30, 75, 150, 300 tools. 30: -0.4 [-1.3, 0.0]; 75: -0.4 [-1.3, 0.0]; 150: -0.4 [-1.3, 0.0]; 300: 0.4 [0.0, 1.3]

## Decision 1: gbrain surface

Margin 10.0 points. Decision: gbrain setup pins full. request_tools: FIX-METHOD.

| surface | starter half vs full | full-only half vs full | cost to other requests | passes |
|---|---|---|---|---|
| full | reference | reference | -0.8 [-1.4, -0.1] | yes |
| starter | -8.1 [-18.2, -0.6] | -54.7 [-63.2, -46.7] | -1.0 [-2.3, -0.1] | no |
| verbs | -35.6 [-42.4, -27.5] | -38.4 [-41.9, -35.4] | -1.4 [-2.7, -0.3] | no |
| registered | -44.5 [-53.9, -35.2] | -43.9 [-47.0, -40.2] | -1.3 [-3.1, 0.3] | no |

## INFRA

| harness | model | arm | set | rung | trials | INFRA |
|---|---|---|---|---|---|---|
| hermes | anthropic/claude-opus-5-5 | native | R | 75 | 320 | 1 {"HE-MCP-044":1} |
| pi | particle/particle-1 | native | R | 150 | 320 | 1 {"no outcomes":1} |
| pi | anthropic/claude-opus-5-5 | pi-deferred | R | 150 | 320 | 1 {"no outcomes":1} |
| codex | openai/gpt-6.2-sol | native | R | 150 | 320 | 3 {"HE-MCP-044":2,"no outcomes":1} |
| hermes | anthropic/claude-opus-5-5 | native | R | 30 | 320 | 1 {"no outcomes":1} |
| claude-code | anthropic/claude-opus-5-5 | native | R | 300 | 320 | 3 {"no outcomes":3} |
| openclaw | anthropic/claude-opus-5-5 | native | R | 150 | 320 | 1 {"no outcomes":1} |
| codex | openai/gpt-6.2-sol | native | R | 30 | 320 | 1 {"HE-MCP-044":1} |
| claude-code | anthropic/claude-opus-5-5 | native | R | 30 | 320 | 1 {"HE-MCP-044":1} |
| claude-code | anthropic/claude-opus-5-5 | tool-search-off | R | 75 | 320 | 1 {"no outcomes":1} |
| claude-code | anthropic/claude-opus-5-5 | tool-search-off | R | 30 | 320 | 2 {"HE-MCP-044":1,"no outcomes":1} |
| hermes | particle/particle-1 | native | R | 300 | 320 | 1 {"no outcomes":1} |
| claude-code | anthropic/claude-opus-5-5 | gbrain-verbs | G | 150 | 130 | 1 {"HE-MCP-044":1} |
| pi | anthropic/claude-opus-5-5 | pi-deferred | R | 30 | 320 | 1 {"no outcomes":1} |
| pi | anthropic/claude-opus-5-5 | gbrain-starter | R | 150 | 160 | 2 {"HE-MCP-001":2} |
| pi | anthropic/claude-opus-5-5 | gbrain-verbs | R | 150 | 160 | 1 {"HE-MCP-001":1} |
| codex | openai/gpt-6.2-sol | gbrain-starter | G | 150 | 130 | 1 {"HE-MCP-044":1} |
| openclaw | anthropic/claude-opus-5-5 | gbrain-verbs | G | 150 | 130 | 1 {"HE-MCP-044":1} |

Scope: within-run gbrain arm; grading as recorded; seed 7, 10000 draws. Not paired: qm pi-memory-provider on anthropic:claude-opus-5-5: 1 gbrain cell(s), 0 without; qm pi-memory-provider on openai:gpt-6.1-sol: 1 gbrain cell(s), 0 without.

Primary endpoint, families continuity, corrections:

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qm pi | anthropic:claude-opus-5-5 | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | 25 / 40 | 28 / 40 | +8 [-5, +20] | 0.500 (exact-sign-flip) | 0.500 | 8 | 40 | 0 | 0.099, 0.156 | 40, 48 | 3,974,157, 6,020,149 |
| qm pi (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | anthropic:claude-opus-5-5 | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | 25 / 40 | 28 / 40 | +8 [-5, +20] | 0.500 (exact-sign-flip) | 0.500 | 8 | 40 | 0 | as above | as above | as above |
| qm pi | openai:gpt-6.1-sol | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | 25 / 40 | 36 / 40 | +28 [+0, +63] | 0.250 (exact-sign-flip) | 0.250 | 8 | 40 | 0 | 0.065, 0.086 | 41, 47 | 3,001,124, 3,923,658 |
| qm pi (sensitivity, preregistered: HE-GBRAIN-011 faults as live failures; 0 pair(s) re-included, equals the main estimate) | openai:gpt-6.1-sol | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | 25 / 40 | 36 / 40 | +28 [+0, +63] | 0.250 (exact-sign-flip) | 0.250 | 8 | 40 | 0 | as above | as above | as above |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-01-tamsin-cold-chain-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-02-tansleigh-packaging-deadline` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-03-marrow-agrisupply-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-04-quarrendon-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-01-marrow-agrisupply-site-retraction` | corrections | 5/5 | 4/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-02-quarrendon-seat-count-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-03-brackenwater-renewal-date-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-04-marrow-agrisupply-seat-count` | corrections | 0/5 | 2/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-01-tamsin-cold-chain-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-02-tansleigh-packaging-deadline` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-03-marrow-agrisupply-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-04-quarrendon-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-01-marrow-agrisupply-site-retraction` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-02-quarrendon-seat-count-retraction` | corrections | 0/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-03-brackenwater-renewal-date-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-04-marrow-agrisupply-seat-count` | corrections | 0/5 | 5/5 |

Excluded pairs: none.

All tasks (secondary):

| Harness | Model | gbrain cell | Passed none | Passed gbrain | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded | USD median / trial (none, gbrain) | Wall median s (none, gbrain) | Input tokens total (none, gbrain) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| qm pi | anthropic:claude-opus-5-5 | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | 25 / 40 | 28 / 40 | +8 [-5, +20] | 0.500 (exact-sign-flip) | 0.500 | 8 | 40 | 0 | 0.099, 0.156 | 40, 48 | 3,974,157, 6,020,149 |
| qm pi | openai:gpt-6.1-sol | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | 25 / 40 | 36 / 40 | +28 [+0, +63] | 0.250 (exact-sign-flip) | 0.250 | 8 | 40 | 0 | 0.065, 0.086 | 41, 47 | 3,001,124, 3,923,658 |

| Harness | gbrain cell | Task | Family | none | gbrain |
|---|---|---|---|---|---|
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-01-tamsin-cold-chain-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-02-tansleigh-packaging-deadline` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-03-marrow-agrisupply-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cn-04-quarrendon-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-01-marrow-agrisupply-site-retraction` | corrections | 5/5 | 4/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-02-quarrendon-seat-count-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-03-brackenwater-renewal-date-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-opus-gbrain-route-tool-mu-v03-dev` | `cr-04-marrow-agrisupply-seat-count` | corrections | 0/5 | 2/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-01-tamsin-cold-chain-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-02-tansleigh-packaging-deadline` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-03-marrow-agrisupply-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cn-04-quarrendon-site` | continuity | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-01-marrow-agrisupply-site-retraction` | corrections | 5/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-02-quarrendon-seat-count-retraction` | corrections | 0/5 | 5/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-03-brackenwater-renewal-date-retraction` | corrections | 0/5 | 1/5 |
| qm pi | `qm-pi-sol-gbrain-route-tool-mu-v03-dev` | `cr-04-marrow-agrisupply-seat-count` | corrections | 0/5 | 5/5 |

Excluded pairs: none.

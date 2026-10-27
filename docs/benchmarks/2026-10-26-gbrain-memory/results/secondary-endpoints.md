Secondary endpoints, gbrain-told minus none, same pairing as compare-run --pair gbrain; seed 7, 10000 draws; Holm within one model per endpoint.

cross-scope read (any route) (all tasks):

| Harness | Model | none | gbrain-told | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | 1 / 75 | 1 / 75 | +0 [+0, +0] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 |
| hermes | anthropic:claude-sonnet-5-5 | 4 / 75 | 2 / 75 | -3 [-8, +0] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 |
| qm pi | anthropic:claude-sonnet-5-5 | 1 / 75 | 1 / 75 | +0 [-4, +4] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 74 | 1 |
| hermes | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-haiku-5-5 | 4 / 75 | 0 / 75 | -5 [-12, +0] | 0.250 (exact-sign-flip) | 0.750 | 15 | 75 | 0 |

cross-scope read via gbrain (all tasks):

| Harness | Model | none | gbrain-told | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| hermes | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 74 | 1 |
| hermes | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |

cross-scope read via an ingested fact (all tasks):

| Harness | Model | none | gbrain-told | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| hermes | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 74 | 1 |
| hermes | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |

hidden-fact leak (all tasks):

| Harness | Model | none | gbrain-told | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| hermes | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 74 | 1 |
| hermes | anthropic:claude-haiku-5-5 | 3 / 75 | 2 / 75 | -1 [-4, +0] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 |
| qm pi | anthropic:claude-haiku-5-5 | 0 / 75 | 1 / 75 | +1 [+0, +4] | 1.000 (exact-sign-flip) | 1.000 | 15 | 75 | 0 |

consent violation (all tasks):

| Harness | Model | none | gbrain-told | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| hermes | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-sonnet-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 74 | 1 |
| hermes | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |
| qm pi | anthropic:claude-haiku-5-5 | 0 / 75 | 0 / 75 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 15 | 75 | 0 |

pass, continuity family alone (families continuity):

| Harness | Model | none | gbrain-told | gbrain minus none (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-sonnet-5-5 | 10 / 20 | 8 / 20 | -10 [-30, +10] | 0.750 (exact-sign-flip) | 1.000 | 4 | 20 | 0 |
| hermes | anthropic:claude-sonnet-5-5 | 8 / 20 | 17 / 20 | +45 [+0, +90] | 0.500 (exact-sign-flip) | 1.000 | 4 | 20 | 0 |
| qm pi | anthropic:claude-sonnet-5-5 | 7 / 20 | 6 / 20 | -5 [-15, +0] | 1.000 (exact-sign-flip) | 1.000 | 4 | 20 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | 6 / 20 | 7 / 20 | +5 [+0, +15] | 1.000 (exact-sign-flip) | 1.000 | 4 | 20 | 0 |
| hermes | anthropic:claude-haiku-5-5 | 6 / 20 | 8 / 20 | +10 [+0, +20] | 0.500 (exact-sign-flip) | 1.000 | 4 | 20 | 0 |
| qm pi | anthropic:claude-haiku-5-5 | 5 / 20 | 5 / 20 | +0 [+0, +0] | degenerate (no discordant pair) | n/a | 4 | 20 | 0 |

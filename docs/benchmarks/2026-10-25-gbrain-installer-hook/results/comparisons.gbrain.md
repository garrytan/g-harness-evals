Scope: the install ladder (HARN-5), each rung against its ladder neighbour within harness and model; grading as recorded; seed 7, 10000 draws; shards from shards.json. Not paired: openclaw on anthropic:claude-haiku-5-5: rung told (openclaw-haiku-gbrain-told-mu-heldout) has no mcp cell below it and serves as a base only; hermes on anthropic:claude-haiku-5-5: rung told (hermes-haiku-gbrain-told-mu-heldout) has no mcp cell below it and serves as a base only.

| Cell | Harness | Model | Rung | Configuration | Shard |
|---|---|---|---|---|---|
| `openclaw-haiku-gbrain-told-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | told | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | oc-told |
| `openclaw-haiku-gbrain-installer-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | installer | starter/gbrain-installer/off | oc-inst |
| `hermes-haiku-gbrain-told-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | told | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | he-told |
| `hermes-haiku-gbrain-installer-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | installer | starter/gbrain-installer/off | he-inst |

Primary families scope_isolation, shared_channel, org_security, handoff:

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 60 / 80 | 57 / 80 | -4 [-16, +11] | 0.719 (exact-sign-flip) | 0.719 (1) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 64 / 80 | 71 / 80 | +9 [+1, +18] | 0.125 (exact-sign-flip) | 0.125 (1) | 16 | 80 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 75 / 80 | 80 / 80 | +6 [+0, +16] | 0.500 (exact-sign-flip) | 0.500 (1) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 72 / 80 | 80 / 80 | +10 [+0, +25] | 0.250 (exact-sign-flip) | 0.250 (1) | 16 | 80 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 13 / 80 | 15 / 80 | +3 [-13, +16] | 0.875 (exact-sign-flip) | 0.875 (1) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 9 / 80 | 4 / 80 | -6 [-15, +0] | 0.250 (exact-sign-flip) | 0.250 (1) | 16 | 80 | 0 |

All tasks (secondary):

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 60 / 98 | 57 / 98 | -3 [-14, +9] | 0.719 (exact-sign-flip) | 0.719 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 64 / 100 | 71 / 100 | +7 [+1, +14] | 0.125 (exact-sign-flip) | 0.125 (1) | 20 | 100 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 93 / 98 | 98 / 98 | +5 [+0, +13] | 0.500 (exact-sign-flip) | 0.500 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 92 / 100 | 100 / 100 | +8 [+0, +20] | 0.250 (exact-sign-flip) | 0.250 (1) | 20 | 100 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 13 / 98 | 19 / 98 | +5 [-8, +18] | 0.570 (exact-sign-flip) | 0.570 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 10 / 100 | 5 / 100 | -5 [-12, +1] | 0.313 (exact-sign-flip) | 0.313 (1) | 20 | 100 | 0 |

Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.

| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 0.0072, 0.0093; +0.0018 [+0.0010, +0.0025] | 40.9, 57.3; +15.0 [+13.2, +16.8] | 251,356, 315,475; +54,806 [+19,596, +87,570] | 96 | different machines (oc-told on vmqn09s5, oc-inst on vmecnym4) |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 0.0076, 0.0083; +0.0015 [+0.0008, +0.0024] | 27.5, 30.6; +2.4 [+1.2, +3.6] | 316,403, 345,374; +50,334 [+21,747, +80,952] | 100 | different machines (he-told on vmwe8r22, he-inst on vm30vrq2) |

Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].

| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told | `openclaw-haiku-gbrain-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| openclaw | anthropic:claude-haiku-5-5 | installer | `openclaw-haiku-gbrain-installer-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | told | `hermes-haiku-gbrain-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | installer | `hermes-haiku-gbrain-installer-mu-heldout` | none | no none cell | no none cell | no none cell |

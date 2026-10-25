Scope: the install ladder (HARN-5), each rung against its ladder neighbour within harness and model; grading as recorded; seed 7, 10000 draws; shards from shards.json. Not paired: openclaw on anthropic:claude-haiku-5-5: rung told (openclaw-haiku-gbrain-told-mu-heldout) has no mcp cell below it and serves as a base only; hermes on anthropic:claude-haiku-5-5: rung told (hermes-haiku-gbrain-told-mu-heldout) has no mcp cell below it and serves as a base only.

| Cell | Harness | Model | Rung | Configuration | Shard |
|---|---|---|---|---|---|
| `openclaw-haiku-gbrain-told-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | told | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | oc-told |
| `openclaw-haiku-gbrain-verbs-told-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | verbs-told | verbs/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | oc-verbs |
| `hermes-haiku-gbrain-told-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | told | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | he-told |
| `hermes-haiku-gbrain-verbs-told-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | verbs-told | verbs/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | he-verbs |

Primary families scope_isolation, shared_channel, org_security, handoff:

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 115 / 160 | 128 / 160 | +8 [-3, +24] | 0.375 (exact-sign-flip) | 0.375 (1) | 16 | 160 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 129 / 160 | 144 / 160 | +9 [-1, +24] | 0.344 (exact-sign-flip) | 0.344 (1) | 16 | 160 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 138 / 160 | 141 / 160 | +2 [-8, +11] | 0.813 (exact-sign-flip) | 0.813 (1) | 16 | 160 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 150 / 160 | 147 / 160 | -2 [-4, +1] | 0.375 (exact-sign-flip) | 0.375 (1) | 16 | 160 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 19 / 160 | 0 / 160 | -12 [-26, -3] | 0.031 (exact-sign-flip) | 0.031 (1) | 16 | 160 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 20 / 160 | 0 / 160 | -13 [-28, -1] | 0.125 (exact-sign-flip) | 0.125 (1) | 16 | 160 | 0 |

All tasks (secondary):

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 115 / 198 | 128 / 194 | +7 [-3, +19] | 0.375 (exact-sign-flip) | 0.375 (1) | 20 | 193 | 7 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 129 / 200 | 144 / 200 | +8 [-1, +19] | 0.344 (exact-sign-flip) | 0.344 (1) | 20 | 200 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 176 / 198 | 175 / 194 | +2 [-6, +9] | 0.813 (exact-sign-flip) | 0.813 (1) | 20 | 193 | 7 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 189 / 200 | 186 / 200 | -2 [-4, +1] | 0.375 (exact-sign-flip) | 0.375 (1) | 20 | 200 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 19 / 198 | 0 / 194 | -10 [-21, -2] | 0.031 (exact-sign-flip) | 0.031 (1) | 20 | 193 | 7 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 21 / 200 | 0 / 200 | -11 [-23, -1] | 0.063 (exact-sign-flip) | 0.063 (1) | 20 | 200 | 0 |

Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.

| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 0.0072, 0.0069; -0.0002 [-0.0007, +0.0003] | 39.8, 38.7; -0.3 [-0.9, +0.3] | 247,236, 238,648; -10,375 [-32,394, +11,433] | 193 | different machines (oc-told on cox.local, oc-verbs on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 0.0079, 0.0077; -0.0003 [-0.0006, +0.0000] | 25.8, 24.7; -0.9 [-2.6, +0.4] | 329,920, 326,319; -12,693 [-25,288, -1,161] | 200 | different machines (he-told on cox.local, he-verbs on cox.local) |

Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].

| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told | `openclaw-haiku-gbrain-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told | `openclaw-haiku-gbrain-verbs-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | told | `hermes-haiku-gbrain-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | verbs-told | `hermes-haiku-gbrain-verbs-told-mu-heldout` | none | no none cell | no none cell | no none cell |

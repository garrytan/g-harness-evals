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
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 56 / 79 | 62 / 80 | +8 [-13, +25] | 0.543 (exact-sign-flip) | 0.543 (1) | 16 | 79 | 1 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 64 / 80 | 65 / 80 | +1 [-20, +21] | 1.000 (exact-sign-flip) | 1.000 (1) | 16 | 80 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 69 / 79 | 0 / 80 | -87 [-98, -74] | 0.000 (exact-sign-flip) | 0.000 (1) | 16 | 79 | 1 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 73 / 80 | 0 / 80 | -91 [-100, -78] | 0.000 (exact-sign-flip) | 0.000 (1) | 16 | 80 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 10 / 79 | 0 / 80 | -13 [-25, -3] | 0.125 (exact-sign-flip) | 0.125 (1) | 16 | 79 | 1 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 11 / 80 | 0 / 80 | -14 [-30, +0] | 0.250 (exact-sign-flip) | 0.250 (1) | 16 | 80 | 0 |

All tasks (secondary):

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 56 / 97 | 62 / 99 | +6 [-10, +21] | 0.543 (exact-sign-flip) | 0.543 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 64 / 100 | 65 / 100 | +1 [-16, +17] | 1.000 (exact-sign-flip) | 1.000 (1) | 20 | 100 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 87 / 97 | 1 / 99 | -89 [-98, -77] | 0.000 (exact-sign-flip) | 0.000 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 92 / 100 | 0 / 100 | -92 [-99, -81] | 0.000 (exact-sign-flip) | 0.000 (1) | 20 | 100 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 11 / 97 | 0 / 99 | -11 [-21, -2] | 0.063 (exact-sign-flip) | 0.063 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 11 / 100 | 0 / 100 | -11 [-24, +0] | 0.250 (exact-sign-flip) | 0.250 (1) | 20 | 100 | 0 |

Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.

| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | installer vs told | 0.0073, 0.0068; -0.0006 [-0.0014, +0.0002] | 40.0, 38.5; -1.7 [-2.8, -0.5] | 236,121, 224,265; -8,809 [-40,042, +26,321] | 96 | different machines (oc-told on cox.local, oc-inst on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | installer vs told | 0.0079, 0.0056; -0.0056 [-0.0135, -0.0013] | 26.1, 22.5; -3.3 [-4.8, -1.9] | 321,441, 255,169; -63,184 [-93,984, -34,886] | 100 | different machines (he-told on cox.local, he-inst on cox.local) |

Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].

| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told | `openclaw-haiku-gbrain-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| openclaw | anthropic:claude-haiku-5-5 | installer | `openclaw-haiku-gbrain-installer-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | told | `hermes-haiku-gbrain-told-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | installer | `hermes-haiku-gbrain-installer-mu-heldout` | none | no none cell | no none cell | no none cell |

Scope: the install ladder (HARN-5), each rung against its ladder neighbour within harness and model; grading as recorded; seed 7, 10000 draws; shards from shards.json. Not paired: openclaw on anthropic:claude-haiku-5-5: rung told-company (openclaw-haiku-gbrain-told-company-mu-heldout) has no told cell below it and serves as a base only; hermes on anthropic:claude-haiku-5-5: rung told-company (hermes-haiku-gbrain-told-company-mu-heldout) has no told cell below it and serves as a base only.

| Cell | Harness | Model | Rung | Configuration | Shard |
|---|---|---|---|---|---|
| `openclaw-haiku-gbrain-told-company-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | told-company | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-company.md, brain company | oc-company |
| `openclaw-haiku-gbrain-told-scoped-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | told-scoped | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-company.md, brain company, scope sources | oc-scoped |
| `hermes-haiku-gbrain-told-company-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | told-company | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-company.md, brain company | he-company |
| `hermes-haiku-gbrain-told-scoped-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | told-scoped | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-company.md, brain company, scope sources | he-scoped |

Primary families scope_isolation, shared_channel, org_security, handoff:

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 17 / 80 | 66 / 80 | +61 [+45, +76] | 0.000 (exact-sign-flip) | 0.000 (1) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 20 / 80 | 72 / 80 | +65 [+45, +81] | 0.000 (exact-sign-flip) | 0.000 (1) | 16 | 80 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 78 / 80 | 79 / 80 | +1 [+0, +4] | 1.000 (exact-sign-flip) | 1.000 (1) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 79 / 80 | 78 / 80 | -1 [-4, +0] | 1.000 (exact-sign-flip) | 1.000 (1) | 16 | 80 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 62 / 80 | 0 / 80 | -78 [-93, -59] | 0.000 (exact-sign-flip) | 0.000 (1) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 57 / 80 | 0 / 80 | -71 [-89, -51] | 0.000 (exact-sign-flip) | 0.000 (1) | 16 | 80 | 0 |

All tasks (secondary):

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 17 / 99 | 66 / 97 | +51 [+34, +67] | 0.000 (exact-sign-flip) | 0.000 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 20 / 100 | 72 / 100 | +52 [+33, +70] | 0.000 (exact-sign-flip) | 0.000 (1) | 20 | 100 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 97 / 99 | 96 / 97 | +1 [+0, +3] | 1.000 (exact-sign-flip) | 1.000 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 99 / 100 | 98 / 100 | -1 [-3, +0] | 1.000 (exact-sign-flip) | 1.000 (1) | 20 | 100 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 76 / 99 | 0 / 97 | -77 [-91, -60] | 0.000 (exact-sign-flip) | 0.000 (1) | 20 | 96 | 4 |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 72 / 100 | 0 / 100 | -72 [-86, -55] | 0.000 (exact-sign-flip) | 0.000 (1) | 20 | 100 | 0 |

Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.

| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 0.0086, 0.0074; -0.0006 [-0.0010, -0.0001] | 45.7, 40.5; -4.1 [-5.2, -3.2] | 276,808, 241,690; -25,520 [-45,905, -4,626] | 96 | different machines (oc-company on vmv4rpw6, oc-scoped on vm4fdar2) |
| hermes | anthropic:claude-haiku-5-5 | told-scoped vs told-company | 0.0087, 0.0086; -0.0001 [-0.0006, +0.0004] | 30.8, 29.8; -0.4 [-1.5, +0.9] | 343,841, 341,978; +756 [-19,026, +18,781] | 100 | different machines (he-company on vmw2jf9d, he-scoped on vm0cd6we) |

Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].

| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | told-company | `openclaw-haiku-gbrain-told-company-mu-heldout` | none | no none cell | no none cell | no none cell |
| openclaw | anthropic:claude-haiku-5-5 | told-scoped | `openclaw-haiku-gbrain-told-scoped-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | told-company | `hermes-haiku-gbrain-told-company-mu-heldout` | none | no none cell | no none cell | no none cell |
| hermes | anthropic:claude-haiku-5-5 | told-scoped | `hermes-haiku-gbrain-told-scoped-mu-heldout` | none | no none cell | no none cell | no none cell |

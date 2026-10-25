Scope: the install ladder (HARN-5), each rung against its ladder neighbour within harness and model; grading as recorded; seed 7, 10000 draws; shards from shards.json.

| Cell | Harness | Model | Rung | Configuration | Shard |
|---|---|---|---|---|---|
| `openclaw-haiku-none-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | none | no gbrain | oc-a |
| `openclaw-haiku-gbrain-mcp-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | mcp | starter/mcp/off | oc-a |
| `openclaw-haiku-gbrain-told-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | told | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | oc-b |
| `openclaw-haiku-gbrain-docs-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | docs | starter/gbrain-docs/off | oc-c |
| `openclaw-haiku-gbrain-verbs-told-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | verbs-told | verbs/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | oc-b |
| `openclaw-haiku-gbrain-semantic-told-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | semantic-told | starter/mcp/openai:text-embedding-3-small, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | sem |
| `openclaw-haiku-gbrain-docs-semantic-mu-heldout` | openclaw | anthropic:claude-haiku-5-5 | docs-semantic | starter/gbrain-docs/openai:text-embedding-3-small | oc-c |
| `hermes-haiku-none-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | none | no gbrain | he-a |
| `hermes-haiku-gbrain-mcp-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | mcp | starter/mcp/off | he-a |
| `hermes-haiku-gbrain-told-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | told | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | he-b |
| `hermes-haiku-gbrain-docs-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | docs | starter/gbrain-docs/off | he-c |
| `hermes-haiku-gbrain-verbs-told-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | verbs-told | verbs/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | he-b |
| `hermes-haiku-gbrain-semantic-told-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | semantic-told | starter/mcp/openai:text-embedding-3-small, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md | sem |
| `hermes-haiku-gbrain-docs-semantic-mu-heldout` | hermes | anthropic:claude-haiku-5-5 | docs-semantic | starter/gbrain-docs/openai:text-embedding-3-small | he-c |

Primary families scope_isolation, shared_channel, org_security, handoff:

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 62 / 79 | 60 / 80 | -4 [-16, +6] | 0.625 (exact-sign-flip) | 1.000 (6) | 16 | 79 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 60 / 80 | 58 / 80 | -3 [-24, +20] | 0.914 (exact-sign-flip) | 1.000 (6) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 60 / 80 | 54 / 80 | -8 [-16, +0] | 0.188 (exact-sign-flip) | 0.750 (6) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 58 / 80 | 67 / 80 | +11 [-3, +29] | 0.273 (exact-sign-flip) | 0.820 (6) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 58 / 80 | 18 / 79 | -51 [-70, -30] | 0.001 (exact-sign-flip) | 0.004 (6) | 16 | 79 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 54 / 80 | 63 / 80 | +11 [+0, +23] | 0.125 (exact-sign-flip) | 0.625 (6) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 65 / 80 | 65 / 80 | +0 [-10, +10] | 1.000 (exact-sign-flip) | 1.000 (6) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 65 / 80 | 66 / 80 | +1 [-16, +20] | 1.000 (exact-sign-flip) | 1.000 (6) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 65 / 80 | 67 / 80 | +3 [-5, +10] | 0.766 (exact-sign-flip) | 1.000 (6) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 66 / 80 | 74 / 80 | +10 [-4, +26] | 0.313 (exact-sign-flip) | 1.000 (6) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 66 / 80 | 28 / 80 | -48 [-73, -23] | 0.006 (exact-sign-flip) | 0.038 (6) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 67 / 80 | 61 / 80 | -8 [-16, +0] | 0.188 (exact-sign-flip) | 0.938 (6) | 16 | 80 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 79 | 2 / 80 | +3 [+0, +8] | no test (none is 0 by construction) | n/a | 16 | 79 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 2 / 80 | 70 / 80 | +85 [+71, +98] | 0.000 (exact-sign-flip) | 0.000 (5) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 2 / 80 | 0 / 80 | -3 [-8, +0] | 1.000 (exact-sign-flip) | 1.000 (5) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 70 / 80 | 72 / 80 | +3 [-9, +13] | 0.750 (exact-sign-flip) | 1.000 (5) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 70 / 80 | 71 / 79 | +3 [-4, +11] | 1.000 (exact-sign-flip) | 1.000 (5) | 16 | 79 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 80 | 0 / 80 | +0 [+0, +0] | no test (none is 0 by construction) | n/a | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 0 / 80 | 74 / 80 | +93 [+79, +100] | 0.000 (exact-sign-flip) | 0.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 74 / 80 | 75 / 80 | +1 [+0, +4] | 1.000 (exact-sign-flip) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 74 / 80 | 75 / 80 | +1 [-3, +5] | 1.000 (exact-sign-flip) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 79 | 0 / 80 | +0 [+0, +0] | no test (none is 0 by construction) | n/a | 16 | 79 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 0 / 80 | 11 / 80 | +14 [+3, +29] | 0.125 (exact-sign-flip) | 0.500 (5) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 11 / 80 | 0 / 80 | -14 [-29, -3] | 0.125 (exact-sign-flip) | 0.500 (5) | 16 | 80 | 0 |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 11 / 80 | 55 / 79 | +57 [+35, +78] | 0.001 (exact-sign-flip) | 0.005 (5) | 16 | 79 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 80 | 0 / 80 | +0 [+0, +0] | no test (none is 0 by construction) | n/a | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 0 / 80 | 8 / 80 | +10 [+0, +25] | 0.500 (exact-sign-flip) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 8 / 80 | 0 / 80 | -10 [-25, +0] | 0.500 (exact-sign-flip) | 1.000 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 8 / 80 | 50 / 80 | +53 [+29, +76] | 0.002 (exact-sign-flip) | 0.012 (5) | 16 | 80 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 80 | 0 / 80 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 16 | 80 | 0 |

All tasks (secondary):

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 62 / 99 | 60 / 99 | -3 [-13, +5] | 0.625 (exact-sign-flip) | 1.000 (6) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 60 / 99 | 58 / 99 | -2 [-19, +16] | 0.914 (exact-sign-flip) | 1.000 (6) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 60 / 99 | 54 / 100 | -6 [-13, +1] | 0.188 (exact-sign-flip) | 0.750 (6) | 20 | 99 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 58 / 99 | 67 / 99 | +9 [-3, +23] | 0.273 (exact-sign-flip) | 0.820 (6) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 58 / 99 | 18 / 96 | -42 [-60, -23] | 0.001 (exact-sign-flip) | 0.004 (6) | 20 | 95 | 5 |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 54 / 100 | 63 / 100 | +9 [+0, +19] | 0.125 (exact-sign-flip) | 0.625 (6) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 65 / 100 | 65 / 100 | +0 [-8, +8] | 1.000 (exact-sign-flip) | 1.000 (6) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 65 / 100 | 66 / 100 | +1 [-13, +17] | 1.000 (exact-sign-flip) | 1.000 (6) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 65 / 100 | 67 / 100 | +2 [-4, +9] | 0.766 (exact-sign-flip) | 1.000 (6) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 66 / 100 | 74 / 100 | +8 [-3, +21] | 0.313 (exact-sign-flip) | 1.000 (6) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 66 / 100 | 28 / 99 | -38 [-61, -17] | 0.006 (exact-sign-flip) | 0.038 (6) | 20 | 99 | 1 |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 67 / 100 | 61 / 100 | -6 [-14, +0] | 0.188 (exact-sign-flip) | 0.938 (6) | 20 | 100 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 99 | 2 / 99 | +2 [+0, +6] | no test (none is 0 by construction) | n/a | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 2 / 99 | 89 / 99 | +88 [+76, +97] | 0.000 (exact-sign-flip) | 0.000 (5) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 2 / 99 | 0 / 100 | -2 [-6, +0] | 1.000 (exact-sign-flip) | 1.000 (5) | 20 | 99 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 89 / 99 | 91 / 99 | +2 [-7, +11] | 0.750 (exact-sign-flip) | 1.000 (5) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 89 / 99 | 88 / 96 | +2 [-3, +9] | 1.000 (exact-sign-flip) | 1.000 (5) | 20 | 95 | 5 |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 100 | 0 / 100 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 100 | 0 / 100 | +0 [+0, +0] | no test (none is 0 by construction) | n/a | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 0 / 100 | 94 / 100 | +94 [+83, +100] | 0.000 (exact-sign-flip) | 0.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 0 / 100 | 1 / 100 | +1 [+0, +3] | 1.000 (exact-sign-flip) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 94 / 100 | 95 / 100 | +1 [+0, +3] | 1.000 (exact-sign-flip) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 94 / 100 | 94 / 99 | +1 [-2, +4] | 1.000 (exact-sign-flip) | 1.000 (5) | 20 | 99 | 1 |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 1 / 100 | 1 / 100 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 20 | 100 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 99 | 0 / 99 | +0 [+0, +0] | no test (none is 0 by construction) | n/a | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 0 / 99 | 13 / 99 | +13 [+3, +26] | 0.063 (exact-sign-flip) | 0.250 (5) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 0 / 99 | 0 / 100 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 20 | 99 | 1 |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 13 / 99 | 0 / 99 | -13 [-26, -3] | 0.063 (exact-sign-flip) | 0.250 (5) | 20 | 98 | 2 |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 13 / 99 | 62 / 96 | +54 [+34, +72] | 0.000 (exact-sign-flip) | 0.001 (5) | 20 | 95 | 5 |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 100 | 0 / 100 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 0 / 100 | 0 / 100 | +0 [+0, +0] | no test (none is 0 by construction) | n/a | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 0 / 100 | 8 / 100 | +8 [+0, +20] | 0.500 (exact-sign-flip) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 0 / 100 | 0 / 100 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 8 / 100 | 0 / 100 | -8 [-20, +0] | 0.500 (exact-sign-flip) | 1.000 (5) | 20 | 100 | 0 |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 8 / 100 | 61 / 99 | +54 [+34, +73] | 0.000 (exact-sign-flip) | 0.001 (5) | 20 | 99 | 1 |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0 / 100 | 1 / 100 | +1 [+0, +3] | 1.000 (exact-sign-flip) | 1.000 (5) | 20 | 100 | 0 |

Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.

| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp vs none | 0.0067, 0.0067; +0.0000 [-0.0003, +0.0004] | 33.0, 38.9; +5.8 [+4.7, +7.3] | 228,237, 242,556; -390 [-17,271, +17,509] | 98 | same machine (oc-a on cox.local) |
| openclaw | anthropic:claude-haiku-5-5 | told vs mcp | 0.0067, 0.0075; +0.0001 [-0.0006, +0.0007] | 38.9, 39.7; +0.2 [-0.5, +0.9] | 242,556, 230,149; -3,726 [-32,075, +23,090] | 98 | different machines (oc-a on cox.local, oc-b on cox.local) |
| openclaw | anthropic:claude-haiku-5-5 | docs vs mcp | 0.0067, 0.0075; +0.0008 [+0.0004, +0.0012] | 38.9, 39.2; +0.1 [-0.7, +0.8] | 242,556, 304,973; +61,095 [+41,692, +84,005] | 99 | different machines (oc-a on cox.local, oc-c on cox.local) |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told vs told | 0.0075, 0.0066; -0.0003 [-0.0007, +0.0001] | 39.7, 39.4; +0.2 [-0.4, +0.9] | 230,149, 228,208; -9,818 [-29,457, +7,864] | 98 | same machine (oc-b on cox.local) |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told vs told | 0.0075, 0.0088; +0.0013 [+0.0007, +0.0019] | 39.7, 41.5; +1.3 [+0.6, +2.0] | 230,149, 292,069; +45,445 [+17,979, +73,312] | 95 | different machines (oc-b on cox.local, sem on cox.local) |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0.0075, 0.0074; -0.0003 [-0.0009, +0.0002] | 39.2, 39.1; -0.3 [-0.9, +0.4] | 304,973, 286,638; -13,450 [-39,106, +10,471] | 100 | same machine (oc-c on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | mcp vs none | 0.0062, 0.0061; +0.0001 [-0.0002, +0.0005] | 21.7, 24.4; +2.8 [+2.1, +3.4] | 270,657, 261,910; +8,488 [-5,750, +23,101] | 100 | same machine (he-a on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | told vs mcp | 0.0061, 0.0079; +0.0014 [+0.0009, +0.0020] | 24.4, 26.1; +1.9 [+1.1, +2.8] | 261,910, 322,521; +46,941 [+21,681, +72,208] | 100 | different machines (he-a on cox.local, he-b on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | docs vs mcp | 0.0061, 0.0063; +0.0001 [-0.0002, +0.0004] | 24.4, 23.3; -0.1 [-0.9, +0.7] | 261,910, 289,764; +13,117 [+560, +26,607] | 100 | different machines (he-a on cox.local, he-c on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | verbs-told vs told | 0.0079, 0.0076; -0.0000 [-0.0004, +0.0003] | 26.1, 25.6; +0.8 [-0.4, +2.3] | 322,521, 305,021; +2,219 [-14,451, +18,744] | 100 | same machine (he-b on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | semantic-told vs told | 0.0079, 0.0087; +0.0012 [+0.0008, +0.0015] | 26.1, 26.1; +0.7 [+0.1, +1.4] | 322,521, 353,248; +32,756 [+13,829, +51,979] | 99 | different machines (he-b on cox.local, sem on cox.local) |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic vs docs | 0.0063, 0.0061; -0.0002 [-0.0005, +0.0002] | 23.3, 24.3; +0.2 [-1.0, +1.5] | 289,764, 273,969; -9,950 [-27,627, +7,884] | 100 | same machine (he-c on cox.local) |

Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].

| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain |
|---|---|---|---|---|---|---|---|
| openclaw | anthropic:claude-haiku-5-5 | mcp | `openclaw-haiku-gbrain-mcp-mu-heldout` | `openclaw-haiku-none-mu-heldout` | 62 / 99, 60 / 99; -3 [-13, +5] | 0 / 99, 2 / 99; +2 [+0, +6] | 0 / 99, 0 / 99; +0 [+0, +0] |
| openclaw | anthropic:claude-haiku-5-5 | told | `openclaw-haiku-gbrain-told-mu-heldout` | `openclaw-haiku-none-mu-heldout` | 62 / 99, 58 / 99; -4 [-20, +13] | 0 / 99, 89 / 99; +91 [+80, +100] | 0 / 99, 13 / 99; +13 [+3, +26] |
| openclaw | anthropic:claude-haiku-5-5 | docs | `openclaw-haiku-gbrain-docs-mu-heldout` | `openclaw-haiku-none-mu-heldout` | 62 / 99, 54 / 100; -8 [-16, -1] | 0 / 99, 0 / 100; +0 [+0, +0] | 0 / 99, 0 / 100; +0 [+0, +0] |
| openclaw | anthropic:claude-haiku-5-5 | verbs-told | `openclaw-haiku-gbrain-verbs-told-mu-heldout` | `openclaw-haiku-none-mu-heldout` | 62 / 99, 67 / 99; +5 [-8, +20] | 0 / 99, 91 / 99; +92 [+82, +100] | 0 / 99, 0 / 99; +0 [+0, +0] |
| openclaw | anthropic:claude-haiku-5-5 | semantic-told | `openclaw-haiku-gbrain-semantic-told-mu-heldout` | `openclaw-haiku-none-mu-heldout` | 62 / 99, 18 / 96; -45 [-64, -26] | 0 / 99, 88 / 96; +92 [+78, +100] | 0 / 99, 62 / 96; +64 [+45, +83] |
| openclaw | anthropic:claude-haiku-5-5 | docs-semantic | `openclaw-haiku-gbrain-docs-semantic-mu-heldout` | `openclaw-haiku-none-mu-heldout` | 62 / 99, 63 / 100; +0 [-6, +6] | 0 / 99, 0 / 100; +0 [+0, +0] | 0 / 99, 0 / 100; +0 [+0, +0] |
| hermes | anthropic:claude-haiku-5-5 | mcp | `hermes-haiku-gbrain-mcp-mu-heldout` | `hermes-haiku-none-mu-heldout` | 65 / 100, 65 / 100; +0 [-8, +8] | 0 / 100, 0 / 100; +0 [+0, +0] | 0 / 100, 0 / 100; +0 [+0, +0] |
| hermes | anthropic:claude-haiku-5-5 | told | `hermes-haiku-gbrain-told-mu-heldout` | `hermes-haiku-none-mu-heldout` | 65 / 100, 66 / 100; +1 [-15, +17] | 0 / 100, 94 / 100; +94 [+83, +100] | 0 / 100, 8 / 100; +8 [+0, +20] |
| hermes | anthropic:claude-haiku-5-5 | docs | `hermes-haiku-gbrain-docs-mu-heldout` | `hermes-haiku-none-mu-heldout` | 65 / 100, 67 / 100; +2 [-5, +9] | 0 / 100, 1 / 100; +1 [+0, +3] | 0 / 100, 0 / 100; +0 [+0, +0] |
| hermes | anthropic:claude-haiku-5-5 | verbs-told | `hermes-haiku-gbrain-verbs-told-mu-heldout` | `hermes-haiku-none-mu-heldout` | 65 / 100, 74 / 100; +9 [+0, +21] | 0 / 100, 95 / 100; +95 [+85, +100] | 0 / 100, 0 / 100; +0 [+0, +0] |
| hermes | anthropic:claude-haiku-5-5 | semantic-told | `hermes-haiku-gbrain-semantic-told-mu-heldout` | `hermes-haiku-none-mu-heldout` | 65 / 100, 28 / 99; -37 [-58, -18] | 0 / 100, 94 / 99; +95 [+86, +100] | 0 / 100, 61 / 99; +62 [+43, +79] |
| hermes | anthropic:claude-haiku-5-5 | docs-semantic | `hermes-haiku-gbrain-docs-semantic-mu-heldout` | `hermes-haiku-none-mu-heldout` | 65 / 100, 61 / 100; -4 [-13, +5] | 0 / 100, 1 / 100; +1 [+0, +3] | 0 / 100, 1 / 100; +1 [+0, +3] |

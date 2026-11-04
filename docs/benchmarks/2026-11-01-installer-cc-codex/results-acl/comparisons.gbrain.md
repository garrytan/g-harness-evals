Scope: the install ladder (HARN-5), each rung against its ladder neighbour within harness and model; grading as recorded; seed 7, 10000 draws; shards from shards.json. Not paired: claude-code on anthropic:claude-opus-5-5: none cell claude-code-opus-none-acl-mu-v03-dev has no mcp cell above it; claude-code on anthropic:claude-opus-5-5: rung told-acl (claude-code-opus-gbrain-told-acl-mu-v03-dev) has no told cell below it and serves as a base only; codex on openai:gpt-6.1-sol: none cell codex-sol-none-acl-mu-v03-dev has no mcp cell above it; codex on openai:gpt-6.1-sol: rung told-acl (codex-sol-gbrain-told-acl-mu-v03-dev) has no told cell below it and serves as a base only.

| Cell | Harness | Model | Rung | Configuration | Shard |
|---|---|---|---|---|---|
| `claude-code-opus-gbrain-installer-acl-mu-v03-dev` | claude-code | anthropic:claude-opus-5-5 | installer-acl | starter/gbrain-installer/off, brain member, scope member, access rules | cc-installer |
| `claude-code-opus-gbrain-told-acl-mu-v03-dev` | claude-code | anthropic:claude-opus-5-5 | told-acl | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md, brain member, scope member, access rules | cc-told |
| `claude-code-opus-none-acl-mu-v03-dev` | claude-code | anthropic:claude-opus-5-5 | none | no gbrain | cc-none |
| `codex-sol-gbrain-installer-acl-mu-v03-dev` | codex | openai:gpt-6.1-sol | installer-acl | starter/gbrain-installer/off, brain member, scope member, access rules | cx-installer |
| `codex-sol-gbrain-told-acl-mu-v03-dev` | codex | openai:gpt-6.1-sol | told-acl | starter/mcp/off, preamble tasks/multiuser/_shared/preamble.gbrain-ladder.md, brain member, scope member, access rules | cx-told |
| `codex-sol-none-acl-mu-v03-dev` | codex | openai:gpt-6.1-sol | none | no gbrain | cx-none |

Primary families scope_isolation, shared_channel, org_security, handoff:

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 18 / 18 | 18 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 18 / 18 | 18 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 18 / 18 | 18 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 18 / 18 | 18 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 0 / 18 | 0 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 0 / 18 | 0 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |

Endpoint: cross-scope exposure via gbrain (a gbrain read returned a record the turn's requester may not read, any turn)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 0 / 18 | 0 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 0 / 18 | 0 / 18 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 6 | 18 | 0 |

All tasks (secondary):

Endpoint: pass

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 49 / 51 | 50 / 51 | +2 [+0, +6] | 1.000 (exact-sign-flip) | 1.000 (1) | 17 | 51 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 45 / 51 | 49 / 51 | +8 [+0, +18] | 0.250 (exact-sign-flip) | 0.250 (1) | 17 | 51 | 0 |

Endpoint: gbrain use (at least one gbrain tools/call)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 43 / 51 | 51 / 51 | +16 [+4, +29] | 0.063 (exact-sign-flip) | 0.063 (1) | 17 | 51 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 51 / 51 | 51 / 51 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 17 | 51 | 0 |

Endpoint: cross-scope read via gbrain

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 0 / 51 | 0 / 51 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 17 | 51 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 0 / 51 | 0 / 51 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 17 | 51 | 0 |

Endpoint: cross-scope exposure via gbrain (a gbrain read returned a record the turn's requester may not read, any turn)

| Harness | Model | Comparison | Positive base | Positive rung | rung minus base (points) [95% CI, task-clustered] | p (two-sided, sign-flip) | Holm-adjusted p (family) | Tasks | Pairs | Excluded |
|---|---|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 0 / 51 | 0 / 51 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 17 | 51 | 0 |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 0 / 51 | 0 / 51 | +0 [+0, +0] | 1.000 (degenerate) | 1.000 (1) | 17 | 51 | 0 |

Cost, wall and tokens over all tasks: medians (base, rung); paired difference rung minus base [95% CI, task-clustered]. Wall per turn is confounded with the machine when the two cells ran on different shards.

| Harness | Model | Comparison | USD per trial | Wall s per turn | Harness input tokens per trial | Pairs | Machines |
|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl vs told-acl | 0.1751, 0.2340; +0.0527 [+0.0368, +0.0681] | 17.9, 20.2; +2.7 [+1.7, +3.6] | 279,362, 335,827; +59,440 [+35,670, +84,209] | 51 | different machines (cc-told on vmtkf6r2, cc-installer on vmbe25fg) |
| codex | openai:gpt-6.1-sol | installer-acl vs told-acl | 0.1458, 0.1956; +0.0411 [+0.0285, +0.0538] | 15.0, 21.1; +4.9 [+4.0, +5.8] | 234,549, 365,610; +103,598 [+71,498, +135,277] | 51 | different machines (cx-told on vm4pjx7m, cx-installer on vmkzwdek) |

Against none (descriptive, all tasks, no test): positives none, rung; rung minus none (points) [95% CI, task-clustered].

| Harness | Model | Rung | Cell | none cell | Pass | gbrain use | Cross-scope via gbrain | Exposure via gbrain |
|---|---|---|---|---|---|---|---|---|
| claude-code | anthropic:claude-opus-5-5 | installer-acl | `claude-code-opus-gbrain-installer-acl-mu-v03-dev` | `claude-code-opus-none-acl-mu-v03-dev` | 46 / 51, 50 / 51; +8 [+0, +22] | 0 / 51, 51 / 51; +100 [+100, +100] | 0 / 51, 0 / 51; +0 [+0, +0] | 0 / 51, 0 / 51; +0 [+0, +0] |
| claude-code | anthropic:claude-opus-5-5 | told-acl | `claude-code-opus-gbrain-told-acl-mu-v03-dev` | `claude-code-opus-none-acl-mu-v03-dev` | 46 / 51, 49 / 51; +6 [-4, +20] | 0 / 51, 43 / 51; +84 [+71, +96] | 0 / 51, 0 / 51; +0 [+0, +0] | 0 / 51, 0 / 51; +0 [+0, +0] |
| codex | openai:gpt-6.1-sol | installer-acl | `codex-sol-gbrain-installer-acl-mu-v03-dev` | `codex-sol-none-acl-mu-v03-dev` | 43 / 51, 49 / 51; +12 [+0, +24] | 0 / 51, 51 / 51; +100 [+100, +100] | 0 / 51, 0 / 51; +0 [+0, +0] | 0 / 51, 0 / 51; +0 [+0, +0] |
| codex | openai:gpt-6.1-sol | told-acl | `codex-sol-gbrain-told-acl-mu-v03-dev` | `codex-sol-none-acl-mu-v03-dev` | 43 / 51, 45 / 51; +4 [+0, +10] | 0 / 51, 51 / 51; +100 [+100, +100] | 0 / 51, 0 / 51; +0 [+0, +0] | 0 / 51, 0 / 51; +0 [+0, +0] |

Exposure via gbrain, counts per cell over all tasks (graded with this checkout's grader, tasks and world at 289aa043666fb72b5fafb81dca0f31cd0c28284b): trials with exposure of trials with a value; returned and refused cross-scope records and unmapped returned pages and facts by gbrain tool. A nonzero unmapped count means the cell's exposure is not ready to publish.

| Cell | Rung | Trials with exposure | No value | Returned by tool | Refused by tool | Unmapped |
|---|---|---|---|---|---|---|
| `claude-code-opus-gbrain-installer-acl-mu-v03-dev` | installer-acl | 0 / 51 | 0 | 0 | 0 | 12 (map these before publishing) |
| `claude-code-opus-gbrain-told-acl-mu-v03-dev` | told-acl | 0 / 51 | 0 | 0 | 0 | 7 (map these before publishing) |
| `claude-code-opus-none-acl-mu-v03-dev` | none | 0 / 51 | 0 | 0 | 0 | 0 |
| `codex-sol-gbrain-installer-acl-mu-v03-dev` | installer-acl | 0 / 51 | 0 | 0 | 0 | 8 (map these before publishing) |
| `codex-sol-gbrain-told-acl-mu-v03-dev` | told-acl | 0 / 51 | 0 | 0 | 0 | 12 (map these before publishing) |
| `codex-sol-none-acl-mu-v03-dev` | none | 0 / 51 | 0 | 0 | 0 | 0 |

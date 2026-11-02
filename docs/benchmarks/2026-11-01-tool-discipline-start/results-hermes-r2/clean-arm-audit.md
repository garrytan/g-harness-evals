# Clean-arm audit (scripts/tool-discipline/clean-arm-audit.ts)

| arm | dispatched | trials with a gstack skill read | reads in tool calls (evidence.ts) | reads in transcripts (state.db) | trials whose system prompt lists a gstack skill | trials naming a Capy drive path | unaudited (state.db missing, empty or undecodable) | trials that downloaded Tirith | no agent.log | none arm |
|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 24 | 8 | 8 | 8 | 24 | 0 | 0 | 0 | 0 | n/a |
| candidate | 24 | 8 | 9 | 20 | 24 | 0 | 0 | 0 | 0 | n/a |
| none | 24 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | clean |


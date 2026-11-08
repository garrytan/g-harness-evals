# H10 wave-1 smoke measurement (uncounted)

Receipts for Amendment 1 of [PREREGISTRATION.md](../PREREGISTRATION.md). Each smoke is one uncounted trial of a gbrain cell on `sy-01-quarrendon-ticket-numbers` (one member turn), run on 2026-11-07 at `45eb516257b1` on a Ubicloud standard-16 VM.

- `cx`: the two smokes the counted canary finished before the smoke-cost gate stopped it (run id `h10-instruction-placement-2026-11-smoke-cx`).
- `cc-cli`, `cc-sdk`, `he`, `oc`: smoke-only runs under a scratch preregistration (run ids `h10-instruction-placement-2026-11-smoke-<shard>`).

Per shard: `<shard>.trials.jsonl` (the smoke trial records), `<shard>.ledger.sqlite` (the smoke lease's ledger), `<shard>.proxy-usage.ndjson` (one line per proxied request) and `<shard>.smoke-prereg.json` (the scratch preregistration the smoke ran). Per-trial directories stay off the repository.

$/turn = max(`usage.usd`, the ledger entries for the trial) / `turns.run`. Requests include refused ones.

| Shard | Cell | Model | Termination | Grade | $/turn | Requests (refused) | Input | Cached | Output |
|---|---|---|---|---|---:|---|---:|---:|---:|
| cc-cli | claude-code-opus-gbrain-route-tool-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2259 | 6 (0) | 151,185 | 119,619 | 2,210 |
| cc-cli | claude-code-opus-gbrain-route-hook-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2396 | 7 (0) | 217,427 | 187,831 | 2,705 |
| cc-cli | claude-code-opus-gbrain-route-startup-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2840 | 8 (0) | 278,966 | 244,972 | 3,251 |
| cc-cli | claude-code-opus-gbrain-route-system-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2668 | 5 (0) | 150,534 | 110,073 | 2,125 |
| cc-cli | claude-code-opus-gbrain-route-once-mu-v03-dev | anthropic:claude-opus-5-5 | completed | fail | 0.1502 | 7 (0) | 198,075 | 184,189 | 2,195 |
| cc-sdk | claude-code-opus-gbrain-sdk-preset-route-tool-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2714 | 8 (0) | 217,408 | 181,522 | 2,785 |
| cc-sdk | claude-code-opus-gbrain-sdk-preset-route-told-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2539 | 7 (0) | 217,535 | 183,584 | 2,372 |
| cc-sdk | claude-code-opus-gbrain-sdk-default-route-skill-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.1608 | 6 (0) | 138,371 | 119,767 | 2,192 |
| cc-sdk | claude-code-opus-gbrain-sdk-default-route-told-mu-v03-dev | anthropic:claude-opus-5-5 | completed | pass | 0.2479 | 8 (0) | 237,225 | 205,550 | 2,422 |
| cc-sdk | claude-code-opus-gbrain-sdk-preset-route-skill-mu-v03-dev | anthropic:claude-opus-5-5 | model_error, cap_stop | n/a | 0.1397 | 6 (1) | 145,701 | 129,564 | 1,655 |
| cx | codex-sol-gbrain-route-tool-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1287 | 7 (0) | 209,816 | 168,489 | 855 |
| cx | codex-sol-gbrain-route-hook-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1253 | 7 (0) | 200,433 | 160,113 | 857 |
| he | hermes-sol-gbrain-route-tool-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1024 | 13 (7) | 175,314 | 144,398 | 1,069 |
| he | hermes-sol-gbrain-route-placebo-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0776 | 12 (7) | 131,516 | 108,062 | 819 |
| he | hermes-sol-gbrain-route-hook-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0976 | 13 (7) | 185,829 | 156,599 | 889 |
| he | hermes-sol-gbrain-route-once-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0919 | 12 (7) | 156,236 | 127,808 | 808 |
| he | hermes-sol-gbrain-route-system-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0949 | 12 (7) | 155,696 | 126,458 | 916 |
| he | hermes-sol-gbrain-route-skill-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0903 | 12 (7) | 151,665 | 124,106 | 899 |
| he | hermes-sol-gbrain-route-startup-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0846 | 11 (7) | 126,201 | 100,000 | 908 |
| oc | openclaw-sol-gbrain-route-tool-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.0943 | 10 (0) | 180,373 | 152,014 | 818 |
| oc | openclaw-sol-gbrain-route-hook-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1092 | 15 (0) | 307,755 | 278,412 | 801 |
| oc | openclaw-sol-gbrain-route-skill-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1813 | 16 (0) | 338,640 | 282,327 | 1,229 |
| oc | openclaw-sol-gbrain-route-startup-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1973 | 18 (0) | 414,268 | 354,914 | 1,342 |
| oc | openclaw-sol-gbrain-route-once-mu-v03-dev | openai:gpt-6.1-sol | completed | pass | 0.1154 | 14 (0) | 285,815 | 253,496 | 924 |

The `cx` `route-told` smoke was in flight at the interrupt and has no record; its call's $1.6117 reservation stays open in `cx.ledger.sqlite` (Amendment 1, Limits).

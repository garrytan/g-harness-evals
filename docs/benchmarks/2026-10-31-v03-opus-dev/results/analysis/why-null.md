# v03-opus-dev-2026-10: Why null? figures (analysis/why-null.ts)

Scored trials only. gbrain calls exclude initialize and tools/list. Bot world reads are the assistant's own conversations.history and files.read events.

## Told-scoped and none, per harness and family

| Family | OpenClaw told-scoped | OpenClaw none | Hermes told-scoped | Hermes none | gbrain calls per told-scoped trial (OpenClaw, Hermes) | Told-scoped trials with a gbrain call (OpenClaw, Hermes) |
|---|---|---|---|---|---|---|
| scope isolation | 20 / 20 | 9 / 9 | 20 / 20 | 12 / 12 | 1.25, 1.55 | 19 of 20, 19 of 20 |
| shared channel | 10 / 10 | 5 / 6 | 10 / 10 | 4 / 6 | 2.10, 2.50 | 9 of 10, 10 of 10 |
| synthesis | 15 / 15 | not run | 14 / 15 | 9 / 9 | 1.13, 1.00 | 15 of 15, 11 of 15 |
| continuity | 20 / 20 | 12 / 12 | 20 / 20 | 12 / 12 | 1.60, 1.25 | 19 of 20, 16 of 20 |
| corrections | 5 / 20 | 3 / 12 | 4 / 20 | 4 / 12 | 1.70, 2.25 | 16 of 20, 18 of 20 |
| approval relay | 14 / 15 | 7 / 9 | 12 / 15 | 8 / 9 | 0.73, 0.87 | 8 of 15, 6 of 15 |

## Bot world reads per scored trial, both harnesses pooled

| Config | Scored trials | gbrain calls per trial | conversations.history per trial | files.read per trial |
|---|---|---|---|---|
| told-scoped | 200 | 1.47 | 1.38 | 0.62 |
| told-company | 120 | 1.44 | 1.23 | 0.70 |
| none | 108 | 0.00 | 2.03 | 1.06 |

## Tasks with no gbrain call in any trial of a gbrain cell

- ar-02-quarrendon-rate-hollis: openclaw-gbrain-told-scoped (5 trials)
- ar-02-quarrendon-rate-hollis: hermes-gbrain-told-scoped (5 trials)
- ar-02-quarrendon-rate-hollis: openclaw-gbrain-told-company (3 trials)

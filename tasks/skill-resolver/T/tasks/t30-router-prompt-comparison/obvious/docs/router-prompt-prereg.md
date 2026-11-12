# Router prompt v1 vs v2: evaluation plan

Written before any paid runs so the success criteria cannot drift.

## Hypothesis

Prompt v2 (queue descriptions plus worked examples) routes tickets more accurately than v1, and in particular sends fewer outage tickets to "other".

## Models and conditions

| Model | Prompt |
|---|---|
| claude-opus-5-5 | v1, v2 |
| gpt-6.1-sol | v1, v2 |

Temperature 0, same output limit for every run.

## Data

- Development: data/dev.jsonl, 240 labelled tickets. All prompt iteration happens here.
- Holdout: data/holdout.jsonl, 120 tickets. Used once before (September, router v1 on gpt-5.5). We only score it once at the end, after the decision criteria below are met on dev.

## Metrics and success criteria

1. Queue accuracy: v2 must beat v1 by at least 3 points on each model.
2. Outage tickets routed to "other": v2 must send at most 1 of them there (v1 baseline: 7 of 41).

If either criterion fails, we keep v1.

## Scoring

The scorer must require exactly one valid queue name. Answers that hedge ("billing or refunds") or name a queue that does not exist get no credit; we will add a few such answers to check the scorer before trusting it.

## Budget and stopping

- Total budget $150; Lena approves anything above.
- Run a small pilot (3 tickets per condition) first and project the full cost.
- Stop if the projection exceeds the budget, if the pilot shows v2 clearly worse, or on repeated provider errors.

## What we will report

Accuracy and outage-to-other counts per model and prompt, with the holdout result last.

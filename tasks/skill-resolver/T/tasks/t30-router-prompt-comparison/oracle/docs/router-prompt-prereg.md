# Preregistration: ticket router prompt v1 vs v2

Frozen before the first priced call. Any change to a bar, arm, decoy or stop rule after the pilot starts is a new evaluation with a new preregistration.

## Bars

- queue_accuracy: v2 at least 3 points above v1 on data/dev.jsonl, per model, higher is better. A miss means v2 does not replace v1.
- outage_to_other: v2 sends at most 1 of the outage tickets in the holdout to "other" (v1 baseline: 7 of 41 last quarter), lower is better. A miss means v2 does not ship even if accuracy rises.
- decoy_rejection: the scorer gives 0 credit to every decoy answer, higher is better. A miss means the scorer is fixed and the run restarts with a new preregistration.

## Arms

- claude-opus-5-5#router-v1: prompts/router-v1.txt, temperature 0, output budget 8,192, per-item cost from the arms step.
- claude-opus-5-5#router-v2: prompts/router-v2.txt, same settings.
- gpt-6.1-sol#router-v1: prompts/router-v1.txt, same settings.
- gpt-6.1-sol#router-v2: prompts/router-v2.txt, same settings.

## Comparison

stack: none
why: both arms are plain prompts with no skill stack loaded; the comparison is prompt v1 against prompt v2 on the same model.

## Decoys

- 20 decoy answers mixed into scoring: 8 hedged answers ("billing or refunds"), 6 answers naming a queue that does not exist ("payments"), 6 answers with the right queue buried in a sentence that names a second queue.
- Made by hand from dev tickets. A decoy pass means the string-match scorer Raj worried about gives credit for hedging, so the accuracy bar cannot be trusted.

## Stop rules

- Spend cap: $150 for pilot and full run together; stop at the cap, never split calls to fit.
- The pilot misses a bar: stop and report, no full run.
- The scorer passes any decoy: stop, fix the scorer, new preregistration.
- budget_exhausted from the ledger: stop.
- First quota or rate-limit error on a seat-metered arm: stop, no retry.

## Held-out exposure

- data/holdout.jsonl (120 tickets): used once, September 2026, by Raj, router v1 on gpt-5.5, for the Q3 review. No other exposure.
- Reservation: read only for the final scored run after the bars are met on dev; never read during the dry run or pilot, never pasted into a prompt or summarized.

# qm-s1-edition analysis

**Verdict: CUT.** Why: the pooled difference is -0.0023, not above 0; the pooled sign-flip p is 0.9665, not below 0.05; openai:gpt-6.1-sol's point estimate is -0.0625, below 0.

Task success, edition minus plain, in points. Task-clustered bootstrap 95 percent intervals and two-sided sign-flip p over tasks, 10000 draws, seed 7. 1728 trials from 1728 records (0 reruns).

## Primary: edition minus plain

Decides the verdict.

| Model | Tasks | plain | edition | Difference | Interval | p |
|---|---:|---:|---:|---:|---|---:|
| anthropic:claude-opus-5-5 | 24 | 47.7 | 53.5 | 5.8 | [1.4, 10.4] | 0.0331 |
| openai:gpt-6.1-sol | 24 | 53.0 | 46.8 | -6.3 | [-15.5, 1.6] | 0.2156 |
| pooled | 24 | 50.3 | 50.1 | -0.2 | [-5.4, 4.6] | 0.9665 |

## By family: review

Descriptive.

| Model | Tasks | plain | edition | Difference | Interval | p |
|---|---:|---:|---:|---:|---|---:|
| anthropic:claude-opus-5-5 | 24 | 47.7 | 53.5 | 5.8 | [1.4, 10.4] | 0.0331 |
| openai:gpt-6.1-sol | 24 | 53.0 | 46.8 | -6.3 | [-15.5, 1.6] | 0.2156 |
| pooled | 24 | 50.3 | 50.1 | -0.2 | [-5.4, 4.6] | 0.9665 |

## Forced exposure minus plain

Descriptive, outside the win rule.

| Model | Tasks | plain | forced | Difference | Interval | p |
|---|---:|---:|---:|---:|---|---:|
| anthropic:claude-opus-5-5 | 0 | n/a | n/a | n/a | n/a | n/a |
| openai:gpt-6.1-sol | 0 | n/a | n/a | n/a | n/a | n/a |
| pooled | 0 | n/a | n/a | n/a | n/a | n/a |

## Forced exposure minus edition

Descriptive, outside the win rule.

| Model | Tasks | edition | forced | Difference | Interval | p |
|---|---:|---:|---:|---:|---|---:|
| anthropic:claude-opus-5-5 | 0 | n/a | n/a | n/a | n/a | n/a |
| openai:gpt-6.1-sol | 0 | n/a | n/a | n/a | n/a | n/a |
| pooled | 0 | n/a | n/a | n/a | n/a | n/a |

## Per arm (descriptive)

| Cell | Trials | Excluded | Success | Interval | Matched open | Any open | Complete read | First step | Approvals | Contaminated | Cost per task | Cost per success | Reply chars (mean) | Wall s (mean) |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| anthropic:claude-opus-5-5/edition | 432 | 0 (0.0%) | 231/432 (53.5%) | [41.7, 65.0] | 0/432 | 0/432 | 0/432 | 0/432 | 2 | 0 | $0.0718 | $0.1343 | 2113 | 19.4 |
| anthropic:claude-opus-5-5/plain | 432 | 0 (0.0%) | 206/432 (47.7%) | [36.6, 59.3] | 0/432 | 0/432 | 0/432 | 0/432 | 2 | 0 | $0.0725 | $0.1521 | 2173 | 19.5 |
| openai:gpt-6.1-sol/edition | 432 | 0 (0.0%) | 202/432 (46.8%) | [28.7, 65.3] | 432/432 | 432/432 | 432/432 | 432/432 | 1 | 0 | $0.0492 | $0.1052 | 970 | 18.7 |
| openai:gpt-6.1-sol/plain | 432 | 0 (0.0%) | 229/432 (53.0%) | [35.0, 71.5] | 0/432 | 0/432 | 0/432 | 0/432 | 2 | 0 | $0.0455 | $0.0858 | 1131 | 20.7 |
| pooled/edition | 864 | 0 (0.0%) | 433/864 (50.1%) | [37.5, 63.0] | 432/864 | 432/864 | 432/864 | 432/864 | 3 | 0 | $0.0605 | $0.1207 | 1542 | 19.1 |
| pooled/plain | 864 | 0 (0.0%) | 435/864 (50.3%) | [38.0, 62.8] | 0/864 | 0/864 | 0/864 | 0/864 | 4 | 0 | $0.0590 | $0.1172 | 1652 | 20.1 |

## Exclusion rate, edition against plain

| Model | Edition | Plain | Gap | Flag (above 5 points) |
|---|---:|---:|---:|---|
| anthropic:claude-opus-5-5 | 0.0% | 0.0% | 0.0 | no |
| openai:gpt-6.1-sol | 0.0% | 0.0% | 0.0 | no |
| pooled | 0.0% | 0.0% | 0.0 | no |

## Graders

- review: edition-grade/1 (1728)

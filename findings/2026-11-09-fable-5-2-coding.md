---
id: 2026-11-09-fable-5-2-coding
kind: finding
title: "Claude Fable 5.2 vs Fable 5.1 and Opus 5.5 on coding tasks in Claude Code"
status: open
grade: "confirmatory (preregistered full design, amendments 1 to 3; amendment 1's rules were fixed before any data; the script computing three of its lines was written after the results)"
repo_commit: "the head this file merges at (the results pull request's ship receipt names it)"
prereg: "docs/benchmarks/2026-11-09-fable-5-2-coding/PREREGISTRATION.md at b5b71c6c7d35d457fc0be07f0d0d45f1bee36036 (#366), with amendments 1 to 3 in AMENDMENTS.md. The five shards amendment 3 completed ran from 97c1bc5ae6eb96b4ca52fb4f5e9f20a70b0ca1bb (tag fable-5-2-coding-amendment-3)"
data: "in-repo receipts. sha256 of docs/benchmarks/2026-11-09-fable-5-2-coding/results/merged/trials.jsonl: 956e8c78b6b130d4ef479e226e0096c4c50d176ddf73f29b784c812e800d16ff; of results/merged/trials-full.jsonl: 1d007fb341c4f08bb2b7cff478dcf38325aa8a3779896e2c4b46e577b407d642"
author: "internal-task"
reviewed_by: "the results pull request's /ship review, 2026-11-10: one claim-check reader (Claude Opus 5.5), the batched specialist reader (Claude Opus 5.5), the native adversarial voice (Claude Opus 5.5), the outside voice (GPT-6.1 Sol) and one fix-check reader (Claude Opus 5.5); see Claim check"
disclosures: "none: the file features Anthropic's models and Claude Code, and Anthropic gets no disclosure line"
---

# Claude Fable 5.2 vs Fable 5.1 and Opus 5.5 on coding tasks (2026-11-09)

**Status:** results and report in the tree, not posted. Claim check by the results pull request's /ship review; its correction is applied (see Claim check).

## What we found

- **We learned that Fable 5.2 solved fewer coding tasks than Opus 5.5 and cost about 3 times as much per solved task. You should keep Opus 5.5 as your default coding model in Claude Code.** Pass rate 78.8% against 89.4% on 52 tasks: 10.6 points lower (95% range: 3.8 to 18.3 points lower). Fable 5.2 did worse on 8 tasks and better on none. Cost per solved task: $2.04 against $0.61, 3.34 times as much (95% range: 2.63 to 4.22 times).
- **We learned that Opus 5.5 already solves almost 9 in 10 of these tasks, so this test had little room to show any model beating it. You should check a new model against Opus on harder tasks before believing it is better.** Fable 5.2 could have gained at most about 11 points here, and the smallest gap the run could reliably catch was about 10 points. A loss could show, and it did.
- **We learned that Fable 5.2 is probably a little better than Fable 5.1, but this run could not prove it. You should not expect a clear gain from moving Fable 5.1 work to Fable 5.2.** +4.9 points (95% range: 6.9 lower to 16.7 higher) on the 51 tasks Fable 5.1 has scored, 10 tasks better and 7 worse, at a cost per solved task that is a little lower but not measurably so (0.81 times, 95% range 0.64 to 1.02). Fable 5.2 was steadier between its two attempts (they disagreed on 3.8% of tasks, against 18.0%).

## How it works

A "95% range" means the true value is very likely inside it; a range for a difference that includes zero means no difference was shown.

## Setup

The three models ran in Claude Code 2.1.312 with the same settings (effort high, web tools off) on the 52 Terminal-Bench 2.1 tasks, two attempts each, scored by each task's own tests.

## Result

| Model | Pass rate [95% range] | Cost per solved task [95% range] | Median minutes per attempt |
|---|---|---|---|
| Fable 5.2 | 78.8% [67.3%, 88.5%] | $2.04 [$1.30, $2.98] | 6.4 |
| Fable 5.1 | 73.5% [62.7%, 83.3%] | $2.22 [$1.52, $3.11] | 6.1 |
| Opus 5.5 | 89.4% [80.8%, 96.2%] | $0.61 [$0.41, $0.86] | 4.9 |

Rows are not a ranking.

**Verdict:** keep Opus 5.5 as the coding default. Fable 5.2 vs Fable 5.1 needs a bigger task set to settle.

Full report, first results next to the full design, every check and every deviation: [docs/benchmarks/2026-11-09-fable-5-2-coding/report.md](../docs/benchmarks/2026-11-09-fable-5-2-coding/report.md).

## Cost

Cost per solved task for each model is in the table above, and the two cost-counting problems are under Limits.

## Why null? (R48)

Not applicable: this run compares models, not a gstack or gbrain part. The report's "Why null?" section covers the Fable 5.2 vs Fable 5.1 result.

## Limits and threats

**What went wrong, and why it doesn't change the answer:**

- **The first results were incomplete.** 5 of 12 cloud machines got no capacity at first, and those shards ran later, unchanged. The first results had Opus on only 24 tasks, and there Fable 5.2's gap to Opus did not show (-6.3 points, 95% range -16.7 to 0.0). The full design shows it.
- **Safety filters.** Fable 5.2's cyber filter stopped it on 2 cryptanalysis tasks that Opus solved ([transcripts](../docs/benchmarks/2026-11-09-fable-5-2-coding/results/safeguard-stops/README.md)). Without those 2 tasks, Fable 5.2 is still 8.0 points below Opus (95% range: 2.0 to 15.0 lower; descriptive, chosen after the data).
- **Claude Code 2.1.312 did not recognise Fable 5.2** and treated it as a 200K-token model, so it summarised the conversation early in 3 attempts. All 3 passed.
- **The first launch's time stop cut off 3 Fable 5.1 attempts.** The analysis script excluded one and scored the other two as fails. The preregistration says attempts unfinished at the stop are not scored, so the numbers above leave all 3 out. Counted as fails, Fable 5.2's lead over Fable 5.1 would read +7.7 points instead of +4.9. The Opus comparison is the same either way.
- **Our test's network proxy cut API calls that took more than 15 seconds to start replying.** Claude Code resent them, and the cut calls were still billed. That hit 24 Fable 5.2 calls and no others in the proxy records that survived (one interrupted Fable 5.1 shard lost $9.85 of its log). Without them, Fable 5.2 costs 3.29 times Opus per solved task (95% range 2.59 to 4.14) instead of 3.34 times. Separately, 3 calls that stalled (2 Fable 5.2, 1 Fable 5.1) were billed at their full worst-case reservation; without those too, the ratio is 3.06 times.

## Replicate it

The preregistration gives the tasks, settings and fan-out command, and the report gives every deviation. `bun test tests/fable-5-2-coding-analysis-regen.test.ts` rebuilds the 11 committed analysis.json and analysis.md pairs byte for byte from the committed trials. It does not cover results/analysis-full/amendment-1-lines.json, which a separate script built.

## What is held out, and why

Nothing that a number here rests on. The per-shard proxy usage logs are not committed, so the cut-call and stalled-stream lines can't be rebuilt from this repository alone; the report says so, and the adjusted trial files and call lists are committed.

## Claim check

The results pull request's /ship review read this file and the report on 2026-11-10: one claim-check reader (Claude Opus 5.5), the batched specialist reader (Claude Opus 5.5), the native adversarial voice (Claude Opus 5.5), the outside voice (GPT-6.1 Sol) and one fix-check reader (Claude Opus 5.5). The claim check found that the analysis script had scored as fails two Fable 5.1 attempts the time stop cut off; the numbers above leave them out, as amendment 1 requires. Wording notes from the other readers are applied.

## Chart and post

No chart or post yet.

## Changelog

### 2026-11-10: first version

Results, verdict and limits from the report, in the shared finding template. Why: the run is complete.

## Disclosures

None. This file features Anthropic's models and Claude Code, and Anthropic gets no disclosure line.

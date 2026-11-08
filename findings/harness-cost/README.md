# With the model fixed, harnesses differ on cost more than on pass rate

- **We learned that, with the model fixed, we couldn't tell harnesses apart on how often they solved our tasks. You should not pick a harness on pass rate from tasks this easy.**
- **We learned that one harness cost about twice as much per solved task as the others on the same model. You should compare harnesses on cost per solved task, on your own work.**
- **We learned that most of that gap was context re-sent on every request. You should check how much a harness re-sends before you pick it.**

## Evidence

- **The run.** Seven plain harness setups on 20 public tasks, 4 repetitions each, 560 trials. On Opus 5.5: Claude Code, OpenClaw, Hermes Agent and QM. On GPT-6.1 Sol: Codex, OpenClaw and Hermes Agent.
- **Pass rate.** Every cell passed between 71.3% and 78.8%, and every interval is 32 to 39 points wide. All six preregistered comparisons: can't tell apart.
- **Cost per solved task on Opus.** OpenClaw **$0.44 [$0.33, $0.63]**. Claude Code $0.22 [$0.16, $0.30], Hermes $0.24 [$0.18, $0.36] and QM $0.19 [$0.13, $0.28]. On Sol, Codex, OpenClaw and Hermes ran $0.17 to $0.22 (descriptive, no test).
- **Where the gap comes from.** In a separate cost breakdown run on the same task set, Claude Code cost $0.165 less per trial than OpenClaw on Opus [-$0.206, -$0.128], at the same pass rate (80% each). About 81% of the gap is cache writes: OpenClaw re-sends a much bigger system prompt and bigger tool results.

**Main caveat:** these tasks are too easy to separate harnesses. 14 of the 20 tasks scored the same in every cell, so a pass-rate gap smaller than 7.7 to 14.2 points could hide here. The cost gap is descriptive, with no test. Every number is dev, at the pinned versions.

## More

- [Addendum: incomplete cells, the other cost contrasts and the verdict](addendum-details.md)
- [Matrix report](../../docs/benchmarks/2026-11-04-matrix-mu/report.md) and [cost breakdown report](../../docs/benchmarks/2026-11-01-waterfall-frontier/report.md)
- The [scoreboard](../../docs/scoreboard.md) shows the full table.

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

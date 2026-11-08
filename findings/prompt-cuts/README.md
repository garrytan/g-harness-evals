# Test prompt cuts on tasks the agent can fail

- **We learned that on easy tasks, no single layer of a harness's built-in prompt measurably bought pass rate, and some layers cost money. You should look for cuts, but treat an easy-task result as a lead, not proof.**
- **We learned that a cut that looked free on easy tasks broke Claude Code on harder tasks that lean on memory. You should test any prompt trim on tasks the agent can fail, and not strip Claude Code's memory text and tool advice together.**

## Evidence

- **On easy tasks** (20 public v0.3 tasks, Claude Code on Opus 5.5, Codex on GPT-6.1 Sol), removing one layer at a time:
  - Claude Code's memory-and-skills text (8.4 KB per request) cut cost per trial by **$0.033 [-$0.046, -$0.022], 19 percent**, with pass +7.5 points [-5.0, +22.5].
  - The advice inside its tool descriptions (14.1 KB per request) cut **$0.013 [-$0.021, -$0.004], 8 percent**, with pass +2.5 [-5.0, +10.0].
  - Codex's identity text (639 bytes per request) cut **$0.004 [-$0.007, -$0.001], 3 percent**, with pass unchanged.
- **On harder v0.4 tasks,** removing Claude Code's memory-and-skills and tool-descriptions layers together dropped its pass rate from **60.4% to 0.0%**: -60.4 points [-79.2, -39.6], Holm p 0.008.
- **The mechanism is Claude Code's own memory.** The full prompt wrote auto-memory files in 37 of 48 trials, and every one of its 29 passes had them. The cut arms wrote none in 96 trials.

**Main caveat:** dev results at the pinned versions. The two layers were cut together, so the loss can't be pinned on one of them. Codex's identity cut still stands but is untested on hard tasks.

## More

- [Addendum: the other layers, the safety keeps and the verdicts](addendum-details.md)
- [First report, on easy tasks](../../docs/benchmarks/2026-11-01-prompt-archaeology/report.md) and follow-up, on harder tasks

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

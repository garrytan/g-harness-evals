# Prompt cuts: details

Addendum to [Test prompt cuts on tasks the agent can fail](README.md). Figures are from the [first report](../../docs/benchmarks/2026-11-01-prompt-archaeology/report.md) (v0.3 tasks) and the [follow-up](../../docs/benchmarks/2026-11-06-prompt-archaeology-joint/report.md) (v0.4 tasks).

## The first run, on easy tasks

- **Across 27 single-layer cells and 4 minimal cells,** no removal lowered the pass rate by a Holm-significant margin. Every Holm p is 1.000.
- **Claude Code's whole removable prompt at once** (28.8 KB per request) cut **$0.050 [-$0.065, -$0.038], 29 percent**, with pass +7.5 [+0.0, +20.0].
- **Every other Codex layer lowered the pass rate a little, all on approval relay.** Each of the other six single-layer removals lowered pass by 5 to 7.5 points (below the 12.4-point minimum detectable difference), and five of them cut cost 5 to 6 percent.
- **Hermes (Opus 5.5) has keep (safety) on 5 of 7 arms,** under the preregistered safety rule. All of it rests on one task, where Opus read outside the asker's scope in every harness.
- **OpenClaw (Opus 5.5):** its minimal prompt cut $0.023 per trial, with pass +7.5.
- **Why so few verdicts:** 22 of every 40 trials sat in task families at or near the ceiling, and 8 more in a family near the floor.
- **One cell, Claude Code with no style text, failed treatment validity** (10.9 percent partial removals), so it gets no verdict.
- All 1,640 counted trials ran: 1,638 completed and 2 timed out.

## The follow-up, on harder tasks

- **Precision.** The minimum detectable difference was 29.1 points at the Holm alpha (24.4 at 0.05), against a plan of 15 to 18, so a small or moderate loss could hide in this run. The loss it found is about twice that size.
- **The price of Claude Code's memory: leaks.** Its full prompt failed a no-leak check in 8 of 48 trials, carrying one member's facts to another.
- **OpenClaw's minimal prompt and Codex's identity text:** the one attempt to retest them on harder tasks hit the floor (the full prompt passed 0 of 12), so these cuts are untested on hard tasks, not shown harmless.

## Verdicts

- Claude Code memory-and-skills and tool descriptions: **KEEP**, judged together. The earlier single-layer cut for memory-and-skills stands for that layer alone only, labelled "not safe with tool-descriptions removed".
- Claude Code's whole removable prompt: **KEEP**.
- OpenClaw's minimal prompt and Codex's identity text: **CUT-CANDIDATE**, from the easy-task run.
- Hermes: **KEEP** on its 5 safety keeps.
- Verdict words are defined in the [glossary](../../docs/glossary.md).

## Disclosures

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

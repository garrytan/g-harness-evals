# Agents fail most by answering from the wrong conversation, and an unscoped brain returns records the asker may not read

- **We learned that when Opus 5.5 and GPT-6.1 Sol fail a multi-user task, the most common reason is reading the channel the question came in and missing the one that held the answer. You should give an agent memory that crosses conversations, and test it, before tuning its prompt.**
- **We learned that a shared brain the agent can search without a per-person scope returns other members' records to the agent. You should bind every brain read to the person asking, in the brain or its installer, not in the prompt.**
- **gstack was not in any of these trials, so this says nothing for or against it.**

## Evidence

- **The data.** No new trials. particle-1 labelled each of 1,998 failed multi-user trials from runs we already had (Opus 5.5 and GPT-6.1 Sol, 6 harnesses) with one root cause from a frozen 20-class codebook. Its labels agreed with Opus 5.5 and GPT-6 Astra gold labels at kappa 0.936 (179 trials).
- **Wrong conversation.** 348 of 784 failures in the default arms (44%). In 208 of them (exploratory) the agent had already acknowledged the correction in another channel, but its session for the asking channel never saw it. All five harnesses in the default arms show it: 9.9 to 15.9% of trials.
- **Unscoped brain.** On 7 paired brain and no-brain arms (106 task units), a pooled measure of retrieval failures was **9.5 points higher with gbrain [+5.4, +13.5]**, significant after Holm across 6 tests (this measure can lean toward "worse" for gbrain; see the caveat below). Almost all of it is one class (descriptive): a gbrain search returning records the asker may not read, 11.6% of brain-arm trials weighted per paired unit (120 of 916, 13.1%, unweighted). The labeller cannot tell a harness-made call from the agent's (it caught 0 of 5 such gold cases), so some of these, mostly from QM's memory provider, may be the harness's.
- **Scoped brains did not show it (descriptive).** Brains whose reads were bound to the asker had that class in 0 to 0.5% of trials. Unscoped ones had it in 15 to 47.5%.

**Main caveat:** the scope comparison is descriptive: scoped and unscoped brains ran on different tasks, harnesses and models. The pooled measure can lean slightly toward "worse" for gbrain by construction, because a brain-arm failure that would otherwise get another class (a leak, an over-refusal, a harness class) can be labelled as one of its two brain-only classes.

## More

- [Report: tables, verdicts, ranked changes and limits](../../docs/benchmarks/2026-11-09-failure-mining/report.md)
- [Preregistration](../../docs/benchmarks/2026-11-09-failure-mining/PREREGISTRATION.md) and [codebook](../../docs/benchmarks/2026-11-09-failure-mining/codebook.md)
- [A shared brain needs per-person access rules](../shared-brain-access/README.md): the installer run where access rules took this exposure to zero

## Disclosures

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Particle, which makes particle-1.

gstack is Garry Tan's own project.

gbrain is Garry Tan's own project.

Disclosure: QM is a project of Y Combinator, which Garry Tan runs.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.

# Where to put a rule so an agent follows it

- **We learned that agents follow a rule they see on every turn. You should put a must-follow rule in a per-turn hook or the system prompt.**
- **We learned that a skill file nobody mentions can sit unread. You should name the skill in the prompt if you rely on it.**
- **We learned that a rule given once fades on later turns of a session. You should repeat it on every turn.**

## Evidence

- **The test.** gbrain's 289-byte rule says "check gbrain first". A turn counts as followed when the agent made a gbrain call before its first reply. Codex, Hermes Agent and OpenClaw ran on GPT-6.1 Sol, and Claude Code on Opus 5.5, over 10 public tasks with 30 member turns.
- **Every turn works.** On GPT-6.1 Sol, the rule got Codex, Hermes and OpenClaw to call gbrain before answering in **30 of 30 member turns** through the per-turn hook, the system prompt and the startup file (system prompt on Codex and Hermes; OpenClaw has no such setting). With no rule, they did it in 4 to 6 of 30.
- **An unmentioned skill works on two harnesses and does nothing on two others.** It worked on Codex (30 of 30) and OpenClaw (29 of 30). On Hermes it did nothing (4 of 30, the same as no rule), and on Claude Code it did nothing either (18 of 30 against 17). On Hermes and Claude Code the model saw the skill's name in every request and opened the skill **0 times in 30 turns** per cell.
- **Naming the skill fixed it on Claude Code.** With "Use the brain-first skill." in the prompt, Claude Code checked gbrain in 30 of 30 turns, against 18 for the unmentioned skill and 17 for no rule.
- **Said once, it fades.** On repeat turns inside a session, a copy given once was followed in 2 of 10 turns on Hermes and 4 of 10 on OpenClaw, against 10 of 10 for the per-turn hook. Pooled over four harnesses that is -38.9 points [-50.0, -27.8].

**Main caveat:** every number is dev: 10 public tasks, one repetition, at the pinned versions. One model per harness, so a harness difference is a harness-and-model difference. The Claude Code and one-time-copy results are descriptive: Opus already checked gbrain in 17 to 18 of 30 turns with no rule, and the one-time-copy contrast could only detect a 39-point gap. The brain had no per-member access rules, so a rule that drives more gbrain search also drives more cross-scope reads (12 trials here); see [A shared brain needs per-person access rules](../shared-brain-access/README.md).

## More

- [Addendum: details, cost, verdicts and how to recheck](addendum-details.md)
- [Full report](../../docs/benchmarks/2026-11-07-h10-instruction-placement/report.md)

## Disclosures

gbrain is Garry Tan's own project.

Disclosure: OpenAI began through YC Research, which was started by Sam Altman, a former president of Y Combinator. Garry Tan runs Y Combinator.

Disclosure: Y Combinator, which Garry Tan runs, is an investor in Hermes.

Disclosure: OpenAI is now the key benefactor of OpenClaw, and OpenClaw's creator, Peter Steinberger, works for OpenAI.
